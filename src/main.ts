import { getBook, getFile } from './db';
import { mountLibrary } from './library';
import { openReader, type Reader } from './reader';
import { makeSamplePdf } from './sample';
import { toast } from './toast';
import './styles.css';

const app = document.querySelector('#app');
if (!app) throw new Error('Missing app root.');

let reader: Reader | null = null;
let opening = false;

const library = mountLibrary((id) => {
  void openBook(id);
});
app.append(library.element);

async function openBook(id: string) {
  if (reader || opening) return;
  opening = true;
  try {
    const meta = await getBook(id);
    const file = meta ? await getFile(id) : null;
    if (!meta || !file) {
      toast('That book is no longer on this iPad.');
      await library.refresh();
      return;
    }
    reader = await openReader(meta, file, () => {
      reader = null;
      void library.refresh();
    });
    await reader.ready;
  } catch (err) {
    reader = null;
    const message = err instanceof Error ? err.message : 'Could not open that book.';
    toast(message);
  } finally {
    opening = false;
  }
}

void library.refresh().catch(() => {
  toast('Pageleaf could not open storage on this browser.');
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

if (import.meta.env.DEV) {
  Object.assign(window, {
    __pageleaf: {
      loadSample: async () => {
        const file = new File([makeSamplePdf()], 'Sample book.pdf', { type: 'application/pdf' });
        await library.addFiles([file]);
      },
      openFirst: async () => {
        const card = document.querySelector<HTMLElement>('.book');
        const id = card?.dataset.id;
        if (id) await openBook(id);
      },
    },
  });
}
