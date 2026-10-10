import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto as crypto } from 'node:crypto';

const source = (await Promise.all(['quality.js', 'sandbox.js'].map(name => readFile(new URL('../src/' + name, import.meta.url), 'utf8')))).join('\n');
const document = { createElement: () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }) };
const { online, offline } = runInNewContext(source + '\n({ online: makePreview("<p>Game</p>", true), offline: makePreview("<p>Game</p>", false) })', { document, crypto });
assert.match(online.srcdoc, /connect-src https: wss:/);
assert.match(online.srcdoc, /script-src 'unsafe-inline' https:/);
assert.match(online.srcdoc, /PerformanceObserver/);
assert.match(offline.srcdoc, /connect-src data: blob:;/);
assert.match(offline.srcdoc, /script-src 'unsafe-inline' data:;/);
assert(!offline.srcdoc.includes('PerformanceObserver'));
assert.equal(online.attributes.sandbox, 'allow-scripts');
assert.equal(offline.attributes.sandbox, 'allow-scripts');
console.log('Online and hidden offline preview policies passed.');
