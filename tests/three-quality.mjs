import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length, 'Choose chromium or webkit');
let fixture = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../node_modules/three/build/three.min.js', import.meta.url), 'utf8');
const license = await readFile(new URL('../node_modules/three/LICENSE', import.meta.url), 'utf8');
const probe = `
window.THREE.WebGLRenderer = new Proxy(window.THREE.WebGLRenderer, { construct(target, args) {
  const renderer = Reflect.construct(target, args), render = renderer.render.bind(renderer);
  (window.testRenderers ||= []).push(renderer);
  renderer.render = (scene, camera) => { window.testThree = { renderer, scene, camera }; return render(scene, camera); };
  return renderer;
} });`;
fixture = fixture.replace('<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>',
  () => `<script>\n/*\n${license}\n*/\n${(source + probe).replace(/<\/script/gi, '<\\/script')}\n</script>`);
fixture = fixture.replace(/<script src="https:[^"]+(?:matter|phaser)[^"]*"><\/script>/g, '<script></script>');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-three-quality-'));
const file = join(scratch, 'three.html'); await writeFile(file, fixture);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fixture));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let failed = false;

async function state(page) {
  return page.evaluate(() => {
    const { renderer, scene, camera } = window.testThree, meshes = [], lights = [], materials = new Set();
    scene.traverse(item => {
      if (item.isMesh) { meshes.push([item.uuid, item.geometry.uuid, ...item.matrixWorld.elements]); materials.add(item.material); }
      if (item.isLight) lights.push([item.type, item.color.getHex(), item.intensity, ...item.position.toArray()]);
    });
    return { renderers: window.testRenderers.length, camera: [...camera.position.toArray(), ...camera.quaternion.toArray()], meshes, lights,
      materials: [...materials].map(value => ({ type: value.type, environment: !!value.envMap,
        colorMap: value.map?.name || null, relief: !!value.bumpMap, roughness: !!value.roughnessMap })), shadows: renderer.shadowMap.enabled };
  });
}
const world = ({ renderers, camera, meshes, lights }) => ({ renderers, camera, meshes, lights });
async function frame(page) {
  return page.evaluate(() => {
    const { renderer, scene, camera } = window.testThree;
    renderer.render(scene, camera);
    const gl = renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    (window.testFrames ||= []).push(pixels); return window.testFrames.length - 1;
  });
}
async function geometry(page) {
  const result = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    footer: document.querySelector('footer').getBoundingClientRect().bottom, stage: document.querySelector('#stage').clientHeight,
    buttons: Array.from(document.querySelectorAll('.controls button, #three-quality button')).map(button => {
      const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, bottom: r.bottom };
    }) }));
  assert(result.scrollWidth <= result.width && result.stage >= 64, JSON.stringify(result));
  if (result.height > 360) assert(result.footer <= result.height + 1, JSON.stringify(result));
  assert(result.buttons.every(r => r.left >= 0 && r.right <= result.width + 1 && r.height >= 44), JSON.stringify(result));
}
async function shadowHint(page) {
  const changed = await page.evaluate(() => {
    const { renderer, scene, camera } = window.testThree, gl = renderer.getContext();
    const circle = document.querySelector('.three-hint-overlay g:last-child circle'), bounds = renderer.domElement.getBoundingClientRect();
    const scale = gl.drawingBufferWidth / bounds.width, size = Math.round(24 * scale);
    const x = Math.max(0, Math.min(gl.drawingBufferWidth - size, Math.round((Number(circle.getAttribute('cx')) - 12) * scale)));
    const y = Math.max(0, Math.min(gl.drawingBufferHeight - size, Math.round(gl.drawingBufferHeight - (Number(circle.getAttribute('cy')) + 12) * scale)));
    const pixels = [];
    const updateMaterials = () => scene.traverse(item => { if (item.isMesh) item.material.needsUpdate = true; });
    for (const enabled of [true, false]) {
      renderer.shadowMap.enabled = enabled; updateMaterials(); renderer.render(scene, camera);
      const values = new Uint8Array(size * size * 4); gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, values); pixels.push(values);
    }
    renderer.shadowMap.enabled = true; updateMaterials(); renderer.render(scene, camera);
    let changed = 0;
    for (let i = 0; i < pixels[0].length; i += 4) if ([0, 1, 2].some(c => Math.abs(pixels[0][i + c] - pixels[1][i + c]) > 5)) changed++;
    return changed;
  });
  assert(changed > 10, 'The shadow callout must point to a real visible shadow, not an unlit surface: ' + changed);
}
async function textureEffects(page) {
  const result = await page.evaluate(() => {
    const { renderer, scene, camera } = window.testThree, materials = new Set(), textures = new Set();
    scene.traverse(item => {
      if (!item.isMesh || !item.material.map) return;
      materials.add(item.material);
      for (const key of ['map', 'bumpMap', 'roughnessMap']) textures.add(item.material[key]);
    });
    const profiles = [...textures].map(texture => {
      const canvas = texture.image, data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const shades = new Set(); for (let i = 0; i < data.length; i += 4) shades.add(data[i]);
      return { name: texture.name, pixels: canvas.width * canvas.height, shades: shades.size,
        colorSpace: texture.colorSpace === (texture.name.endsWith('.color') ? THREE.SRGBColorSpace : THREE.NoColorSpace),
        repeat: texture.wrapS === THREE.RepeatWrapping && texture.wrapT === THREE.RepeatWrapping,
        anisotropy: texture.anisotropy <= Math.min(4, renderer.capabilities.getMaxAnisotropy()) };
    });
    window.testSurfaceTextures = [...textures].map(texture => {
      const resource = { texture, disposed: 0 }; texture.addEventListener('dispose', () => resource.disposed++); return resource;
    });
    const gl = renderer.getContext(), read = () => {
      renderer.render(scene, camera);
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels;
    };
    const original = read(), maps = [...materials].map(material => [material, material.map, material.bumpMap, material.roughnessMap]);
    const changed = pixels => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if ([0, 1, 2].some(c => Math.abs(pixels[i + c] - original[i + c]) > 5)) count++;
      return count / (pixels.length / 4);
    };
    let plain, flat;
    try {
      for (const [material] of maps) { material.map = material.bumpMap = material.roughnessMap = null; material.needsUpdate = true; }
      plain = changed(read());
      for (const [material, color, , roughness] of maps) { material.map = color; material.roughnessMap = roughness; material.needsUpdate = true; }
      flat = changed(read());
    } finally {
      for (const [material, color, bump, roughness] of maps) {
        material.map = color; material.bumpMap = bump; material.roughnessMap = roughness; material.needsUpdate = true;
      }
      read();
    }
    return { profiles, plain, flatPixels: flat * gl.drawingBufferWidth * gl.drawingBufferHeight,
      physicalPaint: [...materials].some(material => material.map.name === 'paint.color' && material.clearcoat > 0),
      allocated: renderer.info.memory.textures };
  });
  assert.equal(result.profiles.length, 18, 'Six shared surface sets need only three small maps each');
  assert.deepEqual(result.profiles.map(value => value.name).sort(), ['paint', 'metal', 'rubber', 'solar', 'soil', 'rock']
    .flatMap(kind => ['color', 'height', 'roughness'].map(role => kind + '.' + role)).sort());
  assert(result.profiles.every(value => value.colorSpace && value.repeat && value.anisotropy && value.shades > 1));
  assert(result.profiles.reduce((sum, value) => sum + value.pixels, 0) <= 450000, 'Texture resolution must remain small for phones');
  assert(result.physicalPaint, 'Paint uses the agreed restrained reflective coating');
  assert(result.plain > .008, 'Textures must visibly change the rendered surfaces with identical light and geometry: ' + result.plain);
  assert(result.flatPixels > 40, 'Height maps must visibly change lighting without moving vertices: ' + result.flatPixels);
  return result.allocated;
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of [pathToFileURL(file).href, `http://127.0.0.1:${server.address().port}/`]) {
        for (const width of [320, 1365]) {
          const context = await browser.newContext({ viewport: { width, height: width === 320 ? 720 : 900 }, hasTouch: width === 320 });
          const page = await context.newPage(), errors = [], requests = [];
          page.on('pageerror', error => errors.push(error.message));
          await context.route('https://**/*', route => { requests.push(route.request().url()); return route.abort(); });
          try {
            await page.goto(url);
            await page.locator('[data-mode="three160"]').click();
            await page.waitForFunction(() => window.testThree?.scene.children.length);
            await geometry(page);
            assert.equal(await page.locator('[data-quality="detailed"]').getAttribute('aria-pressed'), 'true');
            assert(await page.locator('#phaser-renderer').isHidden());
            const beforeInput = (await state(page)).camera;
            const canvas = page.locator('#scene canvas:not(.three-still)'), bounds = await canvas.boundingBox();
            if (width === 320) await canvas.tap({ position: { x: bounds.width * .15, y: bounds.height * .58 } });
            else {
              await page.mouse.move(bounds.x + bounds.width * .15, bounds.y + bounds.height * .58); await page.mouse.down();
              await page.mouse.move(bounds.x + bounds.width * .17, bounds.y + bounds.height * .57); await page.mouse.up();
            }
            await page.waitForFunction(before => window.testThree.camera.position.toArray().some((value, i) => Math.abs(value - before[i]) > .02), beforeInput);
            await page.locator('#pause').click();
            assert(await page.locator('.three-still').isVisible(), 'Paused WebGL needs a stable visible frame');
            const detailed = await state(page), detailedFrame = await frame(page);
            assert(detailed.shadows && detailed.materials.some(value => value.type === 'MeshPhysicalMaterial' && value.environment));
            const allocated = await textureEffects(page);
            assert.deepEqual(await state(page), detailed, 'Isolated texture checks restore all scene materials');
            await page.locator('[data-quality="simple"]').click();
            const simple = await state(page), simpleFrame = await frame(page);
            const painted = await page.locator('.three-still').evaluate(canvas => {
              const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let opaque = 0;
              for (let i = 3; i < data.length; i += 4) if (data[i]) opaque++;
              return opaque / (data.length / 4);
            });
            assert(painted > .99, 'The paused snapshot must contain the actual scene, including in WebKit');
            assert.deepEqual(world(simple), world(detailed), 'Quality must preserve geometry, camera, animation and light sources');
            assert(!simple.shadows && simple.materials.every(value => value.type === 'MeshLambertMaterial' && !value.environment
              && !value.colorMap && !value.relief && !value.roughness), 'Simple quality keeps its original untextured surfaces');
            const changed = await page.evaluate(([a, b]) => {
              const simple = window.testFrames[a], detailed = window.testFrames[b]; let changed = 0;
              for (let i = 0; i < simple.length; i += 4) if ([0, 1, 2].some(c => Math.abs(simple[i + c] - detailed[i + c]) > 12)) changed++;
              return changed / (simple.length / 4);
            }, [simpleFrame, detailedFrame]);
            assert(changed >= .025, 'Materials and shadows must visibly change the real rendered scene');
            const instance = simple.renderers;
            await page.locator('[data-quality="simple"]').click();
            assert.deepEqual(await state(page), simple, 'Selecting the same quality is inert');
            await page.locator('[data-quality="detailed"]').click();
            assert.deepEqual(await state(page), detailed, 'Restoring detailed quality restores the original materials');
            assert.equal(await page.evaluate(() => window.testThree.renderer.info.memory.textures), allocated, 'Quality switching reuses the generated maps');
            await page.locator('#three-hints').click();
            assert.equal(await page.locator('#three-hints').getAttribute('aria-pressed'), 'true');
            assert.match(await page.locator('.three-hint-caption').innerText(), /Подробное/);
            assert.equal(await page.locator('.three-hint-overlay text:visible').count(), 4, await page.locator('.three-hint-overlay g').evaluateAll(groups => JSON.stringify(groups.map(group => ({ visibility: getComputedStyle(group).visibility, circle: group.querySelector('circle').outerHTML })))));
            await page.locator('[data-quality="simple"]').click();
            assert.match(await page.locator('.three-hint-caption').innerText(), /без текстур, отражений и теней/);
            assert.deepEqual(world(await state(page)), world(detailed));
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true', 'Closing hints must preserve user pause');
            await page.locator('#pause').click();
            await page.waitForFunction(() => /^\d/.test(document.querySelector('#fps').textContent));
            await page.locator('#three-hints').click();
            const frozen = world(await state(page));
            await page.waitForTimeout(120);
            assert.deepEqual(world(await state(page)), frozen, 'Hints freeze animation without changing user pause');
            await page.locator('#three-hints').click();
            await page.waitForFunction(before => {
              const matrix = []; window.testThree.scene.traverse(item => { if (item.isMesh) matrix.push([...item.matrixWorld.elements]); });
              return matrix.some((values, i) => values.some((value, j) => value !== before[i][j]));
            }, frozen.meshes.map(value => value.slice(2)));
            assert(await page.locator('.three-still').isHidden(), 'Resuming animation must reveal the live WebGL canvas');
            await page.locator('#pause').click();
            await page.locator('#three-expand').click();
            await geometry(page);
            assert(await page.locator('#three-quality').isVisible(), 'Expanded view keeps quality selection available');
            assert.equal((await state(page)).renderers, instance, 'Expanding must resize the same renderer');
            await page.locator('[data-quality="detailed"]').click();
            await page.locator('#three-hints').click();
            await geometry(page);
            const labels = await page.locator('.three-hint-overlay g').evaluateAll(groups => groups.map(group => {
              const circle = group.querySelector('circle'); return { visible: getComputedStyle(group).visibility !== 'hidden', x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) };
            }));
            assert(labels.every(label => label.visible && label.x > 0 && label.y > 0), 'Each arrow must target a projected scene point: ' + JSON.stringify(labels));
            await shadowHint(page);
            const textureTarget = await page.evaluate(() => {
              const { renderer, scene, camera } = window.testThree, circle = document.querySelector('.three-hint-overlay g:nth-child(3) circle');
              const bounds = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
              ray.setFromCamera(new THREE.Vector2(Number(circle.getAttribute('cx')) / bounds.width * 2 - 1,
                1 - Number(circle.getAttribute('cy')) / bounds.height * 2), camera);
              const meshes = []; scene.traverse(item => { if (item.isMesh) meshes.push(item); });
              return ray.intersectObjects(meshes, false)[0]?.object.material.map?.name;
            });
            assert.equal(textureTarget, 'solar.color', 'The texture arrow must point to a visible panel surface');
            await page.screenshot({ path: join(scratch, `${name}-${url.startsWith('file:') ? 'file' : 'http'}-${width}-hints.png`) });
            await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
            assert.equal(await page.locator('#three-expand').getAttribute('aria-pressed'), 'false');
            await page.setViewportSize({ width: 320, height: 367 });
            for (const font of ['system-ui', 'Arial, sans-serif', 'Verdana, sans-serif']) {
              await page.locator('html').evaluate((root, font) => { root.style.fontFamily = font; }, font);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await geometry(page);
            }
            await page.locator('html').evaluate(root => { root.style.fontFamily = ''; });
            await page.locator('#three-hints').click();
            assert.match(await page.locator('.three-hint-caption').innerText(), /Разверните сцену/);
            await page.locator('#three-expand').click();
            await page.waitForFunction(() => !document.querySelector('.three-hint-caption').textContent.includes('Разверните'));
            await geometry(page);
            await page.locator('#three-expand').click(); await page.locator('#three-hints').click();
            await page.locator('#info-toggle').click();
            assert.match(await page.locator('#info-body').innerText(), /FPS зависит от устройства/);
            await page.locator('#info-close').click();
            await page.locator('#scenario').selectOption('compare');
            assert(await page.evaluate(() => window.testSurfaceTextures.every(resource => resource.disposed === 1)), 'Leaving the scene releases every generated map');
            assert(await page.locator('#three-quality').isHidden());
            assert.equal(await page.locator('#three-hints, #three-expand').count(), 0);
            await page.locator('#scenario').selectOption('showcase');
            assert.equal(await page.locator('[data-quality="detailed"]').getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#three-hints').getAttribute('aria-pressed'), 'false');
            await page.locator('[data-mode="canvas"]').click();
            assert(await page.locator('#three-quality').isHidden());
            assert.equal(await page.locator('#three-hints, #three-expand').count(), 0);
            assert.deepEqual(requests, [], 'The fixture and all generated scene resources are offline');
            assert.deepEqual(errors, []);
            console.log(`${name} ${url.startsWith('file:') ? 'file' : 'http'} ${width}: Three textures/relief/materials/shadows, resource reuse/disposal, unchanged model/camera/light, hints, input, FPS, resizing and compact layout passed.`);
          } catch (error) {
            failed = true; await page.screenshot({ path: join(scratch, `${name}-${width}-failure.png`) }); throw error;
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
  if (failed || process.argv.includes('--keep-screenshots')) console.log('Three screenshots: ' + scratch);
  else await rm(scratch, { recursive: true, force: true });
}
