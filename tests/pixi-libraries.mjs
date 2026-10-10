import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const root = new URL('../', import.meta.url), url = 'https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/dist/pixi.min.js';
const [app, example, distribution, license] = await Promise.all(['onehtml-lab.html', 'src/examples/pixi-poster.html', 'node_modules/pixi.js/dist/pixi.min.js', 'src/vendor/pixi-LICENSE.txt'].map(file => readFile(new URL(file, root), 'utf8')));
const clean = text => text.replace(/\r\n?/g, '\n').trim();
assert.equal(Buffer.byteLength(distribution), 840663);
assert(clean(license).includes(clean(await readFile(new URL('node_modules/pixi.js/LICENSE', root), 'utf8'))));
for (const component of ['eventemitter3', '@pixi/colord', 'ismobilejs', 'earcut', 'parse-svg-path', 'tiny-lru']) assert(license.includes('----- ' + component + ' -----'));
for (const author of ['Mathew Groves', 'Arnout Kazemier', 'Vlad Shilov', 'Kai Mallea', 'Mapbox', 'Jake Rosoman', 'Jason Mulligan']) assert(license.includes(author));
const compatUrl = url.replace('pixi.min.js','packages/unsafe-eval.min.js'), compat = await readFile(new URL('node_modules/pixi.js/dist/packages/unsafe-eval.min.js', root),'utf8');
assert.equal(Buffer.byteLength(compat),15751);
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-pixi-'));
const scripts = (await Promise.all(['format.js', 'vendor/codemirror.bundle.js', 'library-bundle.js', 'library-modules.js', 'library-portable.js', 'exporter.js', 'library-extract.js', 'sandbox.js', 'ai-profiles.js'].map(file => readFile(new URL('src/' + file, root), 'utf8')))).join('\n').replace('/* PIXI_LICENSE */ null', () => JSON.stringify(clean(license)));
const server = createServer((request, response) => {
  if (request.url === '/') return response.writeHead(200, {'Content-Type':'text/html'}).end(app);
  const file = resolve(scratch, decodeURIComponent(request.url.slice(1)));
  if (!file.startsWith(scratch + sep)) return response.writeHead(404).end();
  readFile(file).then(bytes => response.writeHead(200, {'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'}).end(bytes)).catch(() => response.writeHead(404).end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const host = `http://127.0.0.1:${server.address().port}/`;
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || name === selected); assert(engines.length);
try {
  for (const [name, type] of engines) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage(); await page.goto(host); const downloads = [];
      await page.route('https://**/*', route => { assert([url,compatUrl].includes(route.request().url())); downloads.push(route.request().url()); return route.fulfill({body:route.request().url()===compatUrl?compat:distribution, contentType:'text/javascript', headers:{'Access-Control-Allow-Origin':'*'}}); });
      await page.addScriptTag({content:scripts + '\nwindow.pixiApi={libraryReference,localLibraryReference,libraryCache,persistedLibraries,loadLibraryCache,downloadLibrary,prepareGameHtml,prepareGameFiles,planLibraryExtraction,retainExtractionAssets,makeLibraryPack,makeLibraryZip,readLibraryZip,readLibraryPack,readRawLibraryFiles,installLibraryPack,allowedLibraryCacheEntry,aiGameInstructions,aiGameMediaRecipe};'});
      const plans = await page.evaluate(async ({example,url,compatUrl,license}) => {
        const a = pixiApi, ref = a.libraryReference(url); await a.downloadLibrary(ref); await a.downloadLibrary(a.libraryReference(compatUrl)); const entry = a.libraryCache.get(ref.key);
        const inline = await a.prepareGameHtml(example), files = await a.prepareGameFiles(example, 'poster.html'), exact = await a.prepareGameHtml(example, false);
        const short = await a.planLibraryExtraction(inline.html, 'cdn'); await a.retainExtractionAssets(short);
        const adjacent = await a.planLibraryExtraction(inline.html, 'files'); await a.retainExtractionAssets(adjacent); const rebound = await a.prepareGameHtml(adjacent.html);
        const pack = await a.makeLibraryPack([...a.libraryCache.values()].filter(entry=>entry.key.startsWith('pixi.js@'))), zip = await a.makeLibraryZip(pack), decoded = await a.readLibraryPack(await a.readLibraryZip(new Uint8Array(await zip.arrayBuffer())));
        const raw = await a.readRawLibraryFiles(ref, [{name:'pixi-8.22.0.min.js',bytes:new TextEncoder().encode(entry.source)},{name:'LICENSE.txt',bytes:new TextEncoder().encode(license)}]);
        const partialAccepted = await a.allowedLibraryCacheEntry({...entry,license:license.slice(0,license.indexOf('----- eventemitter3'))});
        a.libraryCache.clear(); a.persistedLibraries.clear(); await a.loadLibraryCache(); const lazy = a.libraryCache.get(ref.key)?.lazy; const restored = await a.prepareGameHtml(example);
        const tampered = inline.html.replaceAll('data-onehtml-sha256="','data-onehtml-sha256="0');
        return {ref,inline,files,exact:exact.html,short,rebound,decoded:decoded.map(entry=>({key:entry.key,source:entry.source,license:entry.license})),raw:raw[0].key,partialAccepted,lazy,restored:restored.missingLibraries.length,tampered:(await a.planLibraryExtraction(tampered,'cdn')).html===tampered,unknown:a.libraryReference(url.replace('8.22.0','8.21.0')),local:a.localLibraryReference('../lib/pixi-8.22.0.min.js'),unversioned:a.localLibraryReference('./pixi.min.js'),escaped:typeof window.PIXI,prompt:a.aiGameInstructions({basis:'pixi'}),media:a.aiGameMediaRecipe('pixi')};
      }, {example,url,compatUrl,license:clean(license)});
      assert.equal(downloads.length,2); assert.equal(plans.escaped,'undefined'); assert.equal(plans.ref.downloadBytes,840663); assert.equal(plans.unknown,null); assert.equal(plans.local.key,'pixi.js@8.22.0'); assert.equal(plans.unversioned.key,undefined);
      assert.equal(plans.inline.bundledLibraries.length,2); assert.equal(plans.inline.missingLibraries.length,0); assert.equal(plans.exact,example); assert.equal(plans.short.count,2); assert.equal(plans.rebound.missingLibraries.length,0); assert.equal(plans.restored,0); assert.equal(plans.lazy,true); assert(plans.tampered); assert.equal(plans.partialAccepted,false);
      assert.equal(plans.files.files.length,3); assert.equal(plans.files.files[1].name,'pixi-8.22.0.min.js'); assert.equal(plans.decoded[0].source,distribution); assert.equal(plans.decoded[0].license,clean(license)); assert.equal(plans.raw,'pixi.js@8.22.0'); assert(plans.inline.html.includes(clean(license))); assert(clean(plans.files.files[1].content.replace(/^\/\/ /gm,'')).includes(clean(license)));
      assert(plans.prompt.includes(url)&&plans.prompt.includes('await app.init')&&plans.prompt.includes('app.render()')); assert(plans.media.includes('Texture.from(imageElement)')&&plans.media.includes('Assets.load'));
      for (const file of plans.files.files) await writeFile(join(scratch,file.name),file.content); await writeFile(join(scratch,'inline.html'),plans.inline.html); await writeFile(join(scratch,'cdn.html'),example);
      const student = await browser.newPage(); await student.goto(host); await student.addScriptTag({content:scripts+'\nwindow.studentApi={installLibraryPack,libraryCache};'});
      assert(await student.evaluate(async entries=>studentApi.installLibraryPack(entries),plans.decoded.map(entry=>({...entry,title:'PixiJS 8.22.0',sourceUrl:entry.key.endsWith(':unsafe-eval')?compatUrl:url,licenseType:'MIT'})))); assert.equal(await student.evaluate(()=>studentApi.libraryCache.size),2); await student.close(); await page.close();
      for (const [location,width,height] of [[pathToFileURL(join(scratch,'cdn.html')).href,320,740],[pathToFileURL(join(scratch,'inline.html')).href,390,740],[host+'poster.html',1365,850]]) {
        const context = await browser.newContext({viewport:{width,height},hasTouch:width<500}), demo = await context.newPage(), errors=[], requests=[]; demo.setDefaultTimeout(15000); demo.on('pageerror',error=>errors.push(error.message));
        await context.route('https://**/*',route=>{requests.push(route.request().url()); return location.endsWith('cdn.html')?route.fulfill({body:route.request().url()===compatUrl?compat:distribution,contentType:'text/javascript'}):route.abort();});
        await demo.goto(location); await demo.locator('[data-engine="pixi"]:enabled').waitFor(); assert(await demo.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await demo.locator('[data-palette="1"]').click(); await demo.locator('#stage').focus(); await demo.keyboard.press('ArrowRight'); await demo.keyboard.press('ArrowDown'); assert.equal(await demo.locator('#stage').getAttribute('data-offset'),'12,12');
        await demo.locator('#pause').click(); await demo.locator('[data-engine="pixi"]').click(); await demo.locator('body[data-renderer-state="ready"]').waitFor();
        const supported = await demo.locator('body').getAttribute('data-renderer')==='pixi'; assert.equal(await demo.locator('#stage').getAttribute('data-palette'),'1'); assert.equal(await demo.locator('#stage').getAttribute('data-offset'),'12,12'); assert.equal(await demo.locator('#pause').getAttribute('aria-pressed'),'true');
        if (supported) {
          const drawn = await demo.locator('#surface canvas').evaluate(canvas=>{const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const pixels=new Uint8Array(4);gl.readPixels(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return [...pixels];}); assert(drawn[3]>0,'Real WebGL frame must be drawn');
          await demo.locator('#count').evaluate(node=>{node.value='10000';node.dispatchEvent(new Event('change',{bubbles:true}));}); assert.equal(await demo.locator('#count-value').textContent(),'10 000');
          await demo.locator('#pause').click(); await demo.waitForFunction(()=>!document.querySelector('#metrics').textContent.includes('FPS: —')); await demo.locator('#pause').click();
        } else assert((await demo.locator('#status').innerText()).includes('WebGL недоступен'));
        await demo.locator('[data-engine="pixi"]').click(); await demo.locator('[data-engine="canvas"]').click(); await demo.locator('body[data-renderer="canvas"][data-renderer-state="ready"]').waitFor();
        await demo.locator('#reset').click(); assert.equal(await demo.locator('#stage').getAttribute('data-offset'),'0,0'); assert.equal(await demo.locator('#count').inputValue(),'120');
        const bounds=await demo.locator('#stage').boundingBox(); const start={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height*.55};
        await demo.mouse.move(start.x,start.y); await demo.mouse.down(); await demo.mouse.move(start.x+15,start.y+10); await demo.mouse.up(); assert.notEqual(await demo.locator('#stage').getAttribute('data-offset'),'0,0','Image must respond to drag');
        if (width<500) await demo.locator('#stage').tap();
        await demo.screenshot({path:join(scratch,`${name}-${width}-poster.png`)}); await demo.locator('#help-toggle').click(); assert(await demo.locator('#help').isVisible()); await demo.keyboard.press('Escape'); assert(await demo.locator('#help').isHidden());
        assert.equal(requests.length,location.endsWith('cdn.html')?2:0); assert.deepEqual(errors,[]); await context.close();
      }
      const fallback=await browser.newPage({viewport:{width:320,height:740}});
      await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:get.call(this,type,...args);};});
      await fallback.route('https://**/*',route=>route.fulfill({body:route.request().url()===compatUrl?compat:distribution,contentType:'text/javascript'}));await fallback.goto(pathToFileURL(join(scratch,'cdn.html')).href);await fallback.locator('[data-engine="pixi"]').click();await fallback.locator('#status').filter({hasText:'WebGL недоступен'}).waitFor();assert.equal(await fallback.locator('body').getAttribute('data-renderer'),'canvas');await fallback.close();
      const incomplete=await browser.newPage();await incomplete.route('https://**/*',route=>route.request().url()===url?route.fulfill({body:distribution,contentType:'text/javascript'}):route.abort());await incomplete.goto(pathToFileURL(join(scratch,'cdn.html')).href);assert(await incomplete.locator('[data-engine="pixi"]').isDisabled());assert((await incomplete.locator('#status').textContent()).includes('модуль совместимости'));await incomplete.close();
      for (const width of [390,1365]) {
        const benchmark = await browser.newPage({viewport:{width,height:750},hasTouch:width<500}), benchmarkErrors=[]; benchmark.on('pageerror',error=>benchmarkErrors.push(error.message));
        await benchmark.route('https://**/*',route=>[url,compatUrl].includes(route.request().url())?route.fulfill({body:route.request().url()===compatUrl?compat:distribution,contentType:'text/javascript'}):route.abort()); await benchmark.goto(new URL('src/examples/performance-libraries.html',root).href);
        await benchmark.locator('[data-mode="pixi"]:enabled').waitFor(); await benchmark.locator('[data-mode="pixi"]').click(); await benchmark.waitForFunction(()=>['ready','unavailable'].includes(document.querySelector('#scene').dataset.pixiState));
        if (await benchmark.locator('#scene').getAttribute('data-pixi-state')==='ready') {
          for (const scenario of ['compare','load','showcase']) { await benchmark.locator('#scenario').selectOption(scenario); await benchmark.locator('#scene[data-pixi-state="ready"]').waitFor(); assert.equal(await benchmark.locator('#scene canvas').count(),1); await benchmark.locator('#stage').click({position:{x:120,y:70}}); if(scenario==='compare')await benchmark.waitForFunction(()=>document.querySelector('#scene-stats').textContent.includes('Выстрелов: 1')); if(scenario==='load'){await benchmark.locator('#load').evaluate(node=>{node.value='10000';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});await benchmark.locator('#scene[data-pixi-state="ready"]').waitFor();assert.equal((await benchmark.locator('#load-value').textContent()).replace(/\s/g,''),'10000');} }
          const bounds=await benchmark.locator('#stage').boundingBox(),scale=Math.min(bounds.width/600,bounds.height/780);
          const start={x:bounds.x+bounds.width/2,y:bounds.y+(bounds.height-780*scale)/2+430*scale};
          // Read after the scene's animation callback, before WebGL's default framebuffer is discarded.
          const assertPicture=async()=>{
            const rgba=await benchmark.locator('#scene canvas').evaluate(canvas=>new Promise(resolve=>requestAnimationFrame(()=>{
              const scale=Math.min(canvas.width/600,canvas.height/780),x=canvas.width/2,y=(canvas.height-780*scale)/2+430*scale;
              const gl=canvas.getContext('webgl2')||canvas.getContext('webgl'),rgba=new Uint8Array(4);gl.readPixels(Math.floor(x),Math.floor(canvas.height-y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);resolve([...rgba]);
            })));
            assert(rgba[3]===255&&rgba[1]>rgba[0]&&rgba[1]>rgba[2],`PixiJS landscape must remain inside its mask after dragging (${name}, ${width}): ${rgba}`);
          };
          await assertPicture();await benchmark.mouse.move(start.x,start.y);await benchmark.mouse.down();await assertPicture();
          await benchmark.mouse.move(start.x+40*scale,start.y+30*scale,{steps:4});await assertPicture();await benchmark.mouse.up();
          // A second drag starts from the current position; crossing the circle edge stays bounded.
          await benchmark.mouse.move(start.x,start.y);await benchmark.mouse.down();await benchmark.mouse.move(start.x-280*scale,start.y-100*scale,{steps:4});await benchmark.mouse.up();await assertPicture();
          if(name==='chromium'&&width<500){
            const cdp=await benchmark.context().newCDPSession(benchmark);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y,id:1}]});
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+25*scale,y:start.y+20*scale,id:1}]});await assertPicture();
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
          }
          await benchmark.screenshot({path:join(scratch,`${name}-${width}-pixi-drag.png`)});
        }
        assert.deepEqual(benchmarkErrors,[]); await benchmark.close();
      }
      const context = await browser.newContext({viewport:{width:390,height:800}}), ui = await context.newPage(), requests=[]; await useNativeEditor(ui);
      await context.route('https://**/*',route=>{assert([url,compatUrl].includes(route.request().url()));requests.push(route.request().url());return route.fulfill({body:route.request().url()===compatUrl?compat:distribution,contentType:'text/javascript'});});
      await ui.goto(new URL('onehtml-lab.html',root).href); await ui.locator('#expert-toggle').click(); await ui.locator('#examples-open').click(); await ui.locator('[data-example-category="media"]').click(); assert(await ui.locator('[data-example-id="pixi-poster"]').isVisible()); assert(await ui.locator('[data-example-id="interactive-poster"]').isVisible()); await ui.locator('#examples-close').click();
      const guarded=example.replace('</body>','<script>window.pixiCspGuard={};for(const key of ["eval","Function"])try{if(key==="eval")eval("window.pixiEvalEscaped=true");else new Function("window.pixiEvalEscaped=true")();pixiCspGuard[key]="allowed";}catch(error){pixiCspGuard[key]=error.name;}</script></body>');
      await ui.locator('#code').fill(guarded); await ui.locator('#run').click(); await ui.locator('#library-request').waitFor({state:'visible'}); assert((await ui.locator('#library-request-text').innerText()).includes('821')); assert.equal(requests.length,0); await ui.locator('#library-download').click(); await ui.locator('#library-request').waitFor({state:'hidden'}); await ui.locator('#run').click();
      const preview=ui.frameLocator('#preview iframe'); await preview.locator('[data-engine="pixi"]:enabled').waitFor(); assert.equal(await ui.locator('#preview iframe').getAttribute('sandbox'),'allow-scripts'); await preview.locator('[data-engine="pixi"]').click(); await preview.locator('body[data-renderer-state="ready"]').waitFor(); assert.equal(await preview.locator('body').getAttribute('data-renderer'),'pixi','PixiJS must work without relaxing sandbox/CSP');
      assert.deepEqual(await preview.locator('body').evaluate(()=>window.pixiCspGuard),{eval:'EvalError',Function:'EvalError'});assert.equal(await preview.locator('body').evaluate(()=>window.pixiEvalEscaped),undefined);
      await ui.locator('#run').click(); const waiting=ui.waitForEvent('download'); await ui.locator('#save').click(); await ui.locator('#save-form button[type="submit"]').click(); const saved=await readFile(await (await waiting).path(),'utf8'); assert(saved.includes(clean(license))); assert(saved.includes('data-onehtml-library="pixi.js@8.22.0"')); assert.equal(requests.length,2);
      await context.close(); console.log(`${name}: PixiJS exact catalog, full notices, lazy cache, ZIP/raw imports, reversible export, equal poster controls, real WebGL and isolated preview passed.`);
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve=>server.close(resolve)); }
console.log('Poster screenshots: '+scratch);
