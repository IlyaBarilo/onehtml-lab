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
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, acceptDownloads: true });
    try {
      await context.addInitScript(() => {
        window.__pasteCode = '<h1>Вставленный код</h1>';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          readText: () => Promise.resolve(window.__pasteCode)
        } });
      });
      const page = await context.newPage();
      await page.goto(url);
      assert(await page.locator('#expert-tools').isHidden());
      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert(await page.locator('#import').isVisible());
      const code = page.locator('#code');
      await code.fill('<h1>Первый черновик</h1>');
      await page.locator('#draft-status').getByText('Сохранено').waitFor();
      await page.locator('#network-toggle').click();
      await page.reload();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Первый черновик</h1>');
      assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await code.inputValue(), '<h1>Первый черновик</h1>');

      const chooser = page.waitForEvent('filechooser');
      await page.locator('#import').click();
      await (await chooser).setFiles({ name: 'new.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Импорт</h1>') });
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      assert.equal(await code.inputValue(), '<h1>Первый черновик</h1>');
      await page.locator('#replace-dialog button[value="cancel"]').click();
      assert.equal(await code.inputValue(), '<h1>Первый черновик</h1>');
      const chooserAgain = page.waitForEvent('filechooser');
      await page.locator('#import').click();
      await (await chooserAgain).setFiles({ name: 'new.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Импорт</h1>') });
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Импорт</h1>');
      assert.equal(await code.inputValue(), '<h1>Импорт</h1>');
      await page.locator('#draft-status').getByText('Сохранено').waitFor();

      await page.locator('#paste').click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="cancel"]').click();
      assert.equal(await code.inputValue(), '<h1>Импорт</h1>');
      await page.locator('#paste').click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Вставленный код</h1>');
      assert.equal(await code.inputValue(), '<h1>Вставленный код</h1>');
      await page.locator('#draft-status').getByText('Сохранено').waitFor();

      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'hidden' });
      await page.reload();
      assert(await page.locator('#expert-tools').isHidden());
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      await code.fill('<h1>Код простого режима</h1>');
      await page.locator('#expert-toggle').click();
      await page.locator('#restore-dialog').waitFor({ state: 'visible' });
      assert.equal(await code.inputValue(), '<h1>Код простого режима</h1>');
      await page.locator('#restore-dialog button[value="restore"]').click();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Вставленный код</h1>');
      assert.equal(await code.inputValue(), '<h1>Вставленный код</h1>');

      await page.locator('#draft-status').getByText('Сохранено').waitFor();
      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'hidden' });
      await page.reload();
      await code.fill('<h1>Оставить текущий</h1>');
      await page.locator('#expert-toggle').click();
      await page.locator('#restore-dialog').waitFor({ state: 'visible' });
      await page.locator('#restore-dialog button[value="current"]').click();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert.equal(await code.inputValue(), '<h1>Оставить текущий</h1>');
      await page.locator('#draft-status').getByText('Сохранено').waitFor();
      await page.reload();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Оставить текущий</h1>');
      assert.equal(await code.inputValue(), '<h1>Оставить текущий</h1>');
      console.log(`${engine} ${new URL(url).protocol} expert import, replacement and draft recovery passed.`);
    } finally {
      await context.close();
    }

    const blockedContext = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true });
    try {
      await blockedContext.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      });
      const blockedPage = await blockedContext.newPage();
      await blockedPage.goto(url);
      await blockedPage.locator('#code').fill('<h1>Без хранилища</h1>');
      await blockedPage.locator('#expert-toggle').click();
      await blockedPage.locator('#expert-tools').waitFor({ state: 'visible' });
      assert.equal(await blockedPage.locator('#draft-status').innerText(), 'Не сохраняется');
      assert.equal(await blockedPage.locator('#code').inputValue(), '<h1>Без хранилища</h1>');
      assert(await blockedPage.locator('#import').isEnabled());
      assert(await blockedPage.locator('#save').isEnabled());
    } finally {
      await blockedContext.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
