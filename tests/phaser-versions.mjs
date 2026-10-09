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
for (const [url, folder, codePath, licensePath] of [
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'three', 'build/three.min.js', 'LICENSE'],
  ['https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js', 'matter-js', 'build/matter.min.js', 'LICENSE'],
  ['https://cdnjs.cloudflare.com/ajax/libs/phaser/3.90.0/phaser.min.js', 'phaser3', 'dist/phaser.min.js', 'LICENSE.md'],
  ['https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js', 'phaser4', 'dist/phaser.min.js', 'LICENSE.md']
]) {
  const source = await readFile(new URL(`../node_modules/${folder}/${codePath}`, import.meta.url), 'utf8');
  const license = await readFile(new URL(`../node_modules/${folder}/${licensePath}`, import.meta.url), 'utf8');
  const probe = folder.startsWith('phaser') ? `
window.Phaser.Game = new Proxy(window.Phaser.Game, { construct(target, args) {
  const game = Reflect.construct(target, args); (window.testGames ||= []).push(game); return game;
} });` : '';
  fixture = fixture.replace(`<script src="${url}"></script>`, () => `<script>\n/*\n${license}\n*/\n${(source + probe).replace(/<\/script/gi, '<\\/script')}\n</script>`);
}
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-phaser-versions-'));
const file = join(scratch, 'versions.html'); await writeFile(file, fixture);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fixture));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [pathToFileURL(file).href, `http://127.0.0.1:${server.address().port}/`];
async function scene(page, mode) {
  const before = await page.evaluate(() => window.testGames?.length || 0);
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.waitForFunction(before => window.testGames?.length > before && window.testGames.at(-1).scene.getScenes(true)[0]?.children.list.length, before);
  assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
  return page.evaluate(() => {
    const game = window.testGames.at(-1), s = game.scene.getScenes(true)[0];
    return { x: s.player?.x, coins: s.coins?.getLength(), enemies: s.enemies?.getLength(),
      health: s.health, checkpoint: s.checkpoint, renderer: game.renderer.type };
  });
}
async function geometry(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await page.locator('.controls button').evaluateAll(nodes => JSON.stringify(nodes.map(n => ({ id: n.id, text: n.textContent, width: n.getBoundingClientRect().width, right: n.getBoundingClientRect().right })))));
  const controls = await page.locator('.controls button:visible, #phaser-renderer button:visible').evaluateAll(buttons => buttons.map(button => {
    const r = button.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height };
  }));
  assert(controls.every(r => r.left >= 0 && r.right <= (page.viewportSize()?.width || 0) + 1 && r.height >= 44), JSON.stringify(controls));
  if (await page.locator('#phaser-time').count()) {
    const time = await page.locator('#phaser-time').boundingBox(), hud = await page.locator('.phaser-hud').boundingBox();
    const field = await page.locator('#scene').boundingBox();
    assert(time && hud && field && time.width >= 44 && time.height >= 44 && time.x >= hud.x + hud.width &&
      time.x + time.width <= field.x + field.width && time.y + time.height <= field.y + field.height, 'Time switch must be touch-sized and separate from the HUD: ' + JSON.stringify({ time, hud, field }));
  }
}
async function controls(page, touch) {
  await page.locator('[data-phaser-action="demo"]').click();
  // The automatic demo may have advanced while a cold software renderer initialized.
  // Exercise input on the same safe stretch of ground on every engine and viewport.
  await page.evaluate(() => {
    const s = window.testGames.at(-1).scene.getScenes(true)[0];
    s.player.body.reset(110, 422); s.player.setVelocity(0, 0); s.jumps = 0;
  });
  await page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0].player.body.blocked.down);
  const x = await page.evaluate(() => window.testGames.at(-1).scene.getScenes(true)[0].player.x);
  await page.locator('#scene').focus();
  await page.keyboard.down('ArrowRight');
  try { await page.waitForFunction(x => window.testGames.at(-1).scene.getScenes(true)[0].player.x > x + 20, x); }
  finally { await page.keyboard.up('ArrowRight'); }
  await page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0].player.body.blocked.down);
  const jump = page.locator('[data-phaser-action="jump"]');
  // Observe the brief jump state before the input action; a slow click can outlast it.
  await Promise.all([
    page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0].jumps === 1),
    touch ? jump.tap() : jump.click()
  ]);
  await page.locator('#scene').focus();
  await Promise.all([
    page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0].jumps === 2),
    page.keyboard.press('Space')
  ]);
}
async function renderedFrame(page) {
  const url = await page.evaluate(() => new Promise(resolve => {
    const game = window.testGames.at(-1);
    game.renderer.snapshot(image => resolve(image.src));
    game.renderer.preRender(); game.scene.render(game.renderer); game.renderer.postRender();
  }));
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
async function worldState(page) {
  return page.evaluate(() => {
    const game = window.testGames.at(-1), s = game.scene.getScenes(true)[0];
    return { games: window.testGames.length, width: game.canvas.width, height: game.canvas.height, x: s.player.x, y: s.player.y, vx: s.player.body.velocity.x, vy: s.player.body.velocity.y,
      score: s.score, health: s.health, checkpoint: s.checkpoint, collected: s.collected, jumps: s.jumps };
  });
}
async function changeTime(page, expected, touch = false) {
  const before = await worldState(page), frame = await renderedFrame(page);
  const button = page.locator('#phaser-time');
  if (touch) await button.tap(); else await button.click();
  assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), expected);
  assert.deepEqual(await worldState(page), before, 'Day/night must not restart the level, advance physics or trigger a jump');
  const after = await renderedFrame(page);
  assert(!frame.equals(after), 'Day and night must visibly change the paused scene');
  await geometry(page);
  return after;
}
async function unchangedSky(page, before, after) {
  const changed = await page.evaluate(async sources => {
    const image = src => new Promise((resolve, reject) => {
      const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = src;
    });
    const frames = await Promise.all(sources.map(image));
    const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = Math.floor(frames[0].height * .2);
    const ctx = canvas.getContext('2d'), pixels = frames.map(frame => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    let changed = 0; const samples = [];
    // Repeated GPU blending may round a channel by one 8-bit step, especially in WebKit.
    // Changes larger than that still fail, including a filter applied over the sky.
    for (let i = 0; i < pixels[0].length; i += 4) if ([0,1,2].some(c => Math.abs(pixels[0][i+c] - pixels[1][i+c]) > 1)) {
      changed++;
      if (samples.length < 5) samples.push({ x: i / 4 % canvas.width, y: Math.floor(i / 4 / canvas.width), before: Array.from(pixels[0].slice(i, i + 4)), after: Array.from(pixels[1].slice(i, i + 4)) });
    }
    return { changed, samples };
  }, [before, after].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  if (changed.changed) {
    await writeFile(join(tmpdir(), 'onehtml-phaser-sky-before.png'), before);
    await writeFile(join(tmpdir(), 'onehtml-phaser-sky-after.png'), after);
  }
  assert.equal(changed.changed, 0, 'Local effects must preserve the sky colors and avoid a filter over the whole scene: ' + JSON.stringify(changed.samples));
}
async function visibleNightLighting(page, before, after) {
  const result = await page.evaluate(async sources => {
    const frames = await Promise.all(sources.map(src => new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(image); image.src = src;
    })));
    const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = frames[0].height;
    const ctx = canvas.getContext('2d'), pixels = frames.map(frame => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    let changed = 0, count = 0;
    for (let y = Math.floor(canvas.height * .4); y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if ([0, 1, 2].reduce((sum, c) => sum + Math.abs(pixels[0][i + c] - pixels[1][i + c]), 0) >= 24) changed++;
      count++;
    }
    return changed / count;
  }, [before, after].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  assert(result >= .05, `Night lighting must clearly change the foreground, not just a few tiny bulbs: ${(result * 100).toFixed(1)}%`);
}
async function lightingInputs(page) {
  return page.evaluate(() => {
    const s = window.testGames.at(-1).scene.getScenes(true)[0], v = s.visuals;
    s.updateNightEffects(0);
    const surface = key => {
      const t = s.textures.get(key);
      return [t.source[0].image.toDataURL(), t.dataSource[0].image.toDataURL()];
    };
    return {
      materials: ['station-metal', 'station-stone'].map(surface),
      objects: s.surfaces.map(item => [item.x, item.y, item.displayWidth, item.displayHeight, item.texture.key]),
      fixtures: s.stationLamps.map(item => [item.x, item.y, item.bulb.width, item.bulb.height, item.bulb.fillColor]),
      lights: v.webgl ? [v.follow, v.station, v.checkpointLight, ...v.stationLights].map((light, index) => [
        index === 0 ? 'robot' : light.x, index === 0 ? 'robot' : light.y, light.radius, light.color.r, light.color.g, light.color.b, light.intensity]) : [],
      ambient: v.webgl ? [s.lights.ambientColor.r, s.lights.ambientColor.g, s.lights.ambientColor.b] : [],
      counts: [v.lamps.length, v.halos.length, v.lanternEffects.length, v.motes.length],
      beam: [v.beam.displayWidth, v.beam.displayHeight, v.beam.tintTopLeft, v.beam.alpha],
      ground: s.ground.getChildren().map(item => [item.x, item.y, item.displayWidth, item.displayHeight])
    };
  });
}
async function chooseRenderer(page, value) {
  const before = await page.evaluate(() => window.testGames.length);
  const button = page.locator(`#phaser-renderer [data-renderer="${value}"]`);
  if (page.viewportSize().width === 320) await button.tap(); else await button.click();
  await page.waitForFunction(before => window.testGames.length > before && window.testGames.at(-1).scene.getScenes(true)[0], before);
  assert.equal(await page.locator('#scene').getAttribute('data-phaser-renderer'), value);
  assert.equal(await rendererChoice(page), value);
  assert.equal(await page.evaluate(() => window.testGames.at(-1).renderer.type), value === 'canvas' ? 1 : 2);
  const active = await page.evaluate(() => window.testGames.length);
  await button.click();
  assert.equal(await page.evaluate(() => window.testGames.length), active, 'Pressing the already selected renderer must preserve the running level');
  await geometry(page);
}
async function rendererChoice(page) {
  return page.locator('#phaser-renderer [aria-pressed="true"]').getAttribute('data-renderer');
}
async function visibleSurfaceShadows(page, before, after, label = 'Native self-shadowing') {
  const ratio = await page.evaluate(async sources => {
    const s = window.testGames.at(-1).scene.getScenes(true)[0], camera = s.cameras.main;
    const wall = s.surfaces[0].getBounds(), a = { x: (wall.x - camera.worldView.x) * camera.zoom, y: (wall.y - camera.worldView.y) * camera.zoom };
    const b = { x: (wall.right - camera.worldView.x) * camera.zoom, y: (wall.bottom - camera.worldView.y) * camera.zoom };
    const frames = await Promise.all(sources.map(src => new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(image); image.src = src;
    })));
    const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = frames[0].height;
    const ctx = canvas.getContext('2d'), pixels = frames.map(frame => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, 0, 0); return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    });
    let count = 0, changed = 0;
    for (let y = Math.max(0, Math.ceil(a.y)); y < Math.min(canvas.height, b.y); y++) for (let x = Math.max(0, Math.ceil(a.x)); x < Math.min(canvas.width, b.x); x++) {
      const i = (y * canvas.width + x) * 4;
      if ([0, 1, 2].reduce((sum, c) => sum + Math.abs(pixels[0][i + c] - pixels[1][i + c]), 0) >= 24) changed++;
      count++;
    }
    return count ? changed / count : 0;
  }, [before, after].map(buffer => 'data:image/png;base64,' + buffer.toString('base64')));
  assert(ratio >= .1, `${label} must visibly change the actual panel: ${(ratio * 100).toFixed(1)}%`);
  console.log(`  ${label} changes ${(ratio * 100).toFixed(1)}% of visible panel pixels.`);
}
async function hintView(page, name, protocol, width) {
  await scene(page, 'phaser');
  if (await page.locator('#pause').getAttribute('aria-pressed') !== 'true') await page.locator('#pause').click();
  const before = await worldState(page);
  const cameraBefore = await page.evaluate(() => {
    const c = window.testGames.at(-1).scene.getScenes(true)[0].cameras.main;
    return { x: c.scrollX, y: c.scrollY, zoom: c.zoom, bounds: c.useBounds };
  });
  await page.locator('#phaser-hints').click();
  assert.equal(await page.locator('#phaser-hints').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await worldState(page), before, 'Hint mode must preserve physics, score, selected pause and the game instance');
  assert(await page.locator('.phaser-hint-overlay').isVisible());
  assert.match(await page.locator('.phaser-hint-caption').innerText(), /Phaser 3.*пазы светлее/);
  const inputs3 = await lightingInputs(page), frame3 = await renderedFrame(page);
  await geometry(page);
  assert(await page.locator('.phaser-hint-overlay ellipse').evaluate(node => {
    const r = node.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
    return r.width >= 40 && r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom;
  }), 'The annotation must point to a large visible part of the real panel');
  await page.screenshot({ path: join(tmpdir(), `onehtml-phaser3-${name}-${protocol}-${width}-hints.png`) });
  await page.locator('#phaser-hints').click();
  assert.deepEqual(await worldState(page), before);
  assert.deepEqual(await page.evaluate(() => {
    const c = window.testGames.at(-1).scene.getScenes(true)[0].cameras.main;
    return { x: c.scrollX, y: c.scrollY, zoom: c.zoom, bounds: c.useBounds };
  }), cameraBefore, 'Leaving hint mode must restore the exact original camera');
  assert(await page.locator('.phaser-hint-overlay').isHidden());
  await page.locator('#phaser-hints').click();
  await scene(page, 'phaser4');
  assert.equal(await page.locator('#phaser-hints').getAttribute('aria-pressed'), 'true', 'Hints must carry over between engines');
  assert.match(await page.locator('.phaser-hint-caption').innerText(), /Phaser 4.*тень в пазу/);
  assert.deepEqual(await lightingInputs(page), inputs3, 'Both magnified views must use the same materials, fixed lights, ambient light and decorations');
  const frame4 = await renderedFrame(page);
  await writeFile(join(tmpdir(), `onehtml-phaser3-${name}-${width}-detail.png`), frame3);
  await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-detail.png`), frame4);
  await page.screenshot({ path: join(tmpdir(), `onehtml-phaser4-${name}-${protocol}-${width}-hints.png`) });
  await visibleSurfaceShadows(page, frame3, frame4, 'Phaser 3 vs 4');
  const held = await worldState(page);
  await page.locator('#scene').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await worldState(page), held, 'Hint mode must keep the game frozen and ignore movement/jump input');
  await page.locator('#phaser-time').click();
  assert.match(await page.locator('.phaser-hint-caption').innerText(), /Днём.*разница мала/);
  assert(await page.locator('.phaser-hint-overlay > svg').evaluate(node => getComputedStyle(node).visibility === 'hidden'));
  await page.locator('#phaser-time').click();
  await chooseRenderer(page, 'canvas');
  assert.match(await page.locator('.phaser-hint-caption').innerText(), /Canvas.*почти одинаково/);
  assert.equal(await page.locator('#phaser-hints').getAttribute('aria-pressed'), 'true');
  await chooseRenderer(page, 'webgl');
  await page.locator('#info-toggle').click();
  const guide = await page.locator('#info-body').innerText();
  assert.match(guide, /WebGL.*видеоускоритель/);
  assert.match(guide, /Canvas.*небольшой игры.*WebGL недоступен/s);
  assert.match(guide, /Рекомендация.*Phaser 4 \+ WebGL.*Phaser 3.*оставить на 3/s);
  await page.locator('#info-close').click();
  assert.equal(await page.locator('#phaser-hints').getAttribute('aria-pressed'), 'true');
  await page.locator('#scene').focus(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#phaser-hints').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true', 'Closing hints must respect the existing pause');
  await page.locator('#pause').click();
  await page.locator('#phaser-hints').click();
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false', 'Hints must not change the user pause setting');
  const live = await worldState(page);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await worldState(page), live, 'Hints must stop a running game as well as a manually paused game');
  await page.locator('#phaser-hints').click();
  await page.waitForFunction(x => window.testGames.at(-1).scene.getScenes(true)[0].player.x !== x, live.x);
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch(name === 'chromium' ? { args: ['--use-angle=swiftshader'] } : {});
    try {
      for (const url of urls) for (const width of [320, 1365]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width === 320 });
        const page = await context.newPage(), errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('https://**/*', route => { requests.push(route.request().url()); return route.abort(); });
        try {
          await page.goto(url);
          assert.equal(await page.locator('.mode').count(), 5);
          assert.equal(await page.locator('#info-toggle').innerText(), '?');
          const base = await scene(page, 'phaser');
          assert.equal(base.coins, 25); assert.equal(base.enemies, 5); assert.equal(base.health, 3); assert.equal(base.checkpoint, 110);
          assert.equal(base.renderer, 2, 'Both versions start with the same WebGL renderer');
          assert.equal(await page.locator('#phaser-effects').count(), 1);
          assert.equal(await rendererChoice(page), 'webgl');
          assert.equal(await page.locator('#phaser-renderer button').count(), 2);
          assert.equal(await page.locator('#phaser-renderer select').count(), 0);
          assert.match(await page.locator('#library-description').innerText(), /панелей/);
          assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), 'night', 'Both versions start at night');
          await geometry(page);
          await controls(page, width === 320);
          await page.locator('#pause').click();
          const baseNight = await renderedFrame(page);
          await page.locator('#phaser-effects').click();
          assert.match(await page.locator('#library-description').innerText(), /включите эффекты/i);
          const baseWithoutEffects = await renderedFrame(page);
          await unchangedSky(page, baseNight, baseWithoutEffects);
          await visibleNightLighting(page, baseNight, baseWithoutEffects);
          await page.locator('#phaser-effects').click();
          const baseInputs = await lightingInputs(page);
          const baseDay = await changeTime(page, 'day', width === 320);
          assert.match(await page.locator('#library-description').innerText(), /включите ночь/i);
          if (url === urls[0]) {
            await writeFile(join(tmpdir(), `onehtml-phaser3-${name}-${width}-night.png`), baseNight);
            await writeFile(join(tmpdir(), `onehtml-phaser3-${name}-${width}-day.png`), baseDay);
          }
          await page.locator('#pause').click();
          await page.screenshot({ path: join(tmpdir(), `onehtml-phaser3-${name}-${new URL(url).protocol.replace(':','')}-${width}.png`) });
          const modern = await scene(page, 'phaser4');
          assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), 'day', 'The chosen time of day must carry over to the other version');
          const gameCount = await page.evaluate(() => window.testGames.length);
          for (const expected of ['night', 'day']) {
            if (width === 320) await page.locator('#phaser-time').tap(); else await page.locator('#phaser-time').click();
            assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), expected);
            assert.equal(await page.locator('[data-phaser-action="demo"]').getAttribute('aria-pressed'), 'true', 'A live time switch must not also send a jump or disable demo');
            assert.equal(await page.evaluate(() => window.testGames.length), gameCount, 'Live switching must keep the same game');
          }
          assert.equal(modern.coins, base.coins); assert.equal(modern.enemies, base.enemies); assert.equal(modern.health, 3);
          assert.match(await page.locator('#scene-name').innerText(), /Лесная станция/);
          await geometry(page);
          const available = modern.renderer === 2;
          if (name === 'chromium') assert(available, 'The Chromium test must exercise real WebGL filters, not just the fallback');
          await controls(page, width === 320);
          await page.locator('#pause').click();
          const modernDay = await renderedFrame(page);
          if (available) assert(await page.evaluate(() => {
            const v = window.testGames.at(-1).scene.getScenes(true)[0].visuals;
            return !v.beam.visible && !v.shadow.visible && v.lanternEffects.every(item => !item.visible);
          }), 'Extra night effects must not cover the daytime scene');
          const modernNight = await changeTime(page, 'night', width === 320);
          assert.deepEqual(await lightingInputs(page), baseInputs, 'Textures, normal maps, scene objects, fixtures, colors, light settings and shared effects must match between engines');
          if (url === urls[0]) {
            await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-day.png`), modernDay);
            await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-night.png`), modernNight);
          }
          if (available) {
            assert.equal(await page.locator('#scene').getAttribute('data-phaser-effects'), 'on');
            assert(await page.evaluate(() => window.testGames.at(-1).scene.getScenes(true)[0].surfaces.every(item => item.selfShadow.enabled)), 'Phaser 4 must use its native self-shadowing on the shared materials');
            const withSelfShadow = await renderedFrame(page);
            await page.evaluate(() => window.testGames.at(-1).scene.getScenes(true)[0].surfaces.forEach(item => item.setSelfShadow(false)));
            const withoutSelfShadow = await renderedFrame(page);
            assert(!withSelfShadow.equals(withoutSelfShadow), 'Native self-shadowing must actually change the paused frame without changing lights or decorative effects');
            await visibleSurfaceShadows(page, withSelfShadow, withoutSelfShadow);
            await unchangedSky(page, withSelfShadow, withoutSelfShadow);
            await page.evaluate(() => window.testGames.at(-1).scene.getScenes(true)[0].surfaces.forEach(item => item.setSelfShadow(true)));
            if (url === urls[0]) {
              await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-self-shadow-on.png`), withSelfShadow);
              await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-self-shadow-off.png`), withoutSelfShadow);
            }
            await geometry(page);
            const before = await page.evaluate(() => {
              const s = window.testGames.at(-1).scene.getScenes(true)[0];
              return { x: s.player.x, y: s.player.y, score: s.score, health: s.health, checkpoint: s.checkpoint };
            });
            const withEffects = await renderedFrame(page);
            if (url === urls[0]) {
              const cameraPosition = await page.evaluate(() => {
                const camera = window.testGames.at(-1).scene.getScenes(true)[0].cameras.main;
                const position = { x: camera.scrollX, y: camera.scrollY }; camera.centerOn(3000, camera.midPoint.y); return position;
              });
              await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-station.png`), await renderedFrame(page));
              await page.evaluate(position => window.testGames.at(-1).scene.getScenes(true)[0].cameras.main.setScroll(position.x, position.y), cameraPosition);
            }
            await page.locator('#phaser-effects').click();
            assert.equal(await page.locator('#scene').getAttribute('data-phaser-effects'), 'off');
            assert(await page.evaluate(() => {
              const s = window.testGames.at(-1).scene.getScenes(true)[0];
              return [...s.visuals.lamps, ...s.visuals.halos, ...s.visuals.lanternEffects, ...s.visuals.motes, s.visuals.beam, s.visuals.shadow].every(item => !item.visible) &&
                s.visuals.lit.every(item => !item.lighting) && s.surfaces.every(item => !item.selfShadow.enabled);
            }));
            assert.deepEqual(await page.evaluate(() => {
              const s = window.testGames.at(-1).scene.getScenes(true)[0];
              return { x: s.player.x, y: s.player.y, score: s.score, health: s.health, checkpoint: s.checkpoint };
            }), before, 'Switching effects must preserve gameplay');
            const withoutEffects = await renderedFrame(page);
            if (url === urls[0]) {
              await writeFile(join(tmpdir(), `onehtml-phaser-${name}-${width}-effects-on.png`), withEffects);
              await writeFile(join(tmpdir(), `onehtml-phaser-${name}-${width}-effects-off.png`), withoutEffects);
            }
            if (withEffects.equals(withoutEffects)) {
              await writeFile(join(tmpdir(), `onehtml-phaser-${name}-effects-on.png`), withEffects);
              await writeFile(join(tmpdir(), `onehtml-phaser-${name}-effects-off.png`), withoutEffects);
              console.error(await page.evaluate(() => {
                const g = window.testGames.at(-1); return { contextLost: g.renderer.gl.isContextLost(), error: g.renderer.gl.getError(), scene: g.canvas.getBoundingClientRect().toJSON() };
              }));
            }
            assert(!withEffects.equals(withoutEffects), 'Effects must visibly change the paused scene without advancing physics');
            await unchangedSky(page, withEffects, withoutEffects);
            await visibleNightLighting(page, withEffects, withoutEffects);
            await page.locator('#phaser-effects').click();
            assert.equal(await page.locator('#scene').getAttribute('data-phaser-effects'), 'on');
          } else {
            assert(await page.locator('#phaser-effects').isDisabled());
            assert.match(await page.locator('#message').innerText(), /Canvas.*WebGL/);
          }
          await page.locator('#pause').click();
          if (available) {
            await page.locator('#scene').focus(); await page.keyboard.down('ArrowLeft');
            try { await page.waitForFunction(() => {
              const s = window.testGames.at(-1).scene.getScenes(true)[0];
              return s.player.body.velocity.x < 0 && s.visuals.beam.rotation > 0 && s.visuals.beam.x < s.player.x;
            }); } finally { await page.keyboard.up('ArrowLeft'); }
          }
          await page.locator('#info-toggle').click();
          assert.match(await page.locator('#info-body').innerText(), /для новых 2D-игр/);
          await page.locator('#info-close').click();
          // The same Canvas choice must carry over between versions and every scenario.
          await chooseRenderer(page, 'canvas');
          assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), 'night');
          await controls(page, width === 320);
          await scene(page, 'phaser');
          assert.equal(await rendererChoice(page), 'canvas');
          assert.equal(await page.evaluate(() => window.testGames.at(-1).renderer.type), 1);
          await controls(page, width === 320);
          await page.locator('#pause').click();
          const canvasInputs = await lightingInputs(page);
          assert.deepEqual(canvasInputs.materials, baseInputs.materials);
          assert.deepEqual(canvasInputs.objects, baseInputs.objects);
          const canvas3 = await renderedFrame(page);
          await scene(page, 'phaser4');
          assert.equal(await rendererChoice(page), 'canvas');
          const canvas4Inputs = await lightingInputs(page);
          assert.deepEqual(canvas4Inputs, canvasInputs, 'Both Canvas variants use the same scene, textures and drawn effects');
          if (url === urls[0]) {
            await writeFile(join(tmpdir(), `onehtml-phaser3-${name}-${width}-canvas.png`), canvas3);
            await writeFile(join(tmpdir(), `onehtml-phaser4-${name}-${width}-canvas.png`), await renderedFrame(page));
          }
          await page.locator('#info-toggle').click();
          assert.match(await page.locator('#info-body').innerText(), /Canvas.*почти одинаково/s);
          await page.locator('#info-close').click();
          await page.locator('#pause').click();
          await page.locator('#phaser-expand').click(); assert(await page.locator('header').isHidden());
          await page.locator('#phaser-expand').click(); assert(await page.locator('header').isVisible());
          await page.locator('#scenario').selectOption('compare');
          await page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0]?.blocks?.length === 12);
          assert.equal(await page.locator('#phaser-effects').count(), 0);
          assert.equal(await page.locator('#phaser-time').count(), 0);
          await page.locator('#scenario').selectOption('load');
          await page.locator('#load').fill('200'); await page.locator('#load').dispatchEvent('change');
          await page.locator('#fps').filter({ hasText: /^\d+$/ }).waitFor();
          await chooseRenderer(page, 'webgl');
          await scene(page, 'phaser');
          assert.equal(await page.evaluate(() => window.testGames.at(-1).renderer.type), 2);
          await page.locator('#scenario').selectOption('compare');
          await page.waitForFunction(() => window.testGames.at(-1).scene.getScenes(true)[0]?.blocks?.length === 12);
          assert.equal(await page.evaluate(() => window.testGames.at(-1).renderer.type), 2);
          await chooseRenderer(page, 'canvas');
          await scene(page, 'phaser4');
          assert.equal(await page.evaluate(() => window.testGames.at(-1).renderer.type), 1);
          await chooseRenderer(page, 'webgl');
          await page.locator('#scenario').selectOption('showcase'); await scene(page, 'phaser');
          assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), 'night', 'The time of day also carries back to Phaser 3');
          await scene(page, 'phaser4');
          assert.equal(await page.locator('#phaser-time').count(), 1, 'Scene changes must not duplicate the time switch');
          await hintView(page, name, new URL(url).protocol.replace(':', ''), width);
          await page.screenshot({ path: join(tmpdir(), `onehtml-phaser-${name}-${new URL(url).protocol.replace(':','')}-${width}.png`) });
          if (width === 320) {
            await page.setViewportSize({ width, height: 367 });
            await page.waitForFunction(() => document.querySelector('#scene').clientHeight < 190);
            await geometry(page);
            await page.locator('#phaser-hints').click();
            assert.match(await page.locator('.phaser-hint-caption').innerText(), /Разверните сцену/);
            assert(await page.locator('.controls').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight + 1), 'Controls must fit a low phone preview');
            await page.locator('#phaser-expand').click();
            assert(await page.locator('#scene').evaluate(node => node.clientHeight > 190), 'Expanded phone level must have room for its controls');
            await page.locator('.phaser-hint-caption').filter({ hasText: /Phaser 4.*тень/ }).waitFor();
            await geometry(page);
            await page.locator('#phaser-hints').click();
            await page.locator('#phaser-expand').click();
          }
          assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Real engines must work in the standalone offline fixture');
          console.log(`${name} ${new URL(url).protocol} ${width}: shared day/night, retained Phaser gameplay, ${available ? 'WebGL lights/filters' : 'Canvas fallback'}, paused switching, all modes, layout and offline engines passed.`);
        } finally { await context.close(); }
      }
      if (name === 'chromium') {
        const context = await browser.newContext({ viewport: { width: 320, height: 650 } });
        try {
          await context.addInitScript(() => {
            const get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : get.call(this, type, ...args); };
          });
          const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
          await page.goto(urls[0]); const fallback = await scene(page, 'phaser4');
          assert.equal(fallback.renderer, 1); assert(await page.locator('#phaser-effects').isEnabled());
          assert.match(await page.locator('#message').innerText(), /WebGL недоступен.*Canvas/);
          assert.equal(await rendererChoice(page), 'canvas');
          assert(await page.locator('#phaser-renderer [data-renderer="webgl"]').isDisabled());
          assert.equal(await page.locator('#scene').getAttribute('data-phaser-time'), 'night');
          await page.locator('#pause').click();
          await changeTime(page, 'day'); await changeTime(page, 'night');
          const base = await scene(page, 'phaser'); assert.equal(base.renderer, 1);
          assert.equal(await rendererChoice(page), 'canvas');
          await geometry(page); assert.deepEqual(errors, []);
          console.log('chromium: disabled WebGL keeps the same level playable with an explained Canvas fallback.');
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  assert(resolve(scratch).startsWith(resolve(tmpdir()) + sep) && scratch.includes('onehtml-phaser-versions-'));
  await rm(scratch, { recursive: true, force: true });
}
