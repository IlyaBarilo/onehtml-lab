import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const app=await readFile(new URL('../onehtml-lab.html',import.meta.url));
const license=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
const scripts=(await Promise.all(['library-bundle.js','library-modules.js','media-assets.js','library-extract.js','exporter.js'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const scratch=await mkdtemp(join(tmpdir(),'onehtml-media-tests-'));
const server=createServer((req,res)=>{
  const path=resolve(scratch,decodeURIComponent(req.url.slice(1)));
  if(req.url==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end(app);
  if(!path.startsWith(scratch+sep))return res.writeHead(404).end();
  readFile(path).then(bytes=>res.writeHead(200,{'Content-Type':'text/html'}).end(bytes)).catch(()=>res.writeHead(404).end());
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const host=`http://127.0.0.1:${server.address().port}/`;
const urls=[new URL('../onehtml-lab.html',import.meta.url).href,host];
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const wav=Buffer.alloc(44+8000);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
for(let i=0;i<4000;i++)wav.writeInt16LE(Math.round(8000*Math.sin(i*2*Math.PI*440/8000)),44+i*2);
const game='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}img{width:100%;height:120px;object-fit:contain}.bg{width:80px;height:40px;background:url("./images/photo.png")}</style><img id="photo" src="./images/photo.png"><div class="bg"></div><audio id="sound" controls src="./audio/voice.wav"></audio><p id="done">Медиа</p>';
const fixture=(name,buffer,mimeType)=>({name,mimeType,buffer});
async function resources(page) {
  if(await page.locator('#activity-panel').isHidden())await page.locator('#diagnostic-open').click();
  await page.locator('[data-diagnostic-tab="resources"]').click();
  await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
}
async function setCode(page,code) {
  await page.evaluate(value=>{const field=document.querySelector('#code');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));},code);
}
async function image(page,color) {
  return Buffer.from(await page.evaluate(color=>{const canvas=document.createElement('canvas');canvas.width=20;canvas.height=10;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,20,10);return canvas.toDataURL('image/png').split(',')[1];},color),'base64');
}
async function thumbnails(page) {
  for(const img of await page.locator('#media-list img').all()) {
    await img.scrollIntoViewIfNeeded();
    const src=await img.getAttribute('src');
    await page.waitForFunction(src=>[...document.querySelectorAll('#media-list img')].some(img=>img.src===src && img.complete && img.naturalWidth>0),src);
  }
  await page.locator('.activity-body').evaluate(body=>body.scrollTop=0);
}
try {
 for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try {
   const api=await browser.newPage();await api.goto(host);
   await api.addScriptTag({content:scripts+'\nwindow.mediaApi={scanMedia,mediaCache,mediaPersisted,mediaTransaction,loadMediaCache,addMediaFile,attachMedia,prepareMediaHtml,prepareApplicationHtml,prepareApplicationFiles,mediaLimits,resolvedLibraryMatches,importLocalLibrary};'});
   const png=await image(api,'#ff2244'), blue=await image(api,'#2255ff');
   const checks=await api.evaluate(async({png,wav,game,license})=>{
    const a=mediaApi,bytes=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const img=await a.addMediaFile(new File([bytes(png)],'photo.png',{type:'image/png'}));
    const snd=await a.addMediaFile(new File([bytes(wav)],'voice.wav',{type:'audio/wav'}));
    const attached=a.attachMedia(a.attachMedia(game,'./images/photo.png',img),'./audio/voice.wav',snd);
    const prepared=await a.prepareApplicationHtml(attached),exact=await a.prepareApplicationHtml(attached,false,false);
    const files=await a.prepareApplicationFiles(attached,'game.html');
    const kinds=a.scanMedia(`<!-- <img src="fake.png"> --><script>const x='<img src="js.png">';</script><template><template><img src="t.png"></template><img src="t2.png"></template><noscript><img src="n.png"></noscript><style>/*url(comment.png)*/ p{content:'url(string.png)';background:url('real.png')}</style><p style="background:url('inline.png')"></p><img src="actual.png" src="duplicate.png"><audio><source src="voice.wav"></audio>`).refs.map(ref=>ref.path);
    const invalid=[];for(const file of [new File(['<svg/>'],'fake.png'),new File(['x'],'no-extension'),new File([new Uint8Array(a.mediaLimits.file+1)],'large.wav')])try{await a.addMediaFile(file);}catch(error){invalid.push(error.message);}
    const tampered=attached.replace('<!--onehtml-media:1:','<!--onehtml-media:1:!');
    const mark=attached.slice(a.scanMedia(attached).marker.from,a.scanMedia(attached).marker.to);
    const duplicated=await a.prepareMediaHtml(attached+mark);
    const inert=a.scanMedia('<script>const x="'+mark+'";</script>').links.length;
    const encoded=a.attachMedia('<img src="pictures/a&amp;b.png">','pictures/a&b.png',img);
    const encodedPrepared=await a.prepareMediaHtml(encoded);
    const inline=a.attachMedia(`<p style="background:url('./photo.png')"></p>`,'./photo.png',img);
    const inlinePrepared=await a.prepareMediaHtml(inline);
    const combined=attached+'<script src="./lib/custom.js"></script>';
    const [ref]=await a.resolvedLibraryMatches(combined);
    await a.importLocalLibrary(ref,'window.mediaLibrary=1;',license);
    const combinedPrepared=await a.prepareApplicationHtml(combined);
    const combinedFiles=await a.prepareApplicationFiles(combined,'game.html');
    // Quota and active-document limits are independent, and duplicates take no extra space.
    a.mediaLimits.cache=1;let full='';try{await a.addMediaFile(new File([bytes(png),new Uint8Array([1])],'new.png'));}catch(error){full=error.message;}a.mediaLimits.cache=32*1024*1024;
    a.mediaLimits.document=1;let large='';try{a.attachMedia(game,'./images/photo.png',img);}catch(error){large=error.message;}a.mediaLimits.document=16*1024*1024;
    // A corrupt derived URL in IndexedDB must never be trusted after restoration.
    await a.mediaTransaction('readwrite',store=>store.put({id:img.id,name:img.name,type:img.type,bytes:bytes(png).buffer,dataUrl:'javascript:alert(1)'}));
    a.mediaCache.clear();a.mediaPersisted.clear();await a.loadMediaCache();
    const restored=await a.prepareMediaHtml(attached);
    let mismatch='';try{a.attachMedia(game,'./images/photo.png',snd);}catch(error){mismatch=error.message;}
    a.mediaCache.delete(img.id);const missing=await a.prepareMediaHtml(attached);
    return {attached,prepared,exact,files,kinds,invalid,tampered:await a.prepareMediaHtml(tampered),duplicated,inert,encodedPrepared,inlinePrepared,mismatch,missing,combinedPrepared,combinedFiles,full,large,restored};
   },{png:png.toString('base64'),wav:wav.toString('base64'),game,license});
   assert.equal(checks.prepared.media.length,2);assert.equal(checks.prepared.missingMedia.length,0);
   assert(!checks.prepared.html.includes('onehtml-media:1:'));
   assert(checks.prepared.html.startsWith('<!doctype html>'));
   assert.equal(checks.exact.html,checks.attached);assert.equal(checks.files.files.length,1);
   assert.match(checks.prepared.html,/data:image\/png;base64/);assert.match(checks.prepared.html,/data:audio\/wav;base64/);
   assert.deepEqual(checks.kinds,['real.png','inline.png','actual.png','voice.wav']);
   assert.equal(checks.invalid.length,3);assert(checks.mismatch);
   assert(checks.tampered.mediaReason);assert(checks.duplicated.mediaReason);assert.equal(checks.inert,0);
   assert.match(checks.encodedPrepared.html,/src="data:image/);assert.match(checks.inlinePrepared.html,/url\(&quot;data:image/);
   assert.deepEqual(checks.missing.missingMedia,['./images/photo.png']);assert(checks.missing.html.includes('onehtml-media:1:'));
   assert.equal(checks.combinedPrepared.missingLibraries.length,0,'Media must not change local-library scope');
   assert.match(checks.combinedPrepared.html,/window.mediaLibrary=1/);assert.match(checks.combinedPrepared.html,/data:image\/png/);
   assert.equal(checks.combinedFiles.files.length,2);assert.match(checks.combinedFiles.html,/src="\.\/custom.js"/);
   assert(checks.full);assert(checks.large);assert(!checks.restored.html.includes('javascript:alert'));
   await api.close();
   for(const url of urls)for(const width of [320,1365])for(const editor of ['native','codemirror']) {
    const context=await browser.newContext({viewport:{width,height:844},hasTouch:width===320});context.setDefaultTimeout(10000);
    const page=await context.newPage();if(editor==='native')await useNativeEditor(page);
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>data.files?.length===1});
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.mediaShared={name:data.files[0].name,html:await data.files[0].text()};}});
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const external=[];await context.route(/https?:\/\/(?!127\.0\.0\.1)/,route=>{external.push(route.request().url());return route.abort();});
    try {
     await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
     await page.locator('#expert-toggle').click();await setCode(page,game);
     await resources(page);
     await page.locator('#media-input').setInputFiles([fixture('photo.png',png,'image/png'),fixture('voice.wav',wav,'audio/wav')]);
     await page.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===2 && !document.querySelector('#media-add').disabled);
     assert.match(await page.locator('#media-summary').innerText(),/2 файлов/);
     const imageRow=page.locator('#media-list .media-row').filter({has:page.locator('strong').getByText('photo.png',{exact:true})});
     const soundRow=page.locator('#media-list .media-row').filter({has:page.locator('strong').getByText('voice.wav',{exact:true})});
     assert(await imageRow.locator('img').evaluate(img=>img.complete && img.naturalWidth===20));
     const audioSupported=await soundRow.locator('audio').evaluate(async audio=>{
       if(!audio.canPlayType('audio/wav'))return false;
       try {audio.load();await audio.play();audio.pause();return true;}
       catch(error){if(error.name==='NotSupportedError')return false;throw error;}
     });
     if(!audioSupported)await soundRow.getByText(/Прослушивание недоступно/).waitFor();
     await imageRow.locator('.media-path').fill('./images/photo.png');await imageRow.getByRole('button',{name:'Привязать',exact:true}).click();
     await resources(page);await soundRow.locator('.media-path').fill('./audio/voice.wav');await soundRow.getByRole('button',{name:'Привязать',exact:true}).click();
     const attached=await page.locator('#code').inputValue();assert(attached.includes('onehtml-media:1:'));
     await resources(page);assert.match(await page.locator('#resource-source-list').innerText(),/Выбран файл: photo.png/);
     await page.locator('#activity-close').click();
     await page.locator('#network-toggle').click();
     await page.locator('#run').click();
     const frame=page.frameLocator('#preview > iframe');
     await frame.locator('#photo').waitFor();assert(await frame.locator('#photo').evaluate(img=>img.complete && img.naturalWidth===20));
     assert.match(await frame.locator('#sound').getAttribute('src'),/^data:audio\/wav/);
     assert.match(await frame.locator('.bg').evaluate(el=>getComputedStyle(el).backgroundImage),/data:image\/png/);
     await page.locator('#run').click();
     assert.equal(await page.locator('#code').inputValue(),attached);
     await page.locator('#share').click();await page.waitForFunction(()=>window.mediaShared);
     assert.match(await page.evaluate(()=>mediaShared.html),/data:audio\/wav;base64/);assert.match(await page.evaluate(()=>mediaShared.html),/data:image\/png;base64/);
     assert.equal(await page.locator('#code').inputValue(),attached,'Sharing prepares a separate copy');
     await page.locator('#save').click();assert(await page.locator('#save-media').isChecked());
     await page.locator('#save-media').uncheck();await page.locator('#confirm-save').waitFor({state:'visible'});
     await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);
     assert.equal(Number((await page.locator('#save-result-size').innerText()).replace(/\D/g,'')),Buffer.byteLength(attached));
     let download=page.waitForEvent('download');await page.locator('#confirm-save').click();let file=await download;
     const exactPath=join(scratch,`${name}-${width}-${editor}-exact.html`);await file.saveAs(exactPath);assert.equal(await readFile(exactPath,'utf8'),attached);
     await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);
     const estimate=Number((await page.locator('#save-result-size').innerText()).replace(/\D/g,''));
     download=page.waitForEvent('download');await page.locator('#confirm-save').click();file=await download;
     const exported=join(scratch,`${name}-${width}-${editor}-export.html`);await file.saveAs(exported);
     const html=await readFile(exported,'utf8');assert.match(html,/data:image\/png/);assert.match(html,/data:audio\/wav/);assert(!html.includes('onehtml-media:1:'));
     assert.equal(estimate,Buffer.byteLength(html),'Reported HTML size matches the actual exported bytes');
     const standalone=await context.newPage();await standalone.goto(pathToFileURL(exported).href);
     assert(await standalone.locator('#photo').evaluate(img=>img.complete && img.naturalWidth===20));
     if(audioSupported)await standalone.locator('#sound').evaluate(async audio=>{audio.load();await audio.play();audio.pause();});
     else assert.match(await standalone.locator('#sound').getAttribute('src'),/^data:audio\/wav/);
     await standalone.close();
     // Same relative name, different bytes: history must keep the original binding.
     await resources(page);await page.locator('#media-input').setInputFiles(fixture('photo.png',blue,'image/png'));
     await page.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===3 && !document.querySelector('#media-add').disabled);
     const blueRow=page.locator('#media-list .media-row').nth(2);await blueRow.locator('.media-path').fill('./images/photo.png');await blueRow.getByRole('button',{name:'Привязать',exact:true}).click();
     const newer=await page.locator('#code').inputValue();assert.notEqual(newer,attached);
     await page.locator('#activity-close').click();
     if(width===320 && editor==='native' && url.startsWith('file:')) {
       await page.locator('#history-open').click();await page.locator('#history-list [aria-label="Сравнить эту версию с текущей"]').first().click();await page.locator('#comparison-game-tab').click();
       const compared=page.frameLocator('#comparison-stage > iframe');
       await compared.locator('#photo').waitFor();assert.equal(await compared.locator('#photo').getAttribute('src'),'data:image/png;base64,'+blue.toString('base64'));
       await page.locator('#comparison-past').click();await compared.locator('#photo').waitFor();assert.equal(await compared.locator('#photo').getAttribute('src'),'data:image/png;base64,'+png.toString('base64'));
       await page.locator('#comparison-close').click();assert.equal(await page.locator('#code').inputValue(),newer);
     }
     await page.locator('#history-open').click();await page.locator('#history-list [aria-label="Вернуть версию"]').first().click();
     if(await page.locator('#replace-dialog').isVisible())await page.locator('#replace-dialog [value="replace"]').click();
     await page.waitForFunction(expected=>document.querySelector('#code').value===expected,attached);
     await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');
     await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
     assert.equal(await page.locator('#code').inputValue(),attached);await resources(page);assert.equal(await page.locator('#media-list .media-row').count(),3);
     // A compact insert uses the original caret, keeps bindings and archives the prior text.
     await page.locator('#activity-close').click();await page.evaluate(()=>{const el=document.querySelector('#code');el.setSelectionRange(el.value.length,el.value.length);});
     await resources(page);await imageRow.getByRole('button',{name:'Вставить',exact:true}).first().click();
     const inserted=await page.locator('#code').inputValue();assert.match(inserted.slice(attached.length-20),/<img src="\.\/media-/);
     assert(await page.locator('#activity-panel').isHidden());
     await resources(page);await thumbnails(page);await page.screenshot({path:join(scratch,`${name}-${width}-${editor}-resources.png`)});
     if(width===320){await page.locator('#activity-close').click();await page.locator('#theme-toggle').click();await resources(page);assert(await page.locator('#media-list').isVisible());await thumbnails(page);await page.screenshot({path:join(scratch,`${name}-${width}-${editor}-dark.png`)});}
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     await page.locator('#media-binding-details').evaluate(details=>details.open=true);
     await imageRow.getByRole('button',{name:'Удалить',exact:true}).first().click();assert.match(await page.locator('#media-delete-text').innerText(),/версиям/);
     await page.locator('#media-delete-yes').click();await page.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===2);
     assert.equal(await page.locator('#code').inputValue(),inserted);assert.match(await page.locator('#media-bindings').innerText(),/Файл отсутствует/);
     await page.locator('#media-input').setInputFiles(fixture('photo.png',png,'image/png'));await page.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===3 && !document.querySelector('#media-add').disabled);
     await page.locator('#activity-close').click();await page.locator('#expert-toggle').click();await page.locator('#run').click();
     assert(await page.frameLocator('#preview > iframe').locator('#photo').evaluate(img=>img.complete && img.naturalWidth===20));
     assert.equal(external.length,0);assert.deepEqual(errors,[]);
     console.log(`${name} ${new URL(url).protocol} ${width} ${editor}: selection, binding, audio/image/CSS, history, cache, deletion, themes and exact/offline export passed.`);
    } catch(error) {await page.screenshot({path:join(scratch,`${name}-${width}-${editor}-failure.png`)});throw error;}
    finally{await context.close();}
   }
   // Unavailable/aborted storage is visible and must not silently discard in-memory files.
   const failed=await browser.newContext();
   await failed.addInitScript(()=>{
    const open=IDBFactory.prototype.open;
    IDBFactory.prototype.open=function(name,...args){
     if(name==='onehtml-lab-media')throw new DOMException('Quota','QuotaExceededError');
     return open.call(this,name,...args);
    };
   });
   const page=await failed.newPage();await page.goto(host);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
   await page.locator('#expert-toggle').click();await setCode(page,game);await resources(page);
   await page.locator('#media-input').setInputFiles(fixture('photo.png',png,'image/png'));
   await page.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===1 && !document.querySelector('#media-add').disabled);
   assert.match(await page.locator('#media-list').innerText(),/Только этот сеанс/);await failed.close();
   const aborted=await browser.newContext();const abortedPage=await aborted.newPage();await abortedPage.goto(host);await abortedPage.waitForFunction(()=>!document.querySelector('#code').disabled);
   await abortedPage.locator('#expert-toggle').click();await resources(abortedPage);await abortedPage.locator('#media-input').setInputFiles(fixture('photo.png',png,'image/png'));
   await abortedPage.waitForFunction(()=>document.querySelectorAll('#media-list .media-row').length===1 && !document.querySelector('#media-add').disabled);
   await abortedPage.evaluate(()=>{const remove=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(...args){const result=remove.apply(this,args);if(this.name==='assets')this.transaction.abort();return result;};});
   await abortedPage.locator('#media-list').getByRole('button',{name:'Удалить',exact:true}).click();await abortedPage.locator('#media-delete-yes').click();await abortedPage.locator('#media-feedback').getByText('Не удалось удалить файл из браузера. Он остался в списке.',{exact:true}).waitFor();
   assert.equal(await abortedPage.locator('#media-list .media-row').count(),1);await abortedPage.reload();await abortedPage.waitForFunction(()=>!document.querySelector('#code').disabled);await resources(abortedPage);assert.equal(await abortedPage.locator('#media-list .media-row').count(),1);await aborted.close();
   console.log(`${name}: signature/size/manifest guards, library composition, quota fallback and transactional deletion passed.`);
  }finally{await browser.close();}
 }
}finally{server.close();}
console.log(`Media screenshots: ${scratch}`);
await import('./media-prompts.mjs');
