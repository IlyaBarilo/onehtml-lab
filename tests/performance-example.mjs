import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';

const example = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
const appUrl = new URL('../onehtml-lab.html', import.meta.url).href;
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-performance-'));
const license = 'MIT License\nCopyright (c) Test library authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const apache = (await readFile(new URL('../docs/licenses/babylonjs-9.30.0-LICENSE.txt', import.meta.url), 'utf8')).trim();
const notice = (await readFile(new URL('../docs/licenses/babylonjs-9.30.0-NOTICE.txt', import.meta.url), 'utf8')).trim();
const assets = [
  ['three160', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE', 'window.THREE={REVISION:"160"};'],
  ['matter', 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js', 'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/LICENSE', 'window.Matter={version:"0.20.0"};'],
  ['phaser', 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js', 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/LICENSE.md', 'window.Phaser={VERSION:"3.90.0"};'],
  ['phaser4', 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js', 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/LICENSE.md', 'window.Phaser={VERSION:"4.2.1"};'],
  ['babylon', 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/babylon.js', 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/license.md', 'window.BABYLON={Engine:{Version:"9.30.0"}};']
].map(([id, url, licenseUrl, source], index) => ({ id, url, licenseUrl, source: '/* ' + 'x'.repeat(2048 + index * 512) + ' */\n' + source }));
const cannonUrl = 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
const cannonLicense = await readFile(new URL('../node_modules/cannon-es/LICENSE', import.meta.url), 'utf8');
assets.push({ id: 'cannon', url: cannonUrl, licenseUrl: cannonUrl.replace('/dist/cannon-es.js', '/LICENSE'), source: await readFile(new URL('../node_modules/cannon-es/dist/cannon-es.js', import.meta.url), 'utf8') });
const server = createServer((request, response) => {
  const file = resolve(scratch, decodeURIComponent(request.url.slice(1)));
  if (!file.startsWith(scratch + sep)) return response.writeHead(404).end();
  readFile(file).then(bytes => response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(bytes)).catch(() => response.writeHead(404).end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const localHost = `http://127.0.0.1:${server.address().port}/`;
const selected = process.argv.find(value => value.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length, 'Select chromium or webkit');
const canvasSource = example.slice(example.indexOf('      function canvasShowcase()'), example.indexOf('      function threeColor('));

async function checkCanvasRoute(page, name) {
  let wideGeometry;
  for (const [width, height] of [[320, 420], [1365, 420], [2560, 420], [2560, 240], [2560, 840]]) {
    const result = await page.evaluate(({ source, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const geometry = { windows: [], facades: [], supports: [], cars: [], cabins: [] }, fillRect = context.fillRect.bind(context);
      let captureGeometry = true;
      context.fillRect = (x, y, width, height) => {
        if (captureGeometry) {
          const group = { '#afcfd3': 'windows', '#608594': 'facades', '#536473': 'supports', '#d29359': 'cars', '#b87646': 'cabins' }[context.fillStyle];
          if (group) geometry[group].push({ x, y, width, height });
        }
        fillRect(x, y, width, height);
      };
      let waveLines = [], pathStart, pathEnd;
      const moveTo = context.moveTo.bind(context), lineTo = context.lineTo.bind(context), stroke = context.stroke.bind(context);
      context.moveTo = (x, y) => { pathStart = x; moveTo(x, y); };
      context.lineTo = (x, y) => { pathEnd = x; lineTo(x, y); };
      context.stroke = () => { if (context.strokeStyle === '#a7d2db') waveLines.push({ from: pathStart, to: pathEnd }); stroke(); };
      const scene = new Function('makeCanvas', 'width', 'height', source + '\nreturn canvasShowcase();')(() => context, width, height);
      const bounds = () => {
        const pixels = context.getImageData(0, Math.floor(height * .59) - 40, width, 42).data;
        let min = width, max = -1;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] !== 210 || pixels[i + 1] !== 147 || pixels[i + 2] !== 89) continue;
          const x = i / 4 % width; min = Math.min(min, x); max = Math.max(max, x);
        }
        return max < 0 ? null : { min, max };
      };
      scene.tick(0);
      captureGeometry = false;
      const day = canvas.toDataURL('image/png');
      const roadBandTop = Math.floor(height * .59) - 40;
      const roadPixels = context.getImageData(0, roadBandTop, width, 50).data;
      let wheelBottom = -1;
      for (let i = 0; i < roadPixels.length; i += 4) if (roadPixels[i] < 65 && roadPixels[i + 1] < 80 && roadPixels[i + 2] < 90) wheelBottom = roadBandTop + Math.floor(i / 4 / width);
      if (wheelBottom < Math.floor(height * .59) - 3 || wheelBottom > height * .60) throw new Error(`Wheels float above or below the road: ${wheelBottom}`);
      let previous = bounds(), exits = 0, entries = 0, waveWraps = 0, previousWaves = waveLines;
      for (let step = 1; step <= 240; step += 1) {
        waveLines = [];
        scene.tick(400);
        if (waveLines.length !== 84) throw new Error('Each wave must keep its place in the moving pattern');
        for (let index = 0; index < waveLines.length; index += 1) if (waveLines[index].from < previousWaves[index].from) {
          if (previousWaves[index].from < width || waveLines[index].from >= 0) throw new Error('A wave wrapped while already visible on screen');
          waveWraps += 1;
        }
        previousWaves = waveLines;
        for (const support of geometry.supports) {
          const pillar = context.getImageData(Math.floor(support.x + support.width / 2), Math.floor(height * .59) - 32, 1, 27).data;
          for (let i = 0; i < pillar.length; i += 4) if (pillar[i] !== 83 || pillar[i + 1] !== 100 || pillar[i + 2] !== 115) throw new Error('The car or its lights painted over a foreground bridge support');
        }
        const current = bounds();
        if (previous && !current) {
          if (previous.max < width - 2) throw new Error(`Car disappeared inside the scene at ${step * .4}s: ${JSON.stringify(previous)}`);
          exits += 1;
        }
        if (!previous && current) {
          if (current.min > 2) throw new Error(`Car appeared inside the scene at ${step * .4}s: ${JSON.stringify(current)}`);
          entries += 1;
        }
        if (previous && current && current.min < previous.min && !(previous.max >= width - 2 && current.min <= 2)) {
          throw new Error(`Car jumped backwards at ${step * .4}s: ${JSON.stringify({ previous, current })}`);
        }
        previous = current;
      }
      scene.tap();
      for (let step = 0; step < 80; step += 1) scene.tick(50);
      const night = canvas.toDataURL('image/png');
      scene.dispose();
      return { day, night, exits, entries, waveWraps, geometry };
    }, { source: canvasSource, width, height });
    const { windows, supports, facades, cars, cabins } = result.geometry;
    assert(windows.length > 0 && supports.length === 2 && facades.length >= 18, 'Measure actual skyline and bridge drawing');
    assert(cars.length === 1 && cabins.length === 1, 'Measure actual car body and boat cabin dimensions');
    for (const window of windows) {
      assert(Math.abs(window.height / window.width - 1.2) < .0001, 'Window proportions must stay fixed on every screen');
      if (width > height * 2) assert(window.height >= height * .01, 'Windows must remain readable in tall desktop scenes');
      assert(facades.some(facade => window.x >= facade.x && window.x + window.width <= facade.x + facade.width && window.y >= facade.y && window.y + window.height <= facade.y + facade.height), 'Every window must fit inside its facade');
    }
    for (const support of supports) assert(support.width / support.height <= .087, 'Bridge supports must keep their slender proportions');
    for (const facade of facades) assert(facade.width <= height * .162 + .0001, 'Wide screens must not stretch buildings');
    if (width === 1365) wideGeometry = result.geometry;
    if (width === 2560) {
      assert.deepEqual(cars.map(({ width, height }) => [width, height]), wideGeometry.cars.map(({ width, height }) => [width, height]), 'Car dimensions must stay unchanged across desktop scene sizes');
      assert.deepEqual(cabins.map(({ width, height }) => [width, height]), wideGeometry.cabins.map(({ width, height }) => [width, height]), 'Boat dimensions must stay unchanged across desktop scene sizes');
    }
    if (width === 2560 && height === 420) {
      assert.equal(windows[0].width, wideGeometry.windows[0].width, 'Same scene height keeps the same window size');
      assert.equal(supports[0].width, wideGeometry.supports[0].width, 'Same scene height keeps the same support width');
      assert(facades.length > wideGeometry.facades.length, 'Wider screens show more buildings');
    }
    assert(result.exits >= 2 && result.entries >= 2, 'Check multiple complete crossings and returns');
    assert(result.waveWraps > 10, 'Check waves entering from outside the scene across multiple rows');
    for (const theme of ['day', 'night']) await writeFile(join(tmpdir(), `onehtml-lab-canvas-${name}-${width}x${height}-${theme}.png`), Buffer.from(result[theme].split(',')[1], 'base64'));
  }
  console.log(`${name}: Canvas windows, buildings and supports keep their proportions on phone, desktop and ultrawide screens; road occlusion and offscreen wrapping passed.`);
}

async function libraryLabels(frame, status) {
  for (const asset of assets) {
    const button = frame.locator(`[data-mode="${asset.id}"]`);
    await button.locator('small').getByText(status, { exact: true }).waitFor();
    assert(await button.isEnabled());
    const size = await button.locator('.library-size').innerText();
    assert.match(size, /^Размер: (?:[\d\s,.]+ (?:Б|КБ)|\(нет данных\))$/);
    if (status === 'Встроена в HTML') {
      const bytes = asset.id === 'cannon' ? await frame.locator('script[type="importmap"]').evaluate((node, url) => atob(JSON.parse(node.textContent).imports[url].slice(28)).length, cannonUrl) : Buffer.byteLength('\n' + asset.source + '\n');
      assert.equal((await button.locator('.library-size').getAttribute('title')).replace(/[\u00a0\u202f]/g, ''), `${bytes} байт JS-кода; без сетевого сжатия`);
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

async function checkPreviewLayout(page, name) {
  const layout = await page.locator('html').evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    return { top: document.querySelector('header').getBoundingClientRect().top,
      bottom: header.bottom, height: innerHeight, width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflow: getComputedStyle(document.body).overflowY,
      stage: document.querySelector('#stage').getBoundingClientRect().height };
  });
  const detail = `${name}: ${JSON.stringify(layout)}`;
  assert(layout.scrollWidth <= layout.width, 'The test must not overflow horizontally: ' + detail);
  assert(layout.stage >= 64, 'Keep space for the test scene: ' + detail);
  if (layout.height > 360) {
    assert(layout.top >= 0 && layout.bottom <= layout.height + 1, 'Metrics and load controls must fit the phone preview together: ' + detail);
  } else {
    // The existing example uses scrolling below 360px to keep its scene and touch targets usable.
    assert.equal(layout.overflow, 'auto', 'A very short preview must allow vertical scrolling: ' + detail);
    assert(layout.scrollHeight > layout.height, 'The compact fallback must expose its full content: ' + detail);
    await page.locator('header').scrollIntoViewIfNeeded();
    const controls = await page.locator('html').evaluate(() => Array.from(document.querySelectorAll('.controls button, .load label, #load')).map(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, button: element.tagName === 'BUTTON' };
    }));
    assert(controls.every(control => control.top >= 0 && control.bottom <= layout.height + 1 && (!control.button || control.height >= 44)),
      'Scrolling must make all load and touch controls fully accessible: ' + JSON.stringify(controls));
    await page.locator('header').scrollIntoViewIfNeeded();
    const header = await page.locator('header').evaluate(element => ({ top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom }));
    assert(header.top >= 0 && header.bottom <= layout.height + 1, 'Metrics and library selection must remain reachable');
  }
}

async function checkCompactLayout(page, name) {
  await page.locator('#scenario').selectOption('load');
  await page.locator('#load').evaluate(field => {
    field.value = '10000';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#stage').tap({ position: { x: 30, y: 50 } });
  await page.locator('#input-time').filter({ hasText: /^До кадра: [\d\s,.]+ мс$/ }).waitFor();
  await page.locator('#pause').click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 367 });
    for (const font of ['system-ui', 'Arial, sans-serif', 'Verdana, sans-serif']) {
      await page.locator('html').evaluate((root, font) => { root.style.fontFamily = font; }, font);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header').getBoundingClientRect();
        const stage = document.querySelector('#stage').getBoundingClientRect();
        const label = document.querySelector('.load label');
        return { width: innerWidth, height: innerHeight, bottom: header.bottom, stage: stage.height,
          scrollWidth: document.documentElement.scrollWidth,
          labelWidth: label.clientWidth, labelScrollWidth: label.scrollWidth,
          controls: Array.from(document.querySelectorAll('.controls button')).map(button => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height };
          }) };
      });
      const detail = `${name}, ${font}: ${JSON.stringify(layout)}`;
      assert(layout.bottom <= layout.height + 1, 'Metrics and controls must fit with different system font metrics: ' + detail);
      assert(layout.stage >= 64, 'Keep space for the test scene: ' + detail);
      assert(layout.scrollWidth <= layout.width, 'The compact test must not overflow horizontally: ' + detail);
      assert(layout.labelScrollWidth <= layout.labelWidth + 1, 'The object count must not overlap the pause button: ' + detail);
      assert(layout.controls.every(control => control.height >= 44 && control.left >= 0 && control.right <= layout.width && control.bottom <= layout.height + 1), 'Touch controls must stay fully visible: ' + detail);
      if (width === 320 && font.startsWith('Verdana')) await page.screenshot({ path: join(tmpdir(), `onehtml-lab-performance-compact-${name}.png`) });
    }
    await page.setViewportSize({ width, height: 317 });
    await checkPreviewLayout(page, name);
  }
  console.log(`${name}: compact phone layout fits at 320/390 × 367 with three system fonts; 317px previews keep their controls accessible by scrolling.`);
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
          const isNotice = url === 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/NOTICE.md';
          assert(source || licensed || isNotice, 'Only the exact libraries, licenses and NOTICE may be requested');
          await route.fulfill({ contentType: source ? 'text/javascript' : 'text/plain',
            headers: { 'access-control-allow-origin': '*' }, body: source ? source.source : isNotice ? notice : url.includes('babylonjs@') ? apache : url.includes('cannon-es@') ? cannonLicense : license });
        });
        const page = await context.newPage();
        await useNativeEditor(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(appUrl);
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        await checkCanvasRoute(page, name);
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
        assert.equal(requests, 13, 'Download six libraries, licenses and Babylon NOTICE');
        await page.locator('#run').click();
        const frame = page.frameLocator('#preview > iframe');
        await libraryLabels(frame, 'Встроена в HTML');
        assert.equal(await frame.locator('footer').count(), 0, 'Controls and metrics belong to the compact header, without a footer');
        for (const id of ['fps', 'frame-time', 'input-time', 'tap-count', 'finger-count', 'coordinates']) {
          assert.equal(await frame.locator(`header .metrics #${id}`).count(), 1, 'Keep every metric available in the header');
        }
        for (const id of ['pause', 'reset']) {
          assert.equal(await frame.locator(`header .primary-controls #${id} svg`).count(), 1, 'Pause and reset use accessible header icons');
        }
        assert.equal(await frame.locator('#pause').getAttribute('aria-label'), 'Пауза');
        assert.equal(await frame.locator('#reset').getAttribute('aria-label'), 'Сброс');
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
        await checkPreviewLayout(frame, name);
        if (name === 'chromium') await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-performance-example.png') });
        assert.equal(await frame.locator('#load').getAttribute('max'), '10000');
        await frame.locator('#pause').click();
        assert.equal(await frame.locator('#pause').getAttribute('aria-label'), 'Продолжить');
        assert.equal(await frame.locator('#pause').getAttribute('title'), 'Продолжить');
        await frame.locator('#load').evaluate(field => {
          field.value = '10000';
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal((await frame.locator('#load-value').innerText()).replace(/\s/g, ''), '10000');
        const bounds = await frame.locator('#stage').boundingBox();
        assert(bounds && bounds.height >= 64);
        await frame.locator('#stage').tap({ position: { x: 30, y: 50 } });
        assert.equal(await frame.locator('#tap-count').innerText(), '1');
        await frame.locator('#pause').click();
        assert.equal(await frame.locator('#pause').getAttribute('aria-label'), 'Пауза');
        await frame.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
        await frame.locator('#stage').tap({ position: { x: 45, y: 60 } });
        assert.equal(await frame.locator('#tap-count').innerText(), '2');
        await frame.locator('#input-time').filter({ hasText: /^До кадра: [\d\s,.]+ мс$/ }).waitFor();
        await checkPreviewLayout(frame, name);
        if (name === 'chromium') await page.screenshot({ path: join(tmpdir(), 'onehtml-lab-performance-example.png') });
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
        assert.equal((await frame.locator('#load-value').innerText()).replace(/\s/g, ''), '10000');
        await page.locator('#run').click();
        assert.equal(requests, 13, 'Cached preview must not request external scripts');
        const embedded = await downloadHtml(page);
        assert.equal(embedded.match(/data-onehtml-bundle="1"/g)?.length, 5);
        assert.equal(embedded.match(/data-onehtml-modules="1"/g)?.length, 1);
        assert.equal(embedded.match(/Copyright \(c\) Test library authors/g)?.length, 4);
        const embeddedPath = join(scratch, name + '-embedded.html');
        await writeFile(embeddedPath, embedded);
        const saved = await context.newPage();
        await useNativeEditor(saved);
        await saved.goto(pathToFileURL(embeddedPath).href);
        await libraryLabels(saved, 'Встроена в HTML');
        assert.equal(requests, 13, 'Standalone embedded test must not request CDN resources');
        await checkCompactLayout(saved, name);
        await saved.close();
        const unchanged = await downloadHtml(page, false);
        assert.equal(unchanged.replace(/\r\n/g, '\n'), example.replace(/\r\n/g, '\n'));
        const cdnPath = join(scratch, name + '-cdn.html');
        await writeFile(cdnPath, unchanged);
        const cdn = await context.newPage();
        await useNativeEditor(cdn);
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
        assert.equal(names.length, 7);
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
        await useNativeEditor(local);
        // ES modules beside HTML require HTTP; embedded modules above run as one local file.
        await local.goto(localHost + basename(folder) + '/game.html');
        await libraryLabels(local, 'Загружена из файла');
        assert.equal(requests, beforeLocal, 'Separate libraries must load from files beside HTML');
        await local.close();
        assert.deepEqual(errors, [], 'The application and Canvas test must execute without errors');
        console.log(`${name} file: three modes, default showcase, descriptions, tower interaction, six library sizes, 10000 objects, FPS, taps and classic/module exports passed.`);
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + sep) && basename(scratch).startsWith('onehtml-lab-performance-'));
  await rm(scratch, { recursive: true, force: true });
}
await import('./phaser-versions.mjs');
await import('./three-quality.mjs');
await import('./benchmark-panel.mjs');
