import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = (await Promise.all(['library-bundle.js', 'exporter.js', 'library-extract.js'].map(name => readFile(new URL('../src/' + name, import.meta.url), 'utf8')))).join('\n');
const license = (await readFile(new URL('../docs/licenses/babylonjs-9.30.0-LICENSE.txt', import.meta.url), 'utf8')).trim().replace(/\r\n/g, '\n');
const notice = (await readFile(new URL('../docs/licenses/babylonjs-9.30.0-NOTICE.txt', import.meta.url), 'utf8')).trim().replace(/\r\n/g, '\n');
const context = { TextEncoder, TextDecoder, Blob, crypto: webcrypto, window: {}, fetch: async () => { throw Error('not mocked'); } };
runInNewContext(source + '\nthis.api = { libraryCache, libraryReference, localLibraryReference, validLibraryEntry, libraryAssetIdentity, downloadLibrary, prepareGameHtml, prepareGameFiles, planLibraryExtraction, retainExtractionAssets, importLocalLibrary, localLibraryNotices };', context);
const api = context.api, url = 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/babylon.js', ref = api.libraryReference(url);
assert.equal(ref.key, 'babylonjs@9.30.0');
for (const [url, file] of [
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'three/build/three.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js', 'matter-js/build/matter.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js', 'phaser3/dist/phaser.min.js'],
  ['https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js', 'phaser4/dist/phaser.min.js'],
  [ref.url, 'babylonjs/babylon.js']
]) assert.equal(api.libraryReference(url).downloadBytes, (await stat(new URL('../node_modules/' + file, import.meta.url))).size, 'Known sizes must match the pinned uncompressed builds');
assert.equal(api.libraryReference('https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js').downloadBytes, undefined, 'Do not invent a size for another version');
assert.equal(api.localLibraryReference('./unknown.js').downloadBytes, undefined, 'Do not invent the size of a local file');
assert.equal(api.libraryReference(url.replace('cdn.jsdelivr.net/npm/', 'unpkg.com/')).key, ref.key);
for (const version of ['latest', '9.29.0', '10.0.0']) assert.equal(api.libraryReference(url.replace('9.30.0', version)), null);
for (const path of ['./babylon-9.30.0.js', '../lib/babylonjs@9.30.0/babylon.js', './vendor/babylon/9.30.0/babylon.min.js']) assert.equal(api.localLibraryReference(path).key, ref.key);
assert.equal(api.localLibraryReference('./babylon-9.29.0.js').key, undefined, 'Unknown local versions must not be upgraded');
const library = 'window.BABYLON={Engine:{Version:"9.30.0"}};', entry = { ...ref, source: library, license, notice };
assert(api.validLibraryEntry(entry));
assert(!api.validLibraryEntry({ ...entry, notice: '' }));
assert(!api.validLibraryEntry({ ...entry, license: license.slice(0, Math.floor(license.length / 2)) }));
assert(!api.validLibraryEntry({ ...entry, licenseType: 'MIT' }));
assert.notEqual(api.libraryAssetIdentity(library, license, notice), api.libraryAssetIdentity(library, license, notice + 'changed'));
api.libraryCache.set(ref.key, entry);
const logic = '<output id="result"></output><script>result.textContent=BABYLON.Engine.Version;</script>', game = `<script src="${url}"></script>` + logic;
const embedded = (await api.prepareGameHtml(game)).html;
assert(embedded.includes(license) && embedded.includes(notice) && embedded.includes('data-onehtml-license="Apache-2.0"'));
api.libraryCache.clear();
for (const mode of ['cdn', 'files']) {
  const plan = await api.planLibraryExtraction(embedded, mode);
  assert.equal(plan.count, 1); assert(plan.html.endsWith(logic)); assert(!plan.html.includes(library));
  await api.retainExtractionAssets(plan);
  const saved = await api.prepareGameFiles(plan.html, 'game.html');
  assert.equal(saved.files[1].name, 'babylon-9.30.0.js');
  assert(saved.files[1].content.includes(license) && saved.files[1].content.includes(notice));
  const included = api.localLibraryNotices(saved.files[1].content);
  assert(included.license.includes(license) && included.notice === notice, 'Exported JS carries its own complete notices for a later local import');
  assert((await api.prepareGameHtml(plan.html)).html.includes(notice));
}
for (const altered of [embedded.replace(notice, ''), embedded.replace('9.30.0"}};', '0.0.0"}};'), embedded.replace('data-onehtml-license="Apache-2.0"', 'data-onehtml-license="MIT"')]) {
  assert.equal((await api.planLibraryExtraction(altered)).count, 0);
}
const before = api.libraryCache.get(ref.key);
context.fetch = async requested => ({ ok: true, text: async () => requested === ref.url ? library : requested === ref.licenseUrl ? license : '' });
await assert.rejects(() => api.downloadLibrary(ref));
assert.equal(api.libraryCache.get(ref.key), before, 'A missing NOTICE must not replace the working cached asset');
context.fetch = async requested => ({ ok: true, text: async () => requested === ref.url ? library : requested === ref.licenseUrl ? license : notice });
await api.downloadLibrary(ref);
assert.equal(api.libraryCache.get(ref.key).notice, notice);
const local = (await api.prepareGameHtml('<script src="./babylon.js"></script>')).missingLibraries[0];
await assert.rejects(() => api.importLocalLibrary(local, library, license));
await api.importLocalLibrary(local, library, license, notice);
assert((await api.prepareGameHtml('<script src="./babylon.js"></script>')).html.includes(notice));
console.log('Babylon exact/local versions, Apache-2.0 + NOTICE, reversible exports and transactional licensing passed.');
