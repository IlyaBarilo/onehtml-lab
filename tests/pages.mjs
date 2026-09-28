import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const source = await readFile(new URL('../onehtml-lab.html', import.meta.url));
const output = new URL('../dist/pages/', import.meta.url);
const files = await readdir(output);
assert.deepEqual(files, ['index.html'], 'Pages artifact must contain only the application');
const page = await readFile(new URL('index.html', output));
assert.deepEqual(page, source, 'Pages index must be a byte-for-byte copy of the standalone file');
console.log('Pages artifact passed build checks.');
