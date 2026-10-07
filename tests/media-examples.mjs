import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const appURL = new URL('../onehtml-lab.html', import.meta.url).href;
const appHTML = await readFile(new URL(appURL));
const output = join(tmpdir(), 'onehtml-lab-media');
await mkdir(output, { recursive:true });
const ids = ['sound-panel','3d-showcase'];
const originals = new Map(await Promise.all(ids.map(async id => [id, (await readFile(new URL(`../src/examples/${id}.html`, import.meta.url),'utf8')).replace(/\r\n/g,'\n')])));
const threeURL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
const licenseURL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE';
const three = await readFile(new URL('../node_modules/three/build/three.min.js', import.meta.url),'utf8');
const license = await readFile(new URL('../node_modules/three/LICENSE', import.meta.url),'utf8');
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',');
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9).split(',').map(Number);
const engines = [['chromium',chromium],['webkit',webkit]].filter(([name]) => !selected || selected.includes(name));
assert(engines.length);
const server = createServer((_,response) => response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(appHTML));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const http = `http://127.0.0.1:${server.address().port}/`;

async function soundActions(frame, touch = false, name = 'chromium') {
  assert.equal(await frame.locator('.pad').count(),4);
  assert.equal(await frame.evaluate(() => window.audioCreated || 0),0,'No audio context before a user action');
  if (touch) await frame.locator('[data-sound="0"]').tap();
  else await frame.locator('[data-sound="0"]').click();
  const available = await frame.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function');
  if (!available) {
    assert.equal(name,'webkit','Chromium must exercise real Web Audio');
    assert.match(await frame.locator('#status').innerText(),/Звук недоступен/);
    assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'pulse');
    await frame.locator('#mute').click();
    await frame.locator('[data-sound="1"]').focus(); await frame.locator('[data-sound="1"]').press('Enter');
    assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'ray');
    await frame.locator('[data-sound="2"]').focus(); await frame.locator('[data-sound="2"]').press('Space');
    assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'signal');
    await frame.locator('body').press('f'); assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'echo');
    await frame.locator('#volume').fill('0'); assert.equal(await frame.locator('#volume-value').innerText(),'0%');
    await frame.locator('#theme').click(); assert.equal(await frame.locator('body').getAttribute('class'),'dark');
    return;
  }
  await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('Импульс'));
  assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'pulse');
  // Real Web Audio nodes are observed by the test, not replaced by a mock.
  assert.equal(await frame.evaluate(() => window.audioCreated),1);
  assert(await frame.evaluate(() => window.soundPitches[0] > 250),'The impulse attack must remain in a phone-friendly range');
  await frame.locator('[data-sound="1"]').focus(); await frame.locator('[data-sound="1"]').press('Enter');
  await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('Луч'));
  await frame.locator('[data-sound="2"]').focus(); await frame.locator('[data-sound="2"]').press('Space');
  await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('Сигнал'));
  await frame.locator('body').press('f');
  await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('Эхо'));
  assert.equal(await frame.evaluate(() => window.audioCreated),1,'Reuse the same audio context');
  const waves = await frame.evaluate(() => window.soundWaves);
  assert(waves.includes('sine') && waves.includes('triangle'),'Sounds use distinct real oscillators');
  const before = waves.length;
  await frame.locator('#mute').click(); await frame.locator('[data-sound="1"]').click();
  assert.equal(await frame.locator('#visual').getAttribute('data-shape'),'ray');
  assert.match(await frame.locator('#status').innerText(),/звук выключен/);
  assert.equal(await frame.evaluate(() => window.soundWaves.length),before,'Muted actions must not create oscillators');
  await frame.locator('#mute').click();
  await frame.locator('#volume').fill('0'); await frame.locator('[data-sound="0"]').click();
  assert.equal(await frame.locator('#volume-value').innerText(),'0%');
  assert.equal(await frame.evaluate(() => window.soundWaves.length),before,'Zero volume remains visual only');
  await frame.locator('#volume').fill('80');
  await frame.locator('#volume').focus(); await frame.locator('#volume').press('a');
  assert.equal(await frame.evaluate(() => window.soundWaves.length),before,'Shortcuts must not hijack inputs');
  await frame.locator('[data-sound="3"]').click();
  await frame.waitForFunction(() => document.querySelector('#status').textContent.includes('Эхо'));
  await frame.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
  await frame.waitForFunction(() => window.lastAudio.state === 'suspended');
  await frame.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await frame.locator('[data-sound="0"]').click();
  await frame.waitForFunction(() => window.lastAudio.state === 'running');
  await frame.locator('#theme').click(); assert.equal(await frame.locator('body').getAttribute('class'),'dark');
}
async function sceneActions(frame, name, owner, touch = false) {
  await frame.waitForFunction(() => !document.querySelector('#fallback').hidden ? !document.querySelector('#fallback-text').textContent.includes('Подготовка') : true);
  if (await frame.locator('#fallback').isVisible()) {
    assert.equal(name,'webkit','Chromium must render the real WebGL scene');
    assert.match(await frame.locator('#fallback-text').innerText(),/3D недоступно/);
    assert(await frame.locator('#rotate').isDisabled());
    return false;
  }
  const canvas = frame.locator('#stage canvas');
  await canvas.waitFor();
  assert(await canvas.evaluate(el => el.width > 0 && el.height > 0));
  const original = await canvas.screenshot();
  await frame.locator('#color').selectOption('#bb6647');
  assert.notDeepEqual(await canvas.screenshot(),original,'A different colour must change the rendered object');
  const coloured = await canvas.screenshot();
  await frame.locator('#material').selectOption('metal');
  const metal = await canvas.screenshot();
  assert.notDeepEqual(metal,coloured,'Material must change the rendered surface');
  await frame.locator('#light').fill('0');
  assert.notDeepEqual(await canvas.screenshot(),metal,'Light must affect the rendered scene');
  const lit = await canvas.screenshot();
  await frame.locator('#lamp').click(); assert.equal(await frame.locator('#lamp').getAttribute('aria-pressed'),'false');
  assert.notDeepEqual(await canvas.screenshot(),lit,'The bulb must visibly turn off');
  await frame.locator('#stage').focus(); await frame.locator('#stage').press('ArrowRight');
  assert.equal(await frame.locator('#rotation').inputValue(),'10');
  await frame.locator('#stage').press('ArrowUp'); assert.equal(await frame.locator('#view').inputValue(),'side');
  await frame.locator('#view').selectOption('above');
  const rect = await canvas.boundingBox();
  await owner.mouse.move(rect.x+100,rect.y+100); await owner.mouse.down(); await owner.mouse.move(rect.x+140,rect.y+100,{steps:4}); await owner.mouse.up();
  assert(Number(await frame.locator('#rotation').inputValue()) > 10,'Pointer dragging must rotate the object');
  if (touch && name === 'chromium') {
    const session = await owner.context().newCDPSession(owner);
    const initial = Number(await frame.locator('#rotation').inputValue());
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+120,y:rect.y+100}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+170,y:rect.y+100}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await session.detach();
    assert(Number(await frame.locator('#rotation').inputValue()) > initial,'A phone swipe must rotate the object');
  }
  await frame.locator('#rotation').fill('45'); assert.equal(await frame.locator('#rotation-value').innerText(),'45°');
  await frame.locator('#reset').click(); assert.equal(await frame.locator('#rotation').inputValue(),'0');
  assert.equal(await frame.locator('#material').inputValue(),'matte'); assert.equal(await frame.locator('#lamp').getAttribute('aria-pressed'),'true');
  assert.equal(await frame.locator('#view').inputValue(),'front');
  await frame.locator('#rotate').click();
  await frame.waitForFunction(() => Number(document.querySelector('#rotation').value) > 2);
  await frame.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
  const hidden = await frame.locator('#rotation').inputValue();
  await new Promise(resolve => setTimeout(resolve,80)); assert.equal(await frame.locator('#rotation').inputValue(),hidden);
  await frame.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await frame.waitForFunction(value => document.querySelector('#rotation').value !== value,hidden);
  await frame.locator('#rotate').click();
  await frame.waitForFunction(() => document.querySelector('#rotate').getAttribute('aria-pressed') === 'false');
  const stopped = await frame.locator('#rotation').inputValue();
  await new Promise(resolve => setTimeout(resolve,80));
  assert.equal(await frame.locator('#rotation').inputValue(),stopped);
  await frame.locator('#rotate').click();
  assert.equal(await frame.locator('#rotate').getAttribute('aria-pressed'),'true');
  await owner.emulateMedia({reducedMotion:'reduce'}); await frame.waitForFunction(() => document.querySelector('#rotate').disabled);
  assert.equal(await frame.locator('#rotate').getAttribute('aria-pressed'),'false');
  await frame.locator('#rotation').fill('20'); assert.equal(await frame.locator('#rotation-value').innerText(),'20°');
  await owner.emulateMedia({reducedMotion:'no-preference'}); await frame.waitForFunction(() => !document.querySelector('#rotate').disabled);
  await frame.locator('#theme').click(); assert.equal(await frame.locator('body').getAttribute('class'),'dark');
  return true;
}
async function geometry(frame, width) {
  const sizes = await frame.evaluate(() => ({ width:innerWidth, content:document.documentElement.scrollWidth, font:getComputedStyle(document.body).fontSize }));
  assert.equal(sizes.width,width); assert(sizes.content <= width + 1,JSON.stringify(sizes)); assert.equal(sizes.font,'16px');
  const buttons = await frame.locator('button').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
  assert(buttons.every(h => h >= 44));
}

