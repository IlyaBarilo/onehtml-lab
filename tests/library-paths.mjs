import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/library-bundle.js', import.meta.url), 'utf8');
const context = { TextEncoder, TextDecoder, crypto: webcrypto, window: {} };
runInNewContext(source + '\nthis.api = { libraryMatches, prepareGameHtml, importLocalLibrary, localLibraryLicense, libraryCache, downloadLibrary };', context);
const { libraryMatches, prepareGameHtml, importLocalLibrary, localLibraryLicense, libraryCache } = context.api;
const license = 'The MIT License\nCopyright (c) Library authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const classic = path => `<script id="engine" src="${path}"></script><script>window.ready = true;</script>`;

for (const path of [
  './three-r128.min.js', 'three.r128.js', '../libs/three-r128.min.js', '../../assets/vendor/three-r128.min.js',
  '/vendor/three-r128.min.js', './libs/three@0.128.0/build/three.min.js', './libs/three.js/r128/three.min.js',
  './libs/0.128.0/three.min.js', './three-0.128.0.min.js?cache=1&amp;v=2#script',
  './libs%20folder/three-r128.min.js', 'file:///C:/games/vendor/three-r128.min.js', 'C:\\games\\three-r128.min.js',
  '../archive/r160/vendor/three-r128.min.js'
]) {
  const prepared = await prepareGameHtml(classic(path));
  assert.equal(prepared.missingLibraries.length, 1, path);
  assert.equal(prepared.missingLibraries[0].catalogKey, 'three@0.128.0', path);
  assert.match(prepared.missingLibraries[0].key, /^local@[a-f\d]{64}:/);
  assert.equal(prepared.html, classic(path), 'Unavailable local files must remain unchanged');
}
for (const [path, key] of [
  ['../physics/matter-0.20.0.min.js', 'matter-js@0.20.0'],
  ['vendor/matter-js@0.20.0/build/matter.min.js', 'matter-js@0.20.0'],
  ['/libs/phaser-3.90.0.js', 'phaser@3.90.0'],
  ['assets/phaser/3.90.0/phaser.min.js', 'phaser@3.90.0']
]) assert.equal((await prepareGameHtml(classic(path))).missingLibraries[0].catalogKey, key);

assert.equal(libraryMatches('<script SRC=../three-r128.min.js TYPE=text/javascript></script>')[0].key, 'three@0.128.0');
assert.equal(libraryMatches('<!-- <script src="./three-r128.min.js"></script> -->').length, 0);
assert.equal(libraryMatches('<textarea><script src="./three-r128.min.js"></script></textarea>').length, 0);
assert.equal(libraryMatches('<style>p::before { content: \'<script src="./three-r128.min.js"></script>\' }</style>').length, 0);
assert.equal(libraryMatches('<script>const text = `<script src="./three-r128.min.js"><\\/script>`;</script>').length, 0);
for (const attributes of ['type=module', 'async', 'defer', 'nomodule']) {
  assert.equal(libraryMatches(`<script ${attributes} src="./three-r128.min.js"></script>`).length, 0);
}
for (const path of ['https://example.org/three-r128.min.js', 'https://cdnjs.cloudflare.com.evil.test/ajax/libs/three.js/r128/three.min.js', 'data:text/javascript,hello', './styles.css']) {
  assert.equal(libraryMatches(classic(path)).length, 0, path);
}
assert.equal(libraryMatches(classic('//cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'))[0].key, 'three@0.128.0');

for (const path of ['./three.min.js', '../three-r170.min.js', './custom-engine.js', './mygame-0.160.0/three.min.js']) {
  const reference = (await prepareGameHtml(classic(path))).missingLibraries[0];
  assert(reference.localPath && !reference.catalogKey && !reference.url, 'Unknown versions must require the actual local file');
}

const code = classic('../vendor/custom-engine.js');
const reference = (await prepareGameHtml(code)).missingLibraries[0];
const library = 'window.CustomEngine = { version: "selected" };';
assert.equal(await importLocalLibrary(reference, library, license), false, 'Unavailable IndexedDB must still permit use for this session');
const prepared = await prepareGameHtml(code);
assert.equal(prepared.missingLibraries.length, 0);
assert(prepared.html.includes(library));
assert(prepared.html.includes(license));
assert(prepared.html.includes('<script id="engine" data-onehtml-library="local@'));
assert(!prepared.html.includes('src="../vendor/custom-engine.js"'));
assert.equal((await prepareGameHtml(code, false)).html, code);
assert.equal((await prepareGameHtml(code + '<p>Another game</p>')).missingLibraries.length, 1, 'Unversioned local files must not silently carry over to a different document');
await assert.rejects(importLocalLibrary(reference, '</script><p>unsafe', license));
await assert.rejects(importLocalLibrary(reference, library, 'Unknown license'));
assert.equal(localLibraryLicense(`/*! ${license} */\n${library}`).trim(), license);

libraryCache.set('three@0.128.0', { key: 'three@0.128.0', source: 'window.THREE={REVISION:"128"};', license });
const knownCode = classic('./three-r128.min.js');
const bundled = await prepareGameHtml(knownCode);
assert.equal(bundled.missingLibraries.length, 0);
assert(bundled.html.includes('data-onehtml-library="three@0.128.0"'));
assert.equal(bundled.bundledLibraryDetails[0].addedBytes, Buffer.byteLength(bundled.html) - Buffer.byteLength(knownCode), 'Reported increase includes the source, license and embedding metadata');
assert.equal((await prepareGameHtml(knownCode, false)).html, knownCode);
const sriCode = '<script id="engine" src="./three-r128.min.js" integrity="sha256-old" crossorigin="anonymous"></script>';
assert(!(await prepareGameHtml(sriCode)).html.includes('integrity='));
assert(!(await prepareGameHtml(sriCode)).html.includes('crossorigin='));

libraryCache.clear();
const downloadRef = (await prepareGameHtml(knownCode)).missingLibraries[0];
const requested = [];
context.fetch = async url => {
  requested.push(url);
  return new Response(url.endsWith('/LICENSE') ? license : 'window.THREE={REVISION:"128"};');
};
await context.api.downloadLibrary(downloadRef);
assert.deepEqual(requested, [downloadRef.url, downloadRef.licenseUrl]);
assert(libraryCache.has('three@0.128.0'), 'Local versioned paths must populate the shared version cache');
assert.equal((await prepareGameHtml(classic('../other/three-r128.min.js'))).missingLibraries.length, 0);
console.log('Local library paths, exact versions, selected files, licenses and unchanged source passed.');
