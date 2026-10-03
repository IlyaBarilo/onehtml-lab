// The game sees a synchronous Storage-like object inside its opaque sandbox.
// Only bounded string entries cross to this private host-side namespace.
const gameStorageScopeKey = 'onehtml-lab-game-storage-scope';
const gameStoragePrefix = 'onehtml-lab-game-storage-v1:';
const gameStorageLimit = 262144;
const gameStorageFrames = [];
const gameStorageScopes = new Map();
let gameStoragePersistent = true;

function storedGameScope() {
  try {
    const scope = localStorage.getItem(gameStorageScopeKey);
    return scope && scope.length <= 180 ? scope : 'workspace';
  } catch {
    gameStoragePersistent = false;
    return 'workspace';
  }
}

let gameStorageScope = storedGameScope();

function readGameStorage(scope) {
  try {
    const entries = JSON.parse(localStorage.getItem(gameStoragePrefix + scope) || '[]');
    if (!Array.isArray(entries)) return new Map();
    const result = new Map();
    let size = 0;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return new Map();
      size += entry[0].length + entry[1].length;
      if (size > gameStorageLimit) return new Map();
      result.set(entry[0], entry[1]);
    }
    return result;
  } catch {
    gameStoragePersistent = false;
    return new Map();
  }
}

let gameStorageEntries = readGameStorage(gameStorageScope);
gameStorageScopes.set(gameStorageScope, gameStorageEntries);

function selectGameStorage(scope) {
  if (typeof scope !== 'string' || !scope || scope.length > 180 || scope === gameStorageScope) return;
  gameStorageScope = scope;
  gameStorageEntries = gameStorageScopes.get(scope) || readGameStorage(scope);
  gameStorageScopes.set(scope, gameStorageEntries);
  try { localStorage.setItem(gameStorageScopeKey, scope); }
  catch { gameStoragePersistent = false; }
}

function gameStorageSnapshot() {
  return [...gameStorageEntries];
}

function registerGameStorageFrame(frame) {
  gameStorageFrames.push({ window: frame.contentWindow, scope: gameStorageScope });
  if (gameStorageFrames.length > 8) gameStorageFrames.shift();
}

function handleGameStorageMessage(event) {
  if (event.data?.type !== 'onehtml-lab:game-storage') return false;
  const frame = gameStorageFrames.find(item => item.window === event.source);
  if (!frame) return false;
  const { action, key, value } = event.data;
  const next = new Map(gameStorageScopes.get(frame.scope) || readGameStorage(frame.scope));
  if (action === 'set') {
    if (typeof key !== 'string' || typeof value !== 'string') return true;
    next.set(key, value);
  } else if (action === 'remove') {
    if (typeof key !== 'string') return true;
    next.delete(key);
  } else if (action === 'clear') {
    next.clear();
  } else return true;
  let size = 0;
  for (const [entryKey, entryValue] of next) {
    size += entryKey.length + entryValue.length;
    if (size > gameStorageLimit) return true;
  }
  gameStorageScopes.set(frame.scope, next);
  if (frame.scope === gameStorageScope) gameStorageEntries = next;
  try {
    localStorage.setItem(gameStoragePrefix + frame.scope, JSON.stringify([...next]));
    gameStoragePersistent = true;
  } catch {
    gameStoragePersistent = false;
  }
  return true;
}
