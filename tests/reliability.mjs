import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const file = new URL('../onehtml-lab.html', import.meta.url);
const html = await readFile(file);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const selected = process.argv.find(value => value.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length);
const saved = page => page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
async function edit(page, text, editor) {
  await page.locator(editor === 'native' ? '#code' : '.cm-editor .cm-content').fill(text);
  assert.equal(await page.locator('#code').inputValue(), text);
}
async function snapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('onehtml-lab-draft', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction('drafts', 'readonly');
      const requests = ['expert', 'history', 'revision'].map(key => transaction.objectStore('drafts').get(key));
      transaction.oncomplete = () => { database.close(); resolve(requests.map(request => request.result)); };
    };
  }));
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of [file.href, `http://127.0.0.1:${server.address().port}/`]) for (const editor of ['native', 'codemirror']) {
        const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true, acceptDownloads: true });
        context.setDefaultTimeout(10000);
        try {
          await context.addInitScript(() => localStorage.setItem('onehtml-lab-settings', JSON.stringify({ mode: 'expert' })));
          const open = async () => {
            const page = await context.newPage();
            if (editor === 'native') await useNativeEditor(page);
            await page.goto(url);
            await page.waitForFunction(() => !document.querySelector('#code').disabled);
            return page;
          };
          const first = await open();
          await edit(first, '<h1>Общая версия</h1>', editor); await saved(first);
          const second = await open();
          assert.equal(await second.locator('#code').inputValue(), '<h1>Общая версия</h1>');
          await edit(first, '<h1>Первая вкладка</h1>', editor); await saved(first);
          const beforeConflict = await snapshot(first);
          await edit(second, '<h1>Вторая вкладка</h1>', editor);
          await second.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Другая вкладка');
          assert.deepEqual(await snapshot(first), beforeConflict, 'Conflicting autosave must change neither code nor history');
          await edit(second, '<h1>Продолжаю во второй</h1>', editor);
          assert.match(await second.locator('#activity-summary').innerText(), /другой вкладке/);
          assert(await second.locator('#save').isEnabled());
          await second.locator('#activity-toggle').click();
          await second.locator('#draft-continue').click(); await saved(second);
          const chosen = await snapshot(second);
          assert.equal(chosen[0], '<h1>Продолжаю во второй</h1>');
          assert(chosen[1].entries.some(entry => entry.code === '<h1>Первая вкладка</h1>'));
          assert.equal(await first.locator('#code').inputValue(), '<h1>Первая вкладка</h1>', 'Another tab must not silently replace the visible editor');
          await edit(first, '<h1>Старая вкладка ещё редактирует</h1>', editor);
          await first.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Другая вкладка');
          assert.deepEqual(await snapshot(second), chosen);
          await first.close();
          await second.reload();
          await second.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await second.locator('#code').inputValue(), chosen[0]);
          assert((await snapshot(second))[1].entries.some(entry => entry.code === '<h1>Первая вкладка</h1>'));

          // Defer only the normal debounce, then simulate hiding the mobile tab.
          await second.evaluate(() => {
            const timeout = window.setTimeout.bind(window);
            window.setTimeout = (fn, delay, ...args) => timeout(fn, delay === 700 ? 60000 : delay, ...args);
          });
          await edit(second, '<h1>Перед переходом в ИИ</h1>', editor);
          await second.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
            delete document.visibilityState;
          });
          await saved(second);
          assert.equal((await snapshot(second))[0], '<h1>Перед переходом в ИИ</h1>');
          await second.reload(); await second.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await second.locator('#code').inputValue(), '<h1>Перед переходом в ИИ</h1>');

          // Abort after the code put: the same transaction must retain both old values.
          await second.locator('#history-open').click();
          await second.locator('.history-current-row [aria-label="Отметить текущую версию как верную"]').click();
          await second.locator('#history-close').click(); await saved(second);
          const stable = await snapshot(second);
          await second.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(value, key) {
              if (this.name === 'drafts' && key === 'history') throw new DOMException('Test quota', 'QuotaExceededError');
              return put.call(this, value, key);
            };
          });
          await edit(second, '<h1>Не потерять при ошибке</h1>', editor);
          await second.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Не сохранено');
          assert.deepEqual(await snapshot(second), stable);
          assert.equal(await second.locator('#code').inputValue(), '<h1>Не потерять при ошибке</h1>');
          assert(await second.locator('#save').isEnabled());
          assert(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await second.reload(); await second.waitForFunction(() => !document.querySelector('#code').disabled);
          const large = '<!doctype html>\n<!--' + 'x'.repeat(1024 * 1024) + '-->\n<h1>Последняя строка</h1>';
          await second.locator('#import-file').setInputFiles({ name: 'large.html', mimeType: 'text/html', buffer: Buffer.from(large) });
          await second.locator('#replace-dialog button[value="replace"]').click();
          await second.waitForFunction(text => document.querySelector('#code').value === text, large);
          await saved(second);
          const field = second.locator(editor === 'native' ? '#code' : '.cm-editor .cm-content');
          await field.click(); await field.press('Control+End'); await field.press('End');
          await field.press('!'); await saved(second);
          assert.equal(await second.locator('#code').inputValue(), large + '!');
          await second.setViewportSize({ width: 720, height: 320 });
          assert(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await second.setViewportSize({ width: 320, height: 720 });
          await second.locator('#save').click();
          const downloading = second.waitForEvent('download');
          await second.locator('#confirm-save').click();
          const download = await downloading;
          assert.equal(await readFile(await download.path(), 'utf8'), large + '!');
          await second.reload(); await second.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await second.locator('#code').inputValue(), large + '!');
          console.log(`${name} ${new URL(url).protocol} ${editor}: atomic draft/history, concurrent tabs, explicit recovery, background flush and failed write passed.`);
          console.log(`${name} ${editor}: 1 MiB HTML import, last-line typing, rotation, exact export and reload passed.`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { server.close(); }
