import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,webkit} from 'playwright';
import {useNativeEditor} from './native-editor.mjs';
const root=new URL('../',import.meta.url),url='https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js';
const [app,example,distribution,license]=await Promise.all(['onehtml-lab.html','src/examples/music-lab.html','node_modules/tone/build/Tone.js','src/vendor/tone-LICENSE.txt'].map(file=>readFile(new URL(file,root),'utf8')));
const clean=text=>text.replace(/\r\n?/g,'\n').trim();
assert.equal(Buffer.byteLength(distribution),345500);
assert(clean(license).includes(clean(await readFile(new URL('node_modules/tone/LICENSE.md',root),'utf8'))));
for(const author of ['Yotam Mann','Christoph Guttandin','Sebastian McKenzie','Microsoft Corporation'])assert(license.includes(author));
for(const component of ['standardized-audio-context 25.3.70','automation-events 7.0.4','@babel/runtime 7.26.10','tslib 2.6.2'])assert(license.includes(component));
const scratch=await mkdtemp(join(tmpdir(),'onehtml-tone-'));
const scripts=(await Promise.all(['format.js','vendor/codemirror.bundle.js','library-bundle.js','library-modules.js','library-portable.js','exporter.js','library-extract.js','sandbox.js','ai-profiles.js'].map(file=>readFile(new URL('src/'+file,root),'utf8')))).join('\n').replace('/* TONE_LICENSE */ null',()=>JSON.stringify(clean(license)));
const server=createServer((request,response)=>{if(request.url==='/')return response.writeHead(200,{'Content-Type':'text/html'}).end(app);
  const file=resolve(scratch,decodeURIComponent(request.url.slice(1)));if(!file.startsWith(scratch+sep))return response.writeHead(404).end();
  readFile(file).then(bytes=>response.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'}).end(bytes)).catch(()=>response.writeHead(404).end());});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const host=`http://127.0.0.1:${server.address().port}/`;
const selected=process.argv.find(arg=>arg.startsWith('--engines='))?.slice(10),engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected||name===selected);assert(engines.length);
async function realAudio(page){await page.addInitScript(()=>{window.audioAnalysers=[];const C=window.AudioContext||window.webkitAudioContext;if(C){const original=C.prototype.createAnalyser;C.prototype.createAnalyser=function(...args){const node=original.apply(this,args);window.audioAnalysers.push(node);return node;};}});}
async function signal(page){await page.waitForFunction(()=>window.audioAnalysers.some(node=>{const data=new Float32Array(node.fftSize);node.getFloatTimeDomainData(data);return data.some(value=>Math.abs(value)>.001);}));}
try {
  for(const [name,type] of engines){const browser=await type.launch();try{
    const page=await browser.newPage();await page.goto(host);const downloads=[];
    await page.route('https://**/*',route=>{assert.equal(route.request().url(),url);downloads.push(url);return route.fulfill({body:distribution,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});});
    await page.addScriptTag({content:scripts+'\nwindow.toneApi={libraryReference,localLibraryReference,libraryCatalogReference,libraryCache,persistedLibraries,loadLibraryCache,downloadLibrary,prepareGameHtml,prepareGameFiles,planLibraryExtraction,retainExtractionAssets,makeLibraryPack,makeLibraryZip,readLibraryZip,readLibraryPack,readRawLibraryFiles,installLibraryPack,allowedLibraryCacheEntry,aiGameInstructions,aiGameConnectionText,makePreview};'});
    const plans=await page.evaluate(async({example,url,license})=>{const a=toneApi,ref=a.libraryReference(url);await a.downloadLibrary(ref);const entry=a.libraryCache.get(ref.key);
      const inline=await a.prepareGameHtml(example),files=await a.prepareGameFiles(example,'music.html'),exact=await a.prepareGameHtml(example,false),short=await a.planLibraryExtraction(inline.html,'cdn');await a.retainExtractionAssets(short);
      const adjacent=await a.planLibraryExtraction(inline.html,'files');await a.retainExtractionAssets(adjacent);const rebound=await a.prepareGameHtml(adjacent.html);
      const pack=await a.makeLibraryPack([entry]),zip=await a.makeLibraryZip(pack),decoded=await a.readLibraryPack(await a.readLibraryZip(new Uint8Array(await zip.arrayBuffer())));
      const raw=await a.readRawLibraryFiles(ref,[{name:'Tone.js',bytes:new TextEncoder().encode(entry.source)},{name:'LICENSE.txt',bytes:new TextEncoder().encode(license)}]);
      const partial={...entry,license:license.slice(0,license.indexOf('-----'))};const partialAccepted=await a.allowedLibraryCacheEntry(partial);
      const prompt=a.aiGameInstructions({basis:'canvas',sound:'rhythm'}),description=a.aiGameConnectionText(example,'canvas',{basis:'canvas',sound:'rhythm'});
      a.libraryCache.clear();a.persistedLibraries.clear();await a.loadLibraryCache();const restored=await a.prepareGameHtml(example);
      const tampered=inline.html.replace('data-onehtml-sha256="','data-onehtml-sha256="0'),guard=await a.planLibraryExtraction(tampered,'cdn');
      return {ref,inline,files,exact:exact.html,short,rebound,decoded:decoded.map(entry=>({key:entry.key,source:entry.source,license:entry.license})),raw:raw[0].key,partialAccepted,prompt,description,restored:restored.missingLibraries.length,tampered:guard.html===tampered,unknown:a.libraryReference(url.replace('15.1.22','14.8.49')),local:a.localLibraryReference('../audio/tone-15.1.22.js'),localUnknown:a.localLibraryReference('./Tone.js'),escaped:typeof window.Tone};},{example,url,license:clean(license)});
    assert.equal(downloads.length,1);assert.equal(plans.escaped,'undefined','Download must not run Tone.js in the editor');assert.equal(plans.ref.downloadBytes,345500);assert.equal(plans.unknown,null);assert.equal(plans.local.key,'tone@15.1.22');assert.equal(plans.localUnknown.key,undefined);
    assert.equal(plans.inline.missingLibraries.length,0);assert.equal(plans.inline.bundledLibraries.length,1);assert.equal(plans.exact,example);assert.equal(plans.short.count,1);assert.equal(plans.rebound.missingLibraries.length,0);assert.equal(plans.restored,0);assert(plans.tampered);assert.equal(plans.partialAccepted,false);
    assert.equal(plans.files.files.length,2);assert.equal(plans.files.files[1].name,'tone-15.1.22.js');assert.equal(plans.decoded[0].source,distribution);assert.equal(plans.decoded[0].license,clean(license));assert.equal(plans.raw,'tone@15.1.22');assert(plans.inline.html.includes(clean(license)));assert(clean(plans.files.files[1].content.replace(/^\/\/ /gm,'')).includes(clean(license)));
    assert(plans.prompt.includes(url)&&plans.prompt.includes('Tone.start()')&&plans.prompt.includes('Tone.getTransport()'));assert(!plans.description.includes('дополнительные библиотеки'));assert(plans.description.includes('Tone.js'));
    for(const file of plans.files.files)await writeFile(join(scratch,file.name),file.content);await writeFile(join(scratch,'inline.html'),plans.inline.html);await writeFile(join(scratch,'cdn.html'),example);
    // Install decoded ZIP entries in a fresh browser; no network or prior cache is required.
    const student=await browser.newPage();await student.goto(host);await student.addScriptTag({content:scripts+'\nwindow.studentApi={installLibraryPack,libraryCache};'});
    assert(await student.evaluate(async entries=>studentApi.installLibraryPack(entries),plans.decoded.map(entry=>({...entry,title:'Tone.js 15.1.22',sourceUrl:url,licenseType:'MIT'}))));assert.equal(await student.evaluate(()=>studentApi.libraryCache.size),1);await student.close();await page.close();
    for(const [location,width,height] of [[pathToFileURL(join(scratch,'cdn.html')).href,320,680],[pathToFileURL(join(scratch,'inline.html')).href,390,600],[host+'music.html',1365,800]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<500}),demo=await context.newPage(),errors=[],requests=[];demo.setDefaultTimeout(10000);demo.on('pageerror',e=>errors.push(e.message));await realAudio(demo);
      await context.route('https://**/*',route=>{requests.push(route.request().url());return location.endsWith('cdn.html')?route.fulfill({body:distribution,contentType:'text/javascript'}):route.abort();});
      await demo.goto(location);await demo.locator('button[data-engine="tone"]:enabled').waitFor();assert.equal(await demo.locator('[data-row]').count(),32);assert.equal(await demo.locator('#pads button').count(),8);
      const supported=await demo.evaluate(()=>Boolean(window.AudioContext||window.webkitAudioContext));
      assert.equal(await demo.locator('body').getAttribute('data-audio-state'),supported?'silent':'unavailable');assert(await demo.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(supported){
        for(const engine of ['native','tone','native']){
          await demo.locator('button[data-engine="'+engine+'"]').click();await demo.locator('#play').click();await demo.waitForFunction(()=>document.querySelector('#play').getAttribute('aria-pressed')==='true');await signal(demo);
          await demo.locator('#tempo').fill('156');await demo.locator('#tempo').dispatchEvent('input');assert.equal(await demo.locator('#tempo-value').textContent(),'156 BPM');await demo.locator('#echo').check();
          await demo.locator('#pads button').nth(4).click();assert.equal(await demo.locator('#last-note').textContent(),'Соль');
          await demo.locator('#mute').click();assert.equal(await demo.locator('body').getAttribute('data-audio-state'),'muted');await demo.locator('#mute').click();await signal(demo);
          await demo.locator('#play').click();assert.equal(await demo.locator('#play').getAttribute('aria-pressed'),'false');
        }
        await demo.locator('[data-row="0"][data-step="1"]').click();const pattern=await demo.locator('[data-row]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-pressed')));await demo.locator('button[data-engine="tone"]').click();assert.deepEqual(await demo.locator('[data-row]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-pressed'))),pattern);
        await demo.locator('#pads button').nth(0).focus();await demo.keyboard.press('Tab');await demo.keyboard.press('Enter');await demo.waitForFunction(()=>document.querySelector('#last-note').textContent==='Ре');
        await demo.locator('h1').click();await demo.keyboard.press('a');await demo.waitForFunction(()=>document.querySelector('#last-note').textContent==='До');
        await demo.locator('#play').click();await demo.waitForFunction(()=>document.querySelector('#play').getAttribute('aria-pressed')==='true');
        await demo.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await demo.locator('#play').getAttribute('aria-pressed'),'false');assert.equal(await demo.locator('body').getAttribute('data-audio-state'),'silent');await demo.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
      }else assert(await demo.locator('#play').isDisabled());
      await demo.locator('#reset').click();assert.equal(await demo.locator('#tempo').inputValue(),'112');assert(await demo.locator('#echo').isChecked()===false);
      await demo.screenshot({path:join(scratch,`${name}-${width}-music.png`)});await demo.locator('#help-toggle').click();assert(await demo.locator('#help').isVisible());assert((await demo.locator('#help').innerText()).includes('не обязан заметно отличаться'));
      assert.equal(requests.length,location.endsWith('cdn.html')?1:0);assert.deepEqual(errors,[]);await context.close();
    }
    // Integrated library test: same sound palette and scene controls.
    const benchmark=await browser.newPage({viewport:{width:390,height:700}});await realAudio(benchmark);await benchmark.route('https://**/*',route=>route.request().url()===url?route.fulfill({body:distribution,contentType:'text/javascript'}):route.abort());await benchmark.goto(new URL('src/examples/performance-libraries.html',root).href);
    await benchmark.locator('[data-mode="tone"]:enabled').waitFor();await benchmark.locator('[data-mode="tone"]').click();const supported=await benchmark.evaluate(()=>Boolean(window.AudioContext||window.webkitAudioContext));assert.equal(await benchmark.locator('#scene').getAttribute('data-native-state'),supported?'ready':'unavailable');
    if(supported){await benchmark.locator('#stage').click({position:{x:100,y:80}});await benchmark.waitForFunction(()=>document.querySelector('#scene').dataset.nativeAudio==='running');await signal(benchmark);}
    await benchmark.locator('#pause').click();await benchmark.locator('[data-mode="audio"]').click();assert((await benchmark.locator('#library-description').innerText()).includes('Web Audio'));await benchmark.close();
    const context=await browser.newContext({viewport:{width:390,height:800}}),ui=await context.newPage(),requests=[];await useNativeEditor(ui);await realAudio(ui);
    await context.route('https://**/*',route=>{assert.equal(route.request().url(),url);requests.push(url);return route.fulfill({body:distribution,contentType:'text/javascript'});});
    await ui.goto(new URL('onehtml-lab.html',root).href);await ui.locator('#code').fill(example);await ui.locator('#expert-toggle').click();
    await ui.locator('#examples-open').click();await ui.locator('[data-example-category="media"]').click();assert(await ui.locator('[data-example-id="music-lab"]').isVisible());await ui.locator('#examples-close').click();
    await ui.locator('#run').click();await ui.locator('#library-request').waitFor({state:'visible'});const consent=await ui.locator('#library-request-text').innerText();assert(consent.includes('Tone.js 15.1.22')&&consent.includes('337,4'));assert.equal(requests.length,0);await ui.locator('#library-download').click();await ui.locator('#library-request').waitFor({state:'hidden'});
    await ui.locator('#run').click();const preview=ui.frameLocator('#preview iframe');await preview.locator('button[data-engine="tone"]:enabled').waitFor();assert.equal(await ui.locator('#preview iframe').getAttribute('sandbox'),'allow-scripts');await preview.locator('button[data-engine="tone"]').click();
    if(await preview.locator('body').evaluate(()=>Boolean(window.AudioContext||window.webkitAudioContext))){await preview.locator('#play').click();await preview.locator('body[data-audio-state="running"]').waitFor();}
    await ui.locator('#run').click();assert.equal(requests.length,1);const waiting=ui.waitForEvent('download');await ui.locator('#save').click();await ui.locator('#save-form button[type="submit"]').click();const download=await waiting,saved=await readFile(await download.path(),'utf8');assert(saved.includes(clean(license)));assert(saved.includes('data-onehtml-library="tone@15.1.22"'));
    await ui.locator('#ai-open').click();await ui.locator('#ai-game-options summary').click();await ui.locator('#ai-game-sound').selectOption('rhythm');await ui.locator('#ai-task').fill('Ритмическая игра');await ui.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);assert((await ui.locator('#ai-output').inputValue()).includes(url));assert.equal(requests.length,1);await ui.locator('#ai-close').click();
    await ui.locator('#library-extract-open').click();await ui.locator('[data-library-mode="embed"]').click();await ui.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);await ui.locator('#library-extract-apply').click();const full=await ui.locator('#code').inputValue();assert(full.includes('data-onehtml-library="tone@15.1.22"'));
    await ui.locator('#ai-open').click();await ui.locator('#prompt-change').click();await ui.locator('#ai-task').fill('Измени рисунок ритма');await ui.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);const shortened=await ui.locator('#ai-output').inputValue();assert(shortened.includes(url)&&shortened.length<40000);assert.equal(await ui.locator('#code').inputValue(),full);await context.close();
    console.log(`${name}: Tone.js distribution, complete notices, ZIP/raw import, cache, reversible shortening, exact/file/offline export and equal music controls passed; ${supported ? 'real audio signal verified' : 'unsupported audio fallback verified'}.`);
  }finally{await browser.close();}}
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('Music screenshots: '+scratch);
