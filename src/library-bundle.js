// Only versioned classic script builds in this catalog can be embedded.
// ES modules and scripts with dependencies need a separate resolver.
const libraryCache = new Map();
let libraryCachePersistent = false;
let libraryDatabasePromise;
const libraryScriptTag = /<script\b([^>]*)>\s*<\/script\s*>/gi;
const maxLibraryBytes = 4 * 1024 * 1024;
const maxLicenseBytes = 64 * 1024;

function validLibraryAsset(source, license) {
  return typeof source === 'string' && source.length > 0 && source.length <= maxLibraryBytes
    && typeof license === 'string' && license.length <= maxLicenseBytes
    && !/<\/script/i.test(source) && !/-->/.test(license)
    && license.includes('Permission is hereby granted')
    && license.includes('THE SOFTWARE IS PROVIDED') && /Copyright/i.test(license);
}

function libraryReference(url) {
  let match = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r(\d{3})\/three\.min\.js$/.exec(url)
    || /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.(\d{3})\.0\/build\/three\.min\.js$/.exec(url);
  if (match && Number(match[1]) >= 128 && Number(match[1]) <= 160) {
    const revision = Number(match[1]);
    return { key: `three@0.${revision}.0`, title: `Three.js r${revision}`, url,
      licenseUrl: `https://cdn.jsdelivr.net/npm/three@0.${revision}.0/LICENSE` };
  }
  match = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/matter-js\/(0\.\d+\.\d+)\/matter\.min\.js$/.exec(url)
    || /^https:\/\/cdn\.jsdelivr\.net\/npm\/matter-js@(0\.\d+\.\d+)\/build\/matter\.min\.js$/.exec(url);
  if (match && Number(match[1].split('.')[1]) >= 14 && Number(match[1].split('.')[1]) <= 20) {
    return { key: `matter-js@${match[1]}`, title: `Matter.js ${match[1]}`, url,
      licenseUrl: `https://cdn.jsdelivr.net/npm/matter-js@${match[1]}/LICENSE` };
  }
  match = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/phaser\/(3\.\d+\.\d+)\/phaser\.min\.js$/.exec(url)
    || /^https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@(3\.\d+\.\d+)\/dist\/phaser\.min\.js$/.exec(url);
  if (match) {
    return { key: `phaser@${match[1]}`, title: `Phaser ${match[1]}`, url,
      licenseUrl: `https://cdn.jsdelivr.net/npm/phaser@${match[1]}/LICENSE.md` };
  }
  return null;
}

function libraryDatabase() {
  if (!libraryDatabasePromise) libraryDatabasePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open('onehtml-lab-libraries', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('libraries', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return libraryDatabasePromise;
}

async function loadLibraryCache() {
  try {
    const database = await libraryDatabase();
    const entries = await new Promise((resolve, reject) => {
      const transaction = database.transaction('libraries', 'readonly');
      const request = transaction.objectStore('libraries').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
    for (const entry of entries) {
      if (entry && libraryReference(entry.sourceUrl)?.key === entry.key
        && validLibraryAsset(entry.source, entry.license)) libraryCache.set(entry.key, entry);
    }
    libraryCachePersistent = true;
  } catch {
    libraryCachePersistent = false;
  }
}

function saveLibraryToCache(entry) {
  return libraryDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction('libraries', 'readwrite');
    transaction.objectStore('libraries').put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function libraryMatches(code) {
  const matches = [];
  for (const match of code.matchAll(libraryScriptTag)) {
    if (/(?:^|\s)(?:async|defer|nomodule)(?:\s|=|$)/i.test(match[1])) continue;
    const scriptType = /(?:^|\s)type\s*=\s*(["'])([^"']+)\1/i.exec(match[1])?.[2];
    if (scriptType && !/^(?:text|application)\/javascript$/i.test(scriptType)) continue;
    const url = /(?:^|\s)src\s*=\s*(["'])(https:\/\/[^"']+)\1/i.exec(match[1])?.[2];
    const reference = url && libraryReference(url);
    if (reference) matches.push({ ...reference, tag: match[0], index: match.index });
  }
  return matches;
}

function prepareGameHtml(code, replaceLibraries = true) {
  if (!replaceLibraries) return { html: code, bundledLibraries: [], missingLibraries: [] };
  const matches = libraryMatches(code);
  const missingLibraries = [...new Map(matches.filter(ref => !libraryCache.has(ref.key)).map(ref => [ref.key, ref])).values()];
  let html = '';
  let cursor = 0;
  const bundledLibraries = [];
  for (const reference of matches) {
    const entry = libraryCache.get(reference.key);
    if (!entry) continue;
    html += code.slice(cursor, reference.index);
    html += `<!--\n${reference.title}, MIT license:\n${entry.license}\n-->\n<script data-onehtml-library="${reference.key}">\n${entry.source}\n</script>`;
    cursor = reference.index + reference.tag.length;
    bundledLibraries.push(reference.title);
  }
  html += code.slice(cursor);
  return { html, bundledLibraries, missingLibraries };
}

async function readLimitedResponse(response, maxBytes) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const announced = Number(response.headers.get('content-length'));
  if (announced > maxBytes) throw new Error('size limit');
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new Error('size limit');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error('size limit'); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function downloadLibrary(reference) {
  const [sourceResponse, licenseResponse] = await Promise.all([
    fetch(reference.url, { credentials: 'omit', redirect: 'error' }),
    fetch(reference.licenseUrl, { credentials: 'omit', redirect: 'error' })
  ]);
  const [source, license] = await Promise.all([
    readLimitedResponse(sourceResponse, maxLibraryBytes),
    readLimitedResponse(licenseResponse, maxLicenseBytes)
  ]);
  if (!source.trim() || !validLibraryAsset(source, license)) throw new Error('invalid library or license');
  const entry = { key: reference.key, title: reference.title, source, license: license.trim(),
    sourceUrl: reference.url, licenseUrl: reference.licenseUrl,
    bytes: new TextEncoder().encode(source).length, savedAt: Date.now() };
  try { await saveLibraryToCache(entry); libraryCachePersistent = true; }
  catch { libraryCachePersistent = false; }
  libraryCache.set(reference.key, entry);
  return libraryCachePersistent;
}
