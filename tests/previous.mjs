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
        window.__pasteCode = '<h1>Новая игра</h1>\n<p>Уровень 2</p>';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          readText: () => Promise.resolve(window.__pasteCode)
        } });
      });
      const page = await context.newPage();
      const code = page.locator('#code');
      const previous = page.locator('#restore-previous');
      const compare = page.locator('#compare');
      const saved = () => page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.goto(url);
      await code.fill('<h1>Старая игра</h1>\n<p>Уровень 1</p>');
      await saved();
      await page.locator('#paste').click();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Новая игра'));
      await page.locator('#expert-toggle').click();
      assert(await compare.isEnabled());
      assert(await previous.isEnabled());
      await compare.click();
      assert(await page.locator('#comparison').isVisible());
      assert(await code.isHidden());
      assert((await page.locator('.diff-added').allTextContents()).join('').includes('Новая'));
      assert((await page.locator('.diff-removed').allTextContents()).join('').includes('Старая'));
      assert.equal(await page.locator('#diff-content h1').count(), 0);
      await compare.click();
      assert(await code.isVisible());

      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Новая игра'));
      assert(await compare.isEnabled());
      await previous.click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Старая игра'));
      assert(await compare.isDisabled());
      await saved();
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Старая игра'));
      assert(await compare.isDisabled());

      // A native field paste captures the complete code before a partial edit.
      await page.evaluate(() => {
        const field = document.querySelector('#code');
        const text = 'Новая ';
        const offset = field.value.indexOf('Старая ');
        field.setSelectionRange(offset, offset + 'Старая '.length);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', text);
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
        field.dispatchEvent(paste);
        if (!paste.defaultPrevented) {
          field.setRangeText(text, offset, offset + 'Старая '.length, 'end');
          field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
        }
      });
      assert.equal(await code.inputValue(), '<h1>Новая игра</h1>\n<p>Уровень 1</p>');
      assert(await compare.isEnabled());
      await compare.click();
      assert((await page.locator('.diff-added').allTextContents()).join('').includes('Новая'));
      assert((await page.locator('.diff-removed').allTextContents()).join('').includes('Старая'));
      await previous.click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Старая игра'));
      assert.equal(await code.inputValue(), '<h1>Старая игра</h1>\n<p>Уровень 1</p>');
      assert(await page.locator('#comparison').isHidden());

      await page.locator('#expert-toggle').click();
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
      await page.locator('#paste').click();
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '<h1>Через меню</h1>');
        document.querySelector('#code').dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: transfer
        }));
      });
      assert.equal(await code.inputValue(), '<h1>Через меню</h1>');
      await page.locator('#expert-toggle').click();
      assert(await compare.isEnabled());
      await previous.click();
      await page.locator('#replace-dialog').waitFor({ state: 'visible' });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#code').value.includes('Старая игра'));
      console.log(`${engine} ${new URL(url).protocol} paste comparison and restore passed.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
