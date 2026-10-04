import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
await import('./library-paths.mjs');

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

async function savePackage(page, filename = 'game.html', count = 2, blockMultiple = false) {
  const downloads = [];
  const listener = download => downloads.push(download);
  page.on('download', listener);
  try {
    await page.locator('#save').click();
    await page.locator('#filename').fill(filename);
    await page.locator('#save-libraries-mode').selectOption('files');
    assert.match(await page.locator('#save-libraries-hint').innerText(), /отдельными файлами.*одну папку.*Лицензии/);
    if (blockMultiple) await page.evaluate(() => {
      window.originalDownloadClick = HTMLAnchorElement.prototype.click;
      let clicks = 0;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && ++clicks > 1) return;
        return window.originalDownloadClick.call(this);
      };
    });
    await page.locator('#save-form button[type="submit"]').click();
    await page.locator('#save-files').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#save-file-list button').count(), count);
    assert.equal(await page.locator('#save-title').innerText(), 'Скачать файлы');
    assert(await page.locator('#confirm-save').isHidden());
    const closeBounds = await page.locator('#cancel-save').boundingBox();
    assert(closeBounds.y + closeBounds.height <= page.viewportSize().height, 'File download controls must fit a phone');
    const titleBounds = await page.locator('#save-title').boundingBox();
    assert(titleBounds.y >= 0 && titleBounds.y + titleBounds.height <= page.viewportSize().height, 'The file list heading must remain visible');
    const deadline = Date.now() + 10_000;
    const automaticCount = blockMultiple || page.context().browser().browserType().name() === 'webkit' ? 1 : count;
    while (downloads.length < automaticCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(downloads.length, automaticCount, 'Automatic downloads must follow the browser policy');
    if (blockMultiple) await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.originalDownloadClick; delete window.originalDownloadClick; });
    const receivedNames = new Set(downloads.map(download => download.suggestedFilename()));
    const fileNames = await page.locator('#save-file-list button').allTextContents();
    for (let index = 0; index < fileNames.length; index += 1) {
      if (!receivedNames.has(fileNames[index])) await page.locator('#save-file-list button').nth(index).click();
    }
    while (downloads.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(downloads.length, count, 'All HTML and JS files must download individually');
    const files = new Map();
    for (const download of downloads) {
      assert(!download.suggestedFilename().endsWith('.zip'));
      files.set(download.suggestedFilename(), await readFile(await download.path()));
    }
    assert.equal(files.size, count, 'Distinct file names must survive browser downloads');
    for (const fileName of fileNames) assert(files.has(fileName), 'Every listed file must be downloadable');
    if (blockMultiple) await page.screenshot({ path: join(tmpdir(), page.viewportSize().height < 400 ? 'onehtml-lab-save-files-short.png' : 'onehtml-lab-save-files.png') });
    await page.locator('#cancel-save').click();
    return new Map(fileNames.map(fileName => [fileName, files.get(fileName)]));
  } finally {
    page.off('download', listener);
  }
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
          assert(await page.locator('#save-libraries-mode').isHidden());
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

          const packageFiles = await savePackage(page, 'Моя игра.html');
          assert.deepEqual([...packageFiles.keys()], ['Моя игра.html', 'three-r128.min.js']);
          const packageHtml = packageFiles.get('Моя игра.html').toString('utf8');
          assert(packageHtml.includes('src="./three-r128.min.js"'));
          assert(!packageHtml.includes(sourceUrl));
          assert(packageFiles.get('three-r128.min.js').toString('utf8').includes(sourceLicense));
          const packageDirectory = await mkdtemp(join(scratch, 'package-'));
          for (const [fileName, content] of packageFiles) await writeFile(join(packageDirectory, fileName), content);
          const packagePage = await context.newPage();
          await packagePage.goto(pathToFileURL(join(packageDirectory, 'Моя игра.html')).href);
          await packagePage.locator('#result').getByText('128').waitFor();
          await packagePage.close();
          assert.equal(requests, 1, 'Downloaded HTML must use the JS file beside it');
          assert.equal(await page.locator('#code').inputValue(), game);
          const manualFiles = await savePackage(page, 'game.html', 2, true);
          assert.deepEqual([...manualFiles.keys()], ['game.html', 'three-r128.min.js']);
          assert.equal(manualFiles.get('three-r128.min.js').toString('utf8'), packageFiles.get('three-r128.min.js').toString('utf8'));

          await page.setViewportSize({ width: 320, height: 350 });
          const compactFiles = await savePackage(page, 'game.html', 2, true);
          assert.deepEqual([...compactFiles.keys()], ['game.html', 'three-r128.min.js']);
          await page.locator('#save').click();
          await page.locator('#save-libraries-mode').selectOption('files');
          const compactAction = await page.locator('#save-form button[type="submit"]').boundingBox();
          assert(compactAction.y >= 0 && compactAction.y + compactAction.height <= 350, 'Save button must stay visible with reduced height');
          if (name === 'chromium' && appLocation.startsWith('file:')) await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-save-package-short.png') });
          await page.locator('#save-libraries').uncheck();
          assert(await page.locator('#save-libraries-mode').isHidden());
          await page.locator('#cancel-save').click();
          await page.setViewportSize({ width: 320, height: 650 });
          if (name === 'chromium' && appLocation.startsWith('file:')) {
            await page.locator('#save').click();
            await page.locator('#save-libraries-mode').selectOption('files');
            await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-save-package.png') });
            await page.evaluate(() => {
              window.originalViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
              Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 350, offsetTop: 0 } });
              window.dispatchEvent(new Event('resize'));
            });
            const keyboardAction = await page.locator('#save-form button[type="submit"]').boundingBox();
            assert(keyboardAction.y + keyboardAction.height <= 350, 'Keyboard visual viewport must constrain the save dialog even when layout height stays unchanged');
            await page.evaluate(() => {
              Object.defineProperty(window, 'visualViewport', window.originalViewportDescriptor);
              delete window.originalViewportDescriptor;
              window.dispatchEvent(new Event('resize'));
            });
            await page.locator('#cancel-save').click();
          }

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

          for (const path of ['./three-r128.min.js', '../assets/libs/three-r128.min.js', '/vendor/three/r128/three.min.js?cache=1#engine']) {
            const relativeGame = game.replace(sourceUrl, path);
            await page.locator('#code').fill(relativeGame);
            assert.equal(await saveGame(page, false), relativeGame);
            const exported = await saveGame(page);
            assert(exported.includes('data-onehtml-library="three@0.128.0"'));
            assert(!exported.includes(`<script src="${path}"></script>`));
            assert.equal(await page.locator('#code').inputValue(), relativeGame);
            await page.locator('#run').click();
            await page.frameLocator('#preview > iframe').locator('#result').getByText('128').waitFor();
            await page.locator('#run').click();
          }
          assert.equal(requests, 1, 'Local paths with a known version must reuse the catalog cache');

          const localGame = game.replace(sourceUrl, '../vendor/three.min.js');
          await page.locator('#code').fill(localGame);
          await page.locator('#run').click();
          await page.locator('#library-request').waitFor({ state: 'visible' });
          assert(await page.locator('#library-download').isHidden(), 'An unversioned filename must not select a catalog version');
          assert(await page.locator('#library-files-button').isVisible());
          const localRequestBounds = await page.locator('#library-request').boundingBox();
          const chooseFilesBounds = await page.locator('#library-files-button').boundingBox();
          assert(localRequestBounds.x >= 0 && localRequestBounds.x + localRequestBounds.width <= 320);
          assert(chooseFilesBounds.y + chooseFilesBounds.height <= 650, 'Local file selection must fit a phone screen');
          await page.locator('#library-files').setInputFiles({ name: 'three.min.js', mimeType: 'text/javascript', buffer: Buffer.from('window.THREE={REVISION:"local-copy"};') });
          await page.locator('#library-files-button').getByText('Выбрать лицензию').waitFor();
          await page.locator('#library-files').setInputFiles({ name: 'LICENSE', mimeType: 'text/plain', buffer: Buffer.from(sourceLicense) });
          await page.locator('#library-request').waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => typeof window.THREE), 'undefined');
          assert.equal(await saveGame(page, false), localGame);
          const localExport = await saveGame(page);
          assert(localExport.includes('data-onehtml-library="local@'));
          assert(localExport.includes('window.THREE={REVISION:"local-copy"}'));
          assert(localExport.includes(sourceLicense));
          assert(!localExport.includes('src="../vendor/three.min.js"'));
          const localPackage = await savePackage(page);
          assert.deepEqual([...localPackage.keys()], ['game.html', 'three.min.js']);
          assert(localPackage.get('game.html').toString('utf8').includes('src="./three.min.js"'));
          assert(localPackage.get('three.min.js').toString('utf8').includes('local-copy'));
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#code').fill(localGame);
          assert.equal(await saveGame(page), localExport, 'The selected local library and license must survive reload');
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('local-copy').waitFor();
          await page.locator('#run').click();
          await page.locator('#code').fill(game);

          const selfLicensedGame = '<script src="./libs/custom-engine.js"></script>';
          await page.locator('#code').fill(selfLicensedGame);
          await page.locator('#run').click();
          await page.locator('#library-request').waitFor({ state: 'visible' });
          await page.locator('#library-files').setInputFiles({ name: 'custom-engine.js', mimeType: 'text/javascript',
            buffer: Buffer.from(`/*! ${sourceLicense} */\nwindow.CustomEngine={ready:true};`) });
          await page.locator('#library-request').waitFor({ state: 'hidden' });
          const selfLicensedExport = await saveGame(page);
          assert(selfLicensedExport.includes('window.CustomEngine={ready:true}'));
          assert(selfLicensedExport.includes(sourceLicense));
          await page.locator('#code').fill(game);

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
          assert(!savedOther.includes(`<script src="${otherSource}"></script>`));
          assert(savedOther.includes(`data-onehtml-source="${otherSource}"`), 'Reversible copies must retain the original source address');
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
            const bothPackage = await savePackage(page, 'game.html', 3);
            assert.deepEqual([...bothPackage.keys()], ['game.html', 'matter-0.20.0.min.js', 'phaser-3.90.0.min.js']);
            const bothPackageDirectory = await mkdtemp(join(scratch, 'multi-package-'));
            for (const [fileName, content] of bothPackage) await writeFile(join(bothPackageDirectory, fileName), content);
            const bothPackagePage = await context.newPage();
            await bothPackagePage.goto(pathToFileURL(join(bothPackageDirectory, 'game.html')).href);
            await bothPackagePage.locator('#result').getByText('0.20.0 / 3.90.0').waitFor();
            await bothPackagePage.close();
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
          console.log(`${name} ${new URL(appLocation).protocol}: CDN and local libraries, licenses, cached preview, export, share and narrow layout passed.`);
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
await import('./library-extract-browser.mjs');
