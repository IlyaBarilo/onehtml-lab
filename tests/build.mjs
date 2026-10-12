import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const standalone = await readFile(new URL('../onehtml-lab.html', import.meta.url), 'utf8');
assert(standalone.includes('data:image/svg+xml,'), 'Favicon must be embedded');
assert(standalone.includes('Permission is hereby granted, free of charge'), 'Standalone file must include its MIT license');
assert(!standalone.includes('embeddedThreeR128'), 'Application must not contain a preloaded Three.js copy');
assert(Buffer.byteLength(standalone) < 2000000, 'Application including editors, native browser demos, portable library tools, library workspace and model examples must stay within its size budget; engine distributions must remain external');
assert(!standalone.includes('Babylon.js v9.30.0 - WebGL'), 'Babylon.js must not be bundled into the editor');
assert(!standalone.includes('class Narrowphase {'), 'cannon-es distribution must not be bundled into the editor');
assert(standalone.includes('data-onehtml-library'), 'Standalone file must contain the library replacement mechanism');
assert(!standalone.includes('не распространяется по лицензии MIT'), 'Standalone file must not retain separate logo restrictions');
assert(!standalone.includes('<!-- APP_'), 'No template markers may remain');
assert(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(standalone), 'No external application resources');
const editorLicenses = await readFile(new URL('../src/vendor/codemirror-LICENSE.txt', import.meta.url), 'utf8');
// Git uses LF on Linux; the standalone build deliberately writes CRLF.
const normalizeLineEndings = text => text.replace(/\r\n/g, '\n');
assert(normalizeLineEndings(standalone).includes(normalizeLineEndings(editorLicenses).trim()), 'All CodeMirror copyright and permission notices must be included in full');
const toneLicenses = normalizeLineEndings(await readFile(new URL('../src/vendor/tone-LICENSE.txt', import.meta.url), 'utf8')).trim();
assert(standalone.includes(JSON.stringify(toneLicenses)), 'Complete Tone.js distribution notices must be present as catalog data');
assert(!standalone.includes('/* TONE_LICENSE */ null'), 'The music license marker must be replaced by the build');
assert(!standalone.includes('For license information please see Tone.js.LICENSE.txt'), 'Tone.js itself must remain an optional download');
const pixiLicenses = normalizeLineEndings(await readFile(new URL('../src/vendor/pixi-LICENSE.txt', import.meta.url), 'utf8')).trim();
assert(standalone.includes(JSON.stringify(pixiLicenses)), 'Complete PixiJS and bundled component notices must be present as catalog data');
assert(!standalone.includes('/* PIXI_LICENSE */ null'), 'The PixiJS license marker must be replaced');
assert(!standalone.includes(' * PixiJS - v8.22.0'), 'PixiJS engine distribution must remain an optional download');
for (const name of ['p5', 'havok', 'model-viewer', 'aframe']) {
  const notices = normalizeLineEndings(await readFile(new URL(`../src/vendor/${name}-LICENSE.txt`, import.meta.url), 'utf8')).trim();
  assert(standalone.includes(JSON.stringify(notices)), `Complete ${name} notices must be included as catalog data`);
}
assert(!standalone.includes('/* ADDED_LICENSES */ null'), 'Additional library license marker must be replaced');
assert(!standalone.includes('/* P5_SOURCE_MANIFEST */ null'), 'p5 source metadata must be included');
assert(!/onehtml-p5-source:1\\nH4sI[A-Za-z\d+/=]{100}/.test(standalone), 'p5 source payload must not be preloaded into the editor');
assert(!standalone.includes('raw.githubusercontent.com/IlyaBarilo/onehtml-lab'), 'Game libraries and source files must not be downloaded from the author repository');
await assert.rejects(readFile(new URL('../src/vendor/p5-source-2.3.4.tar.gz', import.meta.url)), {code:'ENOENT'}, 'p5 source archive must not be stored among public files');
assert(standalone.includes("'wasm-unsafe-eval'"), 'WASM physics requires the specific CSP permission');
assert(!standalone.includes("'unsafe-eval'"), 'JavaScript eval must remain blocked');
const expectedVersion = process.argv[2];
assert(process.argv.length <= 3, 'Use: node tests/build.mjs [v1.2.3]');
const matches = [...standalone.matchAll(/class="app-version"/g)];
if (expectedVersion) {
  assert.match(expectedVersion, /^v\d+(?:\.\d+){0,3}$/);
  assert.equal(matches.length, 1, 'Release must show one version element');
  assert(standalone.includes(`<span class="app-version" aria-label="Версия ${expectedVersion.slice(1)}">${expectedVersion.slice(1)}</span>`), 'Visible and accessible version must omit the tag prefix');
} else {
  assert.equal(matches.length, 0, 'Local build must not show a version');
}
console.log('Standalone artifact passed build checks.');
