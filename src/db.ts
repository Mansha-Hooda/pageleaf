import type { Mark } from './marks';

export type BookMeta = {
  id: string;
  title: string;
  pageCount: number;
  addedAt: number;
  lastOpenedAt: number;
  lastPage: number;
  pageWidth: number;
  pageHeight: number;
};

const DB_NAME = 'pageleaf';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
      if (!db.objectStoreNames.contains('marks')) {
        const marks = db.createObjectStore('marks', { keyPath: 'id' });
        marks.createIndex('bookId', 'bookId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listBooks(): Promise<BookMeta[]> {
  const db = await openDb();
  const books = await requestToPromise(db.transaction('books').objectStore('books').getAll()) as BookMeta[];
  db.close();
  return books.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getBook(id: string): Promise<BookMeta | null> {
  const db = await openDb();
  const book = (await requestToPromise(db.transaction('books').objectStore('books').get(id))) as BookMeta | undefined;
  db.close();
  return book ?? null;
}

export async function getFile(id: string): Promise<Blob | null> {
  const db = await openDb();
  const file = (await requestToPromise(db.transaction('files').objectStore('files').get(id))) as Blob | undefined;
  db.close();
  return file ?? null;
}

export async function getThumb(id: string): Promise<Blob | null> {
  const db = await openDb();
  const thumb = (await requestToPromise(db.transaction('thumbs').objectStore('thumbs').get(id))) as Blob | undefined;
  db.close();
  return thumb ?? null;
}

export async function putBook(meta: BookMeta, file: Blob, thumb: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'files', 'thumbs'], 'readwrite');
    tx.objectStore('books').put(meta);
    tx.objectStore('files').put(file, meta.id);
    tx.objectStore('thumbs').put(thumb, meta.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function updateBook(meta: BookMeta): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction('books', 'readwrite').objectStore('books').put(meta));
  db.close();
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['books', 'files', 'thumbs', 'marks'], 'readwrite');
    tx.objectStore('books').delete(id);
    tx.objectStore('files').delete(id);
    tx.objectStore('thumbs').delete(id);
    const keys = tx.objectStore('marks').index('bookId').getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) tx.objectStore('marks').delete(key);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listMarks(bookId: string): Promise<Mark[]> {
  const db = await openDb();
  const marks = (await requestToPromise(
    db.transaction('marks').objectStore('marks').index('bookId').getAll(bookId),
  )) as Mark[];
  db.close();
  return marks;
}

export async function putMark(mark: Mark): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction('marks', 'readwrite').objectStore('marks').put(mark));
  db.close();
}

export async function deleteMark(id: string): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction('marks', 'readwrite').objectStore('marks').delete(id));
  db.close();
}
