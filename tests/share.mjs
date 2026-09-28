import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'src/exporter.js'), 'utf8');
class TestFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}
const sandbox = { File: TestFile, navigator: {} };
runInNewContext(source + '\nglobalThis.shareHtmlUnderTest = shareHtml;', sandbox);
const shareHtml = sandbox.shareHtmlUnderTest;
const code = '<!doctype html><title>Игра 🐱</title>';

let shared;
const supported = {
  canShare(data) { assert.equal(data.files.length, 1); return true; },
  share(data) { shared = data; return Promise.resolve(); }
};
const pending = shareHtml(code, 'Моя игра', supported);
assert(shared, 'System sharing must start before the click activation expires');
assert.equal(await pending, 'shared');
assert.equal(shared.files[0].name, 'Моя игра.html');
assert.equal(shared.files[0].type, 'text/html');
assert.equal(shared.files[0].parts[0], code);
assert.deepEqual(Object.keys(shared), ['files']);

assert.equal(await shareHtml(code, 'game.html', { canShare: () => false, share: () => { throw Error('must not share'); } }), 'unsupported');
assert.equal(await shareHtml(code, 'game.html', { share: () => { throw Error('must not share'); } }), 'unsupported');
assert.equal(await shareHtml(code, 'game.html', {
  canShare: () => true,
  share: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
}), 'cancelled');
await assert.rejects(shareHtml(code, 'game.html', {
  canShare: () => true,
  share: () => Promise.reject(new Error('share failed'))
}), /share failed/);

console.log('HTML file sharing behavior passed.');
