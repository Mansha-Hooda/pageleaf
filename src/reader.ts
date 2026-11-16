import type { BookMeta } from './db';
import { deleteMark, listMarks, putMark, updateBook } from './db';
import { clamp, type Pt } from './geometry';
import {
  drawMarks,
  MARKER_COLORS,
  PEN_COLORS,
  RIBBON_COLORS,
  strokeAt,
  type BookmarkMark,
  type Mark,
  type NormPoint,
  type StrokeMark,
} from './marks';
import { PdfSession } from './pdf';
import { rustle, setSoundEnabled, soundEnabled, unlockSound } from './sound';
import {
  drawBoard,
  drawBookShadow,
  drawCurl,
  drawForeEdge,
  drawGutter,
  drawRestingPage,
  type PageImages,
} from './turn';

type Side = 'left' | 'right';

type View = {
  left: number | null;
  right: number | null;
};

type Curl = {
  side: Side;
  corner: Pt;
  target: Pt;
  vx: number;
  vy: number;
  pointerId: number;
  origin: Pt;
  moved: boolean;
  dragging: boolean;
  commit: boolean;
  dest: Pt;
};

export type Reader = {
  element: HTMLElement;
  close: () => void;
  ready: Promise<void>;
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function openReader(
  meta: BookMeta,
  file: Blob,
  onClose: () => void,
): Promise<Reader> {
  const session = await PdfSession.open(await file.arrayBuffer());
  const marks = await listMarks(meta.id).catch(() => [] as Mark[]);
  const root = document.createElement('section');
  root.className = 'reader';
  root.innerHTML = `
    <div class="stage">
      <canvas class="book"></canvas>
      <canvas class="live"></canvas>
      <div class="ribbons"></div>
      <p class="hint">Pencil draws. A finger turns the page.</p>
      <p class="opening">Opening…</p>
    </div>
    <div class="tools" role="toolbar" aria-label="Page tools">
      <button type="button" data-tool="turn" aria-pressed="true" aria-label="Turn pages">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10.5V5.5a1.5 1.5 0 0 1 3 0V11M13 10.2V7.5a1.5 1.5 0 0 1 3 0V13c0 3.5-2 6.5-6.2 6.5-3.2 0-5.3-2-5.8-4.2L3.2 12A1.4 1.4 0 0 1 5.6 11L7 12.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" data-tool="pen" aria-pressed="false" aria-label="Scribble with the pencil">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 18.5 9.5 8 20H4v-4L14.5 5.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m13 7 4 4" stroke="currentColor" stroke-width="1.6"/></svg>
      </button>
      <button type="button" data-tool="marker" aria-pressed="false" aria-label="Highlight">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 15 8.5-8.5a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L9 19H5v-4Z" fill="currentColor" opacity=".35" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 20h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
      <button type="button" data-action="bookmark" aria-label="Bookmark this page">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.2L6 20V5a1 1 0 0 1 1-1Z" fill="currentColor"/></svg>
      </button>
      <button type="button" data-action="marks" aria-label="Bookmarks">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12M6 12h12M6 19h8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
      <button type="button" data-action="undo" aria-label="Undo last mark">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H4V4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8a8 8 0 1 1-1 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
      <div class="swatches" hidden></div>
    </div>
    <form class="note-card" hidden>
      <p>Note</p>
      <textarea rows="3" placeholder="What did you want to remember?"></textarea>
      <div class="card-actions">
        <button type="submit">Save</button>
        <button type="button" data-action="skip">Close</button>
        <button type="button" data-action="delete-mark">Delete</button>
      </div>
    </form>
    <form class="name-card" hidden>
      <p>Bookmark</p>
      <input type="text" maxlength="48" placeholder="Name this page" />
      <div class="card-actions">
        <button type="submit">Save</button>
        <button type="button" data-action="remove-bookmark">Remove</button>
      </div>
    </form>
    <aside class="mark-list" hidden>
      <div class="mark-list-head">
        <h2>Bookmarks</h2>
        <button type="button" data-action="close-marks" aria-label="Close bookmarks">Close</button>
      </div>
      <ul></ul>
    </aside>
    <header class="chrome top">
      <button type="button" class="icon-btn" data-action="back" aria-label="Back to library">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <h1></h1>
      <button type="button" class="icon-btn" data-action="sound" aria-label="Page sounds"></button>
    </header>
    <footer class="chrome bottom">
      <span class="pages" aria-live="polite"></span>
      <input type="range" min="0" max="${Math.max(0, session.pageCount - 1)}" value="0" aria-label="Page" />
    </footer>
  `;

  const canvas = root.querySelector('canvas.book') as HTMLCanvasElement;
  const liveCanvas = root.querySelector('canvas.live') as HTMLCanvasElement;
  const liveCtx = liveCanvas.getContext('2d');
  const context = canvas.getContext('2d');
  if (!context || !liveCtx) throw new Error('Canvas is not available.');
  const ctx: CanvasRenderingContext2D = context;
  const inkCtx: CanvasRenderingContext2D = liveCtx;
  const title = root.querySelector('h1') as HTMLElement;
  const pages = root.querySelector('.pages') as HTMLElement;
  const range = root.querySelector('footer input') as HTMLInputElement;
  const hint = root.querySelector('.hint') as HTMLElement;
  const opening = root.querySelector('.opening') as HTMLElement;
  const soundBtn = root.querySelector('[data-action="sound"]') as HTMLButtonElement;
  title.textContent = meta.title;

  let focus = clamp(meta.lastPage, 0, session.pageCount - 1);
  let curl: Curl | null = null;
  let tool: 'turn' | 'pen' | 'marker' = 'turn';
  let penColor = PEN_COLORS[0];
  let markerColor = MARKER_COLORS[0];
  let markRevision = 0;
  const undoStack: string[] = [];
  const composites = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  let live: StrokeMark | null = null;
  let livePointer = -1;
  let penIsDown = false;
  let ribbonSig = '';
  const ribbonLayer = root.querySelector('.ribbons') as HTMLElement;
  let raf = 0;
  let springStamp = 0;
  let closed = false;
  let hideTimer = 0;
  const aspect = session.pageWidth / session.pageHeight;

  function spreadNow(): boolean {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return w > h * 1.05;
  }

  function viewFor(page: number): View {
    const count = session.pageCount;
    const p = clamp(page, 0, count - 1);
    if (!spreadNow()) return { left: null, right: p };
    if (p <= 0) return { left: null, right: 0 };
    const leaf = Math.ceil(p / 2);
    const left = leaf * 2 - 1;
    const right = leaf * 2;
    return {
      left: left < count ? left : null,
      right: right < count ? right : null,
    };
  }

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const spread = spreadNow();
    const edge = 16;
    const toolGutter = 58;
    const availW = Math.max(40, w - edge * 2 - toolGutter);
    const availH = Math.max(40, h - 8);
    let pageH = availH;
    let pageW = pageH * aspect;
    const columns = spread ? 2 : 1;
    if (pageW * columns > availW) {
      pageW = availW / columns;
      pageH = pageW / aspect;
    }
    const bookW = pageW * columns;
    const leftX = Math.max(edge, (w - toolGutter - bookW) / 2);
    const rightX = spread ? leftX + pageW : leftX;
    const top = (h - pageH) / 2;
    return { w, h, spread, pageW, pageH, leftX, rightX, top, view: viewFor(focus) };
  }

  function canForward(view: View, spread: boolean): boolean {
    if (!spread) return focus < session.pageCount - 1;
    return view.right != null && view.right + 1 < session.pageCount;
  }

  function canBack(view: View, spread: boolean): boolean {
    if (!spread) return focus > 0;
    return view.left != null;
  }

  function landedTarget(side: Side, corner: Pt, pageW: number): Pt {
    if (side === 'right') return { x: -corner.x, y: corner.y };
    return { x: 2 * pageW - corner.x, y: corner.y };
  }

  function indexesFor(view: View, active: Curl | null, spread: boolean): number[] {
    const found = new Set<number>();
    const add = (index: number | null) => {
      if (index != null && index >= 0 && index < session.pageCount) found.add(index);
    };
    add(view.left);
    add(view.right);
    if (active) {
      const images = curlImages(active.side, view, spread);
      add(images.front);
      add(images.back);
      add(images.under);
    }
    const anchor = view.right ?? view.left ?? 0;
    for (let delta = -3; delta <= 4; delta++) add(anchor + delta);
    return [...found];
  }

  function curlImages(side: Side, view: View, spread: boolean): { front: number | null; back: number | null; under: number | null } {
    if (!spread) {
      if (side === 'right') {
        return { front: focus, back: null, under: focus + 1 < session.pageCount ? focus + 1 : null };
      }
      return { front: focus, back: null, under: focus > 0 ? focus - 1 : null };
    }
    if (side === 'right' && view.right != null) {
      const front = view.right;
      return {
        front,
        back: front + 1 < session.pageCount ? front + 1 : null,
        under: front + 2 < session.pageCount ? front + 2 : null,
      };
    }
    if (side === 'left' && view.left != null) {
      const front = view.left;
      return {
        front,
        back: front > 0 ? front - 1 : null,
        under: front - 2 >= 0 ? front - 2 : null,
      };
    }
    return { front: null, back: null, under: null };
  }

  function strokesOn(index: number): StrokeMark[] {
    return marks.filter((mark): mark is StrokeMark => mark.page === index && mark.kind !== 'bookmark');
  }

  function bitmap(index: number | null): CanvasImageSource | null {
    if (index == null) return null;
    const raw = session.cached(index);
    if (!raw) return null;
    const strokes = strokesOn(index);
    if (!strokes.length) return raw;
    const key = `${index}:${markRevision}:${raw.width}x${raw.height}`;
    const cached = composites.get(index);
    if (cached?.key === key) return cached.canvas;
    const surface = document.createElement('canvas');
    surface.width = raw.width;
    surface.height = raw.height;
    const g = surface.getContext('2d');
    if (!g) return raw;
    g.drawImage(raw, 0, 0);
    drawMarks(g, strokes, surface.width, surface.height);
    composites.set(index, { key, canvas: surface });
    return surface;
  }

  function pageOf(where: { side: Side }, box: ReturnType<typeof layout>): number | null {
    if (!box.spread) return box.view.right;
    return where.side === 'left' ? box.view.left : box.view.right;
  }

  function pageOrigin(page: number, box: ReturnType<typeof layout>): Pt | null {
    if (box.view.left === page) return { x: box.leftX, y: box.top };
    if (box.view.right === page) return { x: box.rightX, y: box.top };
    return null;
  }

  function imagesOf(side: Side, view: View, spread: boolean): PageImages {
    const ids = curlImages(side, view, spread);
    return { front: bitmap(ids.front), under: bitmap(ids.under), back: bitmap(ids.back) };
  }

  function label(view: View): string {
    const shown = [view.left, view.right].filter((p): p is number => p != null);
    if (!shown.length) return '';
    const first = shown[0] + 1;
    const last = shown[shown.length - 1] + 1;
    const span = first === last ? `${first}` : `${first}–${last}`;
    return `${span} of ${session.pageCount}`;
  }

  function paint() {
    const box = layout();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(box.w * dpr));
    const height = Math.max(1, Math.floor(box.h * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (liveCanvas.width !== width || liveCanvas.height !== height) {
      liveCanvas.width = width;
      liveCanvas.height = height;
    }
    session.setPageWidth(box.pageW);
    session.warmup(indexesFor(box.view, curl, box.spread));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const { view, spread, pageW, pageH, leftX, rightX, top } = box;
    drawBookShadow(ctx, leftX + (spread ? pageW : pageW / 2), top + pageH, spread ? pageW * 2 : pageW);

    const passed = view.left ?? (spread ? 0 : focus);
    const ahead = session.pageCount - 1 - (view.right ?? focus);
    if (spread) drawForeEdge(ctx, leftX, top, pageW, pageH, 'left', passed);
    else drawForeEdge(ctx, rightX, top, pageW, pageH, 'left', focus);
    drawForeEdge(ctx, spread ? rightX : rightX, top, pageW, pageH, 'right', ahead);

    const curlingLeft = curl?.side === 'left';
    const curlingRight = curl?.side === 'right';

    if (spread && !curlingLeft) {
      ctx.save();
      ctx.translate(leftX, top);
      if (view.left == null) drawBoard(ctx, pageW, pageH);
      else drawRestingPage(ctx, pageW, pageH, bitmap(view.left));
      ctx.restore();
    }
    if (!(spread ? curlingRight : curl)) {
      ctx.save();
      ctx.translate(rightX, top);
      drawRestingPage(ctx, pageW, pageH, bitmap(view.right));
      ctx.restore();
    }
    if (spread) drawGutter(ctx, rightX, top, pageH);

    if (curl) {
      const originX = curl.side === 'left' && spread ? leftX : rightX;
      ctx.save();
      ctx.translate(originX, top);
      drawCurl(ctx, pageW, pageH, imagesOf(curl.side, view, spread), curl.corner, curl.target);
      ctx.restore();
    }

    inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkCtx.clearRect(0, 0, box.w, box.h);
    if (live && live.points.length) {
      const origin = pageOrigin(live.page, box);
      if (origin) {
        inkCtx.save();
        inkCtx.translate(origin.x, origin.y);
        drawMarks(inkCtx, [live], box.pageW, box.pageH);
        inkCtx.restore();
      }
    }
    syncRibbons(box);

    pages.textContent = label(view);
    const shown = view.right ?? view.left ?? 0;
    if (document.activeElement !== range) range.value = String(shown);
  }

  function pickCorner(local: Pt, side: Side, pageW: number, pageH: number): Pt {
    const outerX = side === 'right' ? pageW : 0;
    const nearOuter = side === 'right' ? local.x > pageW * 0.58 : local.x < pageW * 0.42;
    if (nearOuter && local.y < pageH * 0.3) return { x: outerX, y: 0 };
    if (nearOuter && local.y > pageH * 0.7) return { x: outerX, y: pageH };
    return { x: outerX, y: clamp(local.y, pageH * 0.12, pageH * 0.88) };
  }

  function localPoint(clientX: number, clientY: number): { point: Pt; box: ReturnType<typeof layout> } {
    const rect = canvas.getBoundingClientRect();
    const box = layout();
    return {
      point: { x: clientX - rect.left, y: clientY - rect.top },
      box,
    };
  }

  function hit(point: Pt, box: ReturnType<typeof layout>): { side: Side; local: Pt } | null {
    const within = (x: number, y: number) =>
      point.x >= x && point.x <= x + box.pageW && point.y >= y && point.y <= y + box.pageH;
    if (box.spread && within(box.leftX, box.top)) {
      return { side: 'left', local: { x: point.x - box.leftX, y: point.y - box.top } };
    }
    if (within(box.rightX, box.top)) {
      const local = { x: point.x - box.rightX, y: point.y - box.top };
      const side: Side = box.spread ? 'right' : local.x < box.pageW * 0.5 ? 'left' : 'right';
      return { side, local };
    }
    return null;
  }

  function allowed(side: Side, box: ReturnType<typeof layout>): boolean {
    return side === 'right' ? canForward(box.view, box.spread) : canBack(box.view, box.spread);
  }

  function limitTarget(side: Side, corner: Pt, next: Pt, pageW: number, pageH: number, free: boolean): Pt {
    const dest = landedTarget(side, corner, pageW);
    let x = next.x;
    let y = next.y;
    if (side === 'right') x = clamp(x, dest.x, corner.x + pageW * 0.03);
    else x = clamp(x, corner.x - pageW * 0.03, dest.x);
    if (!free) {
      const cap = pageW * 0.1;
      if (side === 'right') x = Math.max(x, corner.x - cap);
      else x = Math.min(x, corner.x + cap);
    }
    const cornerGrab = corner.y <= 1 || corner.y >= pageH - 1;
    if (!cornerGrab) y = corner.y + (y - corner.y) * 0.4;
    y = clamp(y, -pageH * 0.08, pageH * 1.08);
    return { x, y };
  }

  function travelOf(curlState: Curl, pageW: number): number {
    if (curlState.side === 'right') return (curlState.corner.x - curlState.target.x) / pageW;
    return (curlState.target.x - curlState.corner.x) / pageW;
  }

  function startCurl(side: Side, corner: Pt, pointerId: number, origin: Pt): Curl {
    const next: Curl = {
      side,
      corner,
      target: { ...corner },
      vx: 0,
      vy: 0,
      pointerId,
      origin,
      moved: false,
      dragging: true,
      commit: false,
      dest: { ...corner },
    };
    curl = next;
    return next;
  }

  function finishTurn(side: Side, box: ReturnType<typeof layout>) {
    if (box.spread) {
      if (side === 'right' && box.view.right != null) {
        const landedLeft = box.view.right + 1;
        const landedRight = box.view.right + 2;
        focus = landedRight < session.pageCount ? landedRight : landedLeft;
      } else if (side === 'left' && box.view.left != null) {
        focus = box.view.left <= 1 ? 0 : box.view.left - 1;
      }
    } else if (side === 'right') {
      focus = Math.min(session.pageCount - 1, focus + 1);
    } else {
      focus = Math.max(0, focus - 1);
    }
    curl = null;
    hideCards();
    hint.classList.add('hidden');
    localStorage.setItem('pageleaf-hint', '1');
    rustle(0.9);
    const next = { ...meta, lastPage: focus, lastOpenedAt: Date.now() };
    Object.assign(meta, next);
    void updateBook(next);
    scheduleChrome();
  }

  function releaseCurl(commit: boolean) {
    if (!curl) return;
    const box = layout();
    if (reduceMotion) {
      if (commit) finishTurn(curl.side, box);
      else curl = null;
      paint();
      return;
    }
    curl.dragging = false;
    curl.commit = commit;
    curl.dest = commit ? landedTarget(curl.side, curl.corner, box.pageW) : { ...curl.corner };
    if (commit) rustle(clamp(Math.abs(curl.vx) / 1400, 0.35, 1));
    springStamp = 0;
    ensureFrame();
  }

  function step(now: number): boolean {
    if (!curl || curl.dragging) return false;
    const dt = springStamp ? Math.min(0.032, (now - springStamp) / 1000) : 0.016;
    springStamp = now;
    const stiffness = 340;
    const damping = 38;
    const ax = (curl.dest.x - curl.target.x) * stiffness - curl.vx * damping;
    const ay = (curl.dest.y - curl.target.y) * stiffness - curl.vy * damping;
    curl.vx += ax * dt;
    curl.vy += ay * dt;
    curl.target.x += curl.vx * dt;
    curl.target.y += curl.vy * dt;
    if (curl.commit) {
      if (curl.side === 'right') curl.target.x = Math.max(curl.target.x, curl.dest.x);
      else curl.target.x = Math.min(curl.target.x, curl.dest.x);
    }
    const settled =
      Math.hypot(curl.dest.x - curl.target.x, curl.dest.y - curl.target.y) < 1.2 &&
      Math.hypot(curl.vx, curl.vy) < 40;
    if (!settled) return true;
    if (curl.commit) finishTurn(curl.side, layout());
    else curl = null;
    return false;
  }

  function ensureFrame() {
    if (raf || closed) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      const more = step(now);
      paint();
      if (more) ensureFrame();
    });
  }

  function showChrome() {
    root.classList.add('chrome-on');
    scheduleChrome();
  }

  function scheduleChrome() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => root.classList.remove('chrome-on'), 4200);
  }

  function remember(mark: Mark) {
    markRevision += 1;
    composites.delete(mark.page);
    const index = marks.findIndex((item) => item.id === mark.id);
    if (index >= 0) marks[index] = mark;
    else marks.push(mark);
    void putMark(mark);
  }

  function forget(id: string) {
    const mark = marks.find((item) => item.id === id);
    if (!mark) return;
    markRevision += 1;
    composites.delete(mark.page);
    const index = marks.findIndex((item) => item.id === id);
    if (index >= 0) marks.splice(index, 1);
    void deleteMark(id);
  }

  function commitStroke(drawn: StrokeMark) {
    const mark: StrokeMark = { ...drawn, id: crypto.randomUUID(), points: drawn.points.map((point) => ({ ...point })) };
    undoStack.push(mark.id);
    remember(mark);
    paint();
    if (mark.kind === 'highlight') openNote(mark);
  }

  function hideCards() {
    noteCard.hidden = true;
    nameCard.hidden = true;
  }

  function openNote(mark: StrokeMark) {
    noteCard.hidden = false;
    nameCard.hidden = true;
    noteCard.dataset.id = mark.id;
    noteText.value = mark.note;
    const box = layout();
    const origin = pageOrigin(mark.page, box);
    const anchor = mark.points[mark.points.length - 1] ?? { x: 0.5, y: 0.4, p: 1 };
    const rect = canvas.getBoundingClientRect();
    const left = rect.left + (origin?.x ?? box.rightX) + anchor.x * box.pageW;
    const top = rect.top + (origin?.y ?? box.top) + anchor.y * box.pageH;
    noteCard.style.left = `${clamp(left, 12, window.innerWidth - 280)}px`;
    noteCard.style.top = `${clamp(top, 12, window.innerHeight - 180)}px`;
    noteText.focus();
  }

  function openBookmark(mark: BookmarkMark) {
    nameCard.hidden = false;
    noteCard.hidden = true;
    nameCard.dataset.id = mark.id;
    nameInput.value = mark.name;
    nameCard.style.left = '';
    nameCard.style.top = '';
    nameInput.focus();
  }

  function syncRibbons(box: ReturnType<typeof layout>) {
    const bookmarks = marks.filter((mark): mark is BookmarkMark => mark.kind === 'bookmark');
    const sig = bookmarks.map((mark) => `${mark.id}:${mark.name}:${mark.page}:${mark.color}`).join('|');
    if (sig !== ribbonSig) {
      ribbonSig = sig;
      ribbonLayer.replaceChildren();
      for (const mark of bookmarks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ribbon';
        button.dataset.id = mark.id;
        button.style.setProperty('--ribbon', mark.color);
        button.setAttribute('aria-label', mark.name || `Bookmark on page ${mark.page + 1}`);
        const tag = document.createElement('em');
        tag.textContent = mark.name || `Page ${mark.page + 1}`;
        button.append(tag);
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const current = marks.find((item) => item.id === mark.id);
          if (current?.kind === 'bookmark') openBookmark(current);
        });
        ribbonLayer.append(button);
      }
    }
    ribbonLayer.hidden = curl != null;
    for (const button of ribbonLayer.querySelectorAll<HTMLButtonElement>('.ribbon')) {
      const mark = bookmarks.find((item) => item.id === button.dataset.id);
      const origin = mark ? pageOrigin(mark.page, box) : null;
      if (!mark || !origin || curl) {
        button.hidden = true;
        continue;
      }
      const slot = (mark.page % 4) * 16;
      const onLeft = box.view.left === mark.page;
      button.hidden = false;
      button.style.left = `${onLeft ? origin.x + 28 + slot : origin.x + box.pageW * 0.72 - slot}px`;
      button.style.top = `${origin.y - 14}px`;
    }
  }

  function bookmarkPage() {
    const box = layout();
    const page = box.view.right ?? box.view.left ?? focus;
    const existing = marks.find((mark) => mark.kind === 'bookmark' && mark.page === page);
    if (existing?.kind === 'bookmark') {
      openBookmark(existing);
      return;
    }
    const color = RIBBON_COLORS[marks.filter((mark) => mark.kind === 'bookmark').length % RIBBON_COLORS.length];
    const mark: BookmarkMark = {
      id: crypto.randomUUID(),
      bookId: meta.id,
      page,
      kind: 'bookmark',
      name: '',
      color,
    };
    remember(mark);
    paint();
    openBookmark(mark);
  }

  function showBookmarkList() {
    const list = root.querySelector('.mark-list ul') as HTMLElement;
    const bookmarks = marks
      .filter((mark): mark is BookmarkMark => mark.kind === 'bookmark')
      .sort((a, b) => a.page - b.page);
    list.replaceChildren();
    if (!bookmarks.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-marks';
      empty.textContent = 'No bookmarks yet.';
      list.append(empty);
    }
    for (const mark of bookmarks) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('strong');
      name.textContent = mark.name || 'Untitled';
      const where = document.createElement('span');
      where.textContent = `Page ${mark.page + 1}`;
      button.append(name, where);
      button.addEventListener('click', () => {
        focus = mark.page;
        curl = null;
        const next = { ...meta, lastPage: focus, lastOpenedAt: Date.now() };
        Object.assign(meta, next);
        void updateBook(next);
        markList.hidden = true;
        paint();
      });
      item.append(button);
      list.append(item);
    }
    markList.hidden = false;
  }

  function selectTool(next: 'turn' | 'pen' | 'marker') {
    tool = next;
    root.dataset.tool = next;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.setAttribute('aria-pressed', button.dataset.tool === next ? 'true' : 'false');
    }
    const colors = next === 'pen' ? PEN_COLORS : next === 'marker' ? MARKER_COLORS : [];
    swatches.hidden = colors.length === 0;
    swatches.replaceChildren();
    for (const color of colors) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'swatch';
      dot.style.background = color;
      dot.setAttribute('aria-label', color);
      const active = next === 'pen' ? penColor : markerColor;
      if (color === active) dot.setAttribute('aria-pressed', 'true');
      dot.addEventListener('click', () => {
        if (next === 'pen') penColor = color;
        else markerColor = color;
        selectTool(next);
      });
      swatches.append(dot);
    }
    showChrome();
  }

  function drawingKind(event: PointerEvent): 'pen' | 'marker' | null {
    if (penIsDown && event.pointerType === 'touch') return null;
    if (event.pointerType === 'pen') return tool === 'marker' ? 'marker' : 'pen';
    if (tool === 'pen' || tool === 'marker') return tool;
    return null;
  }

  function addLivePoint(event: PointerEvent, box: ReturnType<typeof layout>) {
    if (!live) return;
    const origin = pageOrigin(live.page, box);
    if (!origin) return;
    const { point } = localPoint(event.clientX, event.clientY);
    const next: NormPoint = {
      x: clamp((point.x - origin.x) / box.pageW, -0.02, 1.02),
      y: clamp((point.y - origin.y) / box.pageH, -0.02, 1.02),
      p: event.pressure > 0 ? clamp(event.pressure, 0.05, 1) : 0.55,
    };
    const prev = live.points[live.points.length - 1];
    if (prev && Math.hypot(prev.x - next.x, prev.y - next.y) < 0.0015) return;
    live.points.push(next);
  }

  function onPointerDown(event: PointerEvent) {
    if (curl?.dragging) return;
    if (event.button !== 0 && event.pointerType !== 'pen') return;
    unlockSound();
    const kind = drawingKind(event);
    if (kind) {
      const { point, box } = localPoint(event.clientX, event.clientY);
      const where = hit(point, box);
      const page = where ? pageOf(where, box) : null;
      if (!where || page == null) return;
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* The gesture still tracks if the pointer is already gone. */
      }
      hideCards();
      live = {
        id: 'live',
        bookId: meta.id,
        page,
        kind: kind === 'marker' ? 'highlight' : 'ink',
        color: kind === 'marker' ? markerColor : penColor,
        width: kind === 'marker' ? 0.032 : 0.0042,
        points: [],
        note: '',
      };
      penIsDown = event.pointerType === 'pen';
      livePointer = event.pointerId;
      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) addLivePoint(sample, box);
      addLivePoint(event, box);
      paint();
      return;
    }
    if (event.pointerType === 'pen' || penIsDown) return;
    const { point, box } = localPoint(event.clientX, event.clientY);
    const where = hit(point, box);
    if (!where) {
      showChrome();
      return;
    }
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* The gesture still tracks if the pointer is already gone. */
    }
    const corner = pickCorner(where.local, where.side, box.pageW, box.pageH);
    startCurl(where.side, corner, event.pointerId, where.local);
    showChrome();
  }

  function onPointerMove(event: PointerEvent) {
    if (live && event.pointerId === livePointer) {
      const box = layout();
      const samples = event.getCoalescedEvents?.() ?? [event];
      for (const sample of samples) addLivePoint(sample, box);
      addLivePoint(event, box);
      paint();
      return;
    }
    if (!curl?.dragging || event.pointerId !== curl.pointerId) return;
    const { point, box } = localPoint(event.clientX, event.clientY);
    const originX = curl.side === 'left' && box.spread ? box.leftX : box.rightX;
    const local = { x: point.x - originX, y: point.y - box.top };
    const dx = local.x - curl.origin.x;
    const dy = local.y - curl.origin.y;
    if (Math.hypot(dx, dy) > 8) curl.moved = true;
    const dir = curl.side === 'right' ? -1 : 1;
    const followX = dx * dir < 0 ? dx * 0.12 : dx;
    const next = { x: curl.corner.x + followX, y: curl.corner.y + dy };
    const previous = curl.target;
    curl.target = limitTarget(curl.side, curl.corner, next, box.pageW, box.pageH, allowed(curl.side, box));
    if (curl.moved) {
      const frame = 16;
      curl.vx = ((curl.target.x - previous.x) / frame) * 1000;
      curl.vy = ((curl.target.y - previous.y) / frame) * 1000;
    }
    paint();
  }

  function onPointerUp(event: PointerEvent) {
    if (live && event.pointerId === livePointer) {
      const drawn = live;
      const moved = drawn.points.length > 1;
      live = null;
      livePointer = -1;
      penIsDown = false;
      if (!moved) {
        const box = layout();
        const origin = pageOrigin(drawn.page, box);
        const last = drawn.points[0];
        if (origin && last && drawn.kind === 'highlight') {
          const found = strokeAt(
            strokesOn(drawn.page).filter((mark) => mark.kind === 'highlight'),
            last.x * box.pageW,
            last.y * box.pageH,
            box.pageW,
            box.pageH,
          );
          if (found) {
            paint();
            openNote(found);
            return;
          }
        }
      }
      if (drawn.points.length) commitStroke(drawn);
      else paint();
      return;
    }
    if (!curl?.dragging || event.pointerId !== curl.pointerId) return;
    const box = layout();
    const tap = !curl.moved;
    if (tap) {
      curl = null;
      const { point } = localPoint(event.clientX, event.clientY);
      const where = hit(point, box);
      if (!where) {
        showChrome();
        paint();
        return;
      }
      const edge = where.side === 'right' ? where.local.x > box.pageW * 0.78 : where.local.x < box.pageW * 0.22;
      const page = pageOf(where, box);
      if (!edge && page != null && tool === 'turn') {
        const found = strokeAt(
          strokesOn(page).filter((mark) => mark.kind === 'highlight'),
          where.local.x,
          where.local.y,
          box.pageW,
          box.pageH,
        );
        if (found) {
          openNote(found);
          paint();
          return;
        }
      }
      if (edge && allowed(where.side, box)) {
        const corner = { x: where.side === 'right' ? box.pageW : 0, y: box.pageH * 0.62 };
        const turn = startCurl(where.side, corner, -1, corner);
        turn.moved = true;
        turn.vx = where.side === 'right' ? -box.pageW * 1.4 : box.pageW * 1.4;
        releaseCurl(true);
      } else {
        root.classList.toggle('chrome-on');
        if (root.classList.contains('chrome-on')) scheduleChrome();
        paint();
      }
      return;
    }
    const going = travelOf(curl, box.pageW);
    const speed = curl.side === 'right' ? -curl.vx / box.pageW : curl.vx / box.pageW;
    const commit = allowed(curl.side, box) && (going > 0.33 || (going > 0.08 && speed > 0.85));
    releaseCurl(commit);
  }

  function scrub() {
    curl = null;
    focus = clamp(Number(range.value), 0, session.pageCount - 1);
    const next = { ...meta, lastPage: focus, lastOpenedAt: Date.now() };
    Object.assign(meta, next);
    void updateBook(next);
    paint();
  }

  function onKey(event: KeyboardEvent) {
    if (closed) return;
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea');
    if (typing) {
      if (event.key === 'Escape') hideCards();
      return;
    }
    if (event.key === 'Escape') {
      if (!noteCard.hidden || !nameCard.hidden || !markList.hidden) {
        hideCards();
        markList.hidden = true;
        return;
      }
      close();
      return;
    }
    const box = layout();
    if (event.key === 'ArrowRight' && canForward(box.view, box.spread)) {
      const corner = { x: box.pageW, y: box.pageH * 0.62 };
      const turn = startCurl('right', corner, -1, corner);
      turn.moved = true;
      turn.vx = -box.pageW;
      releaseCurl(true);
    } else if (event.key === 'ArrowLeft' && canBack(box.view, box.spread)) {
      const corner = { x: 0, y: box.pageH * 0.62 };
      const turn = startCurl('left', corner, -1, corner);
      turn.moved = true;
      turn.vx = box.pageW;
      releaseCurl(true);
    }
  }

  function renderSound() {
    const on = soundEnabled();
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    soundBtn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3l4-3v10l-4-3H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h3l4-3v10l-4-3H4z" fill="currentColor"/><path d="m16 10 4 4m0-4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  function close() {
    if (closed) return;
    closed = true;
    window.clearTimeout(hideTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', onResize);
    root.remove();
    void session.destroy();
    onClose();
    if (history.state && typeof history.state === 'object' && 'pageleaf' in history.state) {
      ignorePop = true;
      history.back();
    }
  }

  let ignorePop = false;
  function onPop() {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    close();
  }

  function onResize() {
    curl = null;
    paint();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('dragstart', (event) => event.preventDefault());
  root.querySelector('[data-action="back"]')?.addEventListener('click', () => close());
  soundBtn.addEventListener('click', () => {
    setSoundEnabled(!soundEnabled());
    renderSound();
    if (soundEnabled()) {
      unlockSound();
      rustle(0.6);
    }
    showChrome();
  });
  range.addEventListener('input', scrub);
  window.addEventListener('keydown', onKey);
  window.addEventListener('popstate', onPop);
  window.addEventListener('resize', onResize);
  if (!history.state || typeof history.state !== 'object' || !('pageleaf' in history.state)) {
    history.pushState({ pageleaf: 1 }, '');
  }

  session.onUpdate = () => {
    composites.clear();
    if (!closed) paint();
  };

  const noteCard = root.querySelector('.note-card') as HTMLFormElement;
  const noteText = noteCard.querySelector('textarea') as HTMLTextAreaElement;
  const nameCard = root.querySelector('.name-card') as HTMLFormElement;
  const nameInput = nameCard.querySelector('input') as HTMLInputElement;
  const markList = root.querySelector('.mark-list') as HTMLElement;
  const swatches = root.querySelector('.swatches') as HTMLElement;

  noteCard.addEventListener('submit', (event) => {
    event.preventDefault();
    const mark = marks.find((item) => item.id === noteCard.dataset.id);
    if (mark?.kind === 'highlight' || mark?.kind === 'ink') {
      remember({ ...mark, note: noteText.value.trim() });
    }
    noteCard.hidden = true;
    paint();
  });
  noteCard.querySelector('[data-action="skip"]')?.addEventListener('click', () => {
    noteCard.hidden = true;
  });
  noteCard.querySelector('[data-action="delete-mark"]')?.addEventListener('click', () => {
    const id = noteCard.dataset.id;
    if (id) forget(id);
    noteCard.hidden = true;
    paint();
  });
  nameCard.addEventListener('submit', (event) => {
    event.preventDefault();
    const mark = marks.find((item) => item.id === nameCard.dataset.id);
    if (mark?.kind === 'bookmark') remember({ ...mark, name: nameInput.value.trim() });
    nameCard.hidden = true;
    paint();
  });
  nameCard.querySelector('[data-action="remove-bookmark"]')?.addEventListener('click', () => {
    const id = nameCard.dataset.id;
    if (id) forget(id);
    nameCard.hidden = true;
    paint();
  });
  root.querySelector('[data-action="bookmark"]')?.addEventListener('click', () => bookmarkPage());
  root.querySelector('[data-action="marks"]')?.addEventListener('click', () => showBookmarkList());
  root.querySelector('[data-action="close-marks"]')?.addEventListener('click', () => {
    markList.hidden = true;
  });
  root.querySelector('[data-action="undo"]')?.addEventListener('click', () => {
    const id = undoStack.pop();
    if (!id) return;
    if (noteCard.dataset.id === id) noteCard.hidden = true;
    forget(id);
    paint();
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.tool;
      if (next === 'turn' || next === 'pen' || next === 'marker') selectTool(next);
    });
  }
  selectTool('turn');

  renderSound();
  if (localStorage.getItem('pageleaf-hint') === '1') hint.classList.add('hidden');
  showChrome();
  document.body.append(root);
  paint();

  const ready = (async () => {
    const box = layout();
    session.setPageWidth(box.pageW);
    const visible = [box.view.left, box.view.right].filter((index): index is number => index != null);
    await session.when(visible.length ? visible : [0]);
    if (closed) return;
    opening.remove();
    root.dataset.ready = 'true';
    paint();
  })();

  const api: Reader = { element: root, close, ready };

  if (import.meta.env.DEV) {
    const debug = {
      pose(progress: number) {
        const box = layout();
        const corner = { x: box.pageW, y: box.pageH * 0.78 };
        const dest = landedTarget('right', corner, box.pageW);
        const t = clamp(progress, 0, 1);
        const turn = startCurl('right', corner, -1, corner);
        turn.dragging = true;
        turn.moved = true;
        turn.target = {
          x: corner.x + (dest.x - corner.x) * t,
          y: corner.y + (dest.y - corner.y) * t * 0.15 + (0 - corner.y) * t * 0.35,
        };
        paint();
      },
      release() {
        if (!curl) return;
        curl.dragging = false;
        releaseCurl(true);
      },
      focus: () => focus,
    };
    Object.assign(window, { __pageleafReader: debug });
  }

  return api;
}
