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
const threeSource = await readFile(new URL('../node_modules/three/build/three.min.js', import.meta.url), 'utf8');
const threeProbe = `THREE.WebGLRenderer=new Proxy(THREE.WebGLRenderer,{construct(target,args){const renderer=Reflect.construct(target,args),render=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{window.testThree={renderer,scene,camera};return render(scene,camera)};return renderer}});`;
const fixture = example.replace(/<script src="https:[^"]+"><\/script>/g, tag => '<script>\n'
  + (tag.includes(url) ? source : tag.includes('three@0.160.0') ? threeSource + '\n' + threeProbe : '') + '\n</script>').replace(/<script type="module" id="cannon-module">[\s\S]*?<\/script>/, '');
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
    const size = (Buffer.byteLength(source) / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    assert((await page.locator('#library-request-text').innerText()).includes(`≈${size} КБ`), 'Show the known code size before requesting any download');
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
      materials: scene.meshes.map(mesh => ({ name: mesh.material?.name, texture: !!mesh.material?.albedoTexture, reflection: mesh.material?.environmentIntensity,
        metallic: mesh.material?.metallic, roughness: mesh.material?.roughness })), objects: document.querySelector('#scene').dataset.babylonObjects };
  });
}

async function roverState(page, kind) {
  return page.evaluate(kind => {
    const B = BABYLON, three = window.testThree, scene = kind === 'babylon' ? B.EngineStore.LastCreatedScene : three.scene;
    const camera = kind === 'babylon' ? scene.activeCamera : three.camera, renderer = kind === 'babylon' ? scene.getEngine() : three.renderer;
    if (kind === 'three') renderer.render(scene, camera); // Read before the browser clears this renderer's drawing buffer.
    const gl = kind === 'babylon' ? renderer._gl : renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const project = point => {
      if (kind === 'babylon') { const p = B.Vector3.Project(new B.Vector3(...point), B.Matrix.Identity(), scene.getTransformMatrix(), new B.Viewport(0, 0, w, h)); return [p.x, h - p.y]; }
      const p = new THREE.Vector3(...point).project(camera); return [(p.x + 1) * w / 2, (p.y + 1) * h / 2];
    };
    const pixel = point => { const [x, y] = project(point), rgb = new Uint8Array(4); gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgb); return [...rgb].slice(0, 3); };
    const meshes = [], groups = [], lights = [];
    if (kind === 'babylon') { meshes.push(...scene.meshes); groups.push(...scene.transformNodes); lights.push(...scene.lights); }
    else scene.traverse(item => { if (item.isMesh) meshes.push(item); if (item.isGroup) groups.push(item); if (item.isLight) lights.push(item); });
    const list = (vector, digits = 5) => [vector.x, vector.y, vector.z].map(value => Number(value.toFixed(digits)));
    return { camera: list(camera.position), groups: groups.map(item => [...list(item.position), ...list(item.rotation)]).sort((a, b) => a.join(',').localeCompare(b.join(','))),
      meshes: meshes.length, vertices: meshes.reduce((sum, item) => sum + (kind === 'babylon' ? item.getTotalVertices() : item.geometry.attributes.position.count), 0),
      lights: lights.map(item => { const color = kind === 'babylon' ? item.diffuse : item.color; return [item.intensity, color.r, color.g, color.b]; }),
      paint: pixel([0, 1.4, 1.305]), roof: pixel([.35, 1.705, .65]) };
  }, kind);
}

