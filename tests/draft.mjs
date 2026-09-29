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
      const code = page.locator('#code');
      const saved = () => page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.goto(url);
      assert(await page.locator('#expert-tools').isHidden());
      await code.fill('<h1>Простой черновик</h1>');
      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Простой черновик</h1>');
      assert(await page.locator('#expert-tools').isHidden());

      await page.locator('#paste').click();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Вставленный код</h1>');
      assert(await page.locator('#replace-dialog').isHidden());
      await saved();
      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert.equal(await code.inputValue(), '<h1>Вставленный код</h1>');
      assert(await page.locator('#import').isVisible());

      const chooser = page.waitForEvent('filechooser');
      await page.locator('#import').click();
      await (await chooser).setFiles({ name: 'new.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Импорт</h1>') });
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="cancel"]').click();
      await page.locator('#replace-dialog').waitFor({ state: 'hidden' });
      assert.equal(await code.inputValue(), '<h1>Вставленный код</h1>');
      const chooserAgain = page.waitForEvent('filechooser');
      await page.locator('#import').click();
      await (await chooserAgain).setFiles({ name: 'new.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Импорт</h1>') });
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Импорт</h1>');
      await saved();

      await page.locator('#paste').click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="cancel"]').click();
      await page.locator('#replace-dialog').waitFor({ state: 'hidden' });
      assert.equal(await code.inputValue(), '<h1>Импорт</h1>');
      await page.locator('#paste').click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Вставленный код</h1>');
      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Вставленный код</h1>');
      assert(await page.locator('#expert-tools').isVisible());

      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'hidden' });
      await code.fill('<h1>Изменено в простом</h1>');
      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value === '<h1>Изменено в простом</h1>');
      assert(await page.locator('#expert-tools').isHidden());
      await page.locator('#expert-toggle').click();
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert.equal(await code.inputValue(), '<h1>Изменено в простом</h1>');
      console.log(`${engine} ${new URL(url).protocol} shared draft and expert-only controls passed.`);
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
      await blockedPage.locator('#status').getByText('Автосохранение недоступно.', { exact: false }).waitFor();
      await blockedPage.locator('#code').fill('<h1>Без хранилища</h1>');
      assert(await blockedPage.locator('#save').isEnabled());
      await blockedPage.locator('#expert-toggle').click();
      await blockedPage.locator('#expert-tools').waitFor({ state: 'visible' });
      assert.equal(await blockedPage.locator('#draft-status').innerText(), 'Не сохраняется');
      assert.equal(await blockedPage.locator('#code').inputValue(), '<h1>Без хранилища</h1>');
      assert(await blockedPage.locator('#import').isEnabled());
    } finally {
      await blockedContext.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
