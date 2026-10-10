import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const url = 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/babylon.js';
const source = await readFile(new URL('../node_modules/babylonjs/babylon.js', import.meta.url), 'utf8');
const license = (await readFile(new URL('../node_modules/babylonjs/license.md', import.meta.url), 'utf8')).trim();
const notice = (await readFile(new URL('../node_modules/babylonjs/NOTICE.md', import.meta.url), 'utf8')).trim();
for (const [name, text] of [['LICENSE', license], ['NOTICE', notice]]) {
  const committed = await readFile(new URL(`../docs/licenses/babylonjs-9.30.0-${name}.txt`, import.meta.url), 'utf8');
  assert.equal(committed.trim().replace(/\r\n/g, '\n'), text.replace(/\r\n/g, '\n'), 'Preserve the actual package notice without edits');
}
const appUrl = new URL('../onehtml-lab.html', import.meta.url), app = await readFile(appUrl);
const example = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
const fixture = example.replace(/<script src="https:[^"]+"><\/script>/g, tag => tag.includes(url) ? '<script>\n' + source + '\n</script>' : '<script></script>');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-babylon-'));
await writeFile(join(scratch, 'example.html'), fixture);
const server = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(request.url === '/example' ? fixture : app));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length);
const game = `<!doctype html><script src="${url}"></script><output id="result"></output><script>result.textContent=BABYLON.Engine.Version;</script>`;
const clean = text => text.replace(/\r\n/g, '\n');
let failed = false;

