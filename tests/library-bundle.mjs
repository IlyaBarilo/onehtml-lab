import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const appUrl = new URL('../onehtml-lab.html', import.meta.url);
const appHtml = await readFile(appUrl);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(appHtml));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-library-'));

const sourceUrl = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const sourceLicenseUrl = 'https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE';
const sourceLicense = 'The MIT License\nCopyright © 2010-2021 three.js authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const game = `<!doctype html><html><body><output id="result"></output><script src="${sourceUrl}"></script><script>document.querySelector('#result').textContent = window.THREE?.REVISION || 'missing';</script></body></html>`;
const repairExamples = await Promise.all(['snake3d-turns', 'snake3d-rewrite'].map(name =>
  readFile(new URL(`../src/examples/${name}.html`, import.meta.url), 'utf8')));
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];

async function saveGame(page, embedLibraries = true) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save').click();
  if (!embedLibraries) await page.locator('#save-libraries').uncheck();
  await page.locator('#save-form button[type="submit"]').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'game.html');
  return readFile(await download.path(), 'utf8');
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const appLocation of [appUrl.href, `http://127.0.0.1:${server.address().port}/`]) {
        const context = await browser.newContext({ viewport: { width: 320, height: 650 }, hasTouch: true, acceptDownloads: true });
        try {
          let requests = 0;
          let licenseRequests = 0;
          await context.route(sourceUrl, route => {
            requests += 1;
            return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
              contentType: 'text/javascript', body: 'window.THREE={REVISION:"128"};' });
          });
          await context.route(sourceLicenseUrl, route => {
            licenseRequests += 1;
            return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
              contentType: 'text/plain', body: sourceLicense });
          });
          const page = await context.newPage();
          await page.goto(appLocation);
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await page.locator('#library-toggle').count(), 0);
          const plain = '<!doctype html><p>Without libraries</p>';
          await page.locator('#code').fill(plain);
          await page.locator('#save').click();
          assert(await page.locator('#save-libraries').isDisabled());
          assert(!await page.locator('#save-libraries').isChecked());
          await page.locator('#cancel-save').click();
          assert.equal(await saveGame(page), plain);
          await page.locator('#code').fill(game);

          await page.locator('#save').click();
          assert(await page.locator('#save-libraries').isDisabled(), 'Fresh r128 must not already be in the application');
          assert(!await page.locator('#save-libraries').isChecked());
          await page.locator('#cancel-save').click();
          assert.equal(await saveGame(page), game, 'Uncached r128 must retain its external link');
          await page.locator('#run').click();
          await page.locator('#library-request').waitFor({ state: 'visible' });
          assert.match(await page.locator('#library-request-text').innerText(), /Three.js r128/);
          assert.equal(requests, 0, 'r128 must not download without explicit approval');
          assert.equal(licenseRequests, 0);
          await page.locator('#library-download').click();
          await page.locator('#library-request').waitFor({ state: 'hidden' });
          assert.equal(requests, 1);
          assert.equal(licenseRequests, 1, 'r128 must download its license as well as its source');
          assert.equal(await page.evaluate(() => typeof window.THREE), 'undefined', 'Downloaded game libraries must not run in the editor');

          await page.locator('#network-toggle').click();
          assert.equal(await page.locator('#network-toggle').getAttribute('aria-pressed'), 'false');
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('128').waitFor();
          assert.equal(requests, 1, 'Cached preview must not download Three.js again');
          assert(await page.locator('#network-status').isHidden());
          assert.equal(await page.locator('#preview > iframe').getAttribute('sandbox'), 'allow-scripts');
          await page.locator('#run').click();
          assert.equal(await page.locator('#code').inputValue(), game);

          await page.locator('#save').click();
          assert(await page.locator('#save-libraries').isEnabled());
          assert(await page.locator('#save-libraries').isChecked());
          assert.match(await page.locator('#save-libraries-hint').innerText(), /размер.*КБ.*редактировать/);
          const saveBounds = await page.locator('#save-dialog').boundingBox();
          const saveActionBounds = await page.locator('#save-form button[type="submit"]').boundingBox();
          assert(saveBounds.x >= 0 && saveBounds.x + saveBounds.width <= 320, 'Save dialog must fit a narrow phone');
          assert(saveActionBounds.y + saveActionBounds.height <= 650, 'Export action must remain visible');
          if (name === 'chromium' && appLocation.startsWith('file:')) {
            await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-save-libraries.png') });
          }
          await page.locator('#cancel-save').click();
          assert.equal(await saveGame(page, false), game, 'Unchecked export must preserve external library links');

          const downloaded = await saveGame(page);
          assert(downloaded.includes('data-onehtml-library="three@0.128.0"'));
          assert(downloaded.includes('Copyright © 2010-2021 three.js authors'));
          assert(downloaded.includes('Permission is hereby granted, free of charge'));
          assert(!downloaded.includes(`<script src="${sourceUrl}"></script>`));
          const savedPath = join(scratch, `${name}-${new URL(appLocation).protocol.slice(0, -1)}.html`);
          await writeFile(savedPath, downloaded, 'utf8');
          const savedPage = await context.newPage();
          await savedPage.goto(pathToFileURL(savedPath).href);
          await savedPage.locator('#result').getByText('128').waitFor();
          await savedPage.close();
          assert.equal(requests, 1, 'Saved game must not download Three.js again');

          await page.evaluate(() => {
            Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
            Object.defineProperty(navigator, 'share', {
              configurable: true,
              value: async data => { window.sharedGame = await data.files[0].text(); }
            });
          });
          await page.locator('#share').click();
          await page.waitForFunction(() => typeof window.sharedGame === 'string');
          assert.equal(await page.evaluate(() => window.sharedGame), downloaded);

          if (name === 'chromium' && appLocation.startsWith('file:')) {
            for (const example of repairExamples) {
              await page.locator('#code').fill(example);
              const exportedExample = await saveGame(page);
              assert(exportedExample.includes('data-onehtml-library="three@0.128.0"'), 'Repair examples must use downloaded Three.js');
              assert(!exportedExample.includes(`<script src="${sourceUrl}"></script>`));
            }
            assert.equal(requests, 1, 'Repair examples must reuse downloaded Three.js');
            await page.locator('#code').fill(game);
          }

          await page.locator('#expert-toggle').click();
          assert.equal(await page.locator('#library-toggle').count(), 0);
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            controls: [...document.querySelectorAll('.expert-actions button')].map(button => button.getBoundingClientRect().right)
          }));
          assert(layout.scrollWidth <= layout.width, 'Expert toolbar must fit a 320px screen');
          assert(layout.controls.every(right => right <= layout.width));
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#code').fill(game);
          assert.equal(await saveGame(page), downloaded, 'Downloaded r128 and its license must persist in IndexedDB');
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('128').waitFor();
          assert.equal(requests, 1, 'Reloaded preview must reuse cached r128');
          assert.equal(licenseRequests, 1, 'Reloaded preview must reuse its cached license');
          await page.locator('#run').click();

          const otherVersion = game.replace('/r128/', '/r129/');
          const otherSource = sourceUrl.replace('/r128/', '/r129/');
          const licenseUrl = 'https://cdn.jsdelivr.net/npm/three@0.129.0/LICENSE';
          await context.route(otherSource, route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
            contentType: 'text/javascript', body: 'window.THREE={REVISION:"129"};' }));
          await context.route(licenseUrl, route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
            contentType: 'text/plain', body: 'The MIT License\nCopyright © 2010-2021 three.js authors\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED AS IS' }));
          await page.locator('#code').fill(otherVersion);
          assert.equal(await saveGame(page), otherVersion, 'Uncached libraries are saved with their original links');
          await page.locator('#run').click();
          await page.locator('#library-request').waitFor({ state: 'visible' });
          assert.match(await page.locator('#library-request-text').innerText(), /Three.js r129/);
          await page.locator('#library-download').click();
          await page.locator('#library-request').waitFor({ state: 'hidden' });
          const savedOther = await saveGame(page);
          assert(savedOther.includes('data-onehtml-library="three@0.129.0"'));
          assert(savedOther.includes('window.THREE={REVISION:"129"}'));
          assert(savedOther.includes('Copyright © 2010-2021 three.js authors'));
          assert(!savedOther.includes(otherSource));
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#code').fill(otherVersion);
          assert.equal(await saveGame(page), savedOther, 'Downloaded library must persist in IndexedDB');
          if (name === 'chromium' && appLocation.startsWith('file:')) {
            const matterUrl = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js';
            const phaserUrl = 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js';
            const gameWithLibraries = `<!doctype html><html><body><output id="result"></output><script src="${matterUrl}"></script><script src="${phaserUrl}"></script><script>document.querySelector('#result').textContent = Matter.version + ' / ' + Phaser.VERSION;</script></body></html>`;
            const mit = 'The MIT License\nCopyright (c) Library authors\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED AS IS';
            for (const [url, body] of [
              [matterUrl, 'window.Matter={version:"0.20.0"};'],
              [phaserUrl, 'window.Phaser={VERSION:"3.90.0"};'],
              ['https://cdn.jsdelivr.net/npm/matter-js@0.20.0/LICENSE', mit],
              ['https://cdn.jsdelivr.net/npm/phaser@3.90.0/LICENSE.md', mit]
            ]) await context.route(url, route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body }));
            await page.locator('#code').fill(gameWithLibraries);
            await page.locator('#run').click();
            await page.locator('#library-request').waitFor({ state: 'visible' });
            assert.match(await page.locator('#library-request-text').innerText(), /Matter.js 0.20.0.*Phaser 3.90.0/);
            await page.locator('#library-download').click();
            await page.locator('#library-request').waitFor({ state: 'hidden' });
            const savedBoth = await saveGame(page);
            assert(savedBoth.includes('data-onehtml-library="matter-js@0.20.0"'));
            assert(savedBoth.includes('data-onehtml-library="phaser@3.90.0"'));
            assert.equal(savedBoth.match(/Permission is hereby granted/g)?.length, 2);
            const bothPath = join(scratch, 'cached-libraries.html');
            await writeFile(bothPath, savedBoth, 'utf8');
            const bothPage = await context.newPage();
            await bothPage.goto(pathToFileURL(bothPath).href);
            await bothPage.locator('#result').getByText('0.20.0 / 3.90.0').waitFor();
            await bothPage.close();
            const uncachedUrl = 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.89.0/phaser.min.js';
            const uncachedGame = `<script src="${uncachedUrl}"></script>`;
            await page.locator('#code').fill(uncachedGame);
            await page.locator('#run').click();
            await page.locator('#library-request').waitFor({ state: 'visible' });
            await page.locator('#library-skip').click();
            assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes(uncachedUrl));
            await page.locator('#run').click();
          }
          console.log(`${name} ${new URL(appLocation).protocol}: r128 download, license, cached preview, export, share and narrow layout passed.`);
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
  const tempRoot = resolve(tmpdir());
  assert(resolve(scratch).startsWith(tempRoot + sep) && basename(scratch).startsWith('onehtml-lab-library-'));
  await rm(scratch, { recursive: true, force: true });
}
