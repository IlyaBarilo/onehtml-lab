import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';

const appUrl = new URL('../onehtml-lab.html', import.meta.url);
const html = await readFile(appUrl);
const output = join(tmpdir(), 'onehtml-lab-ai');
await mkdir(output, { recursive: true });
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const httpUrl = `http://127.0.0.1:${server.address().port}/`;
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];

// Generate portable, marked test libraries using the same export as a saved game.
const source = (await Promise.all(['library-bundle.js', 'exporter.js', 'library-extract.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
const helpers = { TextEncoder, TextDecoder, Blob, crypto: webcrypto, window: {} };
runInNewContext(source + '\nthis.api={libraryCache,prepareGameHtml,importLocalLibrary};', helpers);
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const library = '/* test-library ' + 'x'.repeat(30000) + ' */\nwindow.THREE={REVISION:"128"};';
helpers.api.libraryCache.set('three@0.128.0', { key: 'three@0.128.0', title: 'Three.js r128', sourceUrl: cdn, source: library, license });
const game = '<p>Игра 😀</p><script>window.__gameLeak=true;</script>';
const embedded = (await helpers.api.prepareGameHtml(`<script src="${cdn}"></script>` + game)).html;
const unknownGame = '<script src="./custom.js"></script>' + game;
const unknownRef = (await helpers.api.prepareGameHtml(unknownGame)).missingLibraries[0];
await helpers.api.importLocalLibrary(unknownRef, 'window.CustomEngine=true;', license);
const unknown = (await helpers.api.prepareGameHtml(unknownGame)).html;

async function ready(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#code').disabled);
  await page.locator('#expert-toggle').click();
}
async function prepared(page) {
  await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
  return page.locator('#ai-output').inputValue();
}
async function cacheAndHistory(page) {
  return page.evaluate(async () => {
    const read = (name, store, key) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const value = database.transaction(store, 'readonly').objectStore(store).getAll(key);
        value.onsuccess = () => { database.close(); resolve(value.result); };
        value.onerror = () => { database.close(); reject(value.error); };
      };
    });
    return { libraries: await read('onehtml-lab-libraries', 'libraries'), history: await read('onehtml-lab-draft', 'drafts', 'history') };
  });
}
async function clipboard(context) {
  await context.addInitScript(() => {
    window.__copied = null;
    window.__denyCopy = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText(text) { if (window.__denyCopy) return Promise.reject(new Error('denied')); window.__copied = text; return Promise.resolve(); }
    } });
  });
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
        const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900 });
        context.setDefaultTimeout(10000);
        await clipboard(context);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { if (!error.message.includes('ai-fix-error')) errors.push(error.message); });
        try {
          await ready(page, appUrl.href);
          await page.locator('#ai-open').click();
          assert(await page.locator('#prompt-change').isDisabled());
          assert(await page.locator('#prompt-fix').isDisabled());
          assert(await page.locator('#ai-source-options').isHidden());
          await page.locator('#ai-task').fill('космос 😀');
          let text = await prepared(page);
          assert.match(text, /Сделай игру про космос 😀 для телефона/);
          assert.match(text, /Основное устройство — телефон/);
          assert.match(text, /касаниями и экранными кнопками/);
          assert.match(text, /Также обеспечь работу на компьютере:.*мышью и клавиатурой/);
          assert(!text.includes('Текущий код:'));
          assert.equal(parseInt((await page.locator('#ai-summary').innerText()).match(/\d+/)[0]), Array.from(text).length);
          await page.locator('#ai-view').click();
          assert(await page.locator('#ai-output').isVisible());
          assert(await page.locator('#ai-compose').isHidden());
          await page.locator('#ai-copy').click();
          assert.equal(await page.evaluate(() => window.__copied), text);
          await page.locator('#ai-view').click();
          await page.locator('#ai-dialog [data-platform="desktop"]').click();
          text = await prepared(page);
          assert.match(text, /для компьютера/);
          assert.match(text, /Основное устройство — компьютер/);
          assert.match(text, /управляться мышью и клавиатурой/);
          assert.match(text, /Также обеспечь работу на телефоне:.*экранные кнопки и управление касаниями/);
          await page.locator('#ai-close').click();
          await page.locator('#code').fill(game);
          await page.locator('#ai-open').click();
          await page.locator('#prompt-change').click();
          await page.locator('#ai-task').fill('Добавь паузу\nи новый уровень');
          text = await prepared(page);
          assert.match(text, /Что изменить:\nДобавь паузу\nи новый уровень/);
          assert.match(text, /Основное устройство — компьютер/);
          assert.match(text, /Также обеспечь работу на телефоне:/);
          assert(text.endsWith(game));
          await page.locator('#prompt-fix').click();
          assert(await page.locator('#ai-copy').isDisabled());
          assert.match(await page.locator('#ai-summary').innerText(), /Опишите/);
          await page.locator('#ai-task').fill('Кнопка прыжка не работает');
          text = await prepared(page);
          assert.match(text, /Что не работает:\nКнопка прыжка/);
          assert.match(text, /Основное устройство — компьютер/);
          assert.match(text, /Также обеспечь работу на телефоне:/);
          assert(!text.includes('Сообщение об ошибке:'));
          await page.locator('#prompt-change').click();
          assert.equal(await page.locator('#ai-task').inputValue(), 'Добавь паузу\nи новый уровень');
          await page.locator('#prompt-create').click();
          assert.equal(await page.locator('#ai-task').inputValue(), 'космос 😀');
          await prepared(page);
          await page.screenshot({ path: join(output, `${name}-${viewport.width}-compose.png`) });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const buttons = await page.locator('.ai-footer-actions').boundingBox();
          assert(buttons.y >= 0 && buttons.y + buttons.height <= viewport.height + 1);
          // Keyboard space: the form scrolls and the actions stay on screen.
          await page.evaluate(() => {
            window.__vv = Object.getOwnPropertyDescriptor(window, 'visualViewport');
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 300, offsetTop: 30 } });
            window.dispatchEvent(new Event('resize'));
          });
          assert((await page.locator('#ai-copy').boundingBox()).y >= 30);
          assert((await page.locator('#ai-copy').boundingBox()).y + 44 <= 331);
          await page.evaluate(() => Object.defineProperty(window, 'visualViewport', window.__vv));
          await page.evaluate(() => window.dispatchEvent(new Event('resize')));
          await page.locator('#ai-close').click();
          const broken = '<script>window.ticks=0;setInterval(()=>ticks++,10);setTimeout(()=>{throw new Error("ai-fix-error")},10)</script>';
          await page.locator('#code').fill(broken);
          await page.locator('#run').click();
          await page.waitForFunction(() => !document.querySelector('#runtime-error').hidden);
          const frame = await page.locator('#preview iframe').elementHandle();
          await page.locator('#activity-toggle').click();
          await page.locator('#error-ai').click();
          assert.equal(await page.locator('#prompt-fix').getAttribute('aria-pressed'), 'true');
          text = await prepared(page);
          assert.match(text, /Сообщение об ошибке:/);
          assert.match(text, /ai-fix-error|браузер не сообщил подробности/);
          assert(text.endsWith(broken));
          assert(await frame.evaluate(el => el.isConnected), 'Preparation keeps the running game mounted');
          await page.locator('#ai-view').click();
          await page.evaluate(() => { window.__denyCopy = true; });
          await page.locator('#ai-copy').click();
          assert.equal(await page.locator('#copy-text').inputValue(), text);
          await page.locator('#copy-close').click();
          assert(await page.locator('#ai-output').isVisible(), 'Copy fallback returns to preview');
          await prepared(page);
          await page.locator('#ai-close').click();
          assert(await page.locator('#activity-panel').isVisible(), 'Error shortcut returns to messages');
          await page.locator('#activity-close').click();
          assert(await frame.evaluate(el => el.isConnected));
          await page.locator('#run').click();
          await page.locator('#code').fill('<p>Новое содержимое</p>');
          await page.locator('#ai-open').click();
          text = await prepared(page);
          assert(!text.includes('Сообщение об ошибке:'), 'Old error is not attached after editing code');
          assert(text.endsWith('<p>Новое содержимое</p>'));
          assert.deepEqual(errors, []);
          console.log(`${name} ${viewport.width}: prompt modes, copy/preview, phone layout, errors and unchanged game passed.`);
        } catch (error) {
          await page.screenshot({ path: join(output, `${name}-${viewport.width}-failure.png`) });
          throw error;
        } finally { await context.close(); }
      }
      for (const url of [appUrl.href, httpUrl]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        context.setDefaultTimeout(10000);
        await clipboard(context);
        let requests = 0;
        await context.route('https://**/*', route => { requests++; return route.abort(); });
        const page = await context.newPage();
        await page.addInitScript(() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          crypto.subtle.digest = async (...args) => {
            if (window.__slowHash) await new Promise(resolve => setTimeout(resolve, 300));
            if (window.__noHash) throw new Error('hash unavailable');
            return digest(...args);
          };
        });
        try {
          await ready(page, url);
          const original = embedded.replace(/\r\n/g, '\n');
          await page.locator('#code').fill(original);
          const before = await cacheAndHistory(page);
          await page.locator('#ai-open').click();
          await page.locator('#prompt-change').click();
          await page.locator('#ai-task').fill('Сделай сложнее');
          let text = await prepared(page);
          assert(text.includes(`src="${cdn}"`));
          assert(!text.includes('test-library'));
          assert(text.endsWith(game));
          assert.match(await page.locator('#ai-libraries').innerText(), /Three.js r128/);
          assert.match(await page.locator('#ai-summary').innerText(), /убрано из кода/);
          await page.locator('#ai-shorten').uncheck();
          text = await prepared(page);
          assert(text.endsWith(original), 'Unchecked means original source');
          await page.locator('#ai-shorten').check();
          await prepared(page);
          await page.locator('#ai-view').click();
          await page.screenshot({ path: join(output, `${name}-${new URL(url).protocol.slice(0, -1)}-shortened.png`) });
          await page.locator('#ai-copy').click();
          assert.equal(await page.evaluate(() => window.__copied), await page.locator('#ai-output').inputValue());
          assert.equal(await page.locator('#code').inputValue(), original);
          assert.deepEqual(await cacheAndHistory(page), before, 'Prompt preparation must not change cache or history');
          assert.equal(await page.evaluate(() => window.__gameLeak), undefined);
          await page.locator('#ai-close').click();
          const changed = original.replace('REVISION:"128"', 'REVISION:"999"');
          await page.locator('#code').fill(changed);
          await page.locator('#ai-open').click();
          text = await prepared(page);
          assert(text.endsWith(changed));
          assert.match(await page.locator('#ai-libraries').innerText(), /изменён/);
          await page.locator('#ai-close').click();
          await page.locator('#code').fill(unknown.replace(/\r\n/g, '\n'));
          await page.locator('#ai-open').click();
          text = await prepared(page);
          assert(text.endsWith(unknown.replace(/\r\n/g, '\n')));
          assert.match(await page.locator('#ai-libraries').innerText(), /нет точной CDN-ссылки/);
          await page.locator('#ai-close').click();
          await page.locator('#code').fill(original);
          await page.evaluate(() => { window.__noHash = true; });
          await page.locator('#ai-open').click();
          text = await prepared(page);
          assert(text.endsWith(original), 'Missing crypto keeps the full source');
          await page.locator('#ai-close').click();
          await page.evaluate(() => { window.__noHash = false; window.__slowHash = true; });
          await page.locator('#ai-open').click();
          await page.waitForTimeout(160);
          await page.locator('#prompt-create').click();
          await page.locator('#ai-task').fill('новый запрос');
          const latest = await prepared(page);
          await page.waitForTimeout(900);
          assert.equal(await page.locator('#ai-output').inputValue(), latest, 'Stale library result must not replace the latest prompt');
          assert(!latest.includes('Текущий код:'));
          assert.equal(requests, 0, 'Preparing prompts makes no network requests');
          console.log(`${name} ${new URL(url).protocol}: exact CDN copies, licenses, unknown/changed libraries, no writes/requests and async race passed.`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { server.close(); }
console.log(`AI prompt screenshots: ${output}`);
