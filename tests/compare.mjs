import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'src/compare.js'), 'utf8');
const context = {};
runInNewContext(source, context);
const diff = (before, after) => Array.from(context.codeDiff(before, after), part => ({ type: part.type, text: part.text }));

function check(before, after) {
  const parts = diff(before, after);
  assert.equal(parts.filter(part => part.type !== 'added').map(part => part.text).join(''), before);
  assert.equal(parts.filter(part => part.type !== 'removed').map(part => part.text).join(''), after);
  assert(parts.every(part => part.text && ['same', 'added', 'removed'].includes(part.type)));
  return parts;
}

assert.deepEqual(check('abc', 'abc'), [{ type: 'same', text: 'abc' }]);
assert.deepEqual(check('', '<h1>новая</h1>'), [{ type: 'added', text: '<h1>новая</h1>' }]);
const parts = check('<h1>Старая</h1>\n<p>Игра</p>', '<h1>Новая</h1>\n<p>Игра!</p>');
assert(parts.some(part => part.type === 'removed' && part.text.includes('Старая')));
assert(parts.some(part => part.type === 'added' && part.text.includes('Новая')));
assert(parts.some(part => part.type === 'same' && part.text.includes('Игра')));
assert(parts.some(part => part.type === 'added' && part.text.includes('!')));

const alphabet = ['a', 'b', '<', '>', ' ', '\n', 'Я'];
let seed = 17;
function random() { seed = (seed * 48271) % 2147483647; return seed; }
for (let caseNumber = 0; caseNumber < 500; caseNumber++) {
  const before = Array.from({ length: random() % 35 }, () => alphabet[random() % alphabet.length]).join('');
  const after = Array.from({ length: random() % 35 }, () => alphabet[random() % alphabet.length]).join('');
  check(before, after);
}
check('x'.repeat(100_000), 'y'.repeat(100_000));
console.log('Code diff reconstruction and multiple changes passed.');
