import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const root=new URL('../',import.meta.url);
const names=['vendor/codemirror.bundle.js','library-bundle.js','library-additions.js','library-modules.js'];
const scripts=(await Promise.all(names.map(name=>readFile(new URL('src/'+name,root),'utf8')))).join('\n');
const preparation=await readFile(new URL('src/library-preparation.js',root),'utf8');
const keys=[...preparation.split('const preparationSelection')[0].matchAll(/\['([^']+)'/g)].map(match=>match[1]);
assert.equal(keys.length,19);
const license=await readFile(new URL('node_modules/three/LICENSE',root),'utf8');
const selected=process.argv.find(arg=>arg.startsWith('--engines='))?.slice(10);
const engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected||name===selected);
assert(engines.length);
for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try {
    const page=await browser.newPage();await page.goto(new URL('onehtml-lab.html',root).href);
    const results=await page.evaluate(async({scripts,keys,license})=> {
      const a=new Function(scripts+'\nreturn{libraryCatalogReference,libraryReference,moduleReference,libraryResourceUrls,downloadLibraryResource,downloadModule,libraryCache};')();
      const original=window.fetch,originalTimeout=window.setTimeout;
      const resources=[];
      for(const key of keys) {
        const ref=a.libraryCatalogReference(key);if(!ref)throw Error(key);
        resources.push({ref,url:ref.url,resource:ref.format==='module'?'код модуля':'код библиотеки',format:ref.format==='module'?'module':'text'});
        if(!ref.licenseText)resources.push({ref,url:ref.licenseUrl,resource:'лицензию',format:'text'});
        if(ref.noticeUrl)resources.push({ref,url:ref.noticeUrl,resource:'уведомления NOTICE',format:'text'});
      }
      for(const url of ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js','https://cdnjs.cloudflare.com/ajax/libs/phaser/4.2.1/phaser.min.js','https://unpkg.com/three@0.180.0/build/three.module.js']) {
        const ref=a.libraryReference(url)||a.moduleReference(url);resources.push({ref,url,resource:'код библиотеки',format:ref.format==='module'?'module':'text'});
      }
      const p5=a.libraryCatalogReference('p5@2.3.4'),havok=a.libraryCatalogReference('@babylonjs/havok@1.3.14');
      resources.push({ref:p5,url:'https://raw.githubusercontent.com/processing/p5.js/v2.3.4/src/core/main.js',resource:'исходник',format:'binary'});
      resources.push({ref:havok,url:'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.14/lib/umd/HavokPhysics.wasm',resource:'зависимость WASM',format:'binary'});
      const checked=[];
      try {
        for(const item of resources) {
          const urls=a.libraryResourceUrls(item.ref,item.url),requests=[];
          if(urls.length<2)throw Error('No mirror: '+item.url);
          window.fetch=async url=>{requests.push(url);if(url===urls[0])throw new TypeError('Failed to fetch');return new Response(item.resource==='лицензию'?license:item.resource==='уведомления NOTICE'?'Babylon.js\nCopyright Microsoft Corporation.':item.format==='binary'?new Uint8Array([0,97,115,109]):'export const version="fixed";',{headers:{'content-type':item.format==='binary'?'application/octet-stream':'text/javascript'}});};
          await a.downloadLibraryResource(item.ref,item.url,item.resource,{credentials:'omit',redirect:'error'},item.format);
          checked.push({key:item.ref.key,url:item.url,urls,requests});
        }
        const ref=a.libraryCatalogReference('three-gltf@0.160.0'),requests=[];
        window.fetch=async url=> {
          requests.push(url);if(url.startsWith('https://cdn.jsdelivr.net/'))return new Response('unavailable',{status:503});
          const body=url.endsWith('/LICENSE')?license:url.endsWith('GLTFLoader.js')?"import {REVISION} from 'three'; import {x} from '../utils/BufferGeometryUtils.js'; export const GLTFLoader=REVISION+x;":url.endsWith('BufferGeometryUtils.js')?'export const x=1;':"export const REVISION='160';";
          return new Response(body,{headers:{'content-type':url.endsWith('/LICENSE')?'text/plain':'text/javascript'}});
        };
        await a.downloadModule(ref);
        const moduleEntry=a.libraryCache.get(ref.key),files=JSON.parse(moduleEntry.source);
        const module={requests,canonical:moduleEntry.sourceUrl===ref.url&&files.every(file=>file.url.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/')),count:files.length};
        const sample=new Uint8Array([0,97,115,109]),digest=await crypto.subtle.digest('SHA-256',sample);
        const sha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        let binaryRequests=0;
        window.fetch=async()=>new Response(++binaryRequests===1?new Uint8Array([1,2,3,4]):sample);
        const verified=await a.downloadLibraryResource(havok,resources.at(-1).url,'зависимость WASM',{},'binary',{bytes:4,sha256});
        let licenseRequests=0;
        window.fetch=async()=>new Response(++licenseRequests===1?'<!doctype html><html>Error</html>':license);
        await a.downloadLibraryResource(ref,ref.licenseUrl,'лицензию');
        window.setTimeout=(fn,delay,...args)=>originalTimeout(fn,delay===12000?50:delay,...args);
        let stalledRequests=0,stalledCancelled=false;
        window.fetch=async()=>++stalledRequests===1?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));},cancel(){stalledCancelled=true;}})):new Response('complete');
        const recovered=await a.downloadLibraryResource(ref,ref.url,'код модуля');
        let progressiveRequests=0;
        window.fetch=async()=>{progressiveRequests++;return new Response(new ReadableStream({start(c){let left=4;const tick=()=>{c.enqueue(new TextEncoder().encode('part'));if(--left)originalTimeout(tick,30);else c.close();};originalTimeout(tick,30);}}));};
        const progressive=await a.downloadLibraryResource(ref,ref.url,'код модуля');
        const controller=new AbortController();let cancelledRequests=0;
        window.fetch=async()=>{cancelledRequests++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial'));originalTimeout(()=>controller.abort(),5);}}));};
        let cancelled=false;try{await a.downloadLibraryResource(ref,ref.url,'код модуля',{signal:controller.signal});}catch(e){cancelled=e.name==='AbortError'&&!e.libraryDownload;}
        return {checked,module,binaryRequests,verified:[...verified],licenseRequests,recovered,stalledRequests,stalledCancelled,progressive,progressiveRequests,cancelled,cancelledRequests,unknown:a.libraryResourceUrls(ref,'https://example.org/arbitrary.js')};
      } finally {window.fetch=original;window.setTimeout=originalTimeout;}
    },{scripts,keys,license});
    assert(results.checked.length>40);
    for(const item of results.checked) {
      assert.equal(item.requests.length,2,item.url);assert.deepEqual(item.requests,item.urls.slice(0,2));
      if(item.url.includes('/npm/')||item.url.startsWith('https://unpkg.com/'))assert.equal(item.urls[0].replace(/^https:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/)/,''),item.urls[1].replace(/^https:\/\/(?:cdn\.jsdelivr\.net\/npm\/|unpkg\.com\/)/,''));
    }
    assert(results.module.canonical);assert.equal(results.module.count,3);assert.equal(results.module.requests.length,8);
    assert.equal(results.binaryRequests,2);assert.deepEqual(results.verified,[0,97,115,109]);assert.equal(results.licenseRequests,2);
    assert.equal(results.recovered,'complete');assert.equal(results.stalledRequests,2);assert(results.stalledCancelled);
    assert.equal(results.progressive,'partpartpartpart');assert.equal(results.progressiveRequests,1);
    assert(results.cancelled);assert.equal(results.cancelledRequests,1);assert.deepEqual(results.unknown,['https://example.org/arbitrary.js']);
    console.log(`${name}: all 19 catalog entries, CDN paths, licenses/NOTICE, module graph, WASM/source integrity, body stalls, progressive downloads and cancellation passed (${results.checked.length} resources).`);
  } finally {await browser.close();}
}
