import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = new URL('../onehtml-lab.html', import.meta.url).href;
const output = join(tmpdir(), 'onehtml-lab-workspace');
await mkdir(output, { recursive: true });
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const game = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-content:center;background:#eaf3ff;font:20px system-ui}button{padding:16px;font:inherit}</style></head><body><h1>Проверка игры</h1><button id="score">Счёт: 0</button><script>let n=0;document.querySelector("button").onclick=()=>document.querySelector("button").textContent="Счёт: "+(++n);window.ticks=0;setInterval(()=>window.ticks++,20);</script><!--\n' + 'Строка кода для проверки сохранения прокрутки и выделения.\n'.repeat(180) + '--></body></html>';

for (const [engineName, engine] of engines) {
  const browser = await engine.launch();
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, acceptDownloads: true });
      context.setDefaultTimeout(8000);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => { if (!error.message.includes('workspace-error')) errors.push(error.message); });
      await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
      try {
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        await page.locator('#code').fill(game.replace('Проверка игры', 'Предыдущая игра'));
        await page.locator('#code').evaluate((el, value) => {
          el.dispatchEvent(new Event('paste', { bubbles: true }));
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, game);
        await page.locator('#expert-toggle').click();
        assert(await page.locator('#expert-tools').isVisible());
        assert.equal(await page.locator('#tools-toggle, #expert-shelf').count(), 0);
        for (const id of ['import', 'compare', 'history-open', 'storage-toggle', 'library-extract-open', 'ai-open', 'examples-open']) {
          const bounds = await page.locator(`#${id}`).boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, `${id} is directly visible`);
        }
        await page.screenshot({ path: join(output, `${engineName}-${viewport.width}-editor.png`) });
        await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
        await page.evaluate(() => {
          const settings = JSON.parse(localStorage.getItem('onehtml-lab-settings'));
          localStorage.setItem('onehtml-lab-settings', JSON.stringify({ ...settings, toolsExpanded: false }));
        });
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        assert.equal(await page.locator('#code').inputValue(), game);
        assert(await page.locator('#expert-tools').isVisible(), 'An old collapsed preference must not hide expert controls');
        await page.locator('#code').evaluate(el => { el.setSelectionRange(2400, 2420); el.scrollTop = 1200; });
        const editorState = () => page.locator('#code').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop }));
        const savedState = await editorState();

        for (const [open, panel, close] of [['#help-open', '#help-panel', '#help-close'], ['#ai-open', '#ai-dialog', '#ai-close'], ['#examples-open', '#examples-dialog', '#examples-close'], ['#save', '#save-dialog', '#save-close'], ['#history-open', '#history-view', '#history-close'], ['#compare', '#comparison', '#comparison-close']]) {
          await page.locator(open).click();
          assert(await page.locator('#code').isHidden());
          const bounds = await page.locator(panel).boundingBox();
          const work = await page.locator('.workspace').boundingBox();
          assert.equal(bounds.x, 0);
          const comparisonTrack = panel === '#comparison' && await page.locator('#comparison-scrollbar').isVisible() ? (await page.locator('#comparison-scrollbar').boundingBox()).width : 0;
          assert.equal(bounds.width + comparisonTrack, viewport.width);
          assert(Math.abs(bounds.y - work.y) < 1);
          assert(Math.abs(bounds.height - work.height) < 1);
          assert(await page.locator(close).isVisible());
          if (panel === '#examples-dialog') await page.screenshot({ path: join(output, `${engineName}-${viewport.width}-examples.png`) });
          if (panel !== '#help-panel' && viewport.height > 480) {
            await page.locator('#help-open').click();
            await page.locator('#help-close').click();
            assert(await page.locator(panel).isVisible(), `Help returns to ${panel}`);
          }
          await page.locator(close).click();
          assert(await page.locator('#code').isVisible());
          assert.deepEqual(await editorState(), savedState, `${panel} restores selection and scroll`);
        }

        await page.locator('#ai-open').click();
        await page.locator('#ai-copy').click();
        assert(await page.locator('#copy-dialog').isVisible());
        assert(await page.locator('#ai-dialog').isHidden());
        assert.match(await page.locator('#copy-text').inputValue(), /Сделай игру/);
        await page.locator('#copy-close').click();
        assert(await page.locator('#ai-dialog').isVisible(), 'Copy fallback returns to the originating screen');
        await page.locator('#ai-close').click();
        assert.deepEqual(await editorState(), savedState);

        await page.locator('#save').click();
        await page.locator('#filename').fill('Моя игра');
        if (viewport.height > 480) {
          // Exercise the visual-viewport path used by keyboards that do not resize layout.
          await page.evaluate(() => {
            window.__workspaceViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 300, offsetTop: 42 } });
            window.dispatchEvent(new Event('resize'));
          });
          const visualBounds = await page.locator('#confirm-save').boundingBox();
          assert(visualBounds.y >= 42 && visualBounds.y + visualBounds.height <= 343);
          assert((await page.locator('#filename').boundingBox()).y >= 42);
          await page.evaluate(() => {
            if (window.__workspaceViewport) Object.defineProperty(window, 'visualViewport', window.__workspaceViewport);
            else delete window.visualViewport;
            delete window.__workspaceViewport;
            window.dispatchEvent(new Event('resize'));
          });
        }
        // Reduced visible height models keyboard space; it is not a physical keyboard test.
        await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height, 350) });
        await page.waitForFunction(() => document.querySelector('#confirm-save').getBoundingClientRect().bottom <= 351);
        const saveAction = await page.locator('#confirm-save').boundingBox();
        assert(saveAction.y >= 0 && saveAction.y + saveAction.height <= 351, 'Save stays above the keyboard area');
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#confirm-save').click();
        const download = await downloadEvent;
        assert.equal(download.suggestedFilename(), 'Моя игра.html');
        assert.equal(await readFile(await download.path(), 'utf8'), game);
        await page.setViewportSize(viewport);

        await page.locator('#run').click();
        const frameElement = await page.locator('#preview > iframe').elementHandle();
        const frame = await frameElement.contentFrame();
        await frame.locator('#score').click();
        const normalHeight = (await page.locator('#preview').boundingBox()).height;
        await page.locator('#preview-expand').click();
        assert((await page.locator('#preview').boundingBox()).height > normalHeight);
        assert(await frameElement.evaluate(el => el.isConnected), 'Expanding keeps the same frame');
        assert.equal(await frame.locator('#score').innerText(), 'Счёт: 1');
        assert(await page.locator('#network-toggle').isVisible());
        assert(await page.locator('#run').isVisible());
        const ticks = await frame.evaluate(() => window.ticks);
        await page.screenshot({ path: join(output, `${engineName}-${viewport.width}-expanded.png`) });
        await page.locator('#preview-expand').click();
        assert(await frameElement.evaluate(el => el.isConnected));
        assert((await frame.evaluate(() => window.ticks)) >= ticks);
        await page.locator('#save').click();
        await page.locator('#save-close').click();
        assert.equal(await frame.locator('#score').innerText(), 'Счёт: 1');
        await page.locator('#run').click();
        assert.equal(await page.locator('#code').inputValue(), game);
        assert.deepEqual(await editorState(), savedState, 'Run, expand and stop restore the editor position');

        await page.locator('#code').fill('<script>localStorage.setItem("score", "1"); throw new Error("workspace-error")</script>');
        await page.locator('#run').click();
        await page.locator('#activity-summary').getByText(/Ошибка игры/).waitFor();
        assert(await page.locator('#activity-toggle').evaluate(el => el.classList.contains('has-error')));
        assert(await page.locator('#activity-panel').isHidden());
        assert((await page.locator('#activity-toggle').boundingBox()).height <= 45, 'Messages use one compact row');
        await page.locator('#activity-toggle').click();
        assert.match(await page.locator('#runtime-error-message').innerText(), /workspace-error|браузер не сообщил подробности/);
        await page.locator('#copy-error').click();
        assert.match(await page.locator('#copy-text').inputValue(), /workspace-error|браузер не сообщил подробности/);
        await page.locator('#copy-close').click();
        assert(await page.locator('#activity-panel').isVisible());
        await page.locator('#activity-close').click();
        assert(await page.locator('#preview').isVisible());
        await page.locator('#run').click();

        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        console.log(`${engineName} ${viewport.width}x${viewport.height}: screens, visible expert tools, selection, save, messages and uninterrupted expansion passed.`);
      } catch (error) {
        await page.screenshot({ path: join(output, `${engineName}-${viewport.width}-failure.png`) });
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`Workspace screenshots: ${output}`);
