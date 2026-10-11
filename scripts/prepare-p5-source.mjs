import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

// Accept only the unchanged upstream release, never the project's working tree.
const input = process.argv[2];
assert(input, 'Pass the upstream p5.js v2.3.4 source tar.gz path.');
const archive = await readFile(input);
assert.equal(createHash('sha256').update(archive).digest('hex'), 'efd86925ca0a8e66c53ffdbe8c5799b1abfc85c2921a99a1a03fd5147fd7ef21');
const tar = gunzipSync(archive), selected = [], names = new Set();
const field = bytes => bytes.toString('utf8').split('\0')[0];
let offset = 0, pax = null;
while (offset + 512 <= tar.length) {
  const start = offset, header = tar.subarray(offset, offset + 512), name = field(header.subarray(0, 100));
  if (!name) break;
  const size = parseInt(field(header.subarray(124, 136)).trim(), 8) || 0;
  offset += 512 + Math.ceil(size / 512) * 512;
  assert(offset <= tar.length, 'Truncated tar entry.');
  if (header[156] === 120) { pax = tar.subarray(start, offset); continue; }
  if (header[156] === 103) continue;
  const prefix = field(header.subarray(345, 500));
  const longName = pax && /\d+ path=([^\n]+)/.exec(pax.subarray(512).toString())?.[1];
  const path = (longName || (prefix ? prefix + '/' : '') + name).replace(/^[^/]+\//, '');
  assert(!path.split('/').includes('..'), 'Unsafe source path.');
  const allowed = /^(?:(?:src|lib|translations|utils)\/|package(?:-lock)?\.json$|rollup\.config\.mjs$|license\.txt$)/.test(path);
  const internal = /(?:^|\/)(?:AGENTS\.md|\.gitignore|local)(?:\/|$)/i.test(path);
  if (allowed && !internal) {
    if (header[156] === 48 || header[156] === 0) {
      const content = tar.subarray(start + 512, start + 512 + size);
      selected.push([path, size, createHash('sha256').update(content).digest('hex'), parseInt(field(header.subarray(100, 108)).trim(), 8) || 420]);
      names.add(path);
    }
  }
  pax = null;
}
for (const name of ['src/app.js', 'package.json', 'package-lock.json', 'rollup.config.mjs', 'license.txt']) assert(names.has(name), 'Missing ' + name);
const manifest = {version:'2.3.4',bytes:selected.reduce((sum,item)=>sum+item[1],0),files:selected};
await writeFile(new URL('../src/vendor/p5-source-2.3.4.json', import.meta.url), JSON.stringify(manifest,null,2).replace(/\n/g,'\r\n')+'\r\n');
console.log(`Prepared p5.js source manifest: ${selected.length} files, ${manifest.bytes} bytes. No library or source payload is stored in the repository.`);
