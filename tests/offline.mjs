import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const results = [];
const browser = await webkit.launch({ headless: true, timeout: 20000 });
try {
  for (const target of ['fixtures/plain.html', '../onehtml-lab.html']) {
    const url = new URL(target, import.meta.url).href;
    for (const state of ['online', 'offline-before-load', 'offline-after-load']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let phase = 'navigation';
      try {
        if (state === 'offline-before-load') await context.setOffline(true);
        await page.goto(url, { timeout: 10000 });
        if (state === 'offline-after-load') await context.setOffline(true);
        phase = 'content';
        if (target.includes('onehtml-lab.html')) {
          await page.locator('#code').fill('<!doctype html><button onclick="this.textContent=\'OK\'">Test</button>');
          await page.locator('#run').click();
          await page.frameLocator('iframe').getByRole('button').click();
          if (await page.frameLocator('iframe').getByRole('button').innerText() !== 'OK') throw new Error('Game did not run');
          await page.locator('#run').click();
        } else if (!await page.locator('p').isVisible()) throw new Error('Control file not visible');
        results.push({ target, state, result: 'passed' });
      } catch (error) {
        results.push({ target, state, phase, result: 'failed', error: error.message });
      } finally { await context.close(); }
    }
  }
} finally {
  await browser.close();
  const output = process.env.TEST_RESULTS_DIR || join(tmpdir(), 'onehtml-lab-test-results');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'offline-probe.json'), JSON.stringify({ engine: 'webkit', version: browser.version(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
