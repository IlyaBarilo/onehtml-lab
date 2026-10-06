import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const example = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
const appUrl = new URL('../onehtml-lab.html', import.meta.url).href;
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-performance-'));
const license = 'MIT License\nCopyright (c) Test library authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const assets = [
  ['three160', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE', 'window.THREE={REVISION:"160"};'],
  ['matter', 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js', 'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/LICENSE', 'window.Matter={version:"0.20.0"};'],
  ['phaser', 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js', 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/LICENSE.md', 'window.Phaser={VERSION:"3.90.0"};']
].map(([id, url, licenseUrl, source], index) => ({ id, url, licenseUrl, source: '/* ' + 'x'.repeat(2048 + index * 512) + ' */\n' + source }));
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];

async function libraryLabels(frame, status) {
  for (const asset of assets) {
    const button = frame.locator(`[data-mode="${asset.id}"]`);
    await button.locator('small').getByText(status, { exact: true }).waitFor();
    assert(await button.isEnabled());
    const size = await button.locator('.library-size').innerText();
    assert.match(size, /^Размер: (?:[\d\s,.]+ (?:Б|КБ)|\(нет данных\))$/);
    if (status === 'Встроена в HTML') {
      assert.equal(await button.locator('.library-size').getAttribute('title'), `${Buffer.byteLength('\n' + asset.source + '\n')} байт JS-кода; без сетевого сжатия`);
    }
  }
}

