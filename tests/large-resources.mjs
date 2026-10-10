import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium,webkit} from 'playwright';

const scripts=(await Promise.all(['vendor/codemirror.bundle.js','format.js','library-bundle.js','library-modules.js','media-assets.js','media-prompts.js','media-images.js'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const license=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
const scratch=await mkdtemp(join(tmpdir(),'onehtml-large-resources-'));
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const app=new URL('../onehtml-lab.html',import.meta.url).href;
const expose=scripts+'\nwindow.resourcesApi={addMediaFile,mediaCache,mediaPersisted,loadMediaCache,attachMedia,prepareMediaHtml,planPromptMedia,downloadModule,moduleEntryData,libraryCache,mediaCacheSizeWarning};';
async function resources(page) {
  if(await page.locator('#activity-panel').isHidden())await page.locator('#diagnostic-open').click();
  await page.locator('[data-diagnostic-tab="resources"]').click();
  await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
}
async function code(page,value) {
  await page.evaluate(value=>{const field=document.querySelector('#code');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try {
    const context=await browser.newContext({viewport:{width:320,height:844},acceptDownloads:true});context.setDefaultTimeout(30000);
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route(/^https?:/,route=>route.abort());
    try {
      await page.goto(app);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=10;c.getContext('2d').fillRect(0,0,20,10);return c.toDataURL().split(',')[1];});
      await page.addScriptTag({content:expose});
      const checks=await page.evaluate(async({png,license})=>{
        const a=resourcesApi,head=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
        const upload=async(name,size,index=0)=>a.addMediaFile(new File([head,new Uint8Array(size-head.length),new Uint8Array([index])],name,{type:'image/png'}));
        const first=await upload('big.png',9*1024*1024),second=await upload('larger.png',25*1024*1024);
        for(let i=1;i<=70;i++)await upload(`small-${i}.png`,head.length,i);
        const size=a.mediaCache.size,warning=a.mediaCacheSizeWarning();
        const duplicate=await a.addMediaFile(new File([first.blob],'copy.png'));
        const deduplicated=duplicate.id===first.id && a.mediaCache.size===size;
        const bound=a.attachMedia(a.attachMedia('<img src="big.png"><img src="larger.png">','big.png',first),'larger.png',second);
        const prepared=await a.prepareMediaHtml(bound);
        const shortened=await a.planPromptMedia(prepared.html,[],true);
        const exported={count:prepared.media.length,size:new Blob([prepared.html]).size,reason:prepared.mediaReason,shortened:shortened.files.length,notes:shortened.notes};
        a.mediaCache.clear();a.mediaPersisted.clear();await a.loadMediaCache();
        const restored=a.mediaCache.size,restoredSize=[...a.mediaCache.values()].reduce((sum,entry)=>sum+entry.blob.size,0);
        const nativeFetch=window.fetch;
        const base='https://cdn.jsdelivr.net/npm/three@0.160.0/build/';
        const sources={
          'three.module.js':'/*'+'x'.repeat(4*1024*1024)+'*/\nimport "./three.module.min.js";import "./three.core.js";',
          'three.module.min.js':'export const one=1;',
          'three.core.js':'import "./three.core.min.js";export const two=2;',
          'three.core.min.js':'export const three=3;'
        };
        const urls=[];
        window.fetch=async url=>{urls.push(url);return new Response(url.endsWith('/LICENSE')?license:sources[url.slice(base.length)],{headers:{'Content-Type':'text/javascript'}});};
        let module;
        try {await a.downloadModule({key:'three-esm@0.160.0:three.module.js',url:base+'three.module.js'});module=a.moduleEntryData(a.libraryCache.get('three-esm@0.160.0:three.module.js'));}
        finally {window.fetch=nativeFetch;}
        return {size,warning,deduplicated,exported,restored,restoredSize,moduleFiles:module?.files.length,moduleBytes:module?.bytes,requests:urls.length};
      },{png,license});
      assert.equal(checks.size,72);assert(checks.deduplicated);assert.match(checks.warning,/Большой объём/);
      assert.equal(checks.restored,72);assert(checks.restoredSize>32*1024*1024);
      assert.equal(checks.exported.count,2);assert(checks.exported.size>32_000_000);assert.equal(checks.exported.reason,'');
      assert.equal(checks.exported.shortened,2);assert.deepEqual(checks.exported.notes,[]);
      assert.equal(checks.moduleFiles,4);assert(checks.moduleBytes>4*1024*1024);assert.equal(checks.requests,5);
      // The application's own cache and UI are separate from the exposed test API.
      await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      await page.locator('#expert-toggle').click();
      await code(page,'<p>Small HTML</p>');await page.locator('#save').click();
      await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);
      assert(await page.locator('#save-result-size').isVisible());assert(await page.locator('#save-media-options').isHidden());
      await page.locator('#cancel-save').click();
      const js='/*'+'x'.repeat(5*1024*1024)+'*/window.largeLibraryLoaded=true;';
      await code(page,'<!doctype html><script src="./large.js"></script>');
      await page.locator('#run').click();await page.locator('#library-files-button').waitFor({state:'visible'});
      await page.locator('#library-files').setInputFiles([{name:'large.js',mimeType:'text/javascript',buffer:Buffer.from(js)},{name:'LICENSE.txt',mimeType:'text/plain',buffer:Buffer.from(license+'\nAdditional notice: '+'x'.repeat(70*1024))}]);
      await page.waitForFunction(()=>document.querySelector('#library-request').hidden);
      await page.locator('#run').click();
      await page.waitForFunction(()=>document.querySelector('#preview iframe')?.contentWindow);
      await page.frameLocator('#preview > iframe').locator('body').waitFor({state:'attached'});
      assert(await page.frameLocator('#preview > iframe').locator('body').evaluate(()=>window.largeLibraryLoaded));
      assert.match(await page.locator('#local-access-status').innerText(),/Большой объём/);
      await page.locator('#run').click();
      await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();
      await page.locator('#diagnostic-cache-list .resource-warning').first().waitFor();
      await page.locator('#activity-close').click();
      await code(page,'<!doctype html><img id="photo" src="big.png"><img src="big.png"><img src="big.png">');
      await resources(page);
      const padded=Buffer.alloc(9*1024*1024+1);Buffer.from(png,'base64').copy(padded);
      await page.locator('#media-input').setInputFiles({name:'big.png',mimeType:'image/png',buffer:padded});
      await page.waitForFunction(()=>!document.querySelector('#media-add').disabled && document.querySelectorAll('#media-list .media-row').length===72);
      const row=page.locator('#media-list .media-row').filter({has:page.locator('strong').getByText('big.png',{exact:true})});
      // Re-selecting identical bytes keeps the original copy and its binding.
      assert.match(await row.locator('.resource-warning').innerText(),/Большой объём/);
      await row.locator('.media-path').fill('big.png');await row.getByRole('button',{name:'Привязать',exact:true}).click();
      await page.locator('#activity-close').click();await page.locator('#theme-toggle').click();await page.locator('#save').click();
      await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);
      assert.match(await page.locator('#save-result-size').innerText(),/Большой объём/);
      assert(await page.locator('#confirm-save').isEnabled());
      const colors=await page.locator('#save-result-size').evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(document.querySelector('#save-dialog')).backgroundColor}));
      assert.notEqual(colors.text,colors.background);
      assert.equal(colors.text,'rgb(234, 212, 164)','Warnings must use the dark-theme foreground');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const downloaded=page.waitForEvent('download');await page.locator('#confirm-save').click();
      const path=join(scratch,`${name}-large.html`);await(await downloaded).saveAs(path);
      const exported=await readFile(path,'utf8');assert(Buffer.byteLength(exported)>32_000_000);assert.equal((exported.match(/data:image\/png;base64/g)||[]).length,3);
      const standalone=await context.newPage();await standalone.goto(pathToFileURL(path).href);
      await standalone.waitForFunction(()=>document.querySelector('#photo').complete);
      assert.equal(await standalone.locator('#photo').evaluate(img=>img.naturalWidth),20);await standalone.close();
      await rm(path);
      await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      await page.locator('#media-open').click();
      const largeImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4096;c.height=10000;const x=c.getContext('2d');x.fillStyle='#2476ac';x.fillRect(0,0,c.width,c.height);const value=c.toDataURL().split(',')[1];c.width=c.height=1;return value;});
      await page.locator('#media-input').setInputFiles({name:'high-resolution.png',mimeType:'image/png',buffer:Buffer.from(largeImage,'base64')});
      const high=page.locator('#media-prompt-list > li').filter({has:page.locator('strong').getByText('high-resolution.png',{exact:true})});
      await high.getByRole('button',{name:'Уменьшить',exact:true}).click();
      assert.match(await page.locator('#media-image-before-info').innerText(),/Высокое разрешение/);
      assert(await page.locator('#media-image-preview').isEnabled());
      await page.locator('#media-image-size').selectOption('1024');await page.locator('#media-image-preview').click();
      await page.waitForFunction(()=>!document.querySelector('#media-image-apply').disabled);
      assert.equal(await page.locator('#media-image-after').evaluate(img=>img.naturalHeight),1024);
      assert.equal(await page.locator('#media-image-after').evaluate(img=>img.naturalWidth),419);
      await page.locator('#media-image-apply').click();
      await page.setViewportSize({width:1365,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.deepEqual(errors,[]);
      console.log(`${name}: large libraries/licenses, 4-file modules, 72-file cache, >32 MB export/shortening, warnings and >40 MP resizing passed.`);
    } catch(error) {await page.screenshot({path:join(scratch,`${name}-failure.png`)});throw error;}
    finally {await context.close();}
  } finally {await browser.close();}
}
await rmdir(scratch);
console.log('Large resource checks passed; temporary exports removed.');
