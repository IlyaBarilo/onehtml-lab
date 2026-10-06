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

function compact(parts, contextLines = 3) {
  const { source, gaps } = context.comparisonLineGaps(parts, contextLines);
  const chunks = Array.from(context.comparisonChunks(parts, gaps));
  assert.equal(chunks.map(part => part.type === 'gap' ? source.slice(part.gap.from, part.gap.to) : part.text).join(''), source, 'Expanding every gap reconstructs the full diff');
  for (const type of ['added', 'removed']) {
    assert.equal(chunks.filter(part => part.type === type).map(part => part.text).join(''), parts.filter(part => part.type === type).map(part => part.text).join(''), 'No changed characters can be hidden');
  }
  return { source, gaps: Array.from(gaps, gap => ({ ...gap })), chunks };
}
const numbered = Array.from({ length: 55 }, (_, i) => `Строка ${i}`).join('\n');
const edited = numbered.replace('Строка 13\n', 'Новая 13\n').replace('Строка 37\n', 'Новая 37 ⭐\n');
assert.deepEqual(compact(diff(numbered, edited)).gaps.map(gap => [gap.id, gap.count]), [[0, 10], [17, 17], [41, 14]]);
assert.deepEqual(compact(diff(numbered, numbered.replace('Строка 13\n', 'Новая 13\n').replace('Строка 18\n', 'Новая 18\n'))).gaps.map(gap => [gap.id, gap.count]), [[0, 10], [22, 33]], 'Nearby context merges without hiding changes');
assert.equal(compact(diff('', '')).gaps.length, 0);
assert.equal(compact(diff('unchanged\n', 'unchanged\n')).gaps[0].count, 1, 'A trailing newline is not an extra hidden line');
assert.equal(compact(diff('\n\n\n', '\n\n\n')).gaps[0].count, 3);
for (const [before, after] of [
  ['first\r\n\r\nlast\r\n', 'first\r\nnew\r\nlast\r\n'],
  ['one\rtwo\rthree', 'one\rTWO\rthree'],
  ['a b\nc', 'a\nb\nc'],
  ['a\nb\nc', 'a b\nc'],
  ['⭐ x', '🏆 x'],
  ['a\n', 'a'],
  ['a', 'a\n']
]) compact(diff(before, after), 0);
const splitNewline = compact([{ type: 'same', text: 'a\r' }, { type: 'same', text: '\nb' }], 0);
assert.equal(splitNewline.gaps[0].count, 2, 'CRLF across fragments is one newline');
for (let caseNumber = 0; caseNumber < 250; caseNumber++) {
  const before = Array.from({ length: random() % 60 }, () => alphabet[random() % alphabet.length]).join('');
  const after = Array.from({ length: random() % 60 }, () => alphabet[random() % alphabet.length]).join('');
  compact(diff(before, after), random() % 4);
}
console.log('Code diff reconstruction, context merging, exact hidden-line counts and complete changes passed.');
