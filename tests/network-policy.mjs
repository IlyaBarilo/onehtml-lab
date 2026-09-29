import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../src/sandbox.js', import.meta.url), 'utf8');
const document = { createElement: () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }) };
const { online, offline } = runInNewContext(source + '\n({ online: makePreview("<p>Game</p>", true), offline: makePreview("<p>Game</p>", false) })', { document });
assert.match(online.srcdoc, /connect-src https: wss:/);
assert.match(online.srcdoc, /script-src 'unsafe-inline' https:/);
assert.match(online.srcdoc, /PerformanceObserver/);
assert.match(offline.srcdoc, /connect-src 'none'/);
assert.match(offline.srcdoc, /script-src 'unsafe-inline';/);
assert(!offline.srcdoc.includes('PerformanceObserver'));
assert.equal(online.attributes.sandbox, 'allow-scripts');
assert.equal(offline.attributes.sandbox, 'allow-scripts');
console.log('Online and hidden offline preview policies passed.');
