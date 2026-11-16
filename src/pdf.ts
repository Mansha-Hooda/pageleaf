import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL;

export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfError';
  }
}

async function openDoc(data: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    const task = pdfjs.getDocument({
      data,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      useSystemFonts: true,
    });
    return await task.promise;
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
    if (name === 'PasswordException') {
      throw new PdfError('This PDF is password-protected.');
    }
    throw new PdfError('That file could not be opened as a PDF.');
  }
}

export async function inspectPdf(file: File): Promise<{
  title: string;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  blob: Blob;
  thumb: Blob;
}> {
  const data = new Uint8Array(await file.arrayBuffer());
  const blob = new Blob([data], { type: 'application/pdf' });
  const doc = await openDoc(data.slice());
  try {
    if (doc.numPages < 1) throw new PdfError('This PDF has no pages.');
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    let title = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
    try {
      const meta = await doc.getMetadata();
      const info = meta.info as { Title?: string };
      const fromMeta = info?.Title?.replace(/\s+/g, ' ').trim();
      if (fromMeta && fromMeta.length > 1 && !/^untitled$/i.test(fromMeta)) title = fromMeta;
    } catch {
      /* filename is a fine title */
    }
    const thumb = await renderPageBlob(doc, 1, 420);
    return {
      title: title || 'Untitled',
      pageCount: doc.numPages,
      pageWidth: view.width,
      pageHeight: view.height,
      blob,
      thumb,
    };
  } finally {
    await doc.destroy();
  }
}

async function renderPageBlob(doc: PDFDocumentProxy, pageNumber: number, cssWidth: number): Promise<Blob> {
  const page = await doc.getPage(pageNumber);
  const baseView = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: cssWidth / baseView.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport, background: '#f4efe4' }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('thumb'))), 'image/jpeg', 0.84);
  });
  return blob;
}

export class PdfSession {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  private cache = new Map<number, ImageBitmap>();
  private pending = new Map<number, Promise<void>>();
  private width = 0;
  private dpr = 1;
  private generation = 0;
  private closed = false;
  onUpdate: (() => void) | null = null;

  private constructor(
    private doc: PDFDocumentProxy,
    pageWidth: number,
    pageHeight: number,
  ) {
    this.pageCount = doc.numPages;
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
  }

  static async open(data: ArrayBuffer): Promise<PdfSession> {
    const doc = await openDoc(new Uint8Array(data));
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    return new PdfSession(doc, view.width, view.height);
  }

  setPageWidth(cssWidth: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cssWidth < 8) return;
    if (Math.abs(cssWidth - this.width) < 8 && Math.abs(dpr - this.dpr) < 0.05) return;
    this.width = cssWidth;
    this.dpr = dpr;
    this.generation++;
    this.pending.clear();
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
  }

  cached(index: number): ImageBitmap | null {
    return this.cache.get(index) ?? null;
  }

  warmup(indexes: number[]) {
    for (const index of indexes) void this.ensure(index);
  }

  when(indexes: number[]): Promise<void> {
    const jobs = indexes
      .filter((index) => index >= 0 && index < this.pageCount)
      .map((index) => this.ensure(index));
    return Promise.all(jobs).then(() => undefined);
  }

  private ensure(index: number): Promise<void> {
    if (this.closed || index < 0 || index >= this.pageCount || this.width < 8) return Promise.resolve();
    if (this.cache.has(index)) return Promise.resolve();
    const existing = this.pending.get(index);
    if (existing) return existing;
    const generation = this.generation;
    const width = this.width;
    const dpr = this.dpr;
    const job = this.render(index, width, dpr, generation)
      .catch(() => undefined)
      .finally(() => {
        if (this.pending.get(index) === job) this.pending.delete(index);
      });
    this.pending.set(index, job);
    return job;
  }

  private evict(keep: number) {
    const limit = 8;
    if (this.cache.size <= limit) return;
    const ranked = [...this.cache.keys()].sort((a, b) => Math.abs(b - keep) - Math.abs(a - keep));
    while (this.cache.size > limit && ranked.length) {
      const drop = ranked.shift();
      if (drop == null || drop === keep) continue;
      this.cache.get(drop)?.close();
      this.cache.delete(drop);
    }
  }

  private async render(index: number, cssWidth: number, dpr: number, generation: number) {
    const page = await this.doc.getPage(index + 1);
    if (this.closed || generation !== this.generation) return;
    const baseView = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth * dpr) / baseView.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    if (this.closed || generation !== this.generation) return;
    const bitmap = await createImageBitmap(canvas);
    if (this.closed || generation !== this.generation) {
      bitmap.close();
      return;
    }
    this.cache.set(index, bitmap);
    this.evict(index);
    this.onUpdate?.();
  }

  async destroy() {
    this.closed = true;
    this.generation++;
    for (const bitmap of this.cache.values()) bitmap.close();
    this.cache.clear();
    await this.doc.destroy();
  }
}
