import {libraryMenu,libraryTab} from './library-ui-helpers.mjs';
import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = new URL('../onehtml-lab.html', import.meta.url);
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const scriptUrl = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
const licenseUrl = 'https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE';
const script = 'window.THREE={REVISION:"128"};';
const fixture = `<script src="${scriptUrl}"></script><script src="./lib/custom.js"></script><script defer src="https://example.invalid/unknown.js"></script><script type="module">import './module.js';</script><p>Исходник</p>`;
const game = `<script src="${scriptUrl}"></script><h1>Игра</h1><img src="data:image/png,invalid"><script>window.ticks=0;setInterval(()=>ticks++,20);console.warn('Предупреждение <img src=x>');console.warn('Предупреждение <img src=x>');console.error('Ошибка консоли');setTimeout(()=>{throw new Error('diagnostic-throw')},20);Promise.reject(new Error('diagnostic-promise'));</script>`;
const output = join(tmpdir(), 'onehtml-lab-diagnostics'); await mkdir(output, { recursive: true });
let server;
const urls = [file.href];
if (process.argv.includes('--http')) {
  const html = await readFile(file);
  server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  urls.push(`http://127.0.0.1:${server.address().port}/`);
}
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
async function open(page, tab = 'errors') {
  if(await page.locator('#expert-toggle').getAttribute('aria-pressed')!=='true')await page.locator('#expert-toggle').click();
  if (await page.locator('#activity-panel').isHidden()) await page.locator('#diagnostic-open').click();
  await page.locator(`[data-diagnostic-tab="${tab}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#diagnostic-copy').disabled);
  if(tab==='libraries')await libraryTab(page,'code');
}
async function close(page) { await page.locator('#activity-close').click(); }
async function cacheCount(page, count) { await page.waitForFunction(n => document.querySelectorAll('#diagnostic-cache-list > li').length === n, count); }
async function source(page, text) { if (await page.locator('#activity-panel').isVisible()) await close(page); await page.locator('#code').fill(text); }
async function checkDiagnosticScreen(page, width) {
  const viewport = page.viewportSize();
  for (const dark of [false, true]) {
    if ((await page.locator('html').evaluate(el => el.classList.contains('theme-dark'))) !== dark) await page.locator('.diagnostic-footer [data-panel-theme]').click();
    await page.setViewportSize({width, height:400});
    const layout = await page.evaluate(() => {
      const box = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
      const row = document.querySelector('.diagnostic-error-row');
      const [meta,text] = [...row.children].map(box);
      const nav = document.querySelector('#diagnostic-tabs');
      const body = document.querySelector('.activity-body');
      body.scrollTop=body.scrollHeight;
      return {meta,text,font:parseFloat(getComputedStyle(row).fontSize),buttons:[...nav.querySelectorAll('button'),...document.querySelectorAll('.diagnostic-footer button:not([hidden])'),document.querySelector('#activity-close')].map(box),body:box(body),nav:box(nav),footer:box(document.querySelector('.diagnostic-footer')),scroll:document.documentElement.scrollWidth,colors:[getComputedStyle(row).color,getComputedStyle(document.querySelector('.is-warning.diagnostic-error-row')).color,getComputedStyle(document.querySelector('#activity-panel')).backgroundColor]};
    });
    assert(layout.text.top >= layout.meta.bottom - 1, 'Message text must follow its metadata on a separate line');
    assert(layout.font >= 16, 'Messages must be readable on phones');
    assert(layout.buttons.every(r=>r.width>=44 && r.height>=44 && r.left>=0 && r.right<=width+1 && r.top>=0 && r.bottom<=400), 'Navigation and footer remain touchable in a short viewport');
    assert(layout.body.height>=70 && layout.body.top>=layout.nav.bottom-1 && layout.body.bottom<=layout.footer.top+1, 'Only results scroll between navigation and actions');
    assert(layout.scroll<=width && new Set(layout.colors).size===3, 'Errors and warnings remain distinct in both themes without overflow');
    await page.screenshot({path:join(output,`diagnostic-ui-${width}-${dark?'dark':'light'}.png`)});
  }
  await page.locator('.diagnostic-footer [data-panel-theme]').click();
  await page.setViewportSize(viewport);
}
async function checkToolbarLayout(page, width) {
  const layout = await page.evaluate(() => {
    const status = document.querySelector('#draft-status').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#expert-tools button')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
    const resources = document.querySelector('.expert-resource-actions').getBoundingClientRect();
    const actions = document.querySelector('.expert-actions').getBoundingClientRect();
    const sameRow = resources.top < actions.bottom && resources.bottom > actions.top;
    return {
      overlap: buttons.some(rect => rect.left < status.right && rect.right > status.left && rect.top < status.bottom && rect.bottom > status.top),
      scroll: document.documentElement.scrollWidth,
      sameRow,
      gap: sameRow ? resources.left - actions.right : resources.top - actions.bottom,
      leftOffset: resources.left - actions.left
    };
  });
  const details = `${width}px: ${JSON.stringify(layout)}`;
  assert(!layout.overlap, `Draft error cannot cover toolbar buttons at ${details}`);
  assert(layout.scroll <= width, `Toolbar must fit the viewport at ${details}`);
  assert(layout.gap >= 0 && layout.gap <= 16, `Resource buttons follow editing buttons with a small separator at ${details}`);
  if (!layout.sameRow) assert(Math.abs(layout.leftOffset) <= 1, `Wrapped resource buttons stay aligned to the left at ${details}`);
  return layout;
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of urls) for (const width of [320, 1365]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
        context.setDefaultTimeout(10000);
        await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked'); } } }));
        let requests = 0;
        await context.route(scriptUrl, route => { requests++; return route.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: script }); });
        await context.route(licenseUrl, route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, body: license }));
        const page = await context.newPage();
        await useNativeEditor(page);
        const hostErrors = [];
        page.on('pageerror', error => { if (!/diagnostic-(throw|promise)/.test(error.message)) hostErrors.push(error.message); });
        try {
          await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert(await page.locator('#diagnostic-open').isHidden());
          await page.locator('#expert-toggle').click();
          await open(page);
          assert.match(await page.locator('#diagnostic-run-note').innerText(), /ещё не запускалась/);
          await source(page, fixture);
          await open(page, 'libraries');
          assert.equal(await page.locator('#diagnostic-library-list > li').count(), 4);
          assert.match(await page.locator('#diagnostic-library-list').innerText(), /Подмена не поддерживается/);
          assert.match(await page.locator('#diagnostic-library-list > li').filter({ hasText: 'custom.js' }).innerText(), /Файл: custom\.js · \(нет данных\)/);
          assert.equal(requests, 0, 'Inspection must not download or execute source');
          await page.locator('#diagnostic-library-list > li').filter({ hasText: 'Three.js' }).getByRole('button',{name:'Загрузить…',exact:true}).click();
          await page.locator('#library-download').click();
          await cacheCount(page, 1);
          assert.equal(requests, 1);
          assert.match(await page.locator('#diagnostic-cache-list').innerText(), /Нужна текущему коду/);
          await page.locator('#diagnostic-library-list > li').filter({ hasText: 'custom.js' }).getByRole('button',{name:'Выбрать файл…',exact:true}).click();
          await page.locator('#library-files').setInputFiles([
            { name: 'custom.js', mimeType: 'text/javascript', buffer: Buffer.from('window.custom=true;') },
            { name: 'LICENSE', mimeType: 'text/plain', buffer: Buffer.from(license) }
          ]);
          await cacheCount(page, 2);
          assert.match(await page.locator('#diagnostic-library-list > li').filter({ hasText: 'custom.js' }).innerText(), /Файл: custom\.js · 19 байт/);
          assert.equal(await page.locator('#code').inputValue(), fixture);
          const total = Buffer.byteLength(script) + Buffer.byteLength('window.custom=true;') + 2 * Buffer.byteLength(license.trim());
          assert((await page.locator('#diagnostic-cache-size').innerText()).replace(/\s/g, '').includes(String(total)));
          await page.screenshot({ path: join(output, `${name}-${width}-libraries.png`) });
          await close(page); await page.locator('#save').click();
          const downloadEvent = page.waitForEvent('download');
          await page.locator('#confirm-save').click();
          const embedded = await readFile(await (await downloadEvent).path(), 'utf8');
          assert(embedded.includes('data-onehtml-library'));
          await source(page, embedded); await open(page, 'libraries');
          assert.equal(await page.locator('#diagnostic-library-list > li').filter({ hasText: 'Встроена в HTML' }).count(), 2);
          await source(page, fixture); await open(page, 'libraries');
          // Transaction failure must leave both memory and persistent data intact.
          await page.evaluate(() => { window.originalDelete = IDBObjectStore.prototype.delete; let count = 0; IDBObjectStore.prototype.delete = function(...args) { if (++count === 2) throw new Error('denied'); return window.originalDelete.apply(this, args); }; });
          await libraryMenu(page,'more');await page.locator('#diagnostic-cache-clear').click();
          await page.locator('#diagnostic-delete-yes').click();
          await page.waitForFunction(() => document.querySelector('#diagnostic-cache-feedback').textContent.includes('Не удалось'));
          await cacheCount(page, 2);
          await page.evaluate(() => { IDBObjectStore.prototype.delete = window.originalDelete; });
          await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await open(page, 'libraries'); await cacheCount(page, 2);
          await libraryMenu(page,'more');await page.locator('#diagnostic-cache-clear').click(); await page.locator('#diagnostic-delete-no').click(); await cacheCount(page, 2);
          await source(page, game);
          await page.locator('#run').click();
          const element = await page.locator('#preview > iframe').elementHandle();
          const frame = await element.contentFrame();
          await page.waitForFunction(() => document.querySelectorAll('#diagnostic-error-list > li').length === 5);
          await open(page);
          assert.match(await page.locator('#diagnostic-error-list').innerText(), /×2/);
          assert.equal(await page.locator('#diagnostic-error-list img').count(), 0);
          assert.match(await page.locator('#activity-summary').innerText(), /Предупреждения/);
          await page.locator('#diagnostic-copy').click();
          assert.match(await page.locator('#copy-text').inputValue(), /Сеть при запуске: включена/);
          assert.match(await page.locator('#copy-text').inputValue(), /Three.js r128/);
          assert(!((await page.locator('#copy-text').inputValue()).includes('<h1>Игра</h1>')));
          await page.locator('#copy-close').click();
          assert(await page.locator('#activity-panel').isVisible());
          await page.locator('#error-ai').click();
          await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
          assert.match(await page.locator('#ai-output').inputValue(), /Предупреждение <img src=x>/);
          assert((await page.locator('#ai-output').inputValue()).includes(game));
          await page.locator('#ai-close').click();
          await page.screenshot({ path: join(output, `${name}-${width}-errors.png`) });
          await checkDiagnosticScreen(page, width);
          await open(page, 'resources');
          const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;return canvas.toDataURL('image/png').split(',')[1];});
          await page.locator('#media-input').setInputFiles({name:'diagnostic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
          const media=page.locator('#media-list .media-row');await media.waitFor();
          assert(await media.getByRole('button',{name:'Вставить',exact:true}).isDisabled());
          assert(await media.getByRole('button',{name:'Привязать',exact:true}).isDisabled());
          assert.equal(await media.locator('button svg').count(),3);
          const controls=await media.locator('.media-actions').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,buttons:[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().width)}));
          assert(controls.scroll<=controls.width+1 && controls.buttons.every(w=>w>=44), 'Resource icons and path must fit the phone');
          await media.getByRole('button',{name:'Удалить',exact:true}).click();await page.locator('#media-delete-no').click();assert.equal(await media.count(),1);
          const group=page.locator('.diagnostic-resource-group').first();await group.locator('summary').click();assert(!(await group.evaluate(el=>el.open)));await group.locator('summary').click();
          assert.equal(await page.locator('#code').inputValue(),game);
          await page.screenshot({path:join(output,`${name}-${width}-media-controls.png`)});
          // Cache deletion never restarts the frame or changes editor text.
          await open(page, 'libraries');
          await libraryTab(page,'saved');await page.locator('#diagnostic-cache-list > li').filter({ hasText: 'Three.js' }).getByRole('button',{name:'Удалить',exact:true}).click();
          await page.locator('#diagnostic-delete-yes').click(); await cacheCount(page, 1);
          assert(await element.evaluate(el => el.isConnected));
          assert((await frame.evaluate(() => ticks)) > 0);
          assert.equal(await page.locator('#code').inputValue(), game);
          await close(page); await page.locator('#run').click();
          await open(page);
          assert.equal(await page.locator('#diagnostic-error-list > li').count(), 5, 'Stop keeps diagnostics');
          await page.locator('#diagnostic-clear').click();
          await page.waitForFunction(() => !document.querySelector('#diagnostic-error-list').children.length);
          await source(page, '<h1>Без ошибок</h1>');
          await page.locator('#run').click();
          await open(page); assert.equal(await page.locator('#diagnostic-error-list > li').count(), 0);
          // Only the active frame may submit messages; history is bounded at 50.
          await page.evaluate(() => window.postMessage({ type: 'onehtml-lab:runtime-error', kind: 'error', message: 'forged' }, '*'));
          await page.locator('#preview > iframe').evaluate(el => el.contentWindow.postMessage('noop', '*'));
          const emptyFrame = await (await page.locator('#preview > iframe').elementHandle()).contentFrame();
          await emptyFrame.evaluate(() => { for (let i = 0; i < 70; i++) parent.postMessage({ type: 'onehtml-lab:runtime-error', kind: 'warning', message: `row-${i}`, filename: '', line: 0, column: 0 }, '*'); });
          await page.waitForFunction(() => document.querySelectorAll('#diagnostic-error-list > li').length === 50);
          assert(!(await page.locator('#diagnostic-error-list').innerText()).includes('forged'));
          await close(page); await page.locator('#run').click();
          await source(page, '<p>Новый код</p>'); await open(page);
          assert.match(await page.locator('#diagnostic-run-note').innerText(), /Код уже изменён/);
          await page.locator('#diagnostic-error-list button').first().click();
          assert(await page.locator('#error-ai').isDisabled());
          assert(await page.locator('#error-line').isHidden());
          await open(page, 'libraries');
          await libraryMenu(page,'more');await page.locator('#diagnostic-cache-clear').click(); await page.locator('#diagnostic-delete-yes').click(); await cacheCount(page, 0);
          await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await open(page, 'libraries'); await cacheCount(page, 0);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          assert.deepEqual(hostErrors, []);
          console.log(`${name} ${new URL(url).protocol} ${width}: errors, reports, source binding, libraries, transactional deletion and persistence passed.`);
        } catch (error) {
          await page.screenshot({ path: join(output, `${name}-${width}-failure.png`) }); throw error;
        } finally { await context.close(); }
      }
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await context.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('blocked'); } }));
        const page = await context.newPage();
        await useNativeEditor(page);
        await page.goto(file.href); await page.waitForFunction(() => !document.querySelector('#code').disabled);
        await page.locator('#expert-toggle').click();
        await source(page, '<script src="./custom.js"></script>');
        await page.locator('#draft-status.error').waitFor();
        for (const width of [320, 390, 600, 800, 801, 1365]) {
          await page.setViewportSize({ width, height: 844 });
          await checkToolbarLayout(page, width);
          await open(page, 'libraries'); await close(page);
        }
        // Exercise wrapping above the mobile breakpoint regardless of installed font metrics.
        await page.setViewportSize({ width: 801, height: 844 });
        await page.locator('.expert-actions').evaluate(el => { el.style.flexBasis = '100%'; });
        assert.equal((await checkToolbarLayout(page, 801)).sameRow, false, 'The regression case must exercise a wrapped toolbar');
        await open(page, 'libraries'); await close(page);
        await page.locator('.expert-actions').evaluate(el => { el.style.flexBasis = ''; });
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, 'libraries');
        await page.locator('#diagnostic-library-list').getByRole('button',{name:'Выбрать файл…',exact:true}).click();
        await page.locator('#library-files').setInputFiles([
          { name: 'custom.js', mimeType: 'text/javascript', buffer: Buffer.from('window.custom=true;') },
          { name: 'LICENSE', mimeType: 'text/plain', buffer: Buffer.from(license) }
        ]);
        await cacheCount(page, 1);
        assert.match(await page.locator('#diagnostic-cache-list').innerText(), /Только этот сеанс/);
        await libraryMenu(page,'more');await page.locator('#diagnostic-cache-clear').click(); await page.locator('#diagnostic-delete-yes').click(); await cacheCount(page, 0);
        console.log(`${name}: session-only cache deletion with blocked IndexedDB passed.`);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
} finally { server?.close(); }
console.log(`Diagnostics screenshots: ${output}`);
