// Classic scripts can come from the versioned catalog or user-selected local files.
// ES modules and scripts with dependencies need a separate resolver.
const libraryCache = new Map();
const persistedLibraries = new Map();
let libraryCachePersistent = false;
let libraryDatabasePromise;
const libraryScriptTag = /<!--[\s\S]*?-->|<(style|textarea|title|xmp|iframe|noembed|noframes)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<script\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>[\s\S]*?<\/script\s*>/gi;
const localDocumentScopes = new Map();
let localSessionScope = 0;
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

function scriptAttributes(text) {
  const attributes = new Map();
  for (const match of text.matchAll(/(?:^|\s)([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, { value: match[2] ?? match[3] ?? match[4] ?? '', text: match[0].trim() });
  }
  return attributes;
}

function decodeScriptUrl(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    const name = entity.slice(1, -1).toLowerCase();
    if (named[name]) return named[name];
    const number = name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\ufffd';
  }).trim();
}

function localLibraryReference(url) {
  if (!url || url.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^file:/i.test(url) && !/^[a-z]:[\\/]/i.test(url))) return null;
  let path = url.replace(/\\/g, '/').split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  const filename = path.split('/').pop();
  if (!/\.js$/i.test(filename)) return null;
  let reference;
  let title = filename;
  const folders = path.split('/').slice(0, -1).reverse();
  if (/^three(?:[._-](?:r\d{3}|v?0\.\d{3}\.0))?(?:\.min)?\.js$/i.test(filename)) {
    title = 'Three.js';
    const version = /[._-](?:r(\d{3})|v?0\.(\d{3})\.0)(?=[._-]|$)/i.exec(filename)
      || folders.map(folder => /^(?:three(?:\.js)?[@._-])?(?:r(\d{3})|v?0\.(\d{3})\.0)$/i.exec(folder)).find(Boolean);
    if (version) reference = libraryReference(`https://cdn.jsdelivr.net/npm/three@0.${version[1] || version[2]}.0/build/three.min.js`);
  } else if (/^matter(?:-js)?(?:[._-]v?0\.\d+\.\d+)?(?:\.min)?\.js$/i.test(filename)) {
    title = 'Matter.js';
    const version = (/[._-]v?(0\.\d+\.\d+)(?=[._-]|$)/i.exec(filename)
      || folders.map(folder => /^(?:matter(?:-js)?[@._-])?v?(0\.\d+\.\d+)$/i.exec(folder)).find(Boolean))?.[1];
    if (version) reference = libraryReference(`https://cdn.jsdelivr.net/npm/matter-js@${version}/build/matter.min.js`);
  } else if (/^phaser(?:[._-]v?3\.\d+\.\d+)?(?:\.min)?\.js$/i.test(filename)) {
    title = 'Phaser';
    const version = (/[._-]v?(3\.\d+\.\d+)(?=[._-]|$)/i.exec(filename)
      || folders.map(folder => /^(?:phaser[@._-])?v?(3\.\d+\.\d+)$/i.exec(folder)).find(Boolean))?.[1];
    if (version) reference = libraryReference(`https://cdn.jsdelivr.net/npm/phaser@${version}/dist/phaser.min.js`);
  }
  return { ...reference, title: reference?.title || title, localPath: path, filename };
}

async function localDocumentScope(code) {
  if (localDocumentScopes.has(code)) return localDocumentScopes.get(code);
  let scope;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    scope = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { scope = `session-${++localSessionScope}`; }
  // Only keep a small number of large document strings in memory.
  if (localDocumentScopes.size >= 8) localDocumentScopes.delete(localDocumentScopes.keys().next().value);
  localDocumentScopes.set(code, scope);
  return scope;
}

function localLibraryKey(scope, path) { return `local@${scope}:${encodeURIComponent(path)}`; }

function cachedLibrary(reference) {
  return (reference.assetKey && libraryCache.get(reference.assetKey))
    || libraryCache.get(reference.key) || (reference.catalogKey && libraryCache.get(reference.catalogKey));
}