async function conversion(page, mode) {
  await page.locator('#library-extract-open').click();
  await page.locator(`[data-library-mode="${mode}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#library-extract-apply').disabled);
  await page.locator('#library-extract-apply').click();
  await page.locator('#library-extraction').waitFor({ state: 'hidden' });
  return page.locator('#code').inputValue();
}
async function preview(page) {
  await page.locator('#run').click();
  await page.frameLocator('#preview > iframe').locator('#result').getByText('9.30.0', { exact: true }).waitFor();
  await page.locator('#run').click();
}
async function appCase(browser, location) {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, acceptDownloads: true });
  let requests = 0, offline = false;
  await context.route('https://**/*', route => {
    requests++;
    if (offline) return route.abort();
    const response = { [url]: source, [url.replace('babylon.js', 'license.md')]: license, [url.replace('babylon.js', 'NOTICE.md')]: notice }[route.request().url()];
    assert(response, 'Only the pinned engine and notices may be downloaded');
    return route.fulfill({ body: response, headers: { 'access-control-allow-origin': '*' }, contentType: route.request().url() === url ? 'text/javascript' : 'text/plain' });
  });
  try {
    const page = await context.newPage(); await useNativeEditor(page); page.setDefaultTimeout(15000);
    await page.goto(location); await page.waitForFunction(() => !document.querySelector('#code').disabled);
    await page.locator('#expert-toggle').click();
    await page.locator('#ai-open').click(); await page.locator('#ai-task').fill('Марсоход собирает камни');
    await page.locator('#ai-game-options summary').click();
    await page.locator('#ai-game-dimension').selectOption('3d'); await page.locator('#ai-game-basis').selectOption('babylon');
    await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
    assert.match(await page.locator('#ai-output').inputValue(), /babylonjs@9\.30\.0/);
    await page.locator('#ai-close').click(); await page.locator('#code').fill(game);
    await page.locator('#run').click(); await page.locator('#library-request').waitFor({ state: 'visible' });
    assert.equal(requests, 0); await page.locator('#library-download').click();
    await page.locator('#library-request').waitFor({ state: 'hidden' }); assert.equal(requests, 3);
    assert.equal(await page.locator('#code').inputValue(), game, 'Preview preparation never changes code');
    offline = true; await preview(page); assert.equal(requests, 3);
    const event = page.waitForEvent('download'); await page.locator('#save').click(); await page.locator('#confirm-save').click();
    const embedded = await readFile(await (await event).path(), 'utf8');
    assert(clean(embedded).includes(clean(license)) && clean(embedded).includes(clean(notice)));
    assert(clean(embedded).includes(clean(source))); assert(embedded.includes('Apache-2.0'));
    assert.equal(await page.locator('#code').inputValue(), game);
    const file = join(scratch, 'standalone.html'); await writeFile(file, embedded);
    const standalone = await context.newPage(); await standalone.goto(pathToFileURL(file).href);
    await standalone.locator('#result').getByText('9.30.0', { exact: true }).waitFor(); await standalone.close();
    await page.locator('#code').fill(embedded);
    const relative = await conversion(page, 'files'); assert(relative.includes('./babylon-9.30.0.js'));
    await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено'); await page.reload();
    await page.waitForFunction(() => !document.querySelector('#code').disabled); await preview(page);
    const downloads = []; const collect = download => downloads.push(download); page.on('download', collect);
    await page.locator('#save').click(); await page.locator('#confirm-save').click(); await page.locator('#save-files').waitFor({ state: 'visible' });
    for (const button of await page.locator('#save-file-list button').all()) {
      const name = await button.innerText(); if (!downloads.some(download => download.suggestedFilename() === name)) { const event = page.waitForEvent('download'); await button.click(); await event; }
    }
    const js = downloads.find(download => download.suggestedFilename() === 'babylon-9.30.0.js'); assert(js);
    const jsText = await readFile(await js.path(), 'utf8'); assert(clean(jsText).includes(clean(license)) && clean(jsText).includes(clean(notice)));
    await page.locator('#cancel-save').click(); page.off('download', collect);
    await page.setViewportSize({ width: 1365, height: 900 }); await page.locator('#code').fill(embedded);
    const shortened = await conversion(page, 'cdn'); assert(shortened.includes(url) && shortened.length < 2000);
    await preview(page); assert.equal(requests, 3, 'Cached and extracted engines work without Internet after reload');
    // An unversioned local engine needs its own complete Apache notices.
    await page.locator('#code').fill(game.replace(url, '../vendor/babylon.js'));
    await page.locator('#run').click(); await page.locator('#library-request').waitFor({ state: 'visible' });
    await page.locator('#library-files').setInputFiles([
      { name: 'babylon.js', mimeType: 'text/javascript', buffer: Buffer.from(source) },
      { name: 'license.md', mimeType: 'text/plain', buffer: Buffer.from(license) }
    ]);
    await page.locator('#library-files-button').filter({ hasText: 'Выбрать NOTICE' }).waitFor();
    await page.locator('#library-files').setInputFiles([{ name: 'NOTICE.md', mimeType: 'text/plain', buffer: Buffer.from(notice) }]);
    await page.locator('#library-request').waitFor({ state: 'hidden' }); await preview(page);
    assert.equal(requests, 3);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await context.close(); }
}
async function rendered(page) {
  return page.evaluate(() => {
    const scene = BABYLON.EngineStore.LastCreatedScene; scene.render(); const engine = scene.getEngine(), gl = engine._gl;
    const pixels = new Uint8Array(engine.getRenderWidth() * engine.getRenderHeight() * 4);
    gl.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight(), gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let colored = 0, hash = 0; const shades = new Set();
    for (let i = 0; i < pixels.length; i += 16) { if (pixels[i] || pixels[i + 1] || pixels[i + 2]) colored++; hash = (hash * 31 + pixels[i] + pixels[i + 1] * 2 + pixels[i + 2]) | 0; shades.add(pixels[i] + ':' + pixels[i + 1] + ':' + pixels[i + 2]); }
    return { colored, shades: shades.size, hash, meshes: scene.meshes.length, textures: scene.textures.length,
      camera: scene.activeCamera.position.asArray(), lights: scene.lights.map(light => [light.name, light.intensity, ...light.diffuse.asArray()]),
      materials: scene.meshes.map(mesh => mesh.material?.getClassName()), objects: document.querySelector('#scene').dataset.babylonObjects };
  });
}
async function sceneCase(browser, location) {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true });
  const requests = [], errors = []; await context.route('https://**/*', route => { requests.push(route.request().url()); return route.abort(); });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(location); await page.locator('[data-mode="babylon"]').click();
    await page.waitForFunction(() => document.querySelector('#scene').dataset.babylonQuality === 'detailed');
    await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene?.isReady());
    await page.locator('#pause').click();
    const detailed = await rendered(page); assert(detailed.meshes > 300 && detailed.textures > 12 && detailed.shades > 100, JSON.stringify(detailed));
    await page.screenshot({ path: join(scratch, 'babylon-phone.png') });
    await page.locator('[data-quality="simple"]').click(); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    const simple = await rendered(page); assert.notEqual(simple.hash, detailed.hash);
    assert.deepEqual(simple.camera, detailed.camera); assert.deepEqual(simple.lights, detailed.lights); assert.equal(simple.meshes, detailed.meshes);
    assert(simple.materials.every(type => type === 'StandardMaterial'));
    await page.locator('[data-quality="detailed"]').click(); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal((await rendered(page)).textures, detailed.textures, 'Quality toggles reuse textures');
    await page.locator('#three-expand').click(); await page.setViewportSize({ width: 1365, height: 900 });
    await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.getEngine().getRenderWidth() >= 1365);
    await page.screenshot({ path: join(scratch, 'babylon-desktop.png') }); await page.keyboard.press('Escape');
    await page.locator('#pause').click(); await page.locator('#scene canvas').tap({ position: { x: 100, y: 100 } });
    await page.waitForFunction(before => BABYLON.EngineStore.LastCreatedScene.activeCamera.position.asArray().some((value, index) => Math.abs(value - before[index]) > .1), detailed.camera);
    await page.locator('#scenario').selectOption('compare'); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal((await rendered(page)).meshes, 14); await page.locator('#scene canvas').tap({ position: { x: 100, y: 100 } });
    await page.locator('#scenario').selectOption('load'); await page.locator('#pause').click();
    await page.locator('#load').evaluate(field => { field.value = '10000'; field.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#scene').dataset.babylonObjects === '10000');
    assert.equal((await rendered(page)).objects, '10000');
    await page.locator('[data-mode="canvas"]').click(); assert.equal(await page.evaluate(() => BABYLON.EngineStore.Instances.length), 0, 'Changing modes must free the WebGL engine');
    await page.locator('#scenario').selectOption('showcase');
    await page.evaluate(() => { const original = BABYLON.RawCubeTexture; window.restoreTexture = () => { BABYLON.RawCubeTexture = original; }; BABYLON.RawCubeTexture = class { constructor() { throw Error('texture allocation test'); } }; });
    await page.locator('[data-mode="babylon"]').click();
    assert.match(await page.locator('#message').innerText(), /texture allocation test/);
    assert.equal(await page.evaluate(() => BABYLON.EngineStore.Instances.length), 0, 'A failed scene setup must dispose the partially prepared engine');
    await page.evaluate(() => window.restoreTexture());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Procedural model, textures and shaders must work offline');
  } catch (error) { failed = true; throw error; } finally { await context.close(); }
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const location of [appUrl.href, `http://127.0.0.1:${server.address().port}/`]) { const start = performance.now(); await appCase(browser, location); console.log(`${name} ${new URL(location).protocol}: Babylon exports/import/cache passed (${((performance.now() - start) / 1000).toFixed(1)} s).`); }
      for (const location of [pathToFileURL(join(scratch, 'example.html')).href, `http://127.0.0.1:${server.address().port}/example`]) { const start = performance.now(); await sceneCase(browser, location); console.log(`${name} ${new URL(location).protocol}: Babylon scenes/materials/10000 objects/disposal passed (${((performance.now() - start) / 1000).toFixed(1)} s).`); }
      console.log(`${name}: real Babylon core, Apache notices, download/local import, offline cache, standalone/adjacent export, shortening and all three example scenes passed.`);
    } finally { await browser.close(); }
  }
} catch (error) { failed = true; console.error('Babylon artifacts: ' + scratch); throw error; }
finally { await new Promise(resolve => server.close(resolve)); if (!failed) await rm(scratch, { recursive: true, force: true }); }
