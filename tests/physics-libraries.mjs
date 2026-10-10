import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const root=new URL('../',import.meta.url),app=await readFile(new URL('onehtml-lab.html',root)),example=await readFile(new URL('src/examples/3d-physics.html',root),'utf8');
const cannonUrl='https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js',threeUrl='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const sources=new Map();
for(const [url,file] of [[cannonUrl,'cannon-es/dist/cannon-es.js'],[cannonUrl.replace('/dist/cannon-es.js','/LICENSE'),'cannon-es/LICENSE'],[threeUrl,'three/build/three.module.js'],[threeUrl.replace('/build/three.module.js','/LICENSE'),'three/LICENSE']])sources.set(url,await readFile(new URL('node_modules/'+file,root),'utf8'));
const threeBase=threeUrl.replace('build/three.module.js',''),loaderUrl=threeBase+'examples/jsm/loaders/GLTFLoader.js';
for(const file of ['examples/jsm/loaders/GLTFLoader.js','examples/jsm/utils/BufferGeometryUtils.js'])sources.set(threeBase+file,await readFile(new URL('node_modules/three/'+file,root),'utf8'));
const model=await readFile(new URL('src/examples/satellite.glb',root));
const combinedGame=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div data-model-src="satellite.glb" hidden></div><output id="result"></output><script type="importmap">{"imports":{"three":"${threeUrl}","cannon-es":"${cannonUrl}"}}</script><script type="module">
import * as THREE from 'three';import * as CANNON from 'cannon-es';import { GLTFLoader } from '${loaderUrl}';
try{const model=await new GLTFLoader().loadAsync(document.querySelector('[data-model-src]').getAttribute('data-model-src')),world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0)}),floor=new CANNON.Body({mass:0,shape:new CANNON.Plane()}),body=new CANNON.Body({mass:1,shape:new CANNON.Sphere(.32)});floor.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(floor);body.position.y=3;world.addBody(body);for(let n=0;n<360;n++)world.step(1/60);model.scene.position.copy(body.position);model.scene.quaternion.copy(body.quaternion);let meshes=0,textures=0;model.scene.traverse(node=>{if(node.isMesh)meshes++;if(node.material?.map)textures++;});window.combined={meshes,textures,animations:model.animations.length,height:model.scene.position.y,three:THREE.REVISION};document.querySelector('#result').textContent='ready';}catch(error){document.querySelector('#result').textContent=error.message;}
</script>`;
const clean=text=>text.replace(/\r\n/g,'\n').trim();
assert.equal(clean(await readFile(new URL('docs/licenses/cannon-es-0.20.0-LICENSE.txt',root),'utf8')),clean(sources.get(cannonUrl.replace('/dist/cannon-es.js','/LICENSE'))));
const scripts=(await Promise.all(['format.js','vendor/codemirror.bundle.js','library-bundle.js','library-modules.js','media-models.js','media-assets.js','library-extract.js','exporter.js','quality.js','sandbox.js','ai-profiles.js'].map(file=>readFile(new URL('src/'+file,root),'utf8')))).join('\n');
const scratch=await mkdtemp(join(tmpdir(),'onehtml-physics-'));
const server=createServer((request,response)=>{
  if(request.url==='/')return response.writeHead(200,{'Content-Type':'text/html'}).end(app);
  const file=resolve(scratch,decodeURIComponent(request.url.slice(1)));if(!file.startsWith(scratch+sep))return response.writeHead(404).end();
  readFile(file).then(bytes=>response.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'}).end(bytes)).catch(()=>response.writeHead(404).end());
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const host=`http://127.0.0.1:${server.address().port}/`,appFile=new URL('onehtml-lab.html',root).href;
const selected=process.argv.find(argument=>argument.startsWith('--engines='))?.slice(10),engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected||name===selected);assert(engines.length);
async function routeLibraries(context,seen=[]) {
  await context.route('https://**/*',route=>{const url=route.request().url(),body=sources.get(url);assert(body!==undefined,'Unexpected dependency: '+url);seen.push(url);return route.fulfill({body,contentType:url.endsWith('.js')?'text/javascript':'text/plain',headers:{'Access-Control-Allow-Origin':'*'}});});
}
try {
  for(const [name,browserType] of engines) {
    const browser=await browserType.launch();
    try {
      const api=await browser.newPage();api.setDefaultTimeout(20000);await api.goto(host);const seen=[];await routeLibraries(api,seen);
      await api.addScriptTag({content:scripts+'\nwindow.physicsApi={scanModules,moduleReference,moduleEntryData,moduleCatalog,downloadLibrary,libraryCache,persistedLibraries,loadLibraryCache,addMediaFile,attachMedia,prepareApplicationHtml,prepareApplicationFiles,planLibraryExtraction,retainExtractionAssets,makePreview,aiGameConnectionText};'});
      const plans=await api.evaluate(async({example,cannonUrl,threeUrl})=>{
        const a=physicsApi,settings={dimension:'3d',basis:'three',physics:'bodies'};
        const remote=a.scanModules(example);for(const ref of remote.references)await a.downloadLibrary(ref);
        const inline=await a.prepareApplicationHtml(example),again=await a.prepareApplicationHtml(inline.html),exact=await a.prepareApplicationHtml(example,false,false),files=await a.prepareApplicationFiles(example,'tower.html');
        const shrunk=await a.planLibraryExtraction(inline.html,'cdn');await a.retainExtractionAssets(shrunk);const rebound=await a.prepareApplicationHtml(shrunk.html);
        const adjacent=await a.planLibraryExtraction(inline.html,'files');await a.retainExtractionAssets(adjacent);const localRebound=await a.prepareApplicationHtml(adjacent.html);
        const localSource=example.replace(cannonUrl,'../libs/cannon-es-0.20.0.js'),localPlan=a.scanModules(localSource),local=await a.prepareApplicationHtml(localSource),localCdn=await a.planLibraryExtraction(local.html,'cdn');
        const directSource=example.replace(/<script type="importmap">[\s\S]*?<\/script>/,'').replace("from 'three'",'from '+JSON.stringify(threeUrl)).replace("from 'cannon-es'",'from "./libs/cannon-es-0.20.0.js"');
        const direct=await a.prepareApplicationHtml(directSource),directCdn=await a.planLibraryExtraction(direct.html,'cdn');
        const unknown=['<script type="module">import x from "'+cannonUrl.replace('0.20.0','0.19.0')+'";</script>','<script type="module">import x from "./cannon-es.js";</script>','<script type="module">import("'+cannonUrl+'");</script>','<template><script type="module">import * as C from "'+cannonUrl+'";</script></template>','<!-- <script type="module">import * as C from "'+cannonUrl+'";</script> -->'].map(code=>a.scanModules(code));
        const changed=inline.html.replace('data-onehtml-sha256="','data-onehtml-sha256="0'),tampered=await a.planLibraryExtraction(changed);
        const descriptions=[a.aiGameConnectionText(example,'three',settings),a.aiGameConnectionText(example.replace(cannonUrl, 'https://unknown.test/cannon.js'),'three',settings)];
        a.libraryCache.clear();a.persistedLibraries.clear();await a.loadLibraryCache();const restored=await a.prepareApplicationHtml(example);
        return {references:remote.references.map(ref=>({key:ref.key,bytes:ref.downloadBytes})),inline,again,exact:exact.html,files,shrunk,rebound,adjacent,localRebound,localCount:localPlan.references.length,localCdn:localCdn.html,directCdn:directCdn.html,unknown:unknown.map(plan=>({refs:plan.references.length,issues:plan.issues.length})),changed,tampered:tampered.html,tamperedCount:tampered.count,descriptions,restored:restored.missingLibraries.length,escaped:typeof window.CANNON};
      },{example,cannonUrl,threeUrl});
      assert.equal(plans.references.length,2);assert.equal(plans.references.find(ref=>ref.key==='cannon-es@0.20.0').bytes,346256);
      assert.equal(seen.filter(url=>url===cannonUrl).length,1);assert.equal(plans.escaped,'undefined','Downloaded physics must not execute in editor');
      assert.equal(plans.inline.missingLibraries.length,0);assert.equal(plans.inline.bundledLibraries.length,2);assert.equal(plans.exact,example);assert.equal(plans.again.html.match(/data-onehtml-modules="1"/g).length,1);
      assert.equal(plans.shrunk.count,2);assert.equal(plans.adjacent.count,2);assert.equal(plans.restored,0);assert.equal(plans.rebound.missingLibraries.length,0);assert.equal(plans.localRebound.missingLibraries.length,0);
      assert.equal(plans.files.files.length,3);assert(plans.files.files.some(file=>file.name==='cannon-es-0.20.0.js'));
      const cannonFile=plans.files.files.find(file=>file.name==='cannon-es-0.20.0.js');assert(clean(cannonFile.content.replace(/^\/\/ /gm,'')).includes(clean(sources.get(cannonUrl.replace('/dist/cannon-es.js','/LICENSE')))),'Full copyright and MIT terms must remain in exported JS');
      assert.equal(plans.localCount,2);assert(plans.localCdn.includes(cannonUrl)&&!plans.localCdn.includes('../libs/cannon-es-0.20.0.js'));
      assert(plans.directCdn.includes(cannonUrl)&&!plans.directCdn.includes('./libs/cannon-es-0.20.0.js'));
      assert.deepEqual(plans.unknown.map(plan=>plan.refs),[0,0,0,0,0]);assert(plans.unknown[0].issues&&plans.unknown[1].issues&&plans.unknown[2].issues);
      assert.equal(plans.tamperedCount,0);assert.equal(plans.tampered,plans.changed);
      assert(!plans.descriptions[0].includes('дополнительные библиотеки'));assert(plans.descriptions[1].includes('Ожидаемое подключение cannon-es не найдено'));
      const failures=await api.evaluate(async()=>{
        const a=physicsApi,ref=a.moduleCatalog('cannon-es@0.20.0'),original=window.fetch,license=a.libraryCache.get(ref.key).license,answer=[];a.libraryCache.delete(ref.key);
        for(const mode of ['license','dependency','mime']){
          window.fetch=async url=>new Response(String(url).endsWith('/LICENSE')?(mode==='license'?'No permission':license):"import './extra.js'; export const World=1;",{headers:{'Content-Type':mode==='mime'?'text/html':'text/javascript'}});
          try{await a.downloadLibrary(ref);answer.push(false);}catch{answer.push(!a.libraryCache.has(ref.key));}
        }window.fetch=original;await a.loadLibraryCache();return answer;
      });assert.deepEqual(failures,[true,true,true]);
      const combined=await api.evaluate(async({game,base64,loaderUrl})=>{const a=physicsApi,asset=await a.addMediaFile(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'satellite.glb',{type:'model/gltf-binary'})),code=a.attachMedia(game,'satellite.glb',asset);await a.downloadLibrary(a.moduleReference(loaderUrl));return {inline:await a.prepareApplicationHtml(code),files:await a.prepareApplicationFiles(code,'combined.html'),description:a.aiGameConnectionText(code,'three',{dimension:'3d',basis:'three',physics:'bodies'})};},{game:combinedGame,base64:model.toString('base64'),loaderUrl});
      assert(!combined.description.includes('дополнительные библиотеки'),'Compatible GLB loader is part of the Three.js physics setup');
      assert.equal(combined.inline.missingLibraries.length,0);assert.equal(combined.inline.missingMedia.length,0);assert.equal(combined.files.files.length,5);assert.equal(combined.inline.html.match(/data-onehtml-modules="1"/g).length,1);assert.equal(seen.filter(url=>url===threeUrl).length,1,'GLTFLoader and physics share the existing exact Three.js core');
      await api.unroute('https://**/*');let external=0;await api.route('https://**/*',route=>{external++;return route.abort();});
      await api.evaluate(html=>{const host=document.querySelector('#preview');host.hidden=false;const frame=physicsApi.makePreview(html,false);frame.style.cssText='width:100%;height:500px';host.replaceChildren(frame);document.body.replaceChildren(host);},plans.inline.html);
      const isolated=api.frameLocator('#preview iframe');await isolated.locator('#fire:enabled').waitFor({state:'visible'});
      assert.equal(await api.locator('#preview iframe').getAttribute('sandbox'),'allow-scripts');
      assert(await isolated.locator('body').evaluate(()=>{try{void parent.document.body;return false;}catch{return true;}}));
      await isolated.locator('#fire').click();await isolated.locator('#fallen').evaluate(node=>new Promise((resolve,reject)=>{let attempts=0;const poll=()=>Number(node.textContent)>0?resolve():attempts++>300?reject(Error('No physical impact')):setTimeout(poll,20);poll();}));
      await api.evaluate(html=>document.querySelector('#preview').replaceChildren(physicsApi.makePreview(html,false)),combined.inline.html);await isolated.locator('#result').getByText('ready',{exact:true}).waitFor();
      const modelPhysics=await isolated.locator('body').evaluate(()=>window.combined);assert.equal(modelPhysics.three,'160');assert(modelPhysics.meshes>=8&&modelPhysics.textures>0&&modelPhysics.animations===1);assert(modelPhysics.height>.25&&modelPhysics.height<.4,'Loaded GLB follows its settled physics body');assert.equal(external,0);await api.close();
      for(const file of plans.files.files)await writeFile(join(scratch,file.name),file.content);
      for(const [location,width] of [[pathToFileURL(join(scratch,name+'-inline.html')).href,320],[host+'tower.html',1365]]) {
        if(location.startsWith('file:'))await writeFile(join(scratch,name+'-inline.html'),plans.inline.html);
        const page=await browser.newPage({viewport:{width,height:800},hasTouch:width===320}),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());await page.goto(location);
        await page.waitForFunction(()=>!document.querySelector('#fire').disabled);assert.equal(await page.locator('#fallen').innerText(),'0');
        await page.locator('#fire').click();await page.waitForFunction(()=>Number(document.querySelector('#fallen').textContent)>0);assert.equal(await page.locator('#shots').innerText(),'1');
        await page.locator('#pause').click();assert(await page.locator('#fire').isDisabled());await page.locator('#reset').click();assert.equal(await page.locator('#shots').innerText(),'0');await page.locator('#pause').click();
        const stageBox=await page.locator('#stage').boundingBox(),x=stageBox.x+stageBox.width/2,y=stageBox.y+stageBox.height/2;
        await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+15,{steps:4});await page.mouse.up();assert.equal(await page.locator('#shots').innerText(),'0','Dragging the camera must not fire');
        if(width===320){await page.touchscreen.tap(x,y);assert.equal(await page.locator('#shots').innerText(),'1');await page.locator('#reset').click();}
        await page.locator('.settings summary').click();await page.locator('#mass').fill('4');await page.locator('#mass').dispatchEvent('change');assert.equal(await page.locator('#mass-value').innerText(),'4 кг');assert.equal(await page.locator('#fallen').innerText(),'0');
        await page.locator('#friction').fill('0');await page.locator('#friction').dispatchEvent('change');await page.locator('#bounce').fill('0.8');await page.locator('#bounce').dispatchEvent('change');
        await page.locator('#help-toggle').click();assert(await page.locator('#help').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('#stage').evaluate(node=>node.clientHeight>100));
        // Opening controls resizes WebGL after the current frame; inspect the following painted frame.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const colors=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>{const sample=document.createElement('canvas');sample.width=64;sample.height=64;const context=sample.getContext('2d');context.drawImage(document.querySelector('#stage canvas'),0,0,64,64);const pixels=context.getImageData(0,0,64,64).data,colors=new Set();for(let i=0;i<pixels.length;i+=4)if(pixels[i+3])colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]);resolve(colors.size);})));
        assert(colors>20,'The rendered scene must contain visible geometry, not only its background');
        await page.screenshot({path:join(scratch,`${name}-${width}-physics.png`)});await page.locator('#help-toggle').click();await page.locator('.settings summary').click();
        await page.locator('body').click({position:{x:10,y:150}});await page.keyboard.press('r');await page.keyboard.press('Space');await page.waitForFunction(()=>Number(document.querySelector('#shots').textContent)===1);
        assert.deepEqual(errors,[]);await page.close();
      }
      // UI: requirements/copy/history/response checking, explicit download, both editors/themes and shortening.
      for(const [location,width] of [[appFile,320],[host,1365]]) {
        const context=await browser.newContext({viewport:{width,height:800}});const downloaded=[];await routeLibraries(context,downloaded);
        await context.addInitScript(()=>{window.copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied=text}});});
        const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(location);await page.waitForFunction(()=>!document.querySelector('#code').disabled);await page.locator('#expert-toggle').click();await page.locator('#ai-open').click();await page.locator('#ai-task').fill('Сделай игру про башню и шар');await page.locator('#ai-game-options summary').click();await page.locator('#ai-game-dimension').selectOption('3d');await page.locator('#ai-game-physics').selectOption('bodies');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
        assert((await page.locator('#ai-game-recommendation').innerText()).includes('cannon-es'));assert.equal(await page.locator('#ai-game-warning').innerText(),'');const prompt=await page.locator('#ai-output').inputValue();assert(prompt.includes(cannonUrl));assert(!prompt.includes('three.min.js'));assert.equal(downloaded.length,0,'Preparing a prompt does not download libraries');await page.locator('#ai-copy').click();assert.equal(await page.evaluate(()=>window.copied),prompt);
        await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);await page.locator('#ai-open').click();assert.equal(await page.locator('#ai-game-physics').inputValue(),'bodies');await page.locator('#ai-answer-open').click();await page.locator('#ai-answer-text').fill(example);assert((await page.locator('#ai-answer-basis').innerText()).includes('cannon-es'));assert(!(await page.locator('#ai-answer-basis').innerText()).includes('дополнительные библиотеки'));await page.locator('#ai-answer-compare').click();await page.locator('#ai-answer-apply').click();
        await page.locator('#run').click();await page.locator('#library-request').waitFor({state:'visible'});const consent=await page.locator('#library-request-text').innerText();assert(consent.includes('cannon-es 0.20.0')&&consent.includes('338,1'));assert.equal(downloaded.length,0);await page.locator('#library-download').click();await page.locator('#library-request').waitFor({state:'hidden'});await page.locator('#network-toggle').click();await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#fire:enabled').waitFor({state:'visible'});await page.frameLocator('#preview iframe').locator('#fire').click();await page.frameLocator('#preview iframe').locator('#shots').getByText('1',{exact:true}).waitFor();await page.locator('#run').click();
        await page.locator('#theme-toggle').click();await page.locator('#library-extract-open').click();await page.locator('[data-library-mode="embed"]').click();await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);await page.locator('#library-extract-apply').click();await page.locator('#library-extraction').waitFor({state:'hidden'});const full=await page.locator('#code').inputValue();assert(full.includes('data-onehtml-modules'));
        await page.locator('#ai-open').click();await page.locator('#prompt-change').click();await page.locator('#ai-task').fill('Сделай блоки зелёными');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);const short=await page.locator('#ai-output').inputValue();assert(short.length<40000&&!short.includes('data:text/javascript;base64'));assert(short.includes(cannonUrl));assert.equal(await page.locator('#code').inputValue(),full);
        await page.locator('#ai-close').click();await page.locator('#library-extract-open').click();await page.locator('[data-library-mode="cdn"]').click();await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);await page.locator('#library-extract-apply').click();assert((await page.locator('#code').inputValue()).includes(cannonUrl));assert(!(await page.locator('#code').inputValue()).includes('data:text/javascript;base64'));
        const small=await page.locator('#code').inputValue();await page.locator('#editor-toggle').click();assert.equal(await page.locator('#code').inputValue(),small);await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#fire:enabled').waitFor({state:'visible'});await page.frameLocator('#preview iframe').locator('#fire').click();await page.frameLocator('#preview iframe').locator('#shots').getByText('1',{exact:true}).waitFor();await page.locator('#run').click();
        await page.locator('#examples-open').click();await page.locator('[data-example-category="media"]').click();assert(await page.locator('[data-example-id="3d-physics"]').isVisible());assert.deepEqual(errors,[]);await context.close();
      }
      console.log(`${name}: real cannon-es collisions, full MIT, exact/local versions, cache, isolation, offline/file export, physics prompts, history, themes, editors and reversible shortening passed.`);
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('Physics screenshots: '+scratch);
await import('./physics-benchmark.mjs');
