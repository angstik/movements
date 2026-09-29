// Bibliothèque locale (IndexedDB) : vidéos + analyses, stockées uniquement dans ce navigateur.

const DB_NAME = 'aiki-filaire';
const STORE = 'videos';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  });
}

const req2promise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}

export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}

// Vignette JPEG prise dans la vidéo courante (à l'instant affiché).
export function makeThumbnail(video, maxSide = 240) {
  try {
    const k = maxSide / Math.max(video.videoWidth, video.videoHeight);
    const c = document.createElement('canvas');
    c.width = Math.round(video.videoWidth * k);
    c.height = Math.round(video.videoHeight * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return '';
  }
}

export async function addVideo({ name, blob, duration, width, height, thumb }) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = { id, name, blob, size: blob.size, type: blob.type, duration, width, height, thumb, date: Date.now(), analysis: null };
  await tx('readwrite', (s) => s.put(entry));
  return id;
}

export async function saveAnalysis(id, analysis) {
  await tx('readwrite', async (s) => {
    const entry = await req2promise(s.get(id));
    if (!entry) return;
    entry.analysis = analysis;
    entry.analysisDate = Date.now();
    s.put(entry);
  });
}

export async function getEntry(id) {
  return tx('readonly', (s) => req2promise(s.get(id)));
}

// Liste sans les blobs (métadonnées + vignette).
export async function listEntries() {
  const all = await tx('readonly', (s) => req2promise(s.getAll()));
  return all
    .map(({ blob, analysis, ...meta }) => ({ ...meta, hasAnalysis: !!analysis }))
    .sort((a, b) => b.date - a.date);
}

export async function deleteEntry(id) {
  await tx('readwrite', (s) => s.delete(id));
}