async function downloadHtml(page, embed = true) {
  await page.locator('#save').click();
  if (!embed) await page.locator('#save-libraries').uncheck();
  const event = page.waitForEvent('download');
  await page.locator('#confirm-save').click();
  return readFile(await (await event).path(), 'utf8');
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 320, height: 650 }, hasTouch: true, acceptDownloads: true });
      try {
        let requests = 0;
        await context.route('https://**/*', async route => {
          requests += 1;
          const url = route.request().url();
          const source = assets.find(asset => asset.url === url);
          const licensed = assets.some(asset => asset.licenseUrl === url);
          assert(source || licensed, 'Only the three exact libraries and licenses may be requested');
          await route.fulfill({ contentType: source ? 'text/javascript' : 'text/plain',
            headers: { 'access-control-allow-origin': '*' }, body: source ? source.source : license });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(appUrl);
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        await page.locator('#expert-toggle').click();
        await page.locator('#examples-open').click();
        await page.locator('[data-example-category="tests"]').click();
        assert(await page.locator('#example-platform-tabs').isHidden());
        assert.equal(await page.locator('.example-card').count(), 1);
        assert.equal(await page.locator('.example-card strong').innerText(), 'Тест работы библиотек');
        await page.setViewportSize({ width: 1365, height: 900 });
        assert.equal(await page.locator('.example-card').count(), 1, 'The same test must be available on desktop');
        await page.setViewportSize({ width: 320, height: 650 });
        await page.locator('.example-card button').click();
        assert.equal((await page.locator('#code').inputValue()).replace(/\r\n/g, '\n'), example.replace(/\r\n/g, '\n'));
        await page.locator('#run').click();
        await page.locator('#library-request').waitFor({ state: 'visible' });
        assert.equal(requests, 0, 'Opening the example must not download libraries without a click');
        await page.locator('#library-download').click();
        await page.locator('#library-request').waitFor({ state: 'hidden' });
        assert.equal(requests, 6, 'Download all three libraries and their licenses');
        await page.locator('#run').click();
        const frame = page.frameLocator('#preview > iframe');
        await libraryLabels(frame, 'Встроена в HTML');
        assert.equal(await frame.locator('#scenario').inputValue(), 'showcase');
        assert.equal(await frame.locator('#scenario option').count(), 3);
        assert(await frame.locator('.load').isHidden());
        assert.match(await frame.locator('#scene-name').innerText(), /Набережная/);
        await frame.locator('#info-toggle').click();
        assert(await frame.locator('#library-info').isVisible());
        assert.match(await frame.locator('#info-body').innerText(), /Правила игры/);
        await frame.locator('#info-body p').first().tap();
        assert.equal(await frame.locator('#tap-count').innerText(), '0', 'Reading explanations must not trigger scene gestures');
        await frame.locator('#info-close').click();
        assert(await frame.locator('#library-info').isHidden());
        await frame.locator('#scenario').selectOption('load');
        await frame.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
        const initialLayout = await frame.locator('header').evaluate(header => ({ top: header.getBoundingClientRect().top,
          bottom: document.querySelector('footer').getBoundingClientRect().bottom, height: innerHeight }));
        if (name === 'chromium') await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-performance-example.png') });
        assert(initialLayout.top >= 0 && initialLayout.bottom <= initialLayout.height + 1, 'Metrics and load controls must fit the phone preview together: ' + JSON.stringify(initialLayout));
        assert.equal(await frame.locator('#load').getAttribute('max'), '10000');
        await frame.locator('#pause').click();
        await frame.locator('#load').evaluate(field => {
          field.value = '10000';
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await frame.locator('#load-value').innerText(), '10000');
        const bounds = await frame.locator('#stage').boundingBox();
        assert(bounds && bounds.height >= 64);
        await frame.locator('#stage').tap({ position: { x: 30, y: 50 } });
        assert.equal(await frame.locator('#tap-count').innerText(), '1');
        await frame.locator('#pause').click();
        await frame.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
        await frame.locator('#stage').tap({ position: { x: 45, y: 60 } });
        assert.equal(await frame.locator('#tap-count').innerText(), '2');
        await frame.locator('#input-time').filter({ hasText: /^До кадра: [\d.]+ мс$/ }).waitFor();
        const layout = await frame.locator('footer').evaluate(footer => ({ bottom: footer.getBoundingClientRect().bottom,
          viewportHeight: innerHeight, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        if (name === 'chromium') await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-performance-example.png') });
        assert(layout.bottom <= layout.viewportHeight + 1, 'Load controls must remain visible inside the phone preview: ' + JSON.stringify(layout));
        assert(layout.scrollWidth <= layout.viewportWidth, 'The test must not overflow horizontally');
        assert.match(await frame.locator('#library-description').innerText(), /Canvas 2D.*без игровой библиотеки/);
        await frame.locator('#scenario').selectOption('showcase');
        assert(await frame.locator('.load').isHidden());
        assert.match(await frame.locator('#scene-name').innerText(), /Набережная/);
        await frame.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
        await frame.locator('#stage').tap({ position: { x: 80, y: 50 } });
        assert.equal(await frame.locator('#tap-count').innerText(), '3');
        await frame.locator('#scenario').selectOption('compare');
        await frame.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
        assert.equal(await frame.locator('#scene-stats').innerText(), 'Сдвинуто: 0/12 · Выстрелов: 0');
        const target = await frame.locator('#stage').boundingBox();
        await frame.locator('#stage').tap({ position: { x: target.width * .7, y: target.height * .65 } });
        await frame.locator('#scene-stats').filter({ hasText: /Выстрелов: 1/ }).waitFor();
        await frame.locator('#scene-stats').filter({ hasText: /Сдвинуто: [1-9]/ }).waitFor();
        await frame.locator('#scenario').selectOption('load');
        assert(await frame.locator('.load').isVisible());
        assert.equal(await frame.locator('#load-value').innerText(), '10000');
        await page.locator('#run').click();
        assert.equal(requests, 6, 'Cached preview must not request external scripts');
        const embedded = await downloadHtml(page);
        assert.equal(embedded.match(/data-onehtml-bundle="1"/g)?.length, 3);
        assert.equal(embedded.match(/Copyright \(c\) Test library authors/g)?.length, 3);
        const embeddedPath = join(scratch, name + '-embedded.html');
        await writeFile(embeddedPath, embedded);
        const saved = await context.newPage();
        await saved.goto(pathToFileURL(embeddedPath).href);
        await libraryLabels(saved, 'Встроена в HTML');
        assert.equal(requests, 6, 'Standalone embedded test must not request CDN resources');
        await saved.close();
        const unchanged = await downloadHtml(page, false);
        assert.equal(unchanged.replace(/\r\n/g, '\n'), example.replace(/\r\n/g, '\n'));
        const cdnPath = join(scratch, name + '-cdn.html');
        await writeFile(cdnPath, unchanged);
        const cdn = await context.newPage();
        await cdn.goto(pathToFileURL(cdnPath).href);
        await libraryLabels(cdn, 'Загружена с CDN');
        await cdn.close();

        const downloads = [];
        const listener = download => downloads.push(download);
        page.on('download', listener);
        await page.locator('#save').click();
        await page.locator('#save-libraries-mode').selectOption('files');
        await page.locator('#confirm-save').click();
        await page.locator('#save-files').waitFor({ state: 'visible' });
        const names = await page.locator('#save-file-list button').allTextContents();
        assert.equal(names.length, 4);
        const automaticCount = name === 'webkit' ? 1 : names.length;
        const deadline = Date.now() + 10_000;
        while (downloads.length < automaticCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(downloads.length, automaticCount);
        const received = new Set(downloads.map(download => download.suggestedFilename()));
        for (let index = 0; index < names.length; index += 1) {
          if (received.has(names[index])) continue;
          const event = page.waitForEvent('download');
          await page.locator('#save-file-list button').nth(index).click();
          await event;
        }
        page.off('download', listener);
        const folder = await mkdtemp(join(scratch, name + '-files-'));
        for (const download of downloads) await download.saveAs(join(folder, download.suggestedFilename()));
        await page.locator('#cancel-save').click();
        const beforeLocal = requests;
        const local = await context.newPage();
        await local.goto(pathToFileURL(join(folder, 'game.html')).href);
        await libraryLabels(local, 'Загружена из файла');
        assert.equal(requests, beforeLocal, 'Separate libraries must load from files beside HTML');
        await local.close();
        assert.deepEqual(errors, [], 'The application and Canvas test must execute without errors');
        console.log(`${name} file: three modes, default showcase, descriptions, tower interaction, three library sizes, 10000 objects, FPS, taps and all exports passed.`);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
} finally {
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + sep) && basename(scratch).startsWith('onehtml-lab-performance-'));
  await rm(scratch, { recursive: true, force: true });
}
