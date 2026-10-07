import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const args = process.argv.slice(2);
assert(args.length <= 1 && (!args[0] || /^--engines=(chromium|webkit)(,(chromium|webkit))*$/.test(args[0])), 'Use: node tests/game-storage.mjs [--engines=chromium,webkit]');
const selected = args[0]?.slice(10).split(',');
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || selected.includes(name));

const fileUrl = new URL('../onehtml-lab.html', import.meta.url);
const artifact = await readFile(fileUrl);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(artifact));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const game = `<!doctype html><html><body><output id="result"></output><script>
const store = localStorage;
const score = Number(store.getItem('score') || 0) + 1;
store.setItem('score', String(score));
store.setItem('onehtml-lab-settings', 'game-value');
let isolated = false;
try { void parent.document.body; } catch { isolated = true; }
document.querySelector('#result').textContent = String(score) + ':' + store.length + ':' + store.key(0) + ':' + isolated;
</script></body></html>`;

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of [fileUrl.href, `http://127.0.0.1:${server.address().port}/`]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
        try {
          const page = await context.newPage();
          await useNativeEditor(page);
          await page.goto(url);
          const code = page.locator('#code');
          assert(await page.locator('#storage-toggle').isHidden());
          await code.fill(game);
          const runAndRead = async expected => {
            await page.locator('#run').click();
            const result = page.frameLocator('#preview > iframe').locator('#result');
            await result.getByText(new RegExp(`^${expected}:`)).waitFor();
            assert.match(await result.innerText(), /:true$/);
            assert.match(await page.locator('#local-access-status').innerText(), /виртуальный localStorage/);
            assert(await page.locator('#runtime-error').isHidden());
            assert.equal(await page.locator('#preview > iframe').getAttribute('sandbox'), 'allow-scripts');
            await page.locator('#run').click();
          };
          await runAndRead(1);
          await runAndRead(2);
          await page.locator('#expert-toggle').click();
          await page.locator('#draft-status').getByText('Сохранено').waitFor();
          assert.equal(await page.locator('#storage-toggle').getAttribute('aria-pressed'), 'true');
          await page.reload();
          await page.waitForFunction(expected => document.querySelector('#code').value === expected, game);
          assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'true');
          await runAndRead(3);

          await page.locator('#storage-toggle').click();
          assert.equal(await page.locator('#storage-toggle').getAttribute('aria-pressed'), 'false');
          await page.locator('#expert-toggle').click();
          assert(await page.locator('#storage-toggle').isHidden());
          await page.locator('#run').click();
          await page.locator('#activity-summary').getByText(/Ошибка игры/).waitFor();
          await page.locator('#activity-toggle').click();
          await page.locator('#runtime-error').waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.querySelector('#runtime-error-message').textContent.includes('localStorage'));
          await page.locator('#run').click();
          await page.reload();
          assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'false');
          await page.locator('#expert-toggle').click();
          assert.equal(await page.locator('#storage-toggle').getAttribute('aria-pressed'), 'false');
          await page.locator('#storage-toggle').click();
          await runAndRead(4);
          await page.locator('#expert-toggle').click();
          await runAndRead(5);

          await page.locator('#expert-toggle').click();
          for (const [index, expected, title] of [[0, 1, 'Поймай круг'], [1, 1, 'Найди пару'], [0, 2, 'Поймай круг']]) {
            await page.locator('#examples-open').click();
            await page.locator('.example-card').nth(index).getByRole('button', { name: 'Открыть копию' }).click();
            await page.locator('#replace-dialog button[value="replace"]').click();
            await page.waitForFunction(value => document.querySelector('#code').value.includes(`<title>${value}</title>`), title);
            await code.fill(game);
            await runAndRead(expected);
          }
          await page.locator('#expert-toggle').click();

          await code.fill(`<!doctype html><output id="result"></output><script>
localStorage.payload = '<' + '/script><img src=x onerror=alert(1)>';
const value = localStorage.payload;
document.querySelector('#result').textContent = value + ':' + Object.keys(localStorage).length;
delete localStorage.payload;
</script>`);
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText(/<\/script><img/).waitFor();
          await page.locator('#run').click();
          await code.fill(`<!doctype html><output id="result"></output><script>
localStorage.setItem('temporary', 'one');
localStorage.removeItem('temporary');
localStorage.clear();
document.querySelector('#result').textContent = String(localStorage.getItem('temporary')) + ':' + localStorage.length;
</script>`);
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('null:0').waitFor();
          await page.locator('#run').click();
          await code.fill(game);
          await runAndRead(1);
          console.log(`${name} ${new URL(url).protocol}: isolated virtual storage, persistence and toggle passed.`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
