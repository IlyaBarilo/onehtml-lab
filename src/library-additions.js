// Fixed browser distributions. Dependencies never run in the editor itself.
const addedDistributionLicenses = /* ADDED_LICENSES */ null;
const addedLibraryCatalog = {
  'p5@2.3.4': { title: 'p5.js 2.3.4', file: 'p5@2.3.4/lib/p5.min.js', bytes: 990638, license: 'LGPL-2.1', sourceBytes: 4918232 },
  '@babylonjs/havok@1.3.14': { title: 'Havok 1.3.14 · Babylon.js', file: '@babylonjs/havok@1.3.14/lib/umd/HavokPhysics_umd.js', bytes: 67584, license: 'MIT', wasmBytes: 2094563 },
  '@google/model-viewer@4.4.0': { title: 'model-viewer 4.4.0', file: '@google/model-viewer@4.4.0/dist/model-viewer-umd.min.js', bytes: 1072040, license: 'Apache-2.0' },
  'aframe@1.8.0': { title: 'A-Frame 1.8.0', file: 'aframe@1.8.0/dist/aframe-v1.8.0.min.js', bytes: 1323403, license: 'MIT' }
};
function addedLibraryReference(url) {
  for (const [key, item] of Object.entries(addedLibraryCatalog)) if (['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'].some(base => url === base + item.file)) {
    return { key, title: item.title, url, downloadBytes: item.bytes + (item.wasmBytes || item.sourceBytes || 0),
      licenseType: item.license, licenseText: addedDistributionLicenses?.[key],
      licenseUrl: 'https://cdn.jsdelivr.net/npm/' + key + (key.startsWith('p5@') ? '/license.txt' : '/LICENSE') };
  }
  return null;
}
function addedLocalLibraryReference(path) {
  const filename = path.split('/').pop(), folders = path.split('/').slice(0, -1);
  const candidates = [
    ['p5@2.3.4', /^p5(?:[._-]v?(\d+\.\d+\.\d+))?(?:\.min)?\.js$/i, /^(?:p5[@._-])?v?(\d+\.\d+\.\d+)$/i],
    ['@babylonjs/havok@1.3.14', /^(?:havok|HavokPhysics_umd)(?:[._-]v?(\d+\.\d+\.\d+))?(?:\.min)?\.js$/i, /^(?:havok[@._-])?v?(\d+\.\d+\.\d+)$/i],
    ['@google/model-viewer@4.4.0', /^model-viewer(?:-umd)?(?:[._-]v?(\d+\.\d+\.\d+))?(?:\.min)?\.js$/i, /^(?:model-viewer[@._-])?v?(\d+\.\d+\.\d+)$/i],
    ['aframe@1.8.0', /^aframe(?:[._-]v?(\d+\.\d+\.\d+))?(?:\.min)?\.js$/i, /^(?:aframe[@._-])?v?(\d+\.\d+\.\d+)$/i]
  ];
  for (const [key, filePattern, folderPattern] of candidates) {
    const file = filePattern.exec(filename);
    if (!file) continue;
    const version = file[1] || folders.map(folder => folderPattern.exec(folder)?.[1]).find(Boolean);
    if (version === key.slice(key.lastIndexOf('@') + 1)) return { ...libraryCatalogReference(key), localPath: path, filename };
  }
  return null;
}
function addedLibraryValid(entry) {
  const key = entry.catalogKey || entry.key, item = addedLibraryCatalog[key];
  if (!item) return true;
  const license = addedDistributionLicenses?.[key];
  if (!license || !entry.license.replace(/\r\n?/g, '\n').includes(license)) return false;
  if (item.wasmBytes && !/\/\*onehtml-havok-wasm:1\*\//.test(entry.source)) return false;
  if (item.sourceBytes && !/\/\*onehtml-p5-source:1\nH4sI[A-Za-z\d+/=]+\n\*\//.test(entry.source)) return false;
  return true;
}
function libraryBinaryBase64(bytes) {
  let binary = ''; for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}
function wrapAddedLibrary(reference, source, binary) {
  if (reference.key === '@babylonjs/havok@1.3.14') {
    if (!binary || binary.length !== 2094563 || binary[0] !== 0 || binary[1] !== 97 || binary[2] !== 115 || binary[3] !== 109) throw Error('Нужен полный HavokPhysics.wasm версии 1.3.14.');
    return source + '\n/*onehtml-havok-wasm:1*/\n;(() => { const original = globalThis.HavokPhysics, bytes = Uint8Array.from(atob("' + libraryBinaryBase64(binary) + '"), c => c.charCodeAt(0)); globalThis.HavokPhysics = options => original({ ...options, wasmBinary: bytes }); })();\n';
  }
  if (reference.key === 'p5@2.3.4') {
    if (!binary || binary[0] !== 31 || binary[1] !== 139) throw Error('Нужен архив исходников p5.js 2.3.4.');
    return source + '\n/* LGPL: corresponding source and build files, gzip tar encoded as Base64.\nDecode the following payload as p5-source-2.3.4.tar.gz. OneHTML Lab can also save this archive.\nYou may replace or modify this library; preserve its license and source archive when redistributing. */\n/*onehtml-p5-source:1\n' + libraryBinaryBase64(binary) + '\n*/\n';
  }
  return source;
}
async function addedLibrarySource(reference, source, options) {
  if (reference.key === 'p5@2.3.4') return wrapAddedLibrary(reference, source, await downloadP5Source(reference, options));
  let url;
  if (reference.key === '@babylonjs/havok@1.3.14') url = 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.14/lib/umd/HavokPhysics.wasm';
  if (!url) return source;
  const resource = reference.key === 'p5@2.3.4' ? 'архив исходников' : 'зависимость WASM';
  const bytes = await downloadLibraryResource(reference, url, resource, options, 'binary', {bytes:2094563,sha256:'026917766f534c156286f07975850978dabf17c42e742bbfaaebbcb2215e4e11'});
  return wrapAddedLibrary(reference, source, bytes);
}
function p5SourceArchive(entry) {
  const base64 = /\/\*onehtml-p5-source:1\n([A-Za-z\d+/=]+)\n\*\//.exec(entry?.source || '')?.[1];
  return base64 ? Uint8Array.from(atob(base64), c => c.charCodeAt(0)) : null;
}
async function addedLibraryIntegrity(entry) {
  const key = entry.catalogKey || entry.key;
  if (key === 'p5@2.3.4') {
    const archive = p5SourceArchive(entry);
    const marker = entry.source.indexOf('/* LGPL: corresponding source');
    let source = marker < 0 ? '' : entry.source.slice(0, marker);
    const notice = /^\/\*![\s\S]*?\*\//.exec(source)?.[0];
    if (notice?.replace(/\r\n?/g, '\n').includes(addedDistributionLicenses[key])) source = source.slice(notice.length);
    return await validP5SourceArchive(archive)
      && await librarySourceHash(source.trim()) === 'e2c3b269e512774d876b9b98a52f48a9f6bdcc19872ff148e36658bbfa2138ac';
  }
  if (key === '@babylonjs/havok@1.3.14') {
    const marker = entry.source.indexOf('/*onehtml-havok-wasm:1*/');
    const base64 = marker >= 0 && /atob\("([A-Za-z\d+/=]+)"\)/.exec(entry.source.slice(marker))?.[1];
    if (!base64) return false;
    try { return await librarySourceHash(Uint8Array.from(atob(base64), c => c.charCodeAt(0))) === '026917766f534c156286f07975850978dabf17c42e742bbfaaebbcb2215e4e11'; } catch { return false; }
  }
  return true;
}
