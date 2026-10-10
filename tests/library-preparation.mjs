import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';
const root=new URL('../',import.meta.url),html=await readFile(new URL('onehtml-lab.html',root));
const license=await readFile(new URL('node_modules/three/LICENSE',root),'utf8');
const apache=await readFile(new URL('docs/licenses/babylonjs-9.30.0-LICENSE.txt',root),'utf8');
const notice=await readFile(new URL('docs/licenses/babylonjs-9.30.0-NOTICE.txt',root),'utf8');
const classicUrl='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
const classic="window.THREE={REVISION:'160'};";
const game=`<!doctype html><p id="result">missing</p><script src="${classicUrl}"></script><script>document.querySelector('#result').textContent=THREE.REVISION;</script>`;
const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const host=`http://127.0.0.1:${server.address().port}/`,scratch=await mkdtemp(join(tmpdir(),'onehtml-preparation-'));
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:process.argv.includes('--engines=webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
async function panel(page) {
  if(await page.locator('#expert-toggle').getAttribute('aria-pressed')!=='true')await page.locator('#expert-toggle').click();
  if(await page.locator('#activity-panel').isHidden())await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();
  if(!await page.locator('#library-preparation').evaluate(e=>e.open))await page.locator('#library-preparation summary').click();
}
async function settled(page) {
  try {await page.waitForFunction(()=>!document.querySelector('#library-download-all').disabled);}
  catch(error) {throw Error(`${error.message}\n${await page.locator('#library-preparation-status').innerText()}\n${await page.locator('#library-download-all').evaluate(e=>e.outerHTML)}`);}
}
async function importFiles(page,files) {
  await page.evaluate(()=>{window.preparationFileChanged=false;document.querySelector('#library-preparation-input').addEventListener('change',()=>{window.preparationFileChanged=true;},{once:true});});
  await page.locator('#library-preparation-input').setInputFiles(files);
  await page.waitForFunction(()=>window.preparationFileChanged);await settled(page);
}
async function importArchive(page,file) {
  await page.evaluate(()=>{window.preparationArchiveChanged=false;document.querySelector('#library-preparation-archive').addEventListener('change',()=>{window.preparationArchiveChanged=true;},{once:true});});
  const choosing=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Загрузить из архива…',exact:true}).click();
  const chooser=await choosing;assert.equal(chooser.isMultiple(),false);await chooser.setFiles(file);
  await page.waitForFunction(()=>window.preparationArchiveChanged);await settled(page);
  assert.equal(await page.locator('#library-preparation-archive').inputValue(),'','The archive picker can load the same file again');
}
async function archive(page,all=true) {
  await page.locator('#library-export-format').selectOption('zip');const waiting=page.waitForEvent('download');
  await page.locator(all?'#library-export-all':'#library-export-selected').click();const download=await waiting;
  assert.equal(download.suggestedFilename(),'onehtml-libraries.zip');return {name:download.suggestedFilename(),mimeType:'application/zip',buffer:await readFile(await download.path())};
}
function storedFiles(buffer) {
  const files=[];let at=0;
  while(buffer.readUInt32LE(at)===0x04034b50) {
    const size=buffer.readUInt32LE(at+22),nameLength=buffer.readUInt16LE(at+26),start=at+30+nameLength;
    files.push({name:buffer.subarray(at+30,start).toString('utf8'),mimeType:'text/plain',buffer:buffer.subarray(start,start+size)});at=start+size;
  }
  return files;
}
try {
  for(const [engineName,engine] of engines) {
    const browser=await engine.launch();
    try {
      const cases=engineName==='chromium'?[[320,new URL('onehtml-lab.html',root).href],[1365,host]]:[[320,new URL('onehtml-lab.html',root).href]];
      for(const [width,url] of cases) {
        const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),requests=[];
        await useNativeEditor(page);page.setDefaultTimeout(8000);page.on('pageerror',error=>console.error(error.message));let failMatter=true;
        await context.route('**/*',async route=> {
          const url=route.request().url();if(!url.startsWith('https://'))return route.continue();requests.push(url);
          if(url.includes('matter-js@')&&url.endsWith('.js')&&failMatter)return route.fulfill({status:503,body:'unavailable'});
          const body=url.includes('NOTICE')?notice:/\/(?:LICENSE|license)(?:\.md)?$/.test(url)?url.includes('babylon')?apache:license
            :url.includes('/GLTFLoader.js')?"import {REVISION} from 'three'; import {x} from '../utils/BufferGeometryUtils.js'; export const GLTFLoader=REVISION+x;"
            :url.includes('/BufferGeometryUtils.js')?"export const x='ok';"
            :url.includes('/three.module.js')?"export const REVISION='160';"
            :url.includes('/cannon-es.js')?"export const World=class {};"
            :url===classicUrl?classic:"window.libraryFixture=true;";
          await route.fulfill({status:200,contentType:url.endsWith('.js')?'text/javascript':'text/plain',body});
        });
        await page.goto(url);await page.locator('#code').fill(game);
        await panel(page);assert.equal(await page.locator('#library-preparation-list li').count(),11);
        assert(await page.getByRole('button',{name:'Скачать все библиотеки',exact:true}).isEnabled());
        assert(await page.getByRole('button',{name:'Сохранить все библиотеки',exact:true}).isDisabled());
        assert(await page.evaluate(()=>document.querySelector('#library-export-all').getBoundingClientRect().bottom<=document.querySelector('#library-preparation-list').getBoundingClientRect().top),'Saving the complete set must be available before the long catalog');
        await page.locator('#library-download-all').click();await settled(page);
        assert.match(await page.locator('#library-preparation-status').innerText(),/Не загружены.*Matter/s,JSON.stringify(requests));
        assert.equal(await page.locator('#diagnostic-cache-list li').count(),10);
        failMatter=false;const check=page.locator('input[data-library-key="matter-js@0.20.0"]');await check.check();
        await page.locator('#library-download-selected').click();await settled(page);assert.equal(await page.locator('#diagnostic-cache-list li').count(),11);
        const before=requests.length;await page.locator('#library-download-all').click();await settled(page);assert.equal(requests.length,before,'Prepared copies must not be downloaded again');
        assert.equal(await page.locator('#code').inputValue(),game,'Preparation must not edit the game');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Catalog must fit the phone');
        await page.locator('#activity-close').click();await page.locator('#theme-toggle').click();await panel(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const chosenPack=await archive(page,false),pack=await archive(page);assert(pack.buffer.length>10000,'Full licenses and NOTICE must be transported');
        await page.locator('#library-export-format').selectOption('files');await page.locator('#library-export-all').click();await settled(page);
        const count=await page.locator('#library-export-file-list button').count();assert(count>22);
        const individual=storedFiles(pack.buffer);assert.equal(individual.length,count);
        for(const index of [0,1]) {
          const waiting=page.waitForEvent('download');await page.locator('#library-export-file-list button').nth(index).click();const download=await waiting;
          assert.equal(download.suggestedFilename(),individual[index].name);assert.deepEqual(await readFile(await download.path()),individual[index].buffer);
        }
        assert.equal(individual[0].name,'onehtml-libraries.json');
        const student=await browser.newContext({viewport:{width,height:800}}),fresh=await student.newPage();await useNativeEditor(fresh);
        // WebKit's simulated offline mode also disables File reads; deny external requests instead.
        if(engineName==='webkit')await student.route('**/*',route=>route.request().url().startsWith('https://')?route.abort():route.continue());
        await fresh.goto(url);await panel(fresh);
        if(engineName==='chromium')await student.setOffline(true);
        await importFiles(fresh,chosenPack);
        assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),1,'Selected export: '+await fresh.locator('#library-preparation-status').innerText());
        await importFiles(fresh,individual);
        assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),11,'Individual files with manifest must install offline');
        await importArchive(fresh,pack);
        assert.match(await fresh.locator('#library-preparation-status').innerText(),/Установлено: 11.*сохранены/s);
        assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),11);
        // Incomplete individual selection must not overwrite any of the installed copies.
        await importFiles(fresh,individual.slice(0,1));
        assert.match(await fresh.locator('#library-preparation-status').innerText(),/Не хватает файла/);assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),11);
        const damagedPack={...pack,buffer:Buffer.from(pack.buffer)};damagedPack.buffer[80]^=1;await importArchive(fresh,damagedPack);
        assert.match(await fresh.locator('#library-preparation-status').innerText(),/поврежд|контрольн/i);assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),11,'A damaged archive must leave the full installed set intact');
        await importArchive(fresh,pack);assert.match(await fresh.locator('#library-preparation-status').innerText(),/Установлено: 11/);
        if(engineName==='chromium')await student.setOffline(false);await fresh.reload();await panel(fresh);assert.equal(await fresh.locator('#diagnostic-cache-list li').count(),11,'Imported copies must survive reopening');
        if(engineName==='chromium')await student.setOffline(true);await fresh.locator('#activity-close').click();await fresh.locator('#code').fill(game);await fresh.locator('#run').click();
        await fresh.frameLocator('#preview iframe').locator('#result').waitFor();assert.equal(await fresh.frameLocator('#preview iframe').locator('#result').innerText(),'160');
        const saveWaiting=fresh.waitForEvent('download');await fresh.locator('#save').click();await fresh.locator('#save-form button[type="submit"]').click();const saved=await saveWaiting;
        const output=await readFile(await saved.path(),'utf8');assert(output.includes(classic));assert(output.includes(license.trim().replace(/\r\n/g,'\n'))||output.replace(/\r\n/g,'\n').includes(license.trim().replace(/\r\n/g,'\n')));
        await student.close();await context.close();
        console.log(`${engineName} ${width}: selected/all download, retry, cache reuse, ZIP/files export, offline import, persistence and autonomous game passed.`);
      }
      if(engineName==='chromium') {
        const context=await browser.newContext(),page=await context.newPage();await useNativeEditor(page);
        await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw Error('storage disabled');}}));
        await page.goto(new URL('onehtml-lab.html',root).href);await panel(page);
        // A raw import must be tied to the explicit catalog version, as a real file-picker action is.
        const chooser=page.waitForEvent('filechooser');await page.locator('#library-preparation-list li').filter({has:page.locator('input[data-library-key="three@0.160.0"]')}).getByRole('button').click();
        await (await chooser).setFiles([{name:'three.min.js',mimeType:'text/javascript',buffer:Buffer.from(classic)},{name:'LICENSE',mimeType:'text/plain',buffer:Buffer.from(license)}]);await settled(page);
        assert.match(await page.locator('#library-preparation-status').innerText(),/Только этот сеанс/);assert.equal(await page.locator('#diagnostic-cache-list li').count(),1);
        await context.close();console.log('Raw local JS + license and unavailable-storage fallback passed.');
        const cancellation=await browser.newContext(),cancelPage=await cancellation.newPage();await useNativeEditor(cancelPage);
        let started,release;const requested=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
        await cancellation.route('**/*',async route=> {
          if(!route.request().url().startsWith('https://'))return route.continue();
          if(route.request().url().endsWith('.js')){started();await gate;}
          try{await route.fulfill({contentType:'text/javascript',body:route.request().url().endsWith('.js')?'export const World=class {};':license});}catch{}
        });
        try {
          await cancelPage.goto(new URL('onehtml-lab.html',root).href);await panel(cancelPage);
          await cancelPage.locator('input[data-library-key="cannon-es@0.20.0"]').check();await cancelPage.locator('#library-download-selected').click();await requested;
          await cancelPage.locator('#library-preparation-cancel').click();release();await settled(cancelPage);
          assert.match(await cancelPage.locator('#library-preparation-status').innerText(),/остановлена/);assert.equal(await cancelPage.locator('#diagnostic-cache-list li').count(),0);
        } finally {release();await cancellation.close();}
        console.log('Cancellation aborts pending download without installing an incomplete copy.');
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
