// One working draft per browser origin. Keep the original key to restore drafts
// saved by earlier versions, when this storage was limited to expert mode.
let draftDatabasePromise;

function draftDatabase() {
  if (!draftDatabasePromise) draftDatabasePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open('onehtml-lab-draft', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return draftDatabasePromise;
}

async function readWorkingDraft() {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readonly');
    const request = transaction.objectStore('drafts').get('expert');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function writeWorkingDraft(code) {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(code, 'expert');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function readPreviousPaste() {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readonly');
    const request = transaction.objectStore('drafts').get('previous-paste');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function writePreviousPaste(code) {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    if (code === null) store.delete('previous-paste');
    else store.put(code, 'previous-paste');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
