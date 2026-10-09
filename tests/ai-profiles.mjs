import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
const appUrl = new URL('../onehtml-lab.html', import.meta.url), app = await readFile(appUrl);
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-profiles-'));
const server = createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end(app));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [appUrl.href, `http://127.0.0.1:${server.address().port}/`];
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || selected === name);
assert(engines.length);
const prepared = async page => { await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled); return page.locator('#ai-output').inputValue(); };
const pureSources = (await Promise.all(['library-bundle.js','library-modules.js','media-assets.js','library-extract.js','exporter.js','ai-profiles.js'].map(name => readFile(new URL('../src/' + name, import.meta.url), 'utf8')))).join('\n');
const assets = new Map();
for (const [folder, pkg, version, file, license] of [
  ['phaser3','phaser','3.90.0','dist/phaser.min.js','LICENSE.md'], ['phaser4','phaser','4.2.1','dist/phaser.min.js','LICENSE.md'],
  ['matter-js','matter-js','0.20.0','build/matter.min.js','LICENSE'], ['three','three','0.160.0','build/three.min.js','LICENSE']
]) for (const name of [file, license]) assets.set(`https://cdn.jsdelivr.net/npm/${pkg}@${version}/${name}`, await readFile(new URL(`../node_modules/${folder}/${name}`, import.meta.url), 'utf8'));
const wav = Buffer.alloc(44 + 8000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(8000, 40);
for (let i = 0; i < 4000; i++) wav.writeInt16LE(Math.round(5000 * Math.sin(i * 2 * Math.PI * 440 / 8000)), 44 + i * 2);
function fixture(profile) {
  const setup = profile.startsWith('phaser')
    ? `await new Promise(resolve=>{const game=new Phaser.Game({type:Phaser.AUTO,width:160,height:160,parent:'stage',audio:{noAudio:true},scene:{create(){this.textures.addImage('hero',img);this.add.image(80,80,'hero').setDisplaySize(80,80);window.__ready={version:Phaser.VERSION,texture:this.textures.get('hero').getSourceImage()===img};resolve();}}});});`
    : profile === 'three' ? `const texture=new THREE.Texture(img);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;const renderer=new THREE.WebGLRenderer();renderer.setSize(160,160);document.querySelector('#stage').append(renderer.domElement);const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,10);camera.position.z=2;scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:texture})));renderer.render(scene,camera);window.__ready={version:THREE.REVISION,texture:texture.image===img};`
    : `${profile === 'matter' ? 'const engine=Matter.Engine.create(),body=Matter.Bodies.rectangle(80,80,20,20);Matter.Composite.add(engine.world,body);Matter.Engine.update(engine,16);' : ''}const c=document.createElement('canvas');c.width=c.height=160;document.querySelector('#stage').append(c);c.getContext('2d').drawImage(img,40,40,80,80);window.__ready={version:${profile === 'matter' ? 'Matter.version' : "'native'"},texture:true};`;
  const lib = { phaser3: 'phaser@3.90.0/dist/phaser.min.js', phaser4: 'phaser@4.2.1/dist/phaser.min.js', matter: 'matter-js@0.20.0/build/matter.min.js', three: 'three@0.160.0/build/three.min.js' }[profile];
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><img id="hero" hidden src="1.png"><audio id="sound" src="2.wav"></audio><div id="stage"></div><button id="play">Звук</button>${lib ? '<script src="https://cdn.jsdelivr.net/npm/' + lib + '"></script>' : ''}<script>document.querySelector('#play').onclick=()=>{document.querySelector('#sound').play().then(()=>window.__sound='played').catch(()=>window.__sound='blocked');};(async()=>{const img=document.querySelector('#hero');await img.decode();${setup}})().catch(error=>window.__failure=error.message);</script></body></html>`;
}
try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of urls) for (const width of [320, 1365]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async text=>window.__copied=text } }));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('https://**/*', route => route.abort());
        try {
          await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#expert-toggle').click(); await page.locator('#ai-open').click();
          await page.locator('#ai-task').fill('Бумажный кот собирает звёзды');
          await page.locator('#ai-game-options summary').click();
          await page.locator('#ai-game-genre').selectOption('platformer'); await page.locator('#ai-game-style').selectOption('paper');
          assert.match(await page.locator('#ai-game-recommendation').innerText(), /Phaser 3.90.0/);
          let prompt = await prepared(page); assert.match(prompt, /бумажных/); assert.match(prompt, /Прыжок/);
          const png = Buffer.from(await page.evaluate(() => {const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);return c.toDataURL().split(',')[1];}), 'base64');
          await page.locator('#ai-media-open').click();
          await page.locator('#media-input').setInputFiles([{name:'1.png',mimeType:'image/png',buffer:png},{name:'2.wav',mimeType:'audio/wav',buffer:wav}]);
          await page.waitForFunction(() => !document.querySelector('#media-prompt-add').disabled); await page.locator('#media-prompt-close').click();
          await page.locator('#ai-game-basis').selectOption('phaser4'); prompt = await prepared(page); await page.locator('#ai-copy').click();
          assert.match(prompt,/textures.addImage/); assert(prompt.indexOf('Доступные медиафайлы:')>prompt.indexOf('Верни только полный HTML-код.'));assert(!prompt.includes('data:image/png;base64'));
          assert.equal(await page.evaluate(() => window.__copied), prompt);
          await page.waitForFunction(() => new Promise(resolve => { const request=indexedDB.open('onehtml-lab-ai',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('prompts'),rows=tx.objectStore('prompts').getAll();tx.oncomplete=()=>{db.close();resolve(rows.result.some(row=>row.profile?.id==='phaser4'));};}; }));
          await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled); await page.locator('#ai-open').click();
          assert.equal(await page.locator('#ai-game-basis').inputValue(), 'phaser4');
          assert.equal(await page.locator('#ai-game-style').inputValue(), 'paper');
          await page.locator('#ai-game-dimension').selectOption('3d'); await prepared(page); assert.match(await page.locator('#ai-game-warning').innerText(), /не соответствует/);
          await page.locator('#ai-answer-open').click();
          await page.locator('#ai-answer-text').fill('<!doctype html><html><body><canvas></canvas></body></html>');
          assert.match(await page.locator('#ai-answer-basis').innerText(), /Phaser 4.2.1/);
          assert.match(await page.locator('#ai-answer-basis').innerText(), /не найдено/);
          await page.locator('#ai-answer-text').fill('<!doctype html><html><body><canvas></canvas><img src="https://example.test/hero.png"></body></html>');
          assert.match(await page.locator('#ai-answer-basis').innerText(), /Внешние медиа/);
          await page.locator('#ai-answer-text').fill('<!doctype html><html><body><canvas></canvas></body></html>');
          await page.locator('#ai-answer-compare').click(); await page.locator('#ai-answer-apply').click();
          await page.locator('#ai-open').click(); await page.locator('#prompt-change').click(); await page.locator('#ai-task').fill('Сделай героя красным');
          prompt = await prepared(page); assert(!prompt.includes('phaser@')); assert.match(prompt, /точные версии библиотек текущего кода/);
          await page.locator('#ai-game-improve').selectOption('touch'); assert.match(await prepared(page), /Сделай управление удобнее/);
          await page.locator('#ai-prompts-open').click(); await page.locator('#ai-prompts-list button').first().click();
          await page.locator('#ai-prompts-reuse').click(); assert.equal(await page.locator('#ai-game-basis').inputValue(), 'phaser4');
          assert.equal(await page.locator('#ai-game-dimension').inputValue(), '2d', 'History restores copied requirements, not later UI changes');
          await page.locator('#ai-close').click(); await page.locator('#theme-toggle').click(); await page.locator('#ai-open').click();
          await page.locator('#ai-game-options summary').click();
          for (const size of [{width,height:390},{width:390,height:800}]) {
            await page.setViewportSize(size); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            const box=await page.locator('#ai-copy').boundingBox(); assert(box && box.y+box.height<=size.height+1);
          }
          await page.screenshot({path:join(scratch,`${name}-${width}-${new URL(url).protocol.slice(0,-1)}.png`)});
          assert.deepEqual(errors, []);
          console.log(`${name} ${new URL(url).protocol} ${width}: profiles, immutable copied settings, factual code, history and responsive themes passed.`);
        } finally { await context.close(); }
      }
      // Real pinned distributions, not stubs: load/license/cache/embed/extract and image textures.
      for (const profile of ['canvas','phaser3','phaser4','matter','three']) {
        const context = await browser.newContext(), unexpected = [];
        await context.route('https://**/*', route => {
          const body = assets.get(route.request().url());
          if (body === undefined) { unexpected.push(route.request().url()); return route.abort(); }
          return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'text/plain',body});
        });
        const page = await context.newPage();
        try {
          await page.goto(urls[1]); await page.addScriptTag({content:pureSources+'\nwindow.profileTest={addMediaFile,attachMedia,prepareApplicationHtml,prepareApplicationFiles,resolvedLibraryMatches,downloadLibrary,libraryCache,loadLibraryCache,planLibraryExtraction};'});
          const png = await page.evaluate(() => {const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.fillStyle='#e84828';x.fillRect(0,0,16,16);return c.toDataURL().split(',')[1];});
          const source = fixture(profile);
          const result = await page.evaluate(async ({source,png,wav}) => {
            const a=profileTest,bytes=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
            const image=await a.addMediaFile(new File([bytes(png)],'1.png',{type:'image/png'})),sound=await a.addMediaFile(new File([bytes(wav)],'2.wav',{type:'audio/wav'}));
            const bound=a.attachMedia(a.attachMedia(source,'1.png',image),'2.wav',sound);
            const references=await a.resolvedLibraryMatches(bound);
            for(const ref of references)await a.downloadLibrary(ref);
            a.libraryCache.clear();await a.loadLibraryCache();
            const ready=await a.prepareApplicationHtml(bound),exact=await a.prepareApplicationHtml(bound,false,false);
            const small=await a.planLibraryExtraction(ready.html,'cdn'),files=await a.prepareApplicationFiles(bound,'game.html');
            return {html:ready.html,exact:exact.html,bound,small:small.html,rows:small.rows.map(row=>({removable:row.removable,reason:row.reason})),files:files.files,missing:ready.missingLibraries};
          }, {source,png,wav:wav.toString('base64')});
          assert.equal(result.exact,result.bound); assert.equal(result.missing.length,0); assert(result.html.includes('data:image/png;base64,')); assert(result.html.includes('data:audio/wav;base64,'));
          if(profile!=='canvas') {assert(result.html.includes('Permission is hereby granted'));assert(result.rows.every(row=>row.removable));assert(result.small.includes('cdn.jsdelivr.net'));assert.equal(result.files.length,2);assert(result.files[1].content.includes('Permission is hereby granted'));}
          // Deny all network traffic; WebKit on Windows cannot navigate file: in offline emulation.
          await context.route(/^https?:/, route => { unexpected.push(route.request().url()); return route.abort(); });
          await page.evaluate(html=>{const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.srcdoc=html;frame.id='recipe-preview';document.body.replaceChildren(frame);},result.html);
          const frame=page.frameLocator('#recipe-preview'); await frame.locator('#stage canvas').waitFor();
          const saved=join(scratch,`${name}-${profile}.html`);await writeFile(saved,result.html);
          const standalone=await context.newPage();const failures=[];standalone.on('pageerror',e=>failures.push(e.message));await standalone.goto(pathToFileURL(saved).href);
          await standalone.waitForFunction(()=>window.__ready || window.__failure);assert.equal(await standalone.evaluate(()=>window.__failure),undefined);assert(await standalone.evaluate(()=>window.__ready.texture));
          assert.equal(await standalone.locator('#hero').getAttribute('src'),'data:image/png;base64,'+png);
          await standalone.locator('#play').click();await standalone.waitForFunction(()=>window.__sound);
          let audioResult = await standalone.evaluate(()=>window.__sound);
          if (audioResult === 'blocked') {
            assert.equal(await standalone.locator('#sound').evaluate(audio=>audio.error?.code),4,'Only missing decoder support can skip audible playback');
            // Independently check the known WAV as a Blob, separate from the recipe/data URL.
            await standalone.evaluate(base64=>{const audio=new Audio(URL.createObjectURL(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'audio/wav'})));document.querySelector('#play').onclick=()=>audio.play().then(()=>window.__probe='played').catch(()=>window.__probe=audio.error?.code);},wav.toString('base64'));
            await standalone.locator('#play').click();await standalone.waitForFunction(()=>window.__probe!==undefined);assert.equal(await standalone.evaluate(()=>window.__probe),4,'A working decoder must also play the recipe');
            audioResult='decoder unavailable; exact WAV and failure handling verified';
          } else assert.equal(audioResult,'played');
          assert.deepEqual(failures,[]);assert.deepEqual(unexpected,[]);
          console.log(`${name} ${profile}: real distribution, license, cache, export and textures passed; audio: ${audioResult}.`);
        } finally {await context.close();}
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
console.log('Profile artifacts: '+scratch);
