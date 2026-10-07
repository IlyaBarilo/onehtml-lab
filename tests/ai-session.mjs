import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';
const appUrl = new URL('../onehtml-lab.html', import.meta.url);
const html = await readFile(appUrl);
const server = createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [appUrl.href, `http://127.0.0.1:${server.address().port}/`];
const requested = process.argv.find(value => value.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !requested || name === requested);
assert(engines.length);
const first = '<!doctype html><html><body><h1>Первая версия</h1></body></html>';
const second = '<!doctype html><html><body><h1>Вторая версия 😀</h1><script>window.__answerExecuted=true;</script></body></html>';
async function prepared(page) { await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled); return page.locator('#ai-output').inputValue(); }
async function setCode(page, code) { await page.evaluate(value => { const field = document.querySelector('#code'); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); }, code); }
async function historyCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('onehtml-lab-ai', 1);
    request.onsuccess = () => { const database = request.result; const transaction = database.transaction('prompts'); const rows = transaction.objectStore('prompts').getAll(); transaction.oncomplete = () => { database.close(); resolve(rows.result.length); }; transaction.onerror = () => reject(transaction.error); };
    request.onerror = () => reject(request.error);
  }));
}
async function stored(page, count) { await assertPoll(() => historyCount(page), count); }
async function assertPoll(read, expected) { const end = Date.now() + 10000; let value; do { value = await read(); if (value === expected) return; await new Promise(resolve => setTimeout(resolve, 40)); } while (Date.now() < end); assert.equal(value, expected); }
async function layout(page, panel) {
  const value = await page.locator(panel).evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth }; });
  assert(value.scroll <= value.width, JSON.stringify(value)); assert(value.left >= -1 && value.right <= value.width + 1); assert(value.bottom <= value.height + 1);
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      let checkedLimit = false;
      for (const url of urls) for (const width of [320, 1365]) for (const editor of ['native', 'codemirror']) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        context.setDefaultTimeout(10000);
        await context.addInitScript(() => {
          window.__copied = ''; window.__denyCopy = false;
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => { if (window.__denyCopy) throw new Error('denied'); window.__copied = text; },
            readText: async () => { throw new Error('denied'); }
          } });
        });
        const page = await context.newPage();
        if (editor === 'native') await useNativeEditor(page);
        const errors = [], external = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route(/https?:\/\/(?!127\.0\.0\.1)/, route => { external.push(route.request().url()); return route.abort(); });
        const label = `${name} ${new URL(url).protocol} ${width} ${editor}`;
        try {
          await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert(await page.locator('#ai-open').isHidden()); await page.locator('#expert-toggle').click();
          await setCode(page, first);
          if (editor === 'native') await page.locator('#theme-toggle').click();
          await page.locator('#ai-open').click();
          await page.locator('#prompt-create').click(); await page.locator('#ai-task').fill('Идея для новой работы');
          await page.locator('#prompt-change').click(); await page.locator('#ai-task').fill('Измени заголовок 😀');
          await page.locator('[data-ai-project="application"]').click();
          await page.locator('#ai-dialog [data-platform="desktop"]').click();
          await page.locator('#ai-shorten').uncheck();
          const prompt = await prepared(page); await page.locator('#ai-copy').click(); await stored(page, 1);
          assert.equal(await page.evaluate(() => window.__copied), prompt);
          await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
          await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#ai-open').click();
          assert.equal(await page.locator('#ai-task').inputValue(), 'Измени заголовок 😀');
          assert.equal(await page.locator('#prompt-change').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('[data-ai-project="application"]').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('#ai-dialog [data-platform="desktop"]').getAttribute('aria-selected'), 'true');
          assert(await page.locator('#ai-shorten').isChecked() === false);
          await page.locator('#prompt-create').click(); assert.equal(await page.locator('#ai-task').inputValue(), 'Идея для новой работы');
          await page.locator('#prompt-change').click();
          await page.locator('#ai-prompts-open').click(); await page.locator('#ai-prompts-list button').first().click();
          assert.equal(await page.locator('#ai-prompts-text').inputValue(), prompt);
          await page.locator('#ai-prompts-source').getByText('Исходник запроса совпадает с текущей версией.', { exact: true }).waitFor();
          await page.locator('#ai-prompts-copy').click(); await stored(page, 2);
          assert.equal(await page.evaluate(() => window.__copied), prompt);
          await page.locator('#ai-prompts-close').click();
          await page.locator('#ai-answer-open').click();
          await page.locator('#ai-answer-paste').click(); assert.match(await page.locator('#ai-answer-note').innerText(), /Буфер недоступен/);
          await page.locator('#ai-answer-text').fill('Обновлённый код:\n```html\n' + second + '\n```\nПояснение.');
          assert.equal(await page.locator('#code').inputValue(), first);
          await page.locator('#ai-answer-compare').click();
          assert.equal(await page.locator('#code').inputValue(), first);
          assert.equal(await page.evaluate(() => window.__answerExecuted), undefined);
          assert(await page.locator('#ai-answer-diff .diff-added').count());
          await layout(page, '#ai-answer-panel');
          assert.notEqual(await page.locator('#ai-answer-diff').evaluate(node => getComputedStyle(node).color), await page.locator('#ai-answer-panel').evaluate(node => getComputedStyle(node).backgroundColor), 'Review text stays readable in both themes');
          await page.setViewportSize({ width, height: 390 });
          await layout(page, '#ai-answer-panel');
          const applyBounds = await page.locator('#ai-answer-apply').boundingBox();
          assert(applyBounds && applyBounds.height >= 44 && applyBounds.y + applyBounds.height <= 391, 'Apply stays visible at keyboard-height viewports');
          await page.setViewportSize({ width, height: 800 });
          await page.locator('#ai-answer-apply').click(); assert.equal(await page.locator('#code').inputValue(), second);
          if (editor === 'codemirror') assert.match(await page.locator('#alternative-editor .cm-content').innerText(), /Вторая версия/);
          await page.locator('#history-open').click(); assert.match(await page.locator('#history-list').innerText(), /\d{2}:\d{2}:\d{2}/); await page.locator('#history-close').click();
          await page.locator('#ai-open').click(); await page.locator('#ai-prompts-open').click(); await page.locator('#ai-prompts-list button').first().click();
          await page.waitForFunction(() => document.querySelector('#ai-prompts-source').textContent.startsWith('Исходник запроса есть в истории кода:'));
          await page.locator('#ai-prompts-reuse').click();
          assert.equal(await page.locator('#ai-task').inputValue(), 'Измени заголовок 😀');
          assert((await prepared(page)).includes(second)); assert.equal(await page.locator('#code').inputValue(), second);
          await page.evaluate(() => { window.__denyCopy = true; }); await page.locator('#ai-copy').click();
          assert(await page.locator('#copy-dialog').isVisible()); assert.equal(await historyCount(page), 2, 'Failed clipboard access is not a copied prompt');
          await page.locator('#copy-text').evaluate(field => { field.select(); field.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })); });
          await stored(page, 3); await page.locator('#copy-close').click(); await page.evaluate(() => { window.__denyCopy = false; });
          await page.locator('#ai-answer-open').click();
          await page.locator('#ai-answer-text').fill('```html\n' + first + '\n```\n```html\n' + second + '\n```');
          assert(await page.locator('#ai-answer-compare').isDisabled()); await page.locator('#ai-answer-block').selectOption('0');
          await page.locator('#ai-answer-compare').click();
          await setCode(page, second + '\n<!-- Между просмотром и заменой -->');
          assert(await page.locator('#ai-answer-apply').isDisabled()); assert.match(await page.locator('#ai-answer-note').innerText(), /сравните заново/);
          await page.locator('#ai-answer-back').click(); await page.locator('#ai-answer-text').fill('<p>Фрагмент</p>');
          assert.match(await page.locator('#ai-answer-note').innerText(), /неполный HTML/);
          await page.locator('#ai-answer-close').click(); assert.match(await page.locator('#code').inputValue(), /Между просмотром/);
          if (!checkedLimit) {
            await page.locator('#prompt-create').click();
            for (let i = 0; i < 23; i++) { await page.locator('#ai-task').fill('История ' + i); await prepared(page); await page.locator('#ai-copy').click(); }
            await stored(page, 20); await page.locator('#ai-prompts-open').click();
            await assertPoll(() => page.locator('#ai-prompts-list button').count(), 20);
            assert.match(await page.locator('#ai-prompts-list button').first().innerText(), /История 22/);
            await page.locator('#ai-prompts-close').click(); checkedLimit = true;
          }
          await page.locator('#ai-close').click(); await page.locator('#expert-toggle').click(); assert(await page.locator('#ai-open').isHidden());
          assert.deepEqual(errors, []); assert.deepEqual(external, []);
          console.log(`${label}: settings, exact history, source binding, manual copy, inert answer, comparison and explicit replacement passed.`);
        } finally { await context.close(); }
      }
      // Blocked/quota storage leaves current editor and session history usable.
      const context = await browser.newContext();
      await context.addInitScript(() => {
        Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
      });
      const page = await context.newPage(); await page.goto(urls[1]); await page.waitForFunction(() => !document.querySelector('#code').disabled);
      await page.locator('#expert-toggle').click(); await page.locator('#ai-open').click(); await page.locator('#ai-task').fill('Сеанс без хранилища');
      await prepared(page); await page.locator('#ai-copy').click(); await page.locator('#ai-prompts-open').click();
      await page.locator('#ai-prompts-note').getByText(/только в этом сеансе/).waitFor(); assert.equal(await page.locator('#ai-prompts-list button').count(), 1);
      await context.close();
      const quotaContext = await browser.newContext();
      await quotaContext.addInitScript(() => {
        window.__failAiPut = false;
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (window.__failAiPut && this.transaction.db.name === 'onehtml-lab-ai') throw new DOMException('Quota', 'QuotaExceededError');
          return put.apply(this, args);
        };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
      });
      const quotaPage = await quotaContext.newPage(); await quotaPage.goto(urls[1]);
      await quotaPage.waitForFunction(() => !document.querySelector('#code').disabled);
      await quotaPage.locator('#expert-toggle').click(); await quotaPage.locator('#ai-open').click();
      await quotaPage.locator('#ai-task').fill('Сохранённый запрос'); await prepared(quotaPage); await quotaPage.locator('#ai-copy').click(); await stored(quotaPage, 1);
      await quotaPage.evaluate(() => { window.__failAiPut = true; });
      await quotaPage.locator('#ai-task').fill('Запрос при отказе записи'); await prepared(quotaPage); await quotaPage.locator('#ai-copy').click();
      await quotaPage.locator('#ai-prompts-open').click();
      await quotaPage.waitForFunction(() => document.querySelector('#ai-prompts-note').textContent.includes('только в этом сеансе'));
      assert.equal(await quotaPage.locator('#ai-prompts-list button').count(), 2); assert.equal(await historyCount(quotaPage), 1, 'An aborted history write preserves the previous stored prompt');
      await quotaPage.locator('#ai-prompts-close').click(); await quotaPage.evaluate(() => { window.__failAiPut = false; });
      await quotaPage.locator('#ai-copy').click(); await stored(quotaPage, 3, 'The next successful write also saves earlier session-only entries');
      const other = await quotaContext.newPage(); await other.goto(urls[1]); await other.waitForFunction(() => !document.querySelector('#code').disabled);
      await other.locator('#ai-open').click();
      await quotaPage.locator('#ai-task').fill('Первая вкладка'); await other.locator('#ai-task').fill('Вторая вкладка');
      await prepared(quotaPage); await prepared(other);
      await Promise.all([quotaPage.locator('#ai-copy').click(), other.locator('#ai-copy').click()]);
      await stored(quotaPage, 5); await quotaContext.close();
      console.log(`${name}: quota rollback, recovery of session-only history and concurrent prompt copies passed.`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
