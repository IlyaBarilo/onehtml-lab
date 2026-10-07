// One working draft and its history per browser origin. Keep the original draft
// key to restore code saved by earlier expert-mode versions.
let draftDatabasePromise;
let draftStoredRevision = null;

function draftDatabase() {
  if (!draftDatabasePromise) draftDatabasePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open('onehtml-lab-draft', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); draftDatabasePromise = null; };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return draftDatabasePromise;
}

async function readDraftSnapshot() {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readonly');
    const store = transaction.objectStore('drafts');
    const requests = ['expert', 'history', 'previous-paste', 'revision'].map(key => store.get(key));
    transaction.oncomplete = () => {
      draftStoredRevision = requests[3].result ?? null;
      resolve(requests.slice(0, 3).map(request => request.result ?? null));
    };
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

function mergeDraftHistory(code, history, savedCode, savedHistory) {
  const entries = [...history.entries, ...(Array.isArray(savedHistory?.entries) ? savedHistory.entries : [])];
  if (typeof savedCode === 'string' && savedCode && savedCode !== code) entries.unshift({
    id: `other-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    code: savedCode, createdAt: Date.now(), verified: savedHistory?.verifiedCode === savedCode
  });
  const seen = new Set();
  return { entries: entries.filter(entry => {
    if (!entry || typeof entry.code !== 'string' || typeof entry.id !== 'string' || seen.has(entry.id)) return false;
    seen.add(entry.id); return true;
  }).slice(0, 20), verifiedCode: history.verifiedCode };
}

async function writeDraftSnapshot(code, history, continueHere = false, historyChanged = true) {
  const database = await draftDatabase();
  return new Promise((resolve, reject) => {
    // The revision check and both writes share one transaction, including takeover.
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    const revision = store.get('revision');
    const nextRevision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let failure, nextHistory = history;
    function write() {
      try {
        store.put(code, 'expert');
        if (historyChanged || continueHere) store.put(nextHistory, 'history');
        store.put(nextRevision, 'revision');
        store.delete('previous-paste');
      } catch (error) { failure = error; transaction.abort(); }
    }
    revision.onsuccess = () => {
      if (!continueHere && (revision.result ?? null) !== draftStoredRevision) {
        failure = new Error('Draft changed in another tab');
        failure.name = 'DraftConflictError';
        transaction.abort();
        return;
      }
      if (!continueHere) { write(); return; }
      const savedCode = store.get('expert');
      const savedHistory = store.get('history');
      savedHistory.onsuccess = () => {
        nextHistory = mergeDraftHistory(code, history, savedCode.result, savedHistory.result);
        write();
      };
    };
    transaction.oncomplete = () => { draftStoredRevision = nextRevision; resolve(nextHistory); };
    transaction.onerror = transaction.onabort = () => reject(failure || transaction.error);
  });
}
