import assert from 'node:assert/strict';
import './network-policy.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const appPath = fileURLToPath(new URL('../onehtml-lab.html', import.meta.url));
const html = await readFile(appPath);
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const resources = {
  '/library.js': { contentType: 'text/javascript', body: 'window.libraryLoaded = true;' },
  '/style.css': { contentType: 'text/css', body: 'body { background: #eef5ff; }' },
  '/picture.svg': { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>', hideSize: true },
  '/data.json': { contentType: 'application/json', body: '{"ready":true}' },
  '/later.json': { contentType: 'application/json', body: '{"later":true}' }
};
const game = `<!doctype html><html><head>
  <script src="https://assets.onehtml.test/library.js"></script>
  <link rel="stylesheet" href="https://assets.onehtml.test/style.css">
  </head><body><img src="https://assets.onehtml.test/picture.svg">
  <p id="library"></p><p id="data"></p><button id="later">Load more</button>
  <script>
    document.querySelector('#library').textContent = window.libraryLoaded ? 'loaded' : 'missing';
    fetch('https://assets.onehtml.test/data.json').then(response => response.json())
      .then(data => document.querySelector('#data').textContent = data.ready ? 'ready' : 'missing');
    document.querySelector('#later').onclick = () => fetch('https://assets.onehtml.test/later.json').then(response => response.json());
  </script></body></html>`;

const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch();
try {
  for (const url of [pathToFileURL(appPath).href, `http://127.0.0.1:${server.address().port}/`]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      let requestCount = 0;
      await context.route('https://assets.onehtml.test/**', route => {
        requestCount += 1;
        const item = resources[new URL(route.request().url()).pathname];
        if (!item) return route.abort();
        const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
        if (!item.hideSize) headers['Timing-Allow-Origin'] = '*';
        return route.fulfill({ status: 200, contentType: item.contentType, headers, body: item.body });
      });
      const page = await context.newPage();
      await page.goto(url);
      assert(await page.locator('#network-toggle').isVisible());
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#code').fill('<h1>No network</h1>');
      await page.locator('#run').click();
      assert(await page.locator('#network-status').isHidden());
      await page.locator('#run').click();
      assert(await page.locator('#network-status').isHidden());

      await page.locator('#network-toggle').click();
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      await page.reload();
      assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#code').fill(game);
      await page.locator('#run').click();
      assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes("connect-src 'none'"));
      await page.locator('#run').click();
      await page.locator('#network-toggle').click();
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'true');

      await page.locator('#code').fill('<img src="https://assets.onehtml.test/picture.svg">');
      await page.locator('#run').click();
      await page.waitForFunction(() => Number(document.querySelector('#network-count').textContent) >= 1);
      assert.match(await page.locator('#activity-summary').innerText(), /Сеть:.*\(нет данных\)/);
      await page.locator('#activity-toggle').click();
      assert(await page.locator('#network-status').isVisible());
      assert.equal(await page.locator('#network-kb').innerText(), '(нет данных)');
      await page.locator('#run').click();
      assert(await page.locator('#network-status').isHidden());

      await page.locator('#code').fill(game);
      await page.locator('#run').click();
      await page.frameLocator('iframe').locator('#data').getByText('ready').waitFor();
      assert.equal(await page.frameLocator('iframe').locator('#library').innerText(), 'loaded');
      await page.waitForFunction(() => Number(document.querySelector('#network-count').textContent) >= 4);
      await page.locator('#activity-toggle').click();
      assert(await page.locator('#network-status').isVisible());
      assert.equal(await page.locator('#network-message').innerText(), 'Игра использует интернет');
      assert(await page.locator('#network-metrics').isVisible());
      assert.equal(await page.locator('#network-note').count(), 0);
      const measuredKb = await page.locator('#network-kb').innerText();
      if (engine === 'chromium') assert.match(measuredKb, /КБ$/);
      else assert(measuredKb === '(нет данных)' || measuredKb.endsWith(' КБ'));
      await page.locator('#activity-close').click();
      const layout = await page.evaluate(() => ({
        screen: innerWidth,
        content: document.documentElement.scrollWidth,
        headerBottom: document.querySelector('.toolbar').getBoundingClientRect().bottom,
        networkTop: document.querySelector('#activity-toggle').getBoundingClientRect().top,
        networkBottom: document.querySelector('#activity-toggle').getBoundingClientRect().bottom,
        previewTop: document.querySelector('#preview').getBoundingClientRect().top
      }));
      assert(layout.content <= layout.screen, 'Network indicator must fit the mobile screen');
      assert.equal(layout.networkTop, layout.headerBottom);
      assert.equal(layout.previewTop, layout.networkBottom);
      const initialCount = Number(await page.locator('#network-count').innerText());
      await page.frameLocator('iframe').locator('#later').click();
      await page.waitForFunction(count => Number(document.querySelector('#network-count').textContent) > count, initialCount);
      await page.locator('#run').click();
      assert(await page.locator('#network-status').isHidden());
      assert.equal(await page.locator('#network-count').innerText(), '0');

      await page.locator('#run').click();
      await page.locator('#expert-toggle').click();
      await page.locator('#code').waitFor({ state: 'visible' });
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert(await page.locator('#code').isVisible());
      assert.equal(await page.locator('#code').inputValue(), game);
      assert.equal(await page.locator('#expert-toggle').getAttribute('aria-pressed'), 'true');
      assert(await page.locator('#network-toggle').isVisible());
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'true');

      await page.locator('#run').click();
      await page.waitForFunction(() => Number(document.querySelector('#network-count').textContent) >= 4);
      const firstFrame = await page.locator('#preview > iframe').elementHandle();
      await page.locator('#network-toggle').click();
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      assert(await firstFrame.evaluate(element => !element.isConnected));
      assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes("connect-src 'none'"));
      assert(await page.locator('#network-status').isHidden());
      assert.equal(await page.locator('#network-count').innerText(), '0');
      assert.equal(await page.locator('#code').inputValue(), game);
      const requestsBeforeOffline = requestCount;
      await page.waitForTimeout(250);
      assert.equal(requestCount, requestsBeforeOffline, 'Offline preview must not request external resources');

      await page.locator('#network-toggle').click();
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'true');
      assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes('connect-src https: wss:'));
      await page.waitForFunction(() => Number(document.querySelector('#network-count').textContent) >= 4);
      await page.locator('#network-toggle').click();
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#expert-toggle').click();
      await page.locator('#code').waitFor({ state: 'visible' });
      await page.locator('#expert-tools').waitFor({ state: 'hidden' });
      assert(await page.locator('#code').isVisible());
      assert(await page.locator('#network-toggle').isVisible());
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      await page.locator('#run').click();
      assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes("connect-src 'none'"));
      await page.locator('#network-toggle').click();
      assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes('connect-src https: wss:'));
      await page.locator('#network-toggle').click();
      await page.locator('#expert-toggle').click();
      await page.locator('#code').waitFor({ state: 'visible' });
      await page.locator('#expert-tools').waitFor({ state: 'visible' });
      assert(await page.locator('#code').isVisible());
      assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');

      await page.setViewportSize({ width: 320, height: 568 });
      const expertLayout = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll('.actions button')].filter(button => !button.hidden).map(button => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
        })
      }));
      assert.equal(expertLayout.buttons.length, 7);
      assert(expertLayout.document <= expertLayout.viewport);
      assert(expertLayout.buttons.every(button => button.width >= 44 && button.height >= 44 && button.left >= 0 && button.right <= expertLayout.viewport));
      if (engine === 'chromium' && url.startsWith('file:')) {
        await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-expert-320.png') });
      }
      console.log(`${engine} ${new URL(url).protocol} network indicator and updating counters passed.`);
    } finally {
      await context.close();
    }

    const blockedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await blockedContext.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      });
      const blockedPage = await blockedContext.newPage();
      await blockedPage.goto(url);
      assert.equal(await blockedPage.locator('#expert-toggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await blockedPage.locator('#network-toggle').getAttribute('aria-pressed'), 'true');
      await blockedPage.locator('#network-toggle').click();
      assert.equal(await blockedPage.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
      assert.match(await blockedPage.locator('#status').innerText(), /Не удалось сохранить настройки/);
      await blockedPage.reload();
      assert.equal(await blockedPage.locator('#expert-toggle').getAttribute('aria-pressed'), 'false');
      assert.equal(await blockedPage.locator('#network-toggle').getAttribute('aria-pressed'), 'true');
    } finally {
      await blockedContext.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
