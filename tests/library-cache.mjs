import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const root = new URL('../', import.meta.url), scratch = await mkdtemp(join(tmpdir(), 'onehtml-cache-'));
const license = await readFile(new URL('LICENSE', root), 'utf8');
const apache = await readFile(new URL('docs/licenses/babylonjs-9.30.0-LICENSE.txt', root), 'utf8');
const notice = await readFile(new URL('docs/licenses/babylonjs-9.30.0-NOTICE.txt', root), 'utf8');
let html = await readFile(new URL('onehtml-lab.html', root), 'utf8');
const expose = `window.cacheApi={libraryCache,persistedLibraries,loadLibraryCache,readCachedLibrary,removeLibraryCopies,libraryCatalogReference,downloadLibrary,installLibraryPack,makeLibraryPack,readLibraryPack,makeLibraryZip,readLibraryZip,prepareGameHtml,prepareGameFiles,planLibraryExtraction,retainExtractionAssets,resolvedLibraryMatches,importLocalLibrary,librarySourceHash,
  snapshot(){return [...libraryCache.values()].map(e=>({key:e.key,lazy:!!e.lazy,sourceChars:e.source?.length||0,bytes:e.bytes,error:e.cacheError||'',persistent:persistedLibraries.get(e.key)===e}));},
  gate(){const original=librarySourceHash;let release;window.hashGate=new Promise(resolve=>release=resolve);window.releaseHash=release;librarySourceHash=async value=>{if(value.includes('cache-race')){window.hashStarted=true;await window.hashGate;}return original(value);};}
};`;
const end = html.lastIndexOf('})();'); assert(end > 0); html = html.slice(0,end) + expose + html.slice(end);
const file = join(scratch,'app.html'); await writeFile(file,html);
const server = createServer((request,response)=>response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(request.url==='/seed'?'<!doctype html><title>Seed</title>':html));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const host = `http://127.0.0.1:${server.address().port}/`;
const engines = [['chromium',chromium],['webkit',webkit]].filter(([name])=>!process.argv.some(a=>a.startsWith('--engines='))||process.argv.includes('--engines='+name)); assert(engines.length);
const instrumentation = () => {
  window.cacheIO = {calls:[],payloadChars:0,indexChars:0,indexBytes:0};
  for(const method of ['get','getAll','getAllKeys']) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method]=function(...args) {
      if(this.name==='libraries'&&method==='get'&&window.failCacheReads) throw Error('Тестовый сбой чтения');
      const request=original.apply(this,args), name=this.name;
      window.cacheIO.calls.push({name,method,key:args[0]});
      request.addEventListener('success',()=>{
        const records=Array.isArray(request.result)?request.result:[request.result];
        for(const entry of records) if(entry&&typeof entry==='object') {
          if(name==='libraries') window.cacheIO.payloadChars+=(entry.source?.length||0)+(entry.license?.length||0)+(entry.notice?.length||0);
          if(name==='library-metadata') {const text=JSON.stringify(entry);window.cacheIO.indexChars+=text.length;window.cacheIO.indexBytes+=new TextEncoder().encode(text).length;}
        }
      }); return request;
    };
  }
};
async function ready(page,url) { await page.goto(url); await page.waitForFunction(()=>window.cacheApi&&!document.querySelector('#expert-toggle').disabled); }
async function reload(page) { await page.reload(); await page.waitForFunction(()=>window.cacheApi&&!document.querySelector('#expert-toggle').disabled); }
async function resetIO(page) { await page.evaluate(()=>{cacheIO.calls=[];cacheIO.payloadChars=0;cacheIO.indexChars=0;cacheIO.indexBytes=0;}); }
async function changeRecord(page,key,change,storeName='libraries') {
  await page.evaluate(async({key,change,storeName})=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('onehtml-lab-libraries');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {await new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite'),store=tx.objectStore(storeName),r=store.get(key);r.onsuccess=()=>store.put({...r.result,...change});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  },{key,change,storeName});
}
try {
  for(const [name,type] of engines) {
    const browser=await type.launch({headless:true});
    try {
      // Preserve the v1 database, and handle an older tab blocking its upgrade.
      const legacy=await browser.newContext(),seed=await legacy.newPage(); await seed.goto(host+'seed');
      await seed.evaluate(async license=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('onehtml-lab-libraries',1);r.onupgradeneeded=()=>r.result.createObjectStore('libraries',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});window.oldDB=db;db.onversionchange=()=>{};
        await new Promise(resolve=>{const tx=db.transaction('libraries','readwrite');for(let n=128;n<132;n++){const key=`three@0.${n}.0`;tx.objectStore('libraries').put({key,title:`Three.js r${n}`,sourceUrl:`https://cdn.jsdelivr.net/npm/three@0.${n}.0/build/three.min.js`,source:`window.legacyRevision=${n};`,license:n===131?'MIT':license,bytes:0,savedAt:1});}tx.oncomplete=resolve;});
      },license);
      const migrated=await legacy.newPage(); await useNativeEditor(migrated);await migrated.addInitScript(instrumentation);await ready(migrated,host);
      assert((await migrated.locator('#status').textContent()).includes('другой вкладке'));assert.equal(await migrated.evaluate(()=>cacheApi.libraryCache.size),0);
      await seed.close();await reload(migrated);
      assert.equal(await migrated.evaluate(()=>cacheApi.libraryCache.size),4);assert((await migrated.evaluate(()=>cacheApi.snapshot())).every(e=>e.lazy&&e.persistent&&e.sourceChars===0));
      assert.equal(await migrated.evaluate(()=>cacheIO.calls.filter(c=>c.name==='libraries'&&c.method==='getAll').length),0);
      await reload(migrated);assert.equal(await migrated.evaluate(()=>cacheIO.payloadChars),0);
      const restored=await migrated.evaluate(async()=>{const ref=cacheApi.libraryCatalogReference('three@0.128.0');return cacheApi.prepareGameHtml(`<script src="${ref.url}"></script>`);});
      assert(restored.html.includes('window.legacyRevision=128'));assert.equal(restored.missingLibraries.length,0);
      const invalid=await migrated.evaluate(async()=>{const errors=[];for(let n=0;n<2;n++){try{await cacheApi.readCachedLibrary({key:'three@0.131.0'});}catch(error){errors.push(error.message);}}return {errors,retained:cacheApi.libraryCache.has('three@0.131.0')};});assert.equal(invalid.errors.length,2);assert(invalid.retained);await legacy.close();

      for(const url of [pathToFileURL(file).href,host]) {
        const context=await browser.newContext({viewport:{width:320,height:700}}),page=await context.newPage();await useNativeEditor(page);await page.addInitScript(instrumentation);
        const requests=[];await context.route('https://**/*',route=>{requests.push(route.request().url());return route.abort();});await ready(page,url);
        const started=Date.now();
        const seeded=await page.evaluate(async({license,apache,notice})=>{
          const entries=[];for(let n=1;n<=16;n++){const ref=cacheApi.libraryCatalogReference(`phaser@3.${n}.0`);entries.push({...ref,sourceUrl:ref.url,source:`window.cacheLibraryValue=${n};/*`+'x'.repeat(2*1024*1024)+'*/',license,savedAt:1});}
          const module=cacheApi.libraryCatalogReference('cannon-es@0.20.0');entries.push({...module,sourceUrl:module.url,source:JSON.stringify([{url:module.url,source:'export const cachePhysics=true;'}]),license,savedAt:1});
          const unrelated=cacheApi.libraryCatalogReference('three-esm@0.160.0:three.module.js');entries.push({...unrelated,sourceUrl:unrelated.url,source:JSON.stringify([{url:unrelated.url,source:'export const REVISION="160";'}]),license,savedAt:1});
          const localCode='<script src="./lib/custom.js"></script><h1>Local</h1>',localRef=(await cacheApi.resolvedLibraryMatches(localCode))[0];await cacheApi.importLocalLibrary(localRef,'window.cacheLocal=true;',license);
          const race=cacheApi.libraryCatalogReference('three@0.130.0');entries.push({...race,sourceUrl:race.url,source:'window.cacheRace=true;/*cache-race*/',license,savedAt:1});
          const babylon=cacheApi.libraryCatalogReference('babylonjs@9.30.0');entries.push({...babylon,sourceUrl:babylon.url,source:'window.cacheBabylon=true;',license:apache,notice,savedAt:1});
          if(!await cacheApi.installLibraryPack(entries)) throw Error('Cache was not persisted');
          const inline=await cacheApi.prepareGameHtml(`<script src="${entries[0].sourceUrl}"></script><h1>Cached</h1>`),extracted=await cacheApi.planLibraryExtraction(inline.html,'files');await cacheApi.retainExtractionAssets(extracted);
          return {key:entries[0].key,other:entries[1].key,race:race.key,module:module.key,unrelated:unrelated.key,babylon:babylon.key,asset:extracted.assets[0].key,assetCode:extracted.html,localCode,source:entries[0].source,url:entries[0].sourceUrl,count:cacheApi.libraryCache.size};
        },{license,apache,notice});
        assert.equal(seeded.count,22);await reload(page);
        const startup=await page.evaluate(()=>({snap:cacheApi.snapshot(),io:cacheIO,ready:performance.now()}));
        assert(startup.snap.every(e=>e.lazy&&e.persistent&&e.sourceChars===0));assert.equal(startup.io.payloadChars,0);
        assert(startup.io.indexChars<30000);assert.equal(startup.io.calls.filter(c=>c.name==='libraries'&&c.method==='getAll').length,0);
        assert.equal(await page.evaluate(()=>window.cacheLibraryValue),undefined,'Sources must never execute in the editor');
        await page.locator('#expert-toggle').click();await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
        assert((await page.locator('#diagnostic-cache-size').textContent()).includes('Большой объём'));assert.equal(await page.locator('#diagnostic-cache-list > li').count(),22);assert.equal(await page.evaluate(()=>cacheIO.payloadChars),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#activity-close').click();
        const baseline=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('onehtml-lab-libraries');r.onsuccess=()=>resolve(r.result);});const start=performance.now();try{return await new Promise(resolve=>{const r=db.transaction('libraries').objectStore('libraries').getAll();r.onsuccess=()=>resolve({chars:r.result.reduce((n,e)=>n+e.source.length+e.license.length,0),ms:performance.now()-start});});}finally{db.close();}});
        assert(baseline.chars>32*1024*1024);await resetIO(page);
        const result=await page.evaluate(async({key,url})=>{const [a,b]=await Promise.all([cacheApi.readCachedLibrary({key}),cacheApi.readCachedLibrary({key})]);const code=`<script src="${url}"></script><h1>Cached</h1>`,prepared=await cacheApi.prepareGameHtml(code),files=await cacheApi.prepareGameFiles(code,'game.html');const pack=await cacheApi.makeLibraryPack([a]);return {same:a===b,html:prepared.html,source:files.files[1].content,keys:(await cacheApi.readLibraryPack(await cacheApi.readLibraryZip(new Uint8Array(await cacheApi.makeLibraryZip(pack).arrayBuffer())))).map(e=>e.key)};},seeded);
        assert(result.same);assert(result.html.includes(seeded.source));assert(result.source.includes(license));assert.deepEqual(result.keys,[seeded.key]);
        assert.equal(await page.evaluate(key=>cacheIO.calls.filter(c=>c.name==='libraries'&&c.method==='get'&&c.key===key).length,seeded.key),1);
        assert.equal(await page.evaluate(()=>cacheApi.snapshot().filter(e=>!e.lazy).length),1,'Only the requested code may be read');
        assert.equal(await page.evaluate(()=>window.cacheLibraryValue),undefined);
        await changeRecord(page,seeded.key,{lazy:false},'library-metadata');await reload(page);assert((await page.evaluate(()=>cacheApi.snapshot())).every(e=>e.lazy));assert(await page.evaluate(key=>cacheIO.calls.some(c=>c.name==='libraries'&&c.method==='get'&&c.key===key),seeded.key),'Malformed index must be rebuilt from the original copy');
        await changeRecord(page,seeded.module,{moduleFiles:[null]},'library-metadata');await reload(page);assert((await page.evaluate(()=>cacheApi.snapshot())).every(e=>e.lazy));assert(await page.evaluate(key=>cacheIO.calls.some(c=>c.name==='libraries'&&c.method==='get'&&c.key===key),seeded.module),'Malformed module metadata must be rebuilt');
        await reload(page);await page.locator('#code').fill(`<script src="${seeded.url}"></script><h1>Cached</h1>`);await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('h1').waitFor();assert.equal(await page.frameLocator('#preview iframe').locator('body').evaluate(()=>window.cacheLibraryValue),1);await page.locator('#run').click();
        const routes=await page.evaluate(async data=>{const a=await cacheApi.prepareGameHtml(data.localCode),b=await cacheApi.prepareGameHtml(data.assetCode),ref=cacheApi.libraryCatalogReference(data.module),c=await cacheApi.prepareGameHtml(`<script type="module">import {cachePhysics} from '${ref.url}';</script>`);return {local:a.html.includes('window.cacheLocal=true'),asset:b.html.includes(data.source),module:c.modules,missing:c.missingLibraries.length};},seeded);
        assert(routes.local&&routes.asset&&routes.module);assert.equal(routes.missing,0);assert.equal(requests.length,0);
        await reload(page);const reused=await page.evaluate(async({module,unrelated,license})=>{const ref=cacheApi.libraryCatalogReference(module),original=window.fetch;window.fetch=async url=>{if(url!==ref.licenseUrl)throw Error('Неожиданное скачивание исходника');return new Response(license);};try{await cacheApi.downloadLibrary(ref);return {related:!!cacheApi.libraryCache.get(module).source,unrelated:cacheApi.libraryCache.get(unrelated).lazy,reads:cacheIO.calls.filter(c=>c.name==='libraries'&&c.method==='get').map(c=>c.key)};}finally{window.fetch=original;}},{...seeded,license});assert(reused.related&&reused.unrelated);assert.deepEqual(reused.reads,[seeded.module]);
        await reload(page);await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
        await page.locator('#library-export-open').click();await page.locator('#library-export-format').selectOption('zip');
        const downloading=page.waitForEvent('download');downloading.catch(()=>{});await page.locator('#library-export-all').click();await page.waitForFunction(()=>!document.querySelector('#library-export-all').disabled);
        assert((await page.locator('#library-preparation-status').textContent()).startsWith('Сохраняю архив'),await page.locator('#library-preparation-status').textContent());
        const download=await downloading;assert.equal(download.suggestedFilename(),'onehtml-libraries.zip');await download.path();
        assert((await page.evaluate(()=>cacheApi.snapshot())).every(e=>!e.lazy));assert.equal(await page.evaluate(()=>cacheIO.calls.filter(c=>c.name==='libraries'&&c.method==='get').length),seeded.count,'Export all must read each copy once');
        // Deleted or replaced records must not return through an in-flight read.
        await reload(page);await page.evaluate(key=>{cacheApi.gate();window.raceRead=cacheApi.readCachedLibrary({key});},seeded.race);await page.waitForFunction(()=>window.hashStarted);
        await page.evaluate(async key=>{await cacheApi.removeLibraryCopies([cacheApi.libraryCache.get(key)]);window.releaseHash();window.raceResult=await window.raceRead;},seeded.race);assert.equal(await page.evaluate(()=>window.raceResult),undefined);await reload(page);assert(!(await page.evaluate(()=>cacheApi.snapshot())).some(e=>e.key===seeded.race));
        await page.evaluate(async({key,license})=>{const ref=cacheApi.libraryCatalogReference(key);await cacheApi.installLibraryPack([{...ref,sourceUrl:ref.url,source:'window.cacheRace="before";/*cache-race*/',license}]);},{key:seeded.race,license});await reload(page);
        await page.evaluate(key=>{cacheApi.gate();window.replacingRead=cacheApi.readCachedLibrary({key});},seeded.race);await page.waitForFunction(()=>window.hashStarted);
        const replacement=await page.evaluate(async({key,license})=>{const ref=cacheApi.libraryCatalogReference(key);await cacheApi.installLibraryPack([{...ref,sourceUrl:ref.url,source:'window.cacheRace="replacement";',license}]);window.releaseHash();const result=await window.replacingRead;await cacheApi.removeLibraryCopies([cacheApi.libraryCache.get(key)]);return result.source;},{key:seeded.race,license});assert.equal(replacement,'window.cacheRace="replacement";');
        // A transient storage error is visible and can be retried without downloading.
        const ioError=await page.evaluate(async key=>{window.failCacheReads=true;try{await cacheApi.readCachedLibrary({key});return '';}catch(e){return e.message;}finally{window.failCacheReads=false;}},seeded.other);assert(ioError.includes('Тестовый сбой чтения'));
        assert(await page.evaluate(async key=>Boolean(await cacheApi.readCachedLibrary({key})),seeded.other));
        await changeRecord(page,seeded.key,{source:'window.cacheLibraryValue="tampered";'});await reload(page);await page.locator('#code').fill(`<script src="${seeded.url}"></script><h1>Cached</h1>`);await page.locator('#run').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('повреждены'));assert.equal(await page.locator('#preview iframe').count(),0);assert((await page.locator('#code').inputValue()).includes('<h1>Cached</h1>'));
        // The damaged copy is retained until explicitly replaced or deleted.
        assert(await page.evaluate(key=>cacheApi.libraryCache.has(key),seeded.key));
        await page.evaluate(async({key,source,url,license})=>cacheApi.installLibraryPack([{key,title:'Phaser 3.1.0',sourceUrl:url,source,license}]),{...seeded,license});await reload(page);
        await changeRecord(page,seeded.key,{license:'MIT'});await reload(page);const licenseError=await page.evaluate(async key=>{try{await cacheApi.readCachedLibrary({key});return '';}catch(e){return e.message;}},seeded.key);assert(licenseError.includes('лицензия'));
        await changeRecord(page,seeded.babylon,{notice:''});await reload(page);const noticeError=await page.evaluate(async key=>{try{await cacheApi.readCachedLibrary({key});return '';}catch(e){return e.message;}},seeded.babylon);assert(noticeError.includes('NOTICE'));
        const deletion=await page.evaluate(async key=>{const entry=cacheApi.libraryCache.get(key);await cacheApi.removeLibraryCopies([entry]);return cacheIO.calls.filter(c=>c.name==='libraries'&&c.method==='get'&&c.key===key).length;},seeded.other);assert.equal(deletion,0,'Deletion must not read the source');
        console.log(`${name} ${url.startsWith('file:')?'file':'http'}: ${startup.snap.length} cached copies, ${baseline.chars.toLocaleString('en-US')} source characters avoided at startup; ${startup.io.indexBytes.toLocaleString('en-US')} index bytes read. Ready ${startup.ready.toFixed(0)} ms; old getAll ${baseline.ms.toFixed(0)} ms. Migration, offline use/export, modules/local/extracted copies, races, corruption and retry passed (${((Date.now()-started)/1000).toFixed(1)} s).`);
        await context.close();
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
