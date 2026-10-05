import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const url = new URL('../onehtml-lab.html', import.meta.url).href;
const output = join(tmpdir(), 'onehtml-lab-workshop');
await mkdir(output, { recursive: true });
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
// AI replies and clipboard access are controlled inputs, not calls to an external service.
for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
    for (const width of [320, 1365]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 320, acceptDownloads: true });
      context.setDefaultTimeout(10000);
      const page = await context.newPage();
      const requests = [];
      await context.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
      await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.testClipboard } }));
      try {
        // WebKit's offline mode rejects file navigation itself; block network requests above instead.
        if (name === 'chromium') await context.setOffline(true);
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        assert(await page.locator('#help-panel').isHidden(), 'No automatic help on first launch');
        for (const size of [320, 390, 600, 700, 701, 844, 1365]) {
          await page.setViewportSize({ width: size, height: 844 });
          const box = await page.locator('#help-open').boundingBox();
          assert(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= size);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const controls = await page.locator('.actions').boundingBox();
          const brand = await page.locator('.brand').boundingBox();
          assert(brand.y + brand.height <= controls.y + 1 || brand.x + brand.width <= controls.x, 'Brand and controls do not overlap');
        }
        await page.setViewportSize({ width, height: 844 });
        await page.locator('#help-open').click();
        assert(await page.locator('#help-panel').isVisible(), 'Help in simple mode');
        assert(await page.locator('#code').isHidden());
        assert.equal(await page.locator('#help-open').getAttribute('aria-expanded'), 'true');
        await page.screenshot({ path: join(output, `${name}-${width}-help.png`) });
        await page.getByText('Без интернета', { exact: true }).click();
        assert.match(await page.locator('details[open]').innerText(), /Поймай круг/);
        await page.locator('#help-close').click();
        assert(await page.locator('#code').isVisible());
        await page.locator('#help-open').click();
        await page.locator('#help-open').click();
        assert(await page.locator('#help-panel').isHidden());
        await page.locator('#expert-toggle').click();
        await page.locator('#examples-open').click();
        await page.locator('#help-open').click();
        await page.keyboard.press('Escape');
        assert(await page.locator('#examples-dialog').isVisible(), 'Help returns to the originating panel');
        await page.locator('.example-card').filter({ hasText: 'Поймай круг' }).getByRole('button').click();
        const original = await page.locator('#code').inputValue();
        await page.locator('#run').click();
        const frameElement = await page.locator('#preview > iframe').elementHandle();
        const frame = await frameElement.contentFrame();
        await frame.locator('#start').click();
        await frame.locator('#target').click();
        assert.equal(await frame.locator('#score').innerText(), '1');
        await page.locator('#help-open').click();
        await page.locator('#help-close').click();
        assert(await frameElement.evaluate(el => el.isConnected));
        assert.equal(await frame.locator('#score').innerText(), '1', 'Help does not restart the game');
        await page.locator('#run').click();
        await page.locator('#edit-open').click();
        await page.locator('#edit-panel-find').click();
        await page.locator('#edit-query').fill('Поймай круг');
        await page.locator('#edit-replace-toggle').click();
        await page.locator('#edit-replacement').fill('Поймай звезду');
        await page.locator('#edit-replace-all').click();
        await page.locator('#edit-find-close').click();
        const improved = await page.locator('#code').inputValue();
        assert.equal(improved, original.replaceAll('Поймай круг', 'Поймай звезду'));
        async function paste(text) {
          await page.evaluate(value => { window.testClipboard = value; }, text);
          await page.locator('#paste').click();
          await page.locator('#replace-dialog button[value="replace"]').click();
          await page.waitForFunction(value => document.querySelector('#code').value === value, text);
        }
        await paste(improved.replace('let score=0,time=30,timer;', 'throw new Error("workshop-error");\nlet score=0,time=30,timer;'));
        await page.locator('#run').click();
        await page.locator('#activity-summary').getByText(/Ошибка игры/).waitFor();
        await page.locator('#activity-toggle').click();
        await page.locator('#error-ai').click();
        await page.locator('#ai-view').click();
        await page.waitForFunction(() => document.querySelector('#ai-output').value.includes('workshop-error'));
        await page.locator('#ai-close').click();
        if (await page.locator('#activity-panel').isVisible()) await page.locator('#activity-close').click();
        await page.locator('#run').click();
        await paste(improved.replaceAll('Поймай звезду', 'Поймай созвездие'));
        await page.locator('#history-open').click();
        const history = page.locator('.history-entry');
        assert.equal(await history.count(), 2);
        await history.first().getByRole('button', { name: 'Сравнить эту версию с текущей', exact: true }).click();
        assert(await page.locator('#comparison').isVisible());
        await page.locator('#comparison-close').click();
        await page.locator('#history-open').click();
        await history.last().getByRole('button', { name: 'Вернуть версию', exact: true }).click();
        await page.locator('#replace-dialog button[value="replace"]').click();
        await page.waitForFunction(value => document.querySelector('#code').value === value, improved);
        if (await page.locator('#history-view').isVisible()) await page.locator('#history-close').click();
        await page.locator('#save').click();
        await page.locator('#filename').fill('workshop-game.html');
        const pending = page.waitForEvent('download');
        await page.locator('#confirm-save').click();
        const download = await pending;
        const path = join(output, `${name}-${width}-game.html`);
        await download.saveAs(path);
        assert.equal(await readFile(path, 'utf8'), improved);
        const gamePage = await context.newPage();
        await gamePage.goto(pathToFileURL(path).href);
        assert.equal(await gamePage.locator('h1').innerText(), 'Поймай звезду');
        await gamePage.locator('#start').click();
        await gamePage.locator('#target').click();
        assert.equal(await gamePage.locator('#score').innerText(), '1', 'Downloaded HTML works without editor or network');
        assert.deepEqual(requests, [], 'The offline exercise makes no HTTP requests');
        console.log(`${name} ${width}: help, offline exercise, simulated AI repair, comparison, restore and downloaded game passed.`);
      } catch (error) {
        await page.screenshot({ path: join(output, `${name}-${width}-failure.png`) });
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
console.log(`Workshop screenshots and saved games: ${output}`);
