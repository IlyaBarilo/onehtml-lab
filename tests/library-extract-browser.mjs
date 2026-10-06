import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const appUrl = new URL('../onehtml-lab.html', import.meta.url);
const appHtml = await readFile(appUrl);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(appHtml));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-extraction-'));
const sourceUrl = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const licenseUrl = 'https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE';
const license = 'MIT License\nCopyright (c) Library authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const library = '/* library body ' + 'x'.repeat(32000) + ' */\nwindow.THREE={REVISION:"128"};';
const game = `<!doctype html><script id="engine" src="${sourceUrl}"></script><output id="result"></output><script>document.querySelector('#result').textContent = THREE.REVISION;</script>`;
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];

async function ready(page, location) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(location);
  assert.deepEqual(errors, [], 'Application source must parse in the HTML document');
  await page.waitForFunction(() => !document.querySelector('#code').disabled && document.querySelector('#draft-status').textContent.length > 0);
}
async function saveHtml(page) {
  const event = page.waitForEvent('download');
  await page.locator('#save').click();
  await page.locator('#confirm-save').click();
  const download = await event;
  return readFile(await download.path(), 'utf8');
}
async function openExtraction(page, mode = 'cdn', enabled = true) {
  await page.locator('#library-extract-open').click();
  await page.locator('#library-extraction').waitFor({ state: 'visible' });
  await page.locator(`[data-library-mode="${mode}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#library-extraction-summary').textContent.includes('Проверяю'));
  assert.equal(await page.locator('#library-extract-apply').isEnabled(), enabled);
  assert(await page.locator('#code').isHidden());
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    right: document.querySelector('#library-extract-open').getBoundingClientRect().right,
    apply: document.querySelector('#library-extract-apply').getBoundingClientRect().bottom,
    title: document.querySelector('#library-extraction-title').getBoundingClientRect().top,
    height: innerHeight }));
  assert(layout.scrollWidth <= layout.width && layout.right <= layout.width, 'Expert controls must fit a phone');
  assert(layout.title >= 0 && layout.apply <= layout.height, 'Extraction title and action must remain on screen');
}
async function applyExtraction(page) {
  await page.locator('#library-extract-apply').click();
  await page.locator('#library-extraction').waitFor({ state: 'hidden' });
  assert(await page.locator('#code').isVisible() || await page.locator('#alternative-editor').isVisible());
  return page.locator('#code').inputValue();
}
async function saveFiles(page) {
  const downloads = [];
  const listener = download => downloads.push(download);
  page.on('download', listener);
  try {
    await page.locator('#save').click();
    assert(await page.locator('#save-libraries').isChecked());
    assert.equal(await page.locator('#save-libraries-mode').inputValue(), 'files');
    await page.locator('#confirm-save').click();
    await page.locator('#save-files').waitFor({ state: 'visible' });
    const deadline = Date.now() + 10_000;
    while (!downloads.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    const names = await page.locator('#save-file-list button').allTextContents();
    for (let index = 0; index < names.length; index += 1) {
      if (!downloads.some(download => download.suggestedFilename() === names[index])) await page.locator('#save-file-list button').nth(index).click();
    }
    while (new Set(downloads.map(download => download.suggestedFilename())).size < names.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    const files = new Map();
    for (const download of downloads) files.set(download.suggestedFilename(), await readFile(await download.path()));
    assert.equal(files.size, names.length);
    for (const name of names) assert(files.has(name));
    await page.locator('#cancel-save').click();
    return files;
  } finally { page.off('download', listener); }
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const location of [appUrl.href, `http://127.0.0.1:${server.address().port}/`]) {
        const seed = await browser.newContext({ acceptDownloads: true });
        let embedded;
        try {
          await seed.route(sourceUrl, route => route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: library }));
          await seed.route(licenseUrl, route => route.fulfill({ contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: license }));
          const seedPage = await seed.newPage();
          await ready(seedPage, location);
          assert(await seedPage.locator('#alternative-editor').isVisible(), 'Editor conversion also works with the default CodeMirror');
          await seedPage.locator('#code').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, game);
          await seedPage.locator('#expert-toggle').click();
          await openExtraction(seedPage, 'embed', false);
          assert(await seedPage.locator('#library-convert-load').isVisible(), 'Missing copies can be obtained before applying');
          assert.equal(await seedPage.locator('#code').inputValue(), game, 'Planning never modifies source');
          await seedPage.locator('#library-convert-load').click();
          await seedPage.locator('#library-request').waitFor({ state: 'visible' });
          await seedPage.locator('#library-download').click();
          await seedPage.locator('#library-extraction').waitFor({ state: 'visible' });
          await seedPage.waitForFunction(() => !document.querySelector('#library-extract-apply').disabled);
          const converted = await applyExtraction(seedPage);
          await seedPage.locator('.cm-content').getByText('REVISION').first().waitFor();
          assert(converted.includes(license) && converted.includes(library), 'Editor embedding includes the complete license and source');
          assert.equal(await seedPage.evaluate(() => typeof window.THREE), 'undefined', 'Conversion must not execute the library');
          await seedPage.locator('#history-open').click();
          assert.equal(await seedPage.locator('.history-entry').count(), 1, 'Conversion archives the source once');
          await seedPage.locator('#history-close').click();
          embedded = await saveHtml(seedPage);
          assert.equal(embedded, converted, 'Saving already embedded source preserves it exactly');
          assert(embedded.includes('data-onehtml-sha256='));
        } finally { await seed.close(); }

        const context = await browser.newContext({ viewport: { width: 320, height: 650 }, hasTouch: true, acceptDownloads: true });
        let internetRequests = 0;
        await context.route('https://**/*', route => { internetRequests += 1; return route.abort(); });
        try {
          const page = await context.newPage();
          await useNativeEditor(page);
          await ready(page, location);
          assert(await page.locator('#library-extract-open').isHidden());
          await page.locator('#expert-toggle').click();
          assert(await page.locator('#library-extract-open').isDisabled());
          await page.locator('#code').fill(embedded);
          await openExtraction(page);
          assert.match(await page.locator('#library-extraction-list').innerText(), /Three.js r128/);
          if (name === 'chromium' && location.startsWith('file:')) await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-extract.png') });
          await page.locator('#library-extract-close').click();
          assert.equal(await page.locator('#code').inputValue(), embedded, 'Closing the panel must not change the game');
          await openExtraction(page);
          const cdn = await applyExtraction(page);
          assert(cdn.includes(`src="${sourceUrl}"`));
          assert(!cdn.includes(library));
          assert(cdn.length < embedded.length / 10);
          assert.equal(await page.evaluate(() => typeof window.THREE), 'undefined', 'Extracted source must never run in the editor');
          await page.locator('#save').click();
          assert(!await page.locator('#save-libraries').isChecked(), 'CDN extraction must offer a small HTML by default');
          await page.locator('#cancel-save').click();
          assert.equal(await saveHtml(page), cdn);
          await page.locator('#network-toggle').click();
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('128', { exact: true }).waitFor();
          await page.locator('#run').click();
          assert.equal(internetRequests, 0, 'Extracted copies must preview from cache without CDN traffic');
          await page.locator('#history-open').click();
          await page.locator('#history-list .history-entry').first().getByRole('button', { name: 'Вернуть версию', exact: true }).click();
          await page.locator('#replace-dialog').waitFor({ state: 'visible' });
          await page.locator('#replace-dialog [value="replace"]').click();
          await page.waitForFunction(expected => document.querySelector('#code').value === expected, embedded);
          await openExtraction(page, 'files');
          const relative = await applyExtraction(page);
          assert(relative.includes('src="./three-r128.min.js"'));
          await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await page.locator('#code').inputValue(), relative);
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('128', { exact: true }).waitFor();
          await page.locator('#run').click();
          assert.equal(internetRequests, 0, 'Extracted assets must survive reload in IndexedDB');
          await page.locator('#code').fill(relative + '\n<!-- game edit -->');
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('128', { exact: true }).waitFor();
          await page.locator('#run').click();
          const files = await saveFiles(page);
          assert(files.has('game.html') && files.has('three-r128.min.js'));
          assert(files.get('three-r128.min.js').toString('utf8').includes(license));
          const folder = await mkdtemp(join(scratch, 'game-'));
          for (const [fileName, content] of files) await writeFile(join(folder, fileName), content);
          const savedPage = await context.newPage();
          await useNativeEditor(savedPage);
          await savedPage.goto(pathToFileURL(join(folder, 'game.html')).href);
          await savedPage.locator('#result').getByText('128', { exact: true }).waitFor();
          await savedPage.close();
          await page.locator('#code').fill(embedded.replace('REVISION:"128"', 'REVISION:"999"'));
          await openExtraction(page, 'cdn', false);
          assert.match(await page.locator('#library-extraction-list').innerText(), /изменён/);
          await page.locator('#library-extract-close').click();

          const customSource = 'window.CustomReady=true;';
          const customKey = 'local@' + 'a'.repeat(64) + ':custom.js';
          const customHash = createHash('sha256').update(customSource).digest('hex');
          const custom = `<!--onehtml-library:${encodeURIComponent(customKey)}\ncustom.js, MIT license:\n${license}\n-->\n<script data-onehtml-library="${customKey}" data-onehtml-bundle="1" data-onehtml-filename="custom.js" data-onehtml-sha256="${customHash}">\n${customSource}\n</script><output id="result"></output><script>document.querySelector('#result').textContent = CustomReady ? 'ready' : 'missing';</script>`;
          await page.locator('#code').fill(custom);
          await page.setViewportSize({ width: 320, height: 350 });
          await openExtraction(page, 'cdn', false);
          assert(await page.locator('#expert-tools').isHidden(), 'Extraction gives its space to the library list');
          const usableHeight = await page.locator('.library-extraction-body').evaluate(el => {
            const style = getComputedStyle(el);
            return el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
          });
          assert(usableHeight >= 80, 'Library details must remain readable at keyboard-sized heights');
          assert.match(await page.locator('#library-extraction-list').innerText(), /Нет CDN/);
          await page.locator('[data-library-mode="files"]').click();
          await page.waitForFunction(() => !document.querySelector('#library-extract-apply').disabled);
          if (name === 'chromium' && location.startsWith('file:')) await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-extract-short.png') });
          const customRelative = await applyExtraction(page);
          assert(customRelative.includes('src="./custom.js"'));
          await page.setViewportSize({ width: 320, height: 650 });
          await page.locator('#run').click();
          await page.frameLocator('#preview > iframe').locator('#result').getByText('ready', { exact: true }).waitFor();
          await page.locator('#run').click();
          await openExtraction(page, 'embed');
          const customEmbedded = await applyExtraction(page);
          assert(customEmbedded.includes(customSource) && customEmbedded.includes(license), 'Relative links embed their retained local copy');
          assert.equal(internetRequests, 0, 'Cached editor transformations do not use the network');
          await page.locator('#code').fill(embedded);
          await openExtraction(page);
          await page.locator('#expert-toggle').click();
          assert(await page.locator('#library-extraction').isHidden());
          assert(await page.locator('#code').isVisible());
          assert.equal(await page.locator('#code').inputValue(), embedded);
          console.log(`${name} ${new URL(location).protocol}: extraction, history, save defaults, persistent cache, local files and phone layout passed.`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  server.close();
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + sep) && basename(scratch).startsWith('onehtml-lab-extraction-'));
  await rm(scratch, { recursive: true, force: true });
}