async function librarySourceHash(source) {
  try {
    const bytes = new TextEncoder().encode(source.replace(/\r\n?/g, '\n'));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

function libraryCatalogReference(key) {
  let match = /^three@0\.(\d{3})\.0$/.exec(key || '');
  if (match) return libraryReference(`https://cdn.jsdelivr.net/npm/three@0.${match[1]}.0/build/three.min.js`);
  match = /^(matter-js|phaser)@([\d.]+)$/.exec(key || '');
  if (match) return libraryReference(`https://cdn.jsdelivr.net/npm/${match[1]}@${match[2]}/${match[1] === 'phaser' ? 'dist/phaser.min.js' : 'build/matter.min.js'}`);
  return null;
}

function libraryAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function libraryInlineAttributes(attributes) {
  return [...attributes].filter(([name]) => !['src', 'integrity', 'crossorigin', 'referrerpolicy'].includes(name)
    && !name.startsWith('data-onehtml-')).map(([, attribute]) => attribute.text).join(' ');
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
      const knownSource = entry && typeof entry.key === 'string' && libraryReference(entry.sourceUrl)?.key === entry.key;
      const localSource = entry && /^[a-f\d]{64}$/.test(entry.documentScope)
        && localLibraryReference(entry.localPath) && entry.key === localLibraryKey(entry.documentScope, entry.localPath);
      const extractedSource = entry && /^asset@[a-f\d]{64}$/.test(entry.key)
        && validLibraryAsset(entry.source, entry.license)
        && await librarySourceHash(entry.source + '\0' + entry.license) === entry.key.slice(6);
      if ((knownSource || localSource || extractedSource)
        && validLibraryAsset(entry.source, entry.license)) {
        libraryCache.set(entry.key, entry);
        persistedLibraries.set(entry.key, entry);
      }
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
    transaction.oncomplete = () => { persistedLibraries.set(entry.key, entry); resolve(); };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

async function removeLibraryCopies(entries) {
  if (entries.some(entry => libraryCache.get(entry.key) !== entry)) throw new Error('Cache changed');
  const saved = entries.filter(entry => persistedLibraries.has(entry.key));
  if (saved.length) {
    const database = await libraryDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('libraries', 'readwrite');
      const store = transaction.objectStore('libraries');
      try { for (const entry of saved) store.delete(entry.key); }
      catch (error) { transaction.abort(); reject(error); }
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  for (const entry of entries) {
    if (libraryCache.get(entry.key) === entry) { libraryCache.delete(entry.key); persistedLibraries.delete(entry.key); }
  }
}

function libraryMatches(code) {
  const matches = [];
  for (const match of code.matchAll(libraryScriptTag)) {
    if (match[2] === undefined) continue;
    const attributes = scriptAttributes(match[2]);
    if (['async', 'defer', 'nomodule'].some(name => attributes.has(name))) continue;
    const scriptType = attributes.get('type')?.value;
    if (scriptType && !/^(?:text|application)\/javascript$/i.test(scriptType)) continue;
    const url = decodeScriptUrl(attributes.get('src')?.value || '');
    const remoteUrl = url.startsWith('//') ? `https:${url}` : url;
    const reference = libraryReference(remoteUrl.split(/[?#]/)[0]) || localLibraryReference(url);
    const inlineAttributes = libraryInlineAttributes(attributes);
    const assetKey = decodeScriptUrl(attributes.get('data-onehtml-asset')?.value || '');
    if (reference) matches.push({ ...reference, originalUrl: url, tag: match[0], index: match.index, inlineAttributes,
      assetKey: /^asset@[a-f\d]{64}$/.test(assetKey) ? assetKey : undefined });
  }
  return matches;
}

async function resolvedLibraryMatches(code) {
  const matches = libraryMatches(code);
  if (matches.some(ref => ref.localPath)) {
    const scope = await localDocumentScope(code);
    for (const reference of matches.filter(ref => ref.localPath)) {
      reference.catalogKey = reference.key;
      reference.documentScope = scope;
      reference.key = localLibraryKey(scope, reference.localPath);
    }
  }
  return matches;
}

function packageFilename(value) {
  let name = value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  const extension = /\.(?:html|js)$/i.exec(name)?.[0] || '';
  if (Array.from(name).length > 160) name = Array.from(name).slice(0, 160 - extension.length).join('') + extension;
  if (!name || name === '.' || name === '..') name = 'library.js';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}

function libraryFilename(reference, entry) {
  if (reference.filename) return packageFilename(reference.filename);
  const key = entry.catalogKey || entry.key;
  const three = /^three@0\.(\d{3})\.0$/.exec(key);
  if (three) return `three-r${three[1]}.min.js`;
  const matter = /^matter-js@([\d.]+)$/.exec(key);
  if (matter) return `matter-${matter[1]}.min.js`;
  const phaser = /^phaser@([\d.]+)$/.exec(key);
  if (phaser) return `phaser-${phaser[1]}.min.js`;
  return 'library.js';
}

function licensedLibrarySource(reference, entry) {
  const title = reference.title.replace(/[\r\n\u2028\u2029]/g, ' ');
  const notice = `${title}, MIT license:\r\n${entry.license}`;
  const comment = notice.includes('*/')
    ? notice.split(/\r\n?|\n|\u2028|\u2029/).map(line => '// ' + line).join('\r\n')
    : `/*!\r\n${notice}\r\n*/`;
  return `${comment}\r\n${entry.source}`;
}

async function embeddedLibraryTag(reference, entry) {
  const title = reference.title.replace(/--/g, '—').replace(/[<>]/g, '');
  const catalog = libraryCatalogReference(entry.catalogKey || entry.key);
  const cdn = catalog && libraryReference(entry.sourceUrl)?.key === catalog.key ? entry.sourceUrl : catalog?.url;
  const metadata = { 'library': entry.key, 'bundle': '1', 'source': reference.originalUrl || reference.localPath || reference.url || '',
    'filename': libraryFilename(reference, entry), 'sha256': await librarySourceHash(entry.source) };
  if (cdn) { metadata.cdn = cdn; metadata.catalog = catalog.key; }
  const attributes = Object.entries(metadata).map(([name, value]) => `data-onehtml-${name}="${libraryAttribute(value)}"`).join(' ');
  return `<!--onehtml-library:${encodeURIComponent(entry.key)}\n${title}, MIT license:\n${entry.license}\n-->\n<script ${reference.inlineAttributes ? reference.inlineAttributes + ' ' : ''}${attributes}>\n${entry.source}\n</script>`;
}

async function prepareGameHtml(code, replaceLibraries = true) {
  if (!replaceLibraries) return { html: code, bundledLibraries: [], bundledLibraryDetails: [], missingLibraries: [] };
  const matches = await resolvedLibraryMatches(code);
  const missingLibraries = [...new Map(matches.filter(ref => !cachedLibrary(ref)).map(ref => [ref.key, ref])).values()];
  let html = '';
  let cursor = 0;
  const bundledLibraries = [];
  const bundledLibraryDetails = [];
  for (const reference of matches) {
    const entry = cachedLibrary(reference);
    if (!entry) continue;
    html += code.slice(cursor, reference.index);
    const embedded = await embeddedLibraryTag(reference, entry);
    html += embedded;
    cursor = reference.index + reference.tag.length;
    bundledLibraries.push(reference.title);
    const encoder = new TextEncoder();
    bundledLibraryDetails.push({ title: reference.title, addedBytes: encoder.encode(embedded).length - encoder.encode(reference.tag).length });
  }
  html += code.slice(cursor);
  return { html, bundledLibraries, bundledLibraryDetails, missingLibraries };
}

function bundledLibraryLabels(prepared) {
  const sizes = new Map();
  for (const item of prepared.bundledLibraryDetails || []) sizes.set(item.title, (sizes.get(item.title) || 0) + item.addedBytes);
  return [...sizes].map(([title, bytes]) => {
    const kb = Math.abs(bytes) / 1024;
    const size = kb > 0 && kb < .1 ? '<0,1' : kb.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    return `${title} (${bytes < 0 ? '−' : '+'}${size} КБ)`;
  });
}

async function importLocalLibrary(reference, source, license) {
  if (!reference.localPath || !validLibraryAsset(source, license)) throw new Error('invalid library or license');
  const entry = { key: reference.key, title: reference.title, source, license: license.trim(),
    localPath: reference.localPath, documentScope: reference.documentScope,
    bytes: new TextEncoder().encode(source).length, savedAt: Date.now() };
  let persisted = false;
  if (/^[a-f\d]{64}$/.test(reference.documentScope)) {
    try { await saveLibraryToCache(entry); persisted = true; } catch {}
  }
  libraryCache.set(entry.key, entry);
  return persisted;
}

function localLibraryLicense(source) {
  return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].map(match => match[0].slice(2, -2).replace(/^!/, '').trim()).find(license => validLibraryAsset(source, license)) || '';
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
  const entry = { key: reference.catalogKey || reference.key, title: reference.title, source, license: license.trim(),
    sourceUrl: reference.url, licenseUrl: reference.licenseUrl,
    bytes: new TextEncoder().encode(source).length, savedAt: Date.now() };
  try { await saveLibraryToCache(entry); libraryCachePersistent = true; }
  catch { libraryCachePersistent = false; }
  libraryCache.set(entry.key, entry);
  return libraryCachePersistent;
}
