import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const root=new URL('../',import.meta.url);
const [bundle,source,license]=await Promise.all(['src/library-bundle.js','node_modules/tone/build/Tone.js','src/vendor/tone-LICENSE.txt'].map(path=>readFile(new URL(path,root),'utf8')));
const scripts=bundle.replace('/* TONE_LICENSE */ null',()=>JSON.stringify(license.replace(/\r\n?/g,'\n').trim()));
const selected=process.argv.find(arg=>arg.startsWith('--engines='))?.slice(10);
const engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected||name===selected);
assert(engines.length);
for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try {
    const page=await browser.newPage();
    await page.goto(new URL('onehtml-lab.html',root).href);
    const result=await page.evaluate(async ({scripts,source})=> {
      const api=new Function(scripts+'\nreturn {libraryReference,downloadLibrary,libraryCache};')();
      const ref=api.libraryReference('https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js');
      const fetchOriginal=window.fetch,timeoutOriginal=window.setTimeout;
      const results=[];
      for(const mode of ['primary','network','http','wrong-version','timeout','all-fail','cancel']) {
        const requests=[],controller=new AbortController();api.libraryCache.clear();
        window.setTimeout=(fn,delay,...args)=>timeoutOriginal(fn,delay===12000?25:delay,...args);
        window.fetch=async (url,options)=> {
          requests.push(url);
          if(mode==='all-fail'||mode==='network'&&url.includes('unpkg.com'))throw new TypeError('Failed to fetch');
          if(mode==='http'&&url.includes('unpkg.com'))return new Response('missing',{status:503});
          if(mode==='wrong-version'&&url.includes('unpkg.com'))return new Response('window.Tone={version:"wrong"};');
          if((mode==='timeout'||mode==='cancel')&&url.includes('unpkg.com'))return new Promise((resolve,reject)=> {
            options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
            if(mode==='cancel')controller.abort();
          });
          return new Response(source);
        };
        let error;
        try {await api.downloadLibrary(ref,{signal:controller.signal});}
        catch(e){error={message:e.message,name:e.name,libraryDownload:e.libraryDownload};}
        finally {window.fetch=fetchOriginal;window.setTimeout=timeoutOriginal;}
        results.push({mode,requests,error,cached:api.libraryCache.get(ref.key)?.source===source,count:api.libraryCache.size});
      }
      const controller=new AbortController();controller.abort();let preCancelled=false,requests=0;
      window.fetch=async()=>{requests++;return new Response(source);};
      try {await api.downloadLibrary(ref,{signal:controller.signal});}catch(e){preCancelled=e.name==='AbortError';}finally{window.fetch=fetchOriginal;}
      return {results,preCancelled,requests,escaped:typeof window.Tone};
    },{scripts,source});
    for(const item of result.results) {
      assert.equal(item.requests[0],'https://unpkg.com/tone@15.1.22/build/Tone.js');
      if(['primary','cancel'].includes(item.mode))assert.equal(item.requests.length,1);
      else {assert.equal(item.requests.length,2);assert.equal(item.requests[1],'https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js');}
      if(item.mode==='all-fail') {
        assert.equal(item.count,0);assert(item.error.libraryDownload);
        assert.match(item.error.message,/Tone\.js 15\.1\.22.*код библиотеки.*Tone\.js/);
        assert(item.error.message.includes('unpkg.com')&&item.error.message.includes('cdn.jsdelivr.net'));
        assert(item.error.message.includes('из файлов'));
      } else if(item.mode==='cancel') {
        assert.equal(item.count,0);assert.equal(item.error.name,'AbortError');assert(!item.error.libraryDownload);
      } else {assert(!item.error,JSON.stringify(item));assert(item.cached);}
    }
    assert(result.preCancelled);assert.equal(result.requests,0);assert.equal(result.escaped,'undefined');
    console.log(`${name}: Tone.js primary/mirror, network/HTTP/timeout recovery, exact source integrity, cancellation and named failures passed.`);
  } finally {await browser.close();}
}
