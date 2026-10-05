import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const file = new URL('../onehtml-lab.html', import.meta.url);
const output = join(tmpdir(), 'onehtml-lab-desktop');
await mkdir(output, { recursive: true });
const urls = [file.href];
let server;
if (process.argv.includes('--http')) {
  const html = await readFile(file);
  server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  urls.push(`http://127.0.0.1:${server.address().port}/`);
}
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const game = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#eaf3ff;font:20px system-ui;display:grid;place-content:center;min-height:100vh}button{font:inherit;padding:16px}</style></head><body><h1>Игра A</h1><button id="score">Счёт: 0</button><script>window.bootWidth=innerWidth;window.score=0;window.ticks=0;setInterval(()=>ticks++,20);document.querySelector('button').onclick=()=>document.querySelector('button').textContent='Счёт: '+(++score);window.addEventListener('message',e=>{if(e.data==='fail')setTimeout(()=>{throw new Error('desktop-test-error')},0)});</script><!--\n${'Строка для прокрутки и номеров.\n'.repeat(80)}--></body></html>`;
const changed = game.replace('Игра A', 'Игра B');
async function ready(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#code').disabled);
}
async function unchanged(element, frame) {
  assert(await element.evaluate(el => el.isConnected), 'Layout must keep the same iframe node');
  assert.equal(await frame.evaluate(() => window.score), 1, 'Layout must keep the frame document');
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of urls) for (const width of [1000, 1365]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
        context.setDefaultTimeout(10000);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { if (!error.message.includes('desktop-test-error')) errors.push(error.message); });
        try {
          await ready(page, url);
          await page.locator('#code').fill(game);
          await page.locator('#expert-toggle').click();
          await page.locator('#split-toggle').click();
          assert(await page.locator('#code').isVisible());
          assert(await page.locator('#preview-empty').isVisible());
          await page.locator('#preview-device').selectOption('phone');
          await page.locator('#run').click();
          const element = await page.locator('#preview > iframe').elementHandle();
          const frame = await element.contentFrame();
          await frame.locator('#score').click();
          await page.waitForFunction(() => document.querySelector('#preview > iframe').style.width === '390px');
          assert.equal(await frame.evaluate(() => innerWidth), 390);
          assert.equal(await frame.evaluate(() => bootWidth), 390, 'Game starts with the selected viewport');
          assert.equal(await frame.evaluate(() => innerHeight), 844);
          assert(await page.locator('#code').isVisible());
          assert(await page.locator('#preview-changes').isHidden());
          const codeBounds = await page.locator('#code').boundingBox();
          const dividerBounds = await page.locator('#split-divider').boundingBox();
          assert(Math.abs(codeBounds.x + codeBounds.width - dividerBounds.x) < 1);
          await page.screenshot({ path: join(output, `${name}-${width}-phone.png`) });
          await page.locator('#preview-rotate').click();
          await page.waitForFunction(() => document.querySelector('#preview > iframe').style.width === '844px');
          assert.equal(await frame.evaluate(() => innerWidth), 844);
          assert.equal(await frame.evaluate(() => innerHeight), 390);
          await unchanged(element, frame);
          // Dragging over a live frame does not lose the pointer or restart the game.
          await page.mouse.move(dividerBounds.x + 5, dividerBounds.y + 80);
          await page.mouse.down();
          await page.mouse.move(width * .65, dividerBounds.y + 80, { steps: 5 });
          await page.mouse.up();
          assert(Number(await page.locator('#split-divider').getAttribute('aria-valuenow')) >= 64);
          await page.locator('#split-divider').focus();
          await page.keyboard.press('Home');
          assert.equal(await page.locator('#split-divider').getAttribute('aria-valuenow'), '30');
          await page.keyboard.press('End');
          assert.equal(await page.locator('#split-divider').getAttribute('aria-valuenow'), '70');
          const restartBounds = await page.locator('#preview-restart').boundingBox();
          assert(restartBounds.x >= 0 && restartBounds.x + restartBounds.width <= width + 1);
          await page.screenshot({ path: join(output, `${name}-${width}-narrow-preview.png`) });
          await unchanged(element, frame);
          await page.locator('#split-toggle').click();
          assert(await page.locator('#code').isHidden());
          await unchanged(element, frame);
          await page.locator('#split-toggle').click();
          await page.locator('#preview-expand').click();
          assert(await page.locator('#code').isHidden());
          assert(await page.locator('#preview-tools').isHidden());
          await unchanged(element, frame);
          await page.locator('#preview-expand').click();
          assert(await page.locator('#code').isVisible());
          await page.locator('#ai-open').click();
          assert(await page.locator('#code').isHidden());
          assert(await page.locator('#preview-tools').isHidden());
          await page.locator('#ai-close').click();
          await unchanged(element, frame);
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator('#code').waitFor({ state: 'hidden' });
          assert(await page.locator('#split-toggle').isHidden());
          await unchanged(element, frame);
          await page.setViewportSize({ width, height: 900 });
          await page.locator('#code').waitFor({ state: 'visible' });
          await unchanged(element, frame);
          // Source editing does not update the game; save exports the edited text.
          await page.locator('#code').fill(changed);
          assert(await page.locator('#preview-changes').isVisible());
          assert.equal(await frame.locator('h1').innerText(), 'Игра A');
          await page.locator('#code').press('Control+z');
          assert.equal(await page.locator('#code').inputValue(), game);
          assert(await page.locator('#preview-changes').isHidden());
          await page.locator('#code').press('Control+y');
          assert.equal(await page.locator('#code').inputValue(), changed);
          await unchanged(element, frame);
          await page.locator('#save').click();
          const downloadEvent = page.waitForEvent('download');
          await page.locator('#confirm-save').click();
          assert.equal(await readFile(await (await downloadEvent).path(), 'utf8'), changed);
          await unchanged(element, frame);
          await page.locator('#code').press('Control+Enter');
          await page.frameLocator('#preview > iframe').locator('h1').getByText('Игра B', { exact: true }).waitFor();
          assert(!(await element.evaluate(el => el.isConnected)));
          assert(await page.locator('#preview-changes').isHidden());
          const nextElement = await page.locator('#preview > iframe').elementHandle();
          const nextFrame = await nextElement.contentFrame();
          // Error belongs to the running source, and must never target edited lines.
          await page.locator('#preview > iframe').evaluate(el => el.contentWindow.postMessage('fail', '*'));
          await page.waitForFunction(() => !document.querySelector('#runtime-error').hidden);
          await page.locator('#activity-toggle').click();
          assert(await page.locator('#error-ai').isEnabled());
          await page.locator('#activity-close').click();
          await page.locator('#code').fill('\n' + changed);
          await page.locator('#preview > iframe').evaluate(el => el.contentWindow.postMessage('fail', '*'));
          await page.waitForFunction(() => document.querySelector('#runtime-error-message').textContent.includes('Код в редакторе уже изменён'));
          await page.locator('#activity-toggle').click();
          assert(await page.locator('#error-line').isHidden());
          assert(await page.locator('#error-ai').isDisabled());
          await page.locator('#activity-close').click();
          // Search/replace and navigation work without stopping a split preview.
          await page.locator('#edit-open').click();
          await page.locator('#edit-query').fill('Игра B');
          await page.locator('#edit-replacement').fill('Игра C');
          await page.locator('#edit-replace-all').click();
          await page.locator('#edit-close').click();
          assert((await page.locator('#code').inputValue()).includes('Игра C'));
          assert.equal(await nextFrame.locator('h1').innerText(), 'Игра B');
          await page.locator('#code').evaluate(el => { el.readOnly = true; });
          const locked = await page.locator('#code').inputValue();
          await page.locator('#code').press('Control+z');
          assert.equal(await page.locator('#code').inputValue(), locked);
          await page.locator('#code').evaluate(el => { el.readOnly = false; });
          await page.locator('#preview-restart').click();
          await page.frameLocator('#preview > iframe').locator('h1').getByText('Игра C', { exact: true }).waitFor();
          await page.locator('#run').click();
          assert(await page.locator('#preview-empty').isVisible());
          assert.equal(await page.locator('#preview > iframe').count(), 0);
          await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await page.locator('#split-toggle').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('#split-divider').getAttribute('aria-valuenow'), '70');
          assert.equal(await page.locator('#preview-device').inputValue(), 'phone');
          assert.equal(await page.locator('#preview-rotate').getAttribute('aria-pressed'), 'true');
          await page.locator('#expert-toggle').click();
          assert(await page.locator('#preview-settings').isHidden());
          await page.locator('#run').click();
          assert(await page.locator('#code').isVisible(), 'The selected view applies in simple mode');
          await page.waitForFunction(() => document.querySelector('#preview > iframe').style.width === '844px');
          await page.locator('#run').click();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          assert.deepEqual(errors, []);
          console.log(`${name} ${new URL(url).protocol} ${width}: split, resize, phone, editing, restart, export, errors and persistence passed.`);
        } catch (error) {
          await page.screenshot({ path: join(output, `${name}-${width}-failure.png`) });
          throw error;
        } finally { await context.close(); }
      }
      // Corrupt or unavailable preferences must not prevent startup.
      for (const blocked of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        await context.addInitScript(block => {
          if (block) Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
          else localStorage.setItem('onehtml-lab-desktop-view', '{bad');
        }, blocked);
        const page = await context.newPage();
        await ready(page, file.href);
        await page.locator('#expert-toggle').click();
        assert.equal(await page.locator('#split-toggle').getAttribute('aria-pressed'), 'false');
        await page.locator('#split-toggle').click();
        assert(await page.locator('#preview-empty').isVisible());
        await context.close();
      }
    } finally { await browser.close(); }
  }
} finally { server?.close(); }
console.log(`Desktop screenshots: ${output}`);
