import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = (await Promise.all(['library-bundle.js', 'exporter.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
const downloads = [];
const blobs = new Map();
const timers = [];
let removed = 0;
const context = {
  TextEncoder, TextDecoder, Blob, crypto: webcrypto, window: {},
  URL: class extends URL {
    static createObjectURL(blob) { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  },
  document: {
    body: { append() {} },
    createElement(tag) {
      assert.equal(tag, 'a');
      return { click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); }, remove() { removed += 1; } };
    }
  },
  setTimeout(fn, ms) { timers.push({ fn, ms }); }
};
runInNewContext(source + '\nthis.api = { prepareGameFiles, prepareGameHtml, importLocalLibrary, libraryCache, downloadGameFiles, packageFilename, licensedLibrarySource, validLibraryAsset, readLibraryResponse, resourceSizeWarning };', context);
const { prepareGameFiles, prepareGameHtml, importLocalLibrary, libraryCache, downloadGameFiles, packageFilename } = context.api;
const license = 'MIT License\nCopyright (c) Library authors\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED AS IS';
for (const [key, source] of [['three@0.128.0', 'window.THREE={REVISION:"128"};'], ['three@0.160.0', 'window.THREE={REVISION:"160"};'], ['matter-js@0.20.0', 'window.Matter={version:"0.20.0"};']]) {
  libraryCache.set(key, { key, source, license });
}
const game = '<!doctype html><script id="engine" src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js" integrity="old" crossorigin="anonymous"></script><script src="../vendor/three-r160.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script><script src="./three-r128.min.js"></script>';
const prepared = await prepareGameFiles(game, 'Моя игра 🐍');
assert.equal(prepared.files[0].name, 'Моя игра 🐍.html');
assert.equal(prepared.files.length, 4, 'Repeated library references must produce a single file');
for (const name of ['three-r128.min.js', 'three-r160.min.js', 'matter-0.20.0.min.js']) assert(prepared.html.includes(`src="./${name}"`));
assert(prepared.html.includes('id="engine"'));
assert(!prepared.html.includes('integrity=') && !prepared.html.includes('crossorigin='));
assert(!prepared.html.includes('window.THREE'));
for (const file of prepared.files.slice(1)) assert(file.content.includes(license));
assert.equal((await prepareGameHtml(game, false)).html, game);
downloadGameFiles(prepared.files);
assert.equal(downloads.length, 4, 'Each HTML or JS must be downloaded as a separate file');
assert.equal(removed, 4, 'Temporary download anchors must not remain in the editor');
for (const [index, file] of prepared.files.entries()) {
  assert.equal(downloads[index].name, file.name);
  assert.equal(await downloads[index].blob.text(), file.content);
  assert.equal(downloads[index].blob.type, index === 0 ? 'text/html;charset=utf-8' : 'text/javascript;charset=utf-8');
}
assert.equal(blobs.size, 4, 'Blob URLs must stay alive for asynchronous browser downloads');
for (const timer of timers) { assert.equal(timer.ms, 60_000); timer.fn(); }
assert.equal(blobs.size, 0, 'Download URLs must be released after use');
const scriptContext = { window: {} };
const unusualLicense = license + '\n*/\u2028window.injected = true; /*';
const licensedSource = context.api.licensedLibrarySource({ title: 'Local library' }, { source: 'window.safe=true;', license: unusualLicense });
runInNewContext(licensedSource, scriptContext);
assert.equal(scriptContext.window.safe, true);
assert.equal(scriptContext.window.injected, undefined, 'License comments must never become executable code');

const localGame = '<script src="./a/engine.js"></script><script src="./b/engine.js"></script><script src="./c/ENGINE.js"></script>';
const references = (await prepareGameHtml(localGame)).missingLibraries;
await importLocalLibrary(references[0], 'window.One=true;', license);
await importLocalLibrary(references[1], 'window.Two=true;', license);
const local = await prepareGameFiles(localGame, 'game.html');
assert.equal(local.files.length, 3);
assert.equal(local.missingLibraries.length, 1);
assert(local.html.includes('src="./c/ENGINE.js"'), 'Missing libraries must retain their original links');
const localNames = local.files.slice(1).map(file => file.name.toLowerCase());
assert.equal(new Set(localNames).size, 2);
assert(!localNames.includes('engine.js'), 'Missing local filenames must not collide with exported files');
assert(local.files.some(file => file.content.includes('window.One=true')));
assert(local.files.some(file => file.content.includes('window.Two=true')));

const longName = 'e'.repeat(180) + '.js';
const longCode = `<script src="./a/${longName}"></script><script src="./b/${longName}"></script>`;
for (const ref of (await prepareGameHtml(longCode)).missingLibraries) await importLocalLibrary(ref, 'window.Long=true;', license);
const longPackage = await prepareGameFiles(longCode, 'game.html');
assert.equal(longPackage.files.length, 3);
assert.equal(new Set(longPackage.files.map(file => file.name)).size, 3);
assert(longPackage.files.every(file => Array.from(file.name).length <= 160));

assert.equal(packageFilename('CON.js'), '_CON.js');
assert(packageFilename('x'.repeat(300) + '.html').endsWith('.html'));
assert.equal(packageFilename('../bad.js'), '.._bad.js');
const largeSource='/*'+'x'.repeat(5*1024*1024)+'*/window.Large=true;';
const largeLicense=license+'\nAdditional notice: '+'x'.repeat(70*1024);
assert(context.api.validLibraryAsset(largeSource,largeLicense),'Large code and full licenses have no application size cap');
assert.equal(await context.api.readLibraryResponse(new Response(largeSource,{headers:{'Content-Length':String(Buffer.byteLength(largeSource))}})),largeSource);
await assert.rejects(context.api.readLibraryResponse(new Response('missing',{status:404})),/404/);
const largeGame='<script src="./large.js"></script>';
await importLocalLibrary((await prepareGameHtml(largeGame)).missingLibraries[0],largeSource,largeLicense);
const largePrepared=await prepareGameHtml(largeGame);
assert(largePrepared.html.includes(largeSource));assert(largePrepared.html.includes(largeLicense.trim()));
assert.equal((await prepareGameHtml(largeGame,false)).html,largeGame);
assert.match(context.api.resourceSizeWarning(Buffer.byteLength(largeSource),'library'),/Большой объём: 5 МБ/);
assert.match(context.api.resourceSizeWarning(65*1024*1024),/Очень большой объём/);
assert.equal(context.api.resourceSizeWarning(undefined),'');assert.equal(context.api.resourceSizeWarning(1024),'');
console.log('Separate game files: relative references, licenses, collisions, Unicode and individual downloads passed.');
