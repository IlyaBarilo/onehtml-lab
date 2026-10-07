import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../src/ai-session.js', import.meta.url), 'utf8');
const api = runInNewContext(source + '\n({aiResponsePlan,aiResponseWarnings,mergeAiPromptEntries})', { document: { querySelector: () => ({}) } });
const html = '<!doctype html><html><body>Игра 😀</body></html>';
assert.equal(api.aiResponsePlan(html).fenced, false);
for (const marker of ['```', '~~~~']) {
  const value = api.aiResponsePlan(`Пояснение\r\n${marker}html\r\n${html}\r\n${marker}\r\nКонец`);
  assert.equal(value.blocks.length, 1); assert.equal(value.blocks[0].code, html); assert(value.blocks[0].completeFence);
}
assert.equal(api.aiResponsePlan('```html\n' + html).blocks[0].completeFence, false);
assert.equal(api.aiResponsePlan('```css\na{color:red}\n```\n```js\nalert(1)\n```').blocks.length, 0);
assert.equal(api.aiResponsePlan('```\n' + html + '\n```').blocks.length, 1);
assert.equal(api.aiResponsePlan('```html\n' + html + '\n```\n```html\n<p>Другой</p>\n```').blocks.length, 2);
assert.equal(api.aiResponsePlan('````html\n<script>const s="```";</script>\n' + html + '\n````').blocks.length, 1);
assert.equal(api.aiResponseWarnings(html).length, 0);
assert(api.aiResponseWarnings('<p>Фрагмент</p>').some(note => note.includes('неполный HTML')));
assert(api.aiResponseWarnings('```html\n' + html + '\n```').some(note => note.includes('Markdown')));
const entry = index => ({ id: String(index), createdAt: index, text: 'Запрос', task: '', mode: 'change', project: 'game', platform: 'mobile', mediaFiles: [], source: null });
const rows = Array.from({ length: 25 }, (_, index) => entry(index));
const merged = api.mergeAiPromptEntries(rows, [entry(24), { text: '<script>bad</script>' }, { ...entry(30), mode: 'unknown' }]);
assert.equal(merged.length, 20); assert.equal(merged[0].id, '24'); assert.equal(merged.at(-1).id, '5');
assert.equal(new Set(merged.map(value => value.id)).size, 20);
assert.equal(api.mergeAiPromptEntries([{ ...entry(30), source: { symbols: -1 } }]).length, 0);
console.log('AI response fences, ambiguous/incomplete HTML and bounded prompt-history merge passed.');
