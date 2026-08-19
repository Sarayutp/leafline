import type { Article, Feed } from "./types";

interface LibrarySnapshot {
  key: "library";
  feeds: Feed[];
  articles: Article[];
  savedAt: string;
}

const DATABASE_NAME = "leafline-cache";
const STORE_NAME = "snapshots";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSnapshot(feeds: Feed[], articles: Article[]): Promise<void> {
  const database = await openDatabase();
  const snapshot: LibrarySnapshot = { key: "library", feeds, articles, savedAt: new Date().toISOString() };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadSnapshot(): Promise<LibrarySnapshot | null> {
  const database = await openDatabase();
  const snapshot = await new Promise<LibrarySnapshot | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get("library");
    request.onsuccess = () => resolve((request.result as LibrarySnapshot | undefined) || null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return snapshot;
}
