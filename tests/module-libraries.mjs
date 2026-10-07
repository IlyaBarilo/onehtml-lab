import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const root=new URL('../',import.meta.url), app=await readFile(new URL('onehtml-lab.html',root));
const license=await readFile(new URL('node_modules/three/LICENSE',root),'utf8');
const real=await readFile(new URL('node_modules/three/build/three.module.js',root),'utf8');
const scripts=(await Promise.all(['vendor/codemirror.bundle.js','library-bundle.js','library-modules.js','exporter.js','library-extract.js','readiness.js','diagnostics.js'].map(f=>readFile(new URL('src/'+f,root),'utf8')))).join('\n');
const base='https://cdn.jsdelivr.net/npm/three@0.180.0/build/', url=base+'three.module.js';
const source="import { revision } from './three.core.js'; export const REVISION=revision; export { revision } from './three.core.js';";
const core="export const revision='180';";
const game=`<!doctype html><meta name="viewport" content="width=device-width"><p id="result">Загрузка</p><script type="importmap">{"imports":{"three":"${url}"}}</script><script type="module">import {REVISION} from 'three';document.querySelector('#result').textContent=REVISION;</script>`;
const scratch=await mkdtemp(join(tmpdir(),'onehtml-module-tests-'));
const server=createServer((req,res)=>{
  const file=decodeURIComponent(req.url.slice(1));
  if(!file) return res.writeHead(200,{'Content-Type':'text/html'}).end(app);
  const path=resolve(scratch,file);
  if(!path.startsWith(scratch+sep)) return res.writeHead(404).end();
  readFile(path).then(body=>res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'}).end(body)).catch(()=>res.writeHead(404).end());
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const host=`http://127.0.0.1:${server.address().port}/`;
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
try {
  for(const [name,engine] of engines) {
    const browser=await engine.launch();
    try {
      const api=await browser.newPage();await api.goto(host);
      await api.addScriptTag({content:scripts+'\nwindow.moduleApi={scanModules,moduleImports,moduleCatalog,moduleEntryData,libraryCache,prepareGameHtml,prepareGameFiles,planLibraryExtraction,retainExtractionAssets,inspectDiagnosticLibraries,inspectResources,downloadLibrary};'});
      const result=await api.evaluate(async ({game,source,core,url,license})=>{
        const a=moduleApi,ref=a.moduleCatalog('three-esm@0.180.0:three.module.js');
        a.libraryCache.set(ref.key,{...ref,sourceUrl:url,source:JSON.stringify([{url,source},{url:url.replace('module','core'),source:core}]),license});
        const prepared=await a.prepareGameHtml(game);
        const repeated=await a.prepareGameHtml(prepared.html);
        const filesFromInline=await a.prepareGameFiles(prepared.html,'game.html');
        const rows=await a.inspectDiagnosticLibraries(game),resources=a.inspectResources(game,rows);
        const copyResources=a.inspectResources(prepared.html,await a.inspectDiagnosticLibraries(prepared.html));
        const files=await a.prepareGameFiles(game,'three-r180-three.module.js.html');
        const cdn=await a.planLibraryExtraction(prepared.html,'cdn');
        const local=await a.planLibraryExtraction(prepared.html,'files');
        a.libraryCache.clear();await a.retainExtractionAssets(local);
        const rebound=await a.prepareGameHtml(local.html), again=await a.prepareGameFiles(local.html,'game.html');
        const crlf=await a.planLibraryExtraction(prepared.html.replace(/\r?\n/g,'\r\n'));
        const changed=prepared.html.replace('data-onehtml-sha256="','data-onehtml-sha256="0');
        const tampered=await a.planLibraryExtraction(changed);
        const unsupported=[
          '<script type="module">import x from "three/addons/a.js";</script>',
          '<script type="module">import("'+url+'");</script>',
          '<template><script type="module">import x from "'+url+'";</script></template>',
          '<!-- <script type="module">import x from "'+url+'";</script> -->',
          '<script type="importmap">{"scopes":{}}</script><script type="module">import x from "'+url+'";</script>'
        ].map(code=>a.scanModules(code));
        return {prepared,repeated,filesFromInline,rows,resources,copyResources,files,cdn,local,rebound,again,crlf,tampered,changed,unsupported,
          unchanged:await a.prepareGameHtml(game,false),inert:window.escaped};
      },{game,source,core,url,license});
      assert.equal(result.prepared.missingLibraries.length,0);
      assert.equal(result.prepared.bundledLibraries.length,1);
      assert.equal(result.repeated.bundledLibraries.length,1);
      assert.equal(result.repeated.html.match(/data-onehtml-modules="1"/g)?.length,1,'Repeated embedding must not nest copies');
      assert.equal(result.filesFromInline.files.length,3,'An existing inline bundle can also be exported as files');
      assert(result.prepared.bundledLibraryDetails[0].addedBytes>1000);
      assert.equal(result.rows[0].state,'Есть сохранённая копия');
      assert(result.resources.rows.some(row=>row.kind==='Импорт модуля' && row.state==='Копия доступна для подмены'));
      assert(result.copyResources.rows.every(row=>typeof row.path==='string'));
      assert.equal(result.unchanged.html,game);
      assert.equal(result.cdn.html.replace(/ data-onehtml-module-links="[^"]*"/,''),game,'Shrinking must preserve the original importmap and game logic apart from its cache pin');
      assert.equal(result.cdn.count,1,JSON.stringify(result.cdn.rows));
      assert.equal(result.crlf.count,1,JSON.stringify(result.crlf.rows));
      assert.equal(result.tampered.count,0);assert.equal(result.tampered.html,result.changed);
      assert.equal(result.local.count,1,JSON.stringify(result.local.rows));
      assert(result.local.assets.every(asset=>asset.key.startsWith('module-asset@')),'Extracted copies must not overwrite the version catalog');
      assert(result.local.html.includes('data-onehtml-module-links'));
      assert.equal(result.rebound.missingLibraries.length,0);
      assert.equal(result.rebound.bundledLibraries.length,1);
      assert.equal(result.again.files.length,3);
      assert.equal(result.unsupported[0].references.length,0);
      assert(result.unsupported[1].issues.length);
      assert.equal(result.unsupported[2].references.length,0);assert.equal(result.unsupported[3].references.length,0);
      assert.equal(result.unsupported[4].references.length,0);
      assert.equal(result.inert,undefined);
      const failures=await api.evaluate(async ({license,url,source,core})=>{
        const a=moduleApi,ref=a.moduleCatalog('three-esm@0.180.0:three.module.js'),fetchOriginal=window.fetch;
        const results=[];a.libraryCache.delete(ref.key);
        for(const mode of ['missing','license','dependency','dynamic','mime']) {
          window.fetch=async address=>new Response(String(address).endsWith('LICENSE')?(mode==='license'?'No license':license):String(address).endsWith('three.core.js')?core:mode==='dependency'?"import './addons.js';":mode==='dynamic'?"import('./three.core.js');":source,{status:mode==='missing' && String(address).endsWith('three.core.js')?404:200,headers:{'Content-Type':mode==='mime'?'text/html':'text/javascript'}});
          try{await a.downloadLibrary(ref);results.push(false);}catch{results.push(!a.libraryCache.has(ref.key));}
        }
        window.fetch=fetchOriginal;return results;
      },{license,url,source,core});
      assert.deepEqual(failures,[true,true,true,true,true],'Failed downloads must not retain partial or unlicensed graphs');
      const saved=join(scratch,name+'-inline.html');await writeFile(saved,result.prepared.html);
      const standalone=await browser.newPage();let external=0;
      await standalone.route('https://**',route=>{external++;return route.abort();});
      await standalone.goto(pathToFileURL(saved).href);await standalone.locator('#result').getByText('180',{exact:true}).waitFor();
      assert.equal(external,0);await standalone.close();
      for(const file of result.files.files) await writeFile(join(scratch,file.name),file.content);
      assert(result.files.files.slice(1).every(file=>file.content.includes(license.trim())),'Each emitted module needs the full MIT notice');
      const separate=await browser.newPage();await separate.goto(host+result.files.files[0].name);
      await separate.locator('#result').getByText('180',{exact:true}).waitFor();await separate.close();
      // Direct import, external module script, aliases and a real monolithic core.
      await api.evaluate(({real,license})=>{const a=moduleApi,ref=a.moduleCatalog('three-esm@0.160.0:three.module.js');a.libraryCache.set(ref.key,{...ref,sourceUrl:ref.url,source:JSON.stringify([{url:ref.url,source:real}]),license});},{real,license});
      const actual=await api.evaluate(async ()=>{
        const url='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
        const code=`<p id="real"></p><script type="module">import {BoxGeometry,REVISION} from '${url}';document.querySelector('#real').textContent=REVISION+':'+new BoxGeometry().attributes.position.count;</script>`;
        const result=await moduleApi.prepareGameHtml(code);
        return result.html;
      });
      const realPath=join(scratch,name+'-real.html');await writeFile(realPath,actual);
      assert(actual.includes('data-onehtml-modules'),name+': real core must be bundled');
      const realPage=await browser.newPage();realPage.on('pageerror',error=>console.log(name+' real module error: '+error.message.slice(0,300)));await realPage.goto(pathToFileURL(realPath).href);
      await realPage.locator('#real').getByText('160:24',{exact:true}).waitFor();await realPage.close();
      const direct=await api.evaluate(async ()=>{
        const url='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
        return (await moduleApi.prepareGameHtml(`<p id="direct"></p><script type="module" src="${url}"></script><script type="module">import {REVISION} from '${url}';document.querySelector('#direct').textContent=REVISION;</script>`)).html;
      });
      const directPath=join(scratch,name+'-direct.html');await writeFile(directPath,direct);
      const directPage=await browser.newPage();await directPage.goto(pathToFileURL(directPath).href);
      await directPage.locator('#direct').getByText('160',{exact:true}).waitFor();await directPage.close();
      await api.close();
      for(const appUrl of [new URL('onehtml-lab.html',root).href,host]) {
        const context=await browser.newContext({viewport:{width:320,height:844}});context.setDefaultTimeout(15000);
        let requests=0;
        await context.route('https://cdn.jsdelivr.net/**',route=>{
          requests++;const path=new URL(route.request().url()).pathname;
          return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:path.endsWith('LICENSE')?license:path.endsWith('three.core.js')?core:source});
        });
        const page=await context.newPage();await useNativeEditor(page);
        await page.addInitScript(()=>{
          Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
          Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedModuleHtml=await data.files[0].text();}});
        });
        await page.goto(appUrl);
        await page.waitForFunction(()=>!document.querySelector('#code').disabled);
        await page.locator('#expert-toggle').click();await page.locator('#code').fill(game);
        await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();
        await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
        assert.match(await page.locator('#diagnostic-library-list').innerText(),/Three.js r180.*модуль/);
        assert.equal(requests,0,'Inspection must not run or download user modules');
        await page.locator('#activity-close').click();
        await page.locator('#run').click();await page.locator('#library-download').click();
        await page.locator('#library-request').waitFor({state:'hidden'});
        assert.equal(requests,3,'License, core and root are downloaded once');
        await page.locator('#run').click();
        await page.frameLocator('#preview > iframe').locator('#result').getByText('180',{exact:true}).waitFor();
        assert.match(await page.locator('#activity-summary').innerText(),/Three.js r180.*КБ/);
        await page.locator('#run').click();assert.equal(await page.locator('#code').inputValue(),game);
        for(const mode of ['embed','cdn','embed','files']) {
          await page.locator('#library-extract-open').click();
          await page.locator(`[data-library-mode="${mode}"]`).click();
          await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);
          await page.locator('#library-extract-apply').click();
          await page.locator('#library-extraction').waitFor({state:'hidden'});
          const code=await page.locator('#code').inputValue();
          assert(code.includes(mode==='embed'?'data-onehtml-modules="1"':'data-onehtml-module-links='));
        }
        assert.match(await page.locator('#code').inputValue(),/\.\/three-r180-three\.module\.js/);
        await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();
        await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
        const list=await page.locator('#diagnostic-library-list').innerText();
        assert.match(list,/three-r180-three\.module\.js/);assert.match(list,/three-r180-three\.core\.js/);
        assert.equal(await page.locator('#diagnostic-library-list .diagnostic-library-row').count(),2,'Each relative module file must have its own size');
        await page.locator('#activity-close').click();
        await page.locator('#save').click();await page.locator('#save-libraries-mode').selectOption('files');
        assert.match(await page.locator('#save-libraries-hint').innerText(),/HTTP.*без сервера/);
        await page.locator('#cancel-save').click();
        await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');
        await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
        await page.locator('#network-toggle').click();await page.locator('#run').click();
        await page.frameLocator('#preview > iframe').locator('#result').getByText('180',{exact:true}).waitFor();
        assert.equal(requests,3,'Persistent module cache must work in an opaque offline preview');
        await page.locator('#run').click();
        await page.locator('#share').click();await page.waitForFunction(()=>window.sharedModuleHtml?.includes('data-onehtml-modules="1"'));
        assert.equal(requests,3,'Sharing uses cached modules');
        await page.locator('#save').click();await page.locator('#save-libraries').check();await page.locator('#save-libraries-mode').selectOption('inline');
        const download=page.waitForEvent('download');await page.locator('#confirm-save').click();
        const target=join(scratch,name+new URL(appUrl).protocol.replace(':','')+'-download.html');await (await download).saveAs(target);
        const exported=await readFile(target,'utf8');assert(exported.includes(license.trim()));assert(exported.includes('data-onehtml-modules="1"'));
        const check=await context.newPage();await check.goto(pathToFileURL(target).href);await check.locator('#result').getByText('180',{exact:true}).waitFor();await check.close();
        console.log(`${name} ${new URL(appUrl).protocol}: inert inspection, consent, exact graph, cache, licenses and isolated offline preview passed.`);
        await context.close();
      }
      console.log(`${name}: inline file, relative HTTP files, reversibility, modified-copy protection and real Three.js r160 passed.`);
    } finally {await browser.close();}
  }
} finally {
  await new Promise(r=>server.close(r));
  assert(resolve(scratch).startsWith(resolve(tmpdir())+sep));await rm(scratch,{recursive:true,force:true});
}
