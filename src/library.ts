import { deleteBook, getThumb, listBooks, listMarks, putBook, type BookMeta } from './db';
import { inspectPdf, PdfError } from './pdf';
import { toast } from './toast';

export type Library = {
  element: HTMLElement;
  refresh: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
};

export function mountLibrary(onOpen: (id: string) => void): Library {
  const root = document.createElement('main');
  root.className = 'library';
  root.innerHTML = `
    <header class="shelf-head">
      <div>
        <p class="mark">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4c2 5 2 8 0 12-4-2-8-2-12 1 4 1 7 4 8 8 2-5 5-8 10-9-2-4-4-8-6-12z" fill="#d7e2c8"/><path d="M16 16c3 1 6 1 9 0" fill="none" stroke="#8faf78" stroke-width="1.4" stroke-linecap="round"/></svg>
          Pageleaf
        </p>
        <h1>Your books</h1>
      </div>
      <button type="button" class="add" data-action="add">Add PDFs</button>
      <input type="file" accept="application/pdf,.pdf" multiple hidden />
    </header>
    <section class="shelf" aria-live="polite"></section>
  `;

  const shelf = root.querySelector('.shelf') as HTMLElement;
  const input = root.querySelector('input') as HTMLInputElement;
  const addBtn = root.querySelector('.add') as HTMLButtonElement;
  let urls: string[] = [];
  let confirmId: string | null = null;

  function revoke() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  }

  async function refresh() {
    const books = await listBooks();
    revoke();
    confirmId = null;
    if (!books.length) {
      shelf.innerHTML = `
        <div class="empty">
          <div class="empty-book" aria-hidden="true"><span></span><span></span></div>
          <h2>No books yet</h2>
          <p>Add a PDF and it stays on this iPad. Nothing is uploaded.</p>
          <p class="fine">In Safari, use Share, then Add to Home Screen.</p>
        </div>
      `;
      return;
    }
    shelf.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const book of books) {
      grid.append(await card(book));
    }
    shelf.append(grid);
  }

  async function card(book: BookMeta): Promise<HTMLElement> {
    const article = document.createElement('article');
    article.className = 'book';
    article.dataset.id = book.id;
    const thumb = await getThumbUrl(book.id);
    const marked = (await listMarks(book.id)).some((mark) => mark.kind === 'bookmark');
    const ratio = book.pageWidth > 0 && book.pageHeight > 0 ? book.pageWidth / book.pageHeight : 0.75;
    const progress = book.pageCount > 1 ? Math.round((book.lastPage / (book.pageCount - 1)) * 100) : 0;
    article.innerHTML = `
      <button type="button" class="cover" style="aspect-ratio:${ratio}">
        ${thumb ? `<img alt="" src="${thumb}" />` : ''}
        <span class="spine-shade"></span>
        ${marked ? '<span class="cover-mark"></span>' : ''}
        ${progress > 0 ? `<span class="read-progress" style="width:${progress}%"></span>` : ''}
      </button>
      <div class="book-meta">
        <h2></h2>
        <p>${book.pageCount} ${book.pageCount === 1 ? 'page' : 'pages'}</p>
        <button type="button" class="remove" data-action="remove">Remove</button>
      </div>
    `;
    const heading = article.querySelector('h2') as HTMLElement;
    heading.textContent = book.title;
    article.querySelector('.cover')?.addEventListener('click', () => onOpen(book.id));
    article.querySelector('.remove')?.addEventListener('click', (event) => {
      event.stopPropagation();
      void askRemove(book, article);
    });
    return article;
  }

  async function getThumbUrl(id: string): Promise<string | null> {
    const blob = await getThumb(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }

  async function askRemove(book: BookMeta, article: HTMLElement) {
    const button = article.querySelector('.remove') as HTMLButtonElement;
    if (confirmId !== book.id) {
      confirmId = book.id;
      button.textContent = 'Remove book?';
      return;
    }
    await deleteBook(book.id);
    confirmId = null;
    toast(`Removed “${book.title}”.`);
    await refresh();
  }

  async function addFiles(files: File[]) {
    const pdfs = files.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (!pdfs.length) {
      toast('Choose a PDF file.');
      return;
    }
    addBtn.disabled = true;
    let added = 0;
    for (const [index, file] of pdfs.entries()) {
      addBtn.textContent = pdfs.length > 1 ? `Adding ${index + 1} of ${pdfs.length}` : 'Adding…';
      try {
        const info = await inspectPdf(file);
        const record: BookMeta = {
          id: crypto.randomUUID(),
          title: info.title,
          pageCount: info.pageCount,
          addedAt: Date.now(),
          lastOpenedAt: Date.now(),
          lastPage: 0,
          pageWidth: info.pageWidth,
          pageHeight: info.pageHeight,
        };
        await putBook(record, info.blob, info.thumb);
        added++;
      } catch (err) {
        const message = err instanceof PdfError ? err.message : `Could not add ${file.name}.`;
        toast(message);
      }
    }
    addBtn.disabled = false;
    addBtn.textContent = 'Add PDFs';
    await refresh();
    if (added) toast(added === 1 ? 'Added to your library.' : `Added ${added} books.`);
  }

  addBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void addFiles(files);
  });
  root.addEventListener('dragover', (event) => event.preventDefault());
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    void addFiles([...(event.dataTransfer?.files ?? [])]);
  });

  return { element: root, refresh, addFiles };
}