try {
  for (const [name,engine] of engines) {
    const browser = await engine.launch(name === 'chromium' ? { args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'] } : {});
    try {
      for (const [protocol,url] of [['file',appURL],['http',http]]) {
        for (const [width,editor,dark] of [[320,'codemirror',false],[390,'native',true],[1365,'codemirror',true],[1365,'native',false]]) {
          if (widths && !widths.includes(width)) continue;
          const prefix = `${name}-${protocol}-${width}-${editor}`;
          const context = await browser.newContext({viewport:{width,height:844},hasTouch:width < 800,acceptDownloads:true});
          context.setDefaultTimeout(15000);
          const page = await context.newPage(), errors = [], external = [];
          let scripts = 0, licenses = 0;
          await context.route(/^https?:/,route => {
            const target = route.request().url();
            if (target.startsWith(http)) return route.continue();
            if (target === threeURL) { scripts++; return route.fulfill({body:three,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}); }
            if (target === licenseURL) { licenses++; return route.fulfill({body:license,contentType:'text/plain',headers:{'access-control-allow-origin':'*'}}); }
            external.push(target); return route.abort();
          });
          await context.addInitScript(() => {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (Audio) { window.audioCreated = 0; window.soundWaves = []; window.soundPitches = []; window.AudioContext = class extends Audio {
              constructor(...args) { super(...args); window.audioCreated++; window.lastAudio = this; }
              createOscillator() { const node = super.createOscillator(), start = node.start.bind(node); node.start = (...args) => { window.soundWaves.push(node.type); window.soundPitches.push(node.frequency.value); return start(...args); }; return node; }
            }; }
            Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async () => window.nextCode,writeText:async text => { window.copied = text; }}});
          });
          page.on('pageerror',error => errors.push(error.message));
          try {
            await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
            assert(await page.locator('#examples-open').isHidden());
            if (editor === 'native') await page.locator('#editor-toggle').click();
            if (dark) await page.locator('#theme-toggle').click();
            await page.locator('#expert-toggle').click();
            for (const id of ids) {
              await page.locator('#examples-open').click(); await page.locator('[data-example-category="media"]').click();
              const card = page.locator(`[data-example-id="${id}"]`);
              await card.getByRole('button',{name:'Задание',exact:true}).click();
              assert.equal(await card.locator('.example-task-level').count(),2);
              await card.getByRole('button',{name:'Открыть копию',exact:true}).click();
              if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(text => document.querySelector('#code').value === text,originals.get(id));
              await page.locator('#edit-open').click();
              assert.equal(await page.locator('[data-guide-part]:disabled').count(),0); assert.equal(await page.locator('[data-guide-part]').count(),5);
              await page.locator('[data-guide-part="0"]').click();
              const selected = await page.locator('#code').evaluate(el => el.value.slice(el.selectionStart,el.selectionEnd));
              assert(selected.startsWith(id === 'sound-panel' ? 'const sounds' : 'function makeLamp'));
              await page.locator('#examples-open').click();
              for (const index of [0,1]) {
                await card.locator('[data-lesson-prompt]').nth(index).click(); await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
                const prompt = await page.locator('#ai-output').inputValue(); assert(prompt.endsWith(originals.get(id))); assert.match(prompt,/Измени приложение/);
                if (id === '3d-showcase') { assert.match(prompt,/Сохрани существующее подключение Three.js r160/); assert(!prompt.includes('Не добавляй внешние файлы')); }
                await page.locator('#ai-copy').click(); assert.equal(await page.evaluate(() => window.copied),prompt);
                await page.locator('#ai-close').click();
              }
              await page.locator('#examples-close').click(); await page.locator('#run').click();
              if (id === '3d-showcase') {
                await page.locator('#library-request').waitFor({state:'visible'}); assert.equal(scripts,0); assert.equal(licenses,0);
                await page.locator('#library-download').click(); await page.locator('#library-request').waitFor({state:'hidden'});
                await page.locator('#run').click();
              }
              await page.frameLocator('#preview > iframe').locator('main').waitFor();
              const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame());
              await frame.locator('main').waitFor();
              if (id === 'sound-panel') await soundActions(frame,width < 800,name); else await sceneActions(frame,name,page,width < 800);
              await geometry(frame,width);
              await page.screenshot({path:join(output,`${prefix}-${id}.png`)});
              await page.locator('#run').click();
              assert.equal(await page.locator('#code').inputValue(),originals.get(id),'Running must preserve the editable source');
              await page.locator('#save').click();
              await page.locator('#save-dialog').waitFor({state:'visible'});
              if (id === '3d-showcase') { assert(await page.locator('#save-libraries').isChecked()); assert(await page.locator('#save-libraries').isEnabled()); }
              await page.locator('#filename').fill(`${id}.html`);
              const pending = page.waitForEvent('download'); await page.locator('#confirm-save').click();
              const download = await pending, path = join(output,`${prefix}-${id}.html`); await download.saveAs(path);
              const saved = await readFile(path,'utf8');
              if (id === 'sound-panel') assert.equal(saved,originals.get(id));
              else { assert(saved.includes('data-onehtml-library="three@0.160.0"')); assert(saved.includes(license.trim().replace(/\r\n/g,'\n'))); assert(!saved.includes(`src="${threeURL}"`)); }
              const requestCount = scripts + licenses;
              const separate = await context.newPage(); separate.on('pageerror',error => errors.push(error.message));
              await separate.goto(pathToFileURL(path).href);
              if (id === 'sound-panel') await soundActions(separate,width < 800,name); else await sceneActions(separate,name,separate,width < 800);
              assert.equal(scripts + licenses,requestCount,'Saved examples must work without external loads');
              await geometry(separate,width); await separate.close();
              if (id === '3d-showcase') {
                assert.equal(scripts,1); assert.equal(licenses,1);
                await page.locator('#network-toggle').click(); await page.locator('#run').click();
                await page.frameLocator('#preview > iframe').locator('main').waitFor();
                assert.equal(scripts,1,'Cached preview must not download again'); await page.locator('#run').click();
                // Library transformations archive the small editable source and preserve licensing.
                await page.locator('#library-extract-open').click(); await page.locator('[data-library-mode="embed"]').click();
                await page.locator('#library-extract-apply').click();
                await page.waitForFunction(() => document.querySelector('#code').value.includes('data-onehtml-library="three@0.160.0"'));
                await page.locator('#history-open').click();
                assert(await page.locator('.history-entry').count() > 0);
                await page.locator('.history-entry').first().getByRole('button',{name:'Вернуть версию',exact:true}).click();
                await page.locator('#replace-dialog button[value="replace"]').click();
                await page.waitForFunction(text => document.querySelector('#code').value === text,originals.get(id));
              }
            }
            assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
            console.log(`${prefix}: real audio/Three.js when available (Chromium required), explicit fallbacks, lessons, maps, licensed export, cached offline preview and history passed.`);
          } catch (error) { await page.screenshot({path:join(output,`${prefix}-failure.png`)}); throw error; }
          finally { await context.close(); }
        }
      }
      const fallback = await browser.newContext({viewport:{width:320,height:720},reducedMotion:'reduce'});
      try {
        await fallback.route(threeURL,route => route.fulfill({body:three,contentType:'text/javascript'}));
        await fallback.addInitScript(() => {
          Object.defineProperty(window,'AudioContext',{configurable:true,value:undefined}); Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:undefined});
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type,...args) { return /webgl/i.test(type) ? null : original.call(this,type,...args); };
        });
        const page = await fallback.newPage(), errors = [];
        page.on('pageerror',error => errors.push(error.message));
        await page.goto(new URL('../src/examples/sound-panel.html',import.meta.url).href);
        await page.locator('[data-sound="1"]').click(); assert.match(await page.locator('#status').innerText(),/Звук недоступен/);
        assert.equal(await page.locator('#visual').getAttribute('data-shape'),'ray');
        assert.equal(await page.locator('.orb').evaluate(el => getComputedStyle(el).animationName),'none');
        await page.locator('#mute').click(); await page.locator('[data-sound="3"]').click(); assert.match(await page.locator('#status').innerText(),/звук выключен/);
        await page.goto(new URL('../src/examples/3d-showcase.html',import.meta.url).href);
        assert.match(await page.locator('#fallback-text').innerText(),/3D недоступно/); assert(await page.locator('#rotate').isDisabled());
        await page.locator('#theme').click(); assert.equal(await page.locator('body').getAttribute('class'),'dark');
        await fallback.unroute(threeURL); await fallback.route(threeURL,route => route.abort());
        await page.reload(); assert.match(await page.locator('#fallback-text').innerText(),/Three.js r160 не загрузилась/);
        assert.deepEqual(errors,[]);
        console.log(`${name}: missing audio, reduced-motion visual response, unavailable WebGL and missing library are handled without uncaught errors.`);
      } finally { await fallback.close(); }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
console.log(`Media screenshots and saved files: ${output}`);