async function compareRovers(page) {
  const settle = async () => {
    await page.waitForFunction(() => { const canvas = document.querySelector('#scene canvas:not(.three-still)'), host = document.querySelector('#scene'); return canvas && Math.abs(canvas.width - host.clientWidth) <= 1 && Math.abs(canvas.height - host.clientHeight) <= 1; });
  };
  const switchRover = async kind => {
    await page.locator('#three-expand').click();
    await page.locator(`[data-mode="${kind}"]`).click();
    await page.locator('#three-expand').click();
    await settle();
  };
  await page.locator('#three-expand').click();
  await settle();
  for (const quality of ['simple', 'detailed']) {
    await page.locator(`[data-quality="${quality}"]`).click(); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal(await page.locator('#scene').getAttribute('data-babylon-contacts'), String(quality === 'detailed'), 'Contact postprocessing is only enabled in detailed quality on the test GPU');
    const babylon = await roverState(page, 'babylon');
    await switchRover('three160');
    assert.equal(await page.locator(`[data-quality="${quality}"]`).getAttribute('aria-pressed'), 'true');
    const three = await roverState(page, 'three');
    assert.deepEqual(three.camera, babylon.camera, 'Changing the renderer on pause preserves the exact orbit');
    assert.deepEqual(three.groups, babylon.groups, 'The rover pose, wheels, wings and moving mechanisms must match');
    assert.equal(three.lights.length, babylon.lights.length);
    assert(three.lights.every((light, index) => light.every((value, component) => Math.abs(value - babylon.lights[index][component]) < .015)), 'Both renderers must use comparable linear light colors and intensities');
    assert.equal(three.meshes, babylon.meshes, 'Both renderers use the same model parts');
    assert(Math.abs(three.vertices - babylon.vertices) / three.vertices < .15, 'Primitive tessellation must be comparable for meaningful FPS');
    if (quality === 'simple') {
      for (const [name, color] of [['Three', three.paint], ['Babylon', babylon.paint]]) assert(color[0] > color[1] * 1.2 && color[1] > color[2] * 1.2, `${name}: orange paint must retain its color rather than clip to white: ${color}`);
      assert(three.paint.every((value, index) => Math.abs(value - babylon.paint[index]) < 40), 'The same simple paint must look comparable');
      assert(three.roof.every((value, index) => Math.abs(value - babylon.roof[index]) < 40), 'The simple metal roof must also retain comparable brightness');
    }
    await page.locator('#three-hints').click();
    await switchRover('babylon'); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal(await page.locator('#three-hints').getAttribute('aria-pressed'), 'true', 'Hints stay active in the other renderer');
    assert.deepEqual((await roverState(page, 'babylon')).camera, babylon.camera);
    assert.match(await page.locator('.three-hint-caption').innerText(), /Babylon\.js/);
    const circles = await page.locator('.three-hint-overlay circle').evaluateAll(elements => elements.map(element => ({ visible: getComputedStyle(element.parentElement).visibility !== 'hidden', x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) })));
    assert(circles.filter(item => item.visible).length >= 3 && circles.every(item => Number.isFinite(item.x) && Number.isFinite(item.y)), 'Project arrows onto visible material and texture features');
    const frozen = await roverState(page, 'babylon'); await page.waitForTimeout(100); assert.deepEqual((await roverState(page, 'babylon')).groups, frozen.groups, 'Hints freeze the animation');
    if (quality === 'detailed') {
      await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.postProcessRenderPipelineManager.supportedPipelines.some(p => p.name === 'rover-contacts' && p.isReady()));
      const effect = await page.evaluate(() => {
        const scene = BABYLON.EngineStore.LastCreatedScene, engine = scene.getEngine(), gl = engine._gl;
        const pipeline = scene.postProcessRenderPipelineManager.supportedPipelines.find(p => p.name === 'rover-contacts'), strength = pipeline.totalStrength;
        const frame = () => { scene.render(); scene.render(); const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data); return data; };
        let result;
        try { pipeline.totalStrength = 0; const plain = frame(); pipeline.totalStrength = strength; const contact = frame(); let darker = 0, brighter = 0;
          for (let i = 0; i < plain.length; i += 4) { const delta = contact[i] + contact[i + 1] + contact[i + 2] - plain[i] - plain[i + 1] - plain[i + 2]; if (delta < -6) darker++; if (delta > 6) brighter++; }
          result = { darker, brighter, pixels: plain.length / 4 };
        } finally { pipeline.totalStrength = strength; scene.render(); }
        return result;
      });
      assert(effect.darker > 20 && effect.brighter < effect.pixels * .01, 'SSAO must visibly darken contacts without brightening or recoloring the model: ' + JSON.stringify(effect));
    }
    await page.locator('#three-hints').click();
  }
  await page.locator('#three-expand').click();
  await settle();
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
    assert(simple.materials.every(m => m.name.startsWith('simple-') && !m.texture && m.reflection === 0 && m.metallic === 0 && m.roughness === 1), 'Simple materials have no textures, metal highlights or environment reflections');
    await page.locator('[data-quality="detailed"]').click(); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal((await rendered(page)).textures, detailed.textures, 'Quality toggles reuse textures');
    await compareRovers(page);
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
    await page.evaluate(() => { const original = BABYLON.SSAO2RenderingPipeline; window.restoreContacts = () => { BABYLON.SSAO2RenderingPipeline = original; }; BABYLON.SSAO2RenderingPipeline = new Proxy(original, { get(target, key) { return key === 'IsSupported' ? false : Reflect.get(target, key); } }); });
    await page.locator('[data-mode="babylon"]').click(); await page.waitForFunction(() => BABYLON.EngineStore.LastCreatedScene.isReady());
    assert.equal(await page.locator('#scene').getAttribute('data-babylon-contacts'), 'false', 'An unavailable effect must keep the base Babylon scene');
    await page.locator('#three-hints').click();
    if (await page.locator('#three-hints').getAttribute('aria-pressed') !== 'true') await page.locator('#three-hints').click();
    await page.locator('#three-expand').click();
    assert.match(await page.locator('.three-hint-caption').innerText(), /без SSAO/);
    await page.locator('[data-quality="simple"]').click(); assert((await rendered(page)).shades > 100);
    await page.locator('#three-expand').click(); await page.locator('[data-mode="canvas"]').click(); await page.evaluate(() => window.restoreContacts());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Procedural model, textures and shaders must work offline');
  } catch (error) { failed = true; throw error; } finally { await context.close(); }
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const location of [appUrl.href, `http://127.0.0.1:${server.address().port}/`]) { const start = performance.now(); await appCase(browser, location); console.log(`${name} ${new URL(location).protocol}: Babylon exports/import/cache passed (${((performance.now() - start) / 1000).toFixed(1)} s).`); }
      for (const location of [pathToFileURL(join(scratch, 'example.html')).href, `http://127.0.0.1:${server.address().port}/example`]) { const start = performance.now(); await sceneCase(browser, location); console.log(`${name} ${new URL(location).protocol}: matched 3D views, hints, simple materials, Babylon scenes/10000 objects/disposal passed (${((performance.now() - start) / 1000).toFixed(1)} s).`); }
      console.log(`${name}: real Babylon core, Apache notices, download/local import, offline cache, standalone/adjacent export, shortening and all three example scenes passed.`);
    } finally { await browser.close(); }
  }
} catch (error) { failed = true; console.error('Babylon artifacts: ' + scratch); throw error; }
finally { await new Promise(resolve => server.close(resolve)); if (!failed) await rm(scratch, { recursive: true, force: true }); }
