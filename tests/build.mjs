import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const standalone = await readFile(new URL('../onehtml-lab.html', import.meta.url), 'utf8');
assert(standalone.includes('data:image/svg+xml,'), 'Favicon must be embedded');
assert(standalone.includes('Permission is hereby granted, free of charge'), 'Standalone file must include its MIT license');
assert(!standalone.includes('embeddedThreeR128'), 'Application must not contain a preloaded Three.js copy');
assert(Buffer.byteLength(standalone) < 1630000, 'Application including editors, portable library tools and model examples must stay within its size budget; engine distributions must remain external');
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
const expectedVersion = process.argv[2];
assert(process.argv.length <= 3, 'Use: node tests/build.mjs [v1.2.3]');
const matches = [...standalone.matchAll(/class="app-version"/g)];
if (expectedVersion) {
  assert.match(expectedVersion, /^v\d+(?:\.\d+){0,3}$/);
  assert.equal(matches.length, 1, 'Release must show one version element');
  assert(standalone.includes(`aria-label="Версия ${expectedVersion}"`));
} else {
  assert.equal(matches.length, 0, 'Local build must not show a version');
}
console.log('Standalone artifact passed build checks.');
