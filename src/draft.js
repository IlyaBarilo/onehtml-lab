// One expert draft per browser origin. The editor also works if storage fails.
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

async function readExpertDraft() {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readonly');
    const request = transaction.objectStore('drafts').get('expert');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function writeExpertDraft(code) {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put(code, 'expert');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
