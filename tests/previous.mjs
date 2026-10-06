import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const appPath = fileURLToPath(new URL('../onehtml-lab.html', import.meta.url));
const html = await readFile(appPath);
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch();
try {
  for (const url of [pathToFileURL(appPath).href, `http://127.0.0.1:${server.address().port}/`]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true });
    try {
      await context.addInitScript(() => {
        window.__pasteCode = 'B новая игра';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          readText: () => Promise.resolve(window.__pasteCode)
        } });
      });
      const page = await context.newPage();
      await useNativeEditor(page);
      const code = page.locator('#code');
      const compare = page.locator('#compare');
      const history = page.locator('#history-open');
      const entries = page.locator('.history-entry');
      const saved = () => page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.goto(url);
      await code.fill('A старая игра');
      await saved();
      await page.locator('#paste').click();
      assert.equal(await code.inputValue(), 'B новая игра');
      await page.locator('#expert-toggle').click();
      assert(await compare.isEnabled());
      await history.click();
      assert(await page.locator('#history-view').isVisible());
      assert(await code.isHidden());
      assert.equal(await entries.count(), 1);
      assert.match(await entries.first().locator('.history-time').innerText(), /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}/);
      assert.match(await entries.first().locator('.history-added .history-metric-value').innerText(), /^\d+$/);
      assert.equal(await entries.first().locator('.history-removed').count(), 0);
      await page.locator('.history-current-row [aria-label="Отметить текущую версию как верную"]').click();
      assert.match(await page.locator('.history-current-row').getAttribute('class'), /is-verified/);
      await page.locator('#history-close').click();
      assert(await code.isVisible());

      await page.locator('#import-file').setInputFiles({ name: 'game.html', mimeType: 'text/html', buffer: Buffer.from('C импорт') });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === 'C импорт');
      assert.equal(await code.inputValue(), 'C импорт');
      await history.click();
      assert.equal(await entries.count(), 2);
      assert.match(await entries.first().locator('.history-time').innerText(), /✓/);
      assert.match(await page.locator('.history-current-row .history-added .history-metric-value').innerText(), /^\d+$/);
      await page.locator('.history-current-row [aria-label="Сравнить с последней прошлой версией"]').click();
      assert((await page.locator('.diff-added').allTextContents()).join('').includes('C'));
      assert((await page.locator('.diff-removed').allTextContents()).join('').includes('B'));
      assert.equal(parseInt(await page.locator('#comparison-added').innerText(), 10), Array.from((await page.locator('.diff-added').allTextContents()).join('')).length);
      assert.equal(parseInt(await page.locator('#comparison-removed').innerText(), 10), Array.from((await page.locator('.diff-removed').allTextContents()).join('')).length);
      assert.match(await page.locator('#comparison-added').innerText(), /символ/);
      assert.match(await page.locator('.history-current-row .history-added').getAttribute('aria-label'), /символ/);
      assert(await page.locator('#comparison-scrollbar').isHidden());
      await page.getByRole('button', { name: 'Закрыть сравнение и вернуться к редактору' }).click();
      assert(await code.isVisible());

      await history.click();
      await entries.nth(1).getByRole('button', { name: 'Сравнить эту версию с текущей' }).click();
      assert.match(await page.locator('#comparison-source').innerText(), /Текущий код и версия \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}/);
      assert((await page.locator('.diff-removed').allTextContents()).join('').includes('A'));
      await compare.click();

      await history.click();
      await entries.nth(1).getByRole('button', { name: 'Вернуть версию' }).click();
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === 'A старая игра');
      assert.equal(await code.inputValue(), 'A старая игра');
      await history.click();
      assert.equal(await entries.count(), 3);
      assert.match(await entries.nth(1).locator('.history-time').innerText(), /✓/);
      await page.locator('#history-close').click();
      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value === 'A старая игра');
      await history.click();
      assert.equal(await entries.count(), 3);
      assert(await entries.nth(1).getByRole('button', { name: 'Сравнить эту версию с текущей' }).isEnabled());
      await page.locator('#history-close').click();

      await page.evaluate(() => {
        const field = document.querySelector('#code');
        const offset = field.value.indexOf('старая');
        field.setSelectionRange(offset, offset + 'старая'.length);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', 'новая');
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
        field.dispatchEvent(paste);
        if (!paste.defaultPrevented) {
          field.setRangeText('новая', offset, offset + 'старая'.length, 'end');
          field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: 'новая' }));
        }
      });
      assert.equal(await code.inputValue(), 'A новая игра');
      await history.click();
      assert.equal(await entries.count(), 4);
      await page.locator('#history-close').click();

      for (let i = 0; i < 22; i++) {
        await page.evaluate(value => { window.__pasteCode = value; }, `Номер ${i}`);
        await page.locator('#paste').click();
        await page.locator('#replace-dialog button[value="replace"]').click();
      }
      await history.click();
      assert.equal(await entries.count(), 20);
      await entries.first().getByRole('button', { name: 'Удалить версию' }).click();
      assert.equal(await entries.count(), 19);
      assert(await page.locator('#history-view').isVisible());
      await page.locator('#history-close').click();
      console.log(`${engine} ${new URL(url).protocol} history passed.`);
    } finally {
      await context.close();
    }

    const legacyContext = await browser.newContext();
    try {
      const legacyPage = await legacyContext.newPage();
      await useNativeEditor(legacyPage);
      await legacyPage.goto(url);
      await legacyPage.waitForFunction(() => document.querySelector('#code').disabled === false);
      await legacyPage.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('onehtml-lab-draft', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('drafts', 'readwrite');
          transaction.objectStore('drafts').put('Старый снимок', 'previous-paste');
          transaction.objectStore('drafts').put('Новый код', 'expert');
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        };
      }));
      await legacyPage.reload();
      await legacyPage.waitForFunction(() => document.querySelector('#code').value === 'Новый код');
      await legacyPage.locator('#expert-toggle').click();
      await legacyPage.locator('#history-open').click();
      assert.match(await legacyPage.locator('.history-entry .history-time').innerText(), /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}/);
      assert.match(await legacyPage.locator('.history-entry .history-time').getAttribute('title'), /переноса/);
      assert.match(await legacyPage.locator('.history-entry .history-added .history-metric-value').innerText(), /^\d+$/);
      assert.equal(await legacyPage.locator('.history-entry .history-removed').count(), 0);
      console.log(`${engine} ${new URL(url).protocol} legacy snapshot migrated.`);
    } finally {
      await legacyContext.close();
    }

    const oldHistoryContext = await browser.newContext();
    try {
      const oldHistoryPage = await oldHistoryContext.newPage();
      await useNativeEditor(oldHistoryPage);
      await oldHistoryPage.goto(url);
      await oldHistoryPage.waitForFunction(() => document.querySelector('#code').disabled === false);
      await oldHistoryPage.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('onehtml-lab-draft', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const transaction = request.result.transaction('drafts', 'readwrite');
          transaction.objectStore('drafts').put('Новый код', 'expert');
          transaction.objectStore('drafts').put({ entries: [{ id: 'old', code: 'Старый снимок', createdAt: null, active: false, verified: false }], verifiedCode: null }, 'history');
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        };
      }));
      await oldHistoryPage.reload();
      await oldHistoryPage.waitForFunction(() => document.querySelector('#code').value === 'Новый код');
      await oldHistoryPage.locator('#expert-toggle').click();
      await oldHistoryPage.locator('#history-open').click();
      assert.match(await oldHistoryPage.locator('.history-entry .history-time').innerText(), /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}/);
      assert(await oldHistoryPage.locator('.history-entry [aria-label="Сравнить эту версию с текущей"]').isEnabled());
      await oldHistoryPage.waitForFunction(() => new Promise(resolve => {
        const request = indexedDB.open('onehtml-lab-draft', 1);
        request.onsuccess = () => {
          const value = request.result.transaction('drafts', 'readonly').objectStore('drafts').get('history');
          value.onsuccess = () => resolve(Number.isFinite(value.result?.entries?.[0]?.createdAt));
          value.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      }));
      console.log(`${engine} ${new URL(url).protocol} old history timestamps normalized.`);
    } finally {
      await oldHistoryContext.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
