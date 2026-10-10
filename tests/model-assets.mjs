import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const root=new URL('../',import.meta.url), app=await readFile(new URL('onehtml-lab.html',root)), model=await readFile(new URL('src/examples/satellite.glb',root));
const threeBase='https://cdn.jsdelivr.net/npm/three@0.160.0/', babylonBase='https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/', loaderBase='https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.30.0/';
const dependencies=new Map();
for (const [url,path] of [
  [threeBase+'build/three.module.js','three/build/three.module.js'],[threeBase+'build/three.module.min.js','three/build/three.module.min.js'],
  [threeBase+'examples/jsm/loaders/GLTFLoader.js','three/examples/jsm/loaders/GLTFLoader.js'],[threeBase+'examples/jsm/utils/BufferGeometryUtils.js','three/examples/jsm/utils/BufferGeometryUtils.js'],[threeBase+'LICENSE','three/LICENSE'],
  [babylonBase+'babylon.js','babylonjs/babylon.js'],[babylonBase+'license.md','babylonjs/license.md'],[babylonBase+'NOTICE.md','babylonjs/NOTICE.md'],
  [loaderBase+'babylon.glTF2FileLoader.min.js','babylonjs-loaders/babylon.glTF2FileLoader.min.js'],[loaderBase+'babylonjs.loaders.min.js','babylonjs-loaders/babylonjs.loaders.min.js'],[loaderBase+'license.md','babylonjs-loaders/license.md']
]) dependencies.set(url,await readFile(new URL('node_modules/'+path,root),'utf8'));
const clean=text=>text.replace(/\r\n/g,'\n').trim();
assert.equal(clean(await readFile(new URL('docs/licenses/babylonjs-loaders-9.30.0-LICENSE.txt',root),'utf8')),clean(dependencies.get(loaderBase+'license.md')));
const scripts=(await Promise.all(['format.js','vendor/codemirror.bundle.js','library-bundle.js','library-modules.js','media-models.js','media-assets.js','media-prompts.js','media-images.js','library-extract.js','exporter.js','quality.js','sandbox.js'].map(file=>readFile(new URL('src/'+file,root),'utf8')))).join('\n');
const example=await readFile(new URL('src/examples/glb-model.html',root),'utf8');
const name='Мой спутник.glb',path=encodeURIComponent(name), threeGame=example.replace('satellite.glb',path);
const babylonGame=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;touch-action:none}</style><canvas id="canvas"></canvas><output id="result"></output><div data-model-src="${path}" hidden></div><script src="${babylonBase}babylon.js"></script><script src="${loaderBase}babylon.glTF2FileLoader.min.js"></script><script>
(async()=>{try{const engine=new BABYLON.Engine(document.querySelector('canvas'),true),scene=new BABYLON.Scene(engine);scene.clearColor=new BABYLON.Color4(.07,.13,.22,1);const camera=new BABYLON.ArcRotateCamera('camera',.8,1,9,BABYLON.Vector3.Zero(),scene);camera.attachControl(document.querySelector('canvas'),true);new BABYLON.HemisphericLight('light',new BABYLON.Vector3(0,1,0),scene);
const result=await BABYLON.SceneLoader.ImportMeshAsync(null,'',document.querySelector('[data-model-src]').getAttribute('data-model-src'),scene,undefined,'.glb');for(const group of result.animationGroups)group.start(true);await scene.whenReadyAsync();engine.runRenderLoop(()=>scene.render());window.modelCheck={meshes:result.meshes.filter(mesh=>mesh.getTotalVertices()>0).length,textures:scene.textures.length,animations:result.animationGroups.length};document.querySelector('#result').textContent='loaded';window.engine=engine;addEventListener('pagehide',()=>{scene.dispose();engine.dispose();},{once:true});}catch(error){document.querySelector('#result').textContent=error.message;}})();</script>`;
const scratch=await mkdtemp(join(tmpdir(),'onehtml-glb-tests-'));
const server=createServer((req,res)=>{
  if(req.url==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end(app);
  const file=resolve(scratch,decodeURIComponent(req.url.slice(1)));if(!file.startsWith(scratch+sep))return res.writeHead(404).end();
  readFile(file).then(bytes=>res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'}).end(bytes)).catch(()=>res.writeHead(404).end());
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const host=`http://127.0.0.1:${server.address().port}/`, appFile=new URL('onehtml-lab.html',root).href;
const selected=process.argv.find(arg=>arg.startsWith('--engines='))?.slice(10), engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected||selected===name);assert(engines.length);
const errors=[];
try {
  for(const [engineName,browserType] of engines) {
    const browser=await browserType.launch();
    try {
      const api=await browser.newPage();api.setDefaultTimeout(20000);await api.goto(host);
      const consoleErrors=[];api.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text().slice(0,500));});
      const downloaded=[];
      await api.route('**/*',route=>{const url=route.request().url();if(!url.startsWith('https:'))return route.continue();const body=dependencies.get(url);assert(body!==undefined,'Unexpected dependency: '+url);downloaded.push(url);return route.fulfill({body,contentType:url.endsWith('.js')?'text/javascript':'text/plain',headers:{'access-control-allow-origin':'*'}});});
      await api.addScriptTag({content:scripts+'\nwindow.modelApi={moduleReference,moduleEntryData,moduleCatalog,downloadLibrary,libraryReference,libraryCache,mediaCache,mediaPersisted,addMediaFile,attachMedia,prepareApplicationHtml,prepareApplicationFiles,planLibraryExtraction,retainExtractionAssets,planPromptMedia,loadMediaCache,makePreview,scanModules};'});
      const prepared=await api.evaluate(async({base64,name,path,threeGame,babylonGame,threeBase,loaderBase,babylonBase})=>{
        const a=modelApi,entry=await a.addMediaFile(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],name,{type:'model/gltf-binary'}));
        const three=a.attachMedia(threeGame,path,entry),babylon=a.attachMedia(babylonGame,path,entry);
        await a.downloadLibrary(a.moduleReference(threeBase+'build/three.module.js'));
        await a.downloadLibrary(a.moduleReference(threeBase+'examples/jsm/loaders/GLTFLoader.js'));
        await a.downloadLibrary(a.libraryReference(babylonBase+'babylon.js'));
        await a.downloadLibrary(a.libraryReference(loaderBase+'babylon.glTF2FileLoader.min.js'));
        const inline=await a.prepareApplicationHtml(three),bab=await a.prepareApplicationHtml(babylon),adjacent=await a.prepareApplicationFiles(three,'model.html'),babFiles=await a.prepareApplicationFiles(babylon,'bab.html');
        const extracted=await a.planLibraryExtraction(inline.html,'cdn');await a.retainExtractionAssets(extracted);
        const rebound=await a.prepareApplicationHtml(extracted.html),shortened=await a.planPromptMedia(extracted.html,[],true);
        const minGame=three.replace('/build/three.module.js','/build/three.module.min.js');await a.downloadLibrary(a.moduleReference(threeBase+'build/three.module.min.js'));
        const min=await a.prepareApplicationHtml(minGame),minExtract=await a.planLibraryExtraction(min.html,'cdn'),minFiles=await a.prepareApplicationFiles(minGame,'min.html');
        const prefixed=three.replace('"three":"'+threeBase+'build/three.module.js"','"three":"'+threeBase+'build/three.module.js","three/addons/":"'+threeBase+'examples/jsm/"').replace(threeBase+'examples/jsm/loaders/GLTFLoader.js','three/addons/loaders/GLTFLoader.js');
        const prefixPlan=a.scanModules(prefixed),prefix=await a.prepareApplicationHtml(prefixed);
        const mismatch=a.scanModules(three.replace('/three@0.160.0/build/','/three@0.180.0/build/'));
        a.mediaCache.clear();a.mediaPersisted.clear();await a.loadMediaCache();const restored=await a.prepareApplicationHtml(three);
        return {three,babylon,inline,bab,adjacent,babFiles,extracted:extracted.count,rebound,recovered:shortened.html,min,minExtract:minExtract.count,minFiles:minFiles.files.length,prefix,prefixCount:prefixPlan.references.length,mismatch:mismatch.issues.map(issue=>issue.note),restored:restored.missingMedia.length,entry:entry.model};
      },{base64:model.toString('base64'),name,path,threeGame,babylonGame,threeBase,loaderBase,babylonBase});
      assert.equal(downloaded.filter(url=>url===threeBase+'build/three.module.js').length,1,'Shared exact core is downloaded once: '+JSON.stringify(downloaded));
      assert.equal(prepared.inline.missingLibraries.length,0);assert.equal(prepared.inline.missingMedia.length,0);assert.equal(prepared.extracted,2);assert.equal(prepared.minExtract,2);assert.equal(prepared.restored,0);
      assert(prepared.mismatch.some(note=>note.includes('той же версии')));
      assert(!prepared.recovered.includes('data:model/gltf-binary'));assert(prepared.recovered.includes(path));
      assert.equal(prepared.adjacent.files.length,4,'One HTML and three shared module files');assert.equal(prepared.babFiles.files.length,3);
      assert.equal(prepared.minFiles,4,'Minified core must replace the duplicate unminified output');assert.equal(prepared.prefixCount,2);
      assert(clean(prepared.bab.html).includes(clean(dependencies.get(loaderBase+'license.md'))));assert(prepared.bab.html.includes(dependencies.get(babylonBase+'NOTICE.md').trim()));
      for(const file of prepared.adjacent.files.filter(file=>file.name.endsWith('.js')))assert(file.content.includes('Permission is hereby granted'));
      for(const file of prepared.babFiles.files.filter(file=>file.name.endsWith('.js')))assert(file.content.includes('Apache License')&&file.content.includes('The Babylon.js team'));
      assert(prepared.three.includes(path),'Source uses original names');assert(!prepared.three.includes('data:model/'));
      // No network is available to the game, including remote fetch. Data and internal textures still load.
      await api.unroute('**/*');let network=0;await api.route('**/*',route=>{if(!route.request().url().startsWith('https:'))return route.continue();network++;return route.abort();});
      for(const [label,html] of [['three',prepared.inline.html],['three-min',prepared.min.html],['three-prefix',prepared.prefix.html],['babylon',prepared.bab.html]]) {
        await api.evaluate(html=>{const host=document.querySelector('#preview');host.hidden=false;const frame=modelApi.makePreview(html,false);frame.style.cssText='width:100%;height:500px';host.replaceChildren(frame);},html);
        const frame=api.frameLocator('#preview iframe');
        if(label==='babylon'){await frame.locator('#result').getByText('loaded',{exact:true}).waitFor();const check=await frame.locator('body').evaluate(()=>window.modelCheck);assert(check.meshes>=8&&check.textures>=1&&check.animations===1,JSON.stringify(check));}
        else await frame.locator('#stage[data-loaded="true"]').waitFor({state:'attached'}).catch(async error=>{throw Error(label+': '+await frame.locator('#status').textContent()+'; source '+(await frame.locator('#model-source').getAttribute('data-model-src')).slice(0,60)+'; network '+network+'; '+JSON.stringify(consoleErrors)+'; '+error.message);});
        const blocked=await frame.locator('body').evaluate(async()=>{try{await fetch('https://forbidden.invalid/file');return false;}catch{return true;}});assert(blocked);assert.equal(network,0);
      }
      await api.evaluate(()=>document.querySelector('#preview').replaceChildren());
      for(const [label,html] of [['three',prepared.rebound.html],['babylon',prepared.bab.html]]) {
        const file=join(scratch,engineName+'-'+label+'.html');await writeFile(file,html);const page=await browser.newPage();await page.route('**/*',route=>route.request().url().startsWith('https:')?route.abort():route.continue());
        await page.goto(pathToFileURL(file).href);
        if(label==='three')await page.locator('#stage[data-loaded="true"]').waitFor();else await page.locator('#result').getByText('loaded',{exact:true}).waitFor();await page.close();
      }
      for(const file of prepared.adjacent.files)await writeFile(join(scratch,file.name),file.content);
      const adjacentPage=await browser.newPage();await adjacentPage.route('**/*',route=>route.request().url().startsWith('https:')?route.abort():route.continue());await adjacentPage.goto(host+'model.html');await adjacentPage.locator('#stage[data-loaded="true"]').waitFor();await adjacentPage.close();await api.close();
      // Real UI, original-name prompt binding, two host types and phone/desktop layouts.
      for(const [location,width] of [[appFile,320],[host,1365]]) {
        const context=await browser.newContext({viewport:{width,height:800},acceptDownloads:true});
        await context.addInitScript(()=>{window.clipboardRead='';window.clipboardWrite='';Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>window.clipboardRead,writeText:async text=>window.clipboardWrite=text},configurable:true});});
        await context.route('**/*',route=>{if(!route.request().url().startsWith('https:'))return route.continue();const body=dependencies.get(route.request().url());assert(body!==undefined);return route.fulfill({body,contentType:route.request().url().endsWith('.js')?'text/javascript':'text/plain',headers:{'access-control-allow-origin':'*'}});});
        const page=await context.newPage();page.setDefaultTimeout(20000);await useNativeEditor(page);page.on('pageerror',error=>errors.push(error.message));await page.goto(location);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
        await page.locator('#expert-toggle').click();await page.locator('#media-open').click();await page.locator('#media-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:model});await page.waitForFunction(()=>!document.querySelector('#media-prompt-add').disabled);
        assert.equal(await page.locator('#media-prompt-names').inputValue(),name);assert.match(await page.locator('#media-prompt-list').innerText(),/геометрий: 3 · анимаций: 1/);assert.equal(await page.locator('#media-prompt-list audio').count(),0);
        await page.locator('#media-prompt-ai').click();await page.locator('#ai-task').fill('Покажи '+name);await page.waitForFunction(()=>document.querySelector('#ai-summary').textContent.includes('Для GLB-моделей выберите'));assert(await page.locator('#ai-copy').isDisabled());await page.locator('#ai-game-options summary').click();await page.locator('#ai-game-dimension').selectOption('3d');await page.locator('#ai-game-basis').selectOption('three');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
        const prompt=await page.locator('#ai-output').inputValue();assert(prompt.startsWith('Сделай игру'));assert(prompt.indexOf('Верни только полный HTML-код.')<prompt.indexOf('Доступные медиафайлы'));assert(prompt.includes(name)&&prompt.includes('GLTFLoader.js'));
        await page.locator('#ai-copy').click();await page.locator('#ai-close').click();await page.evaluate(text=>window.clipboardRead=text,threeGame);await page.locator('#paste').click();await page.waitForFunction(()=>document.querySelector('#code').value.includes('onehtml-media:1:'));
        await page.locator('#run').click();await page.locator('#library-request').waitFor({state:'visible'});assert.match(await page.locator('#library-request-text').innerText(),/GLB-загрузчик/);await page.locator('#library-download').click();await page.locator('#library-request').waitFor({state:'hidden'});
        await page.locator('#network-toggle').click();await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#stage[data-loaded="true"]').waitFor();assert(await page.locator('#preview-pick').isVisible());
        await page.locator('#expert-toggle').click();await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#stage[data-loaded="true"]').waitFor();assert(await page.locator('#preview-pick').isHidden());await page.locator('#expert-toggle').click();await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#stage[data-loaded="true"]').waitFor();assert(await page.locator('#preview-pick').isVisible());await page.locator('#run').click();
        await page.locator('#save').click();await page.locator('#save-libraries-mode').selectOption('files');await page.waitForFunction(()=>document.querySelector('#save-libraries-hint').textContent.includes('Загрузках'));
        const hint=await page.locator('#save-libraries-hint').innerText();assert(hint.includes('скачанного HTML')&&hint.includes('На сервере'));
        await page.locator('#save-libraries-mode').selectOption('inline');await page.waitForFunction(()=>document.querySelector('#save-libraries-hint').textContent.includes('редактир'));await page.locator('#cancel-save').click();
        await page.locator('#library-extract-open').click();await page.locator('[data-library-mode="files"]').click();assert((await page.locator('#library-placement-hint').innerText()).includes('Загрузках'));await page.locator('#library-extract-close').click();
        await page.locator('#examples-open').click();await page.locator('[data-example-category="media"]').click();const card=page.locator('[data-example-id="glb-model"]');
        const event=page.waitForEvent('download');await card.getByRole('button',{name:'Скачать GLB',exact:true}).click();const sample=await event;assert.equal(sample.suggestedFilename(),'satellite.glb');assert.equal(Buffer.compare(await readFile(await sample.path()),model),0);
        await card.getByRole('button',{name:'Открыть копию',exact:true}).click();if(await page.locator('#replace-dialog').isVisible())await page.locator('#replace-dialog [value="replace"]').click();await page.locator('#run').click();const viewer=page.frameLocator('#preview iframe');await viewer.locator('#stage[data-loaded="true"]').waitFor();
        await viewer.locator('#animation').click();assert.equal(await viewer.locator('#animation').getAttribute('aria-pressed'),'false');await viewer.locator('#rotation').click();assert.equal(await viewer.locator('#rotation').getAttribute('aria-pressed'),'true');await viewer.locator('#zoom').focus();await viewer.locator('#zoom').press('ArrowRight');await viewer.locator('#reset').click();assert.equal(await viewer.locator('#zoom').inputValue(),'100');
        assert(await viewer.locator('html').evaluate(el=>el.scrollWidth<=innerWidth));assert(await viewer.locator('main').evaluate(el=>el.clientHeight>100));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:join(scratch,engineName+'-'+width+'-model.png')});
        await page.locator('#run').click();await page.locator('#library-extract-open').click();await page.locator('[data-library-mode="embed"]').click();await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);await page.locator('#library-extract-apply').click();await page.locator('#library-extraction').waitFor({state:'hidden'});
        const expanded=await page.locator('#code').inputValue();assert(expanded.includes('data-onehtml-modules'));await page.locator('#ai-open').click();await page.locator('#prompt-change').click();await page.locator('#ai-task').fill('Сделай корпус золотым');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
        const shortPrompt=await page.locator('#ai-output').inputValue();assert(shortPrompt.length<40000&&!shortPrompt.includes('data:text/javascript;base64')&&!shortPrompt.includes('data:model/gltf-binary;base64'),'AI receives editable code with shortened model and ES modules');assert.equal(await page.locator('#code').inputValue(),expanded);
        await context.close();
      }
      console.log(`${engineName}: GLB textures/animation, both loaders, exact versions, shared modules, full licenses, cache, offline sandbox/export, separate files and mobile/desktop prompts passed.`);
    }finally{await browser.close();}
  }
  assert.deepEqual(errors,[]);console.log('Model test artifacts: '+scratch);
}finally{await new Promise(resolve=>server.close(resolve));}
