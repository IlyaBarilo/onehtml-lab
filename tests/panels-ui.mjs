import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium,webkit} from 'playwright';
import {useNativeEditor} from './native-editor.mjs';

const root=new URL('../',import.meta.url);
const license=await readFile(new URL('LICENSE',root),'utf8');
const output=join(tmpdir(),'onehtml-panels-ui');await mkdir(output,{recursive:true});
const source='<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script><p>Мой код</p>';
const engines=process.argv.includes('--engines=webkit')?[['webkit',webkit]]:[['chromium',chromium]];
for(const [name,engine] of engines){
 const browser=await engine.launch();
 try{for(const width of name==='webkit'?[390]:[320,390,675,1365]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width<=675,hasTouch:width<=675});
  page.setDefaultTimeout(8000);await useNativeEditor(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/plain',body:route.request().url().endsWith('.js')?'/* Fixture */window.THREE={REVISION:"160"};':license}));
  await page.goto(new URL('onehtml-lab.html',root).href);
  await page.locator('#code').fill(source);await page.locator('#expert-toggle').click();
  async function geometry(id){
   const value=await page.locator(id).evaluate(panel=>{
    const rect=panel.getBoundingClientRect(),footer=panel.querySelector('.panel-ui-footer').getBoundingClientRect();
    const theme=panel.querySelector('[data-panel-theme]').getBoundingClientRect();
    const body=panel.querySelector('.panel-body,.library-extraction-body').getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth>innerWidth,top:rect.top,bottom:rect.bottom,height:innerHeight,footer:footer.bottom,theme:theme.right,right:rect.right,bodyHeight:body.height};
   });
   assert(!value.overflow,JSON.stringify(value));assert(value.top>=0&&value.bottom<=value.height+1,JSON.stringify(value));
   assert(value.footer<=value.bottom+1&&value.right-value.theme<=16,JSON.stringify(value));assert(value.bodyHeight>100,JSON.stringify(value));
  }
  await page.locator('#examples-open').click();
  const tabs=await page.locator('.example-category').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,height:rect.height,icon:!!node.querySelector('svg')};}));
  assert(tabs.every(tab=>tab.icon&&tab.left>=0&&tab.right<=width&&tab.height>=44),JSON.stringify(tabs));
  assert(tabs.every(tab=>Math.abs(tab.top-tabs[0].top)<1),'All sections fit one row');
  const device=page.locator('#example-platform-tabs');
  await device.getByRole('tab',{name:'Компьютер',exact:true}).click();
  assert.equal(await device.getByRole('tab',{name:'Компьютер',exact:true}).getAttribute('aria-selected'),'true');
  await device.getByRole('tab',{name:'Компьютер',exact:true}).press('ArrowLeft');
  assert.equal(await device.getByRole('tab',{name:'Телефон',exact:true}).getAttribute('aria-selected'),'true');
  const deviceLayout=await device.evaluate(node=>{const rect=node.getBoundingClientRect(),search=document.querySelector('#example-search').getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,searchTop:search.top,searchBottom:search.bottom};});
  assert(deviceLayout.top<=deviceLayout.searchBottom&&deviceLayout.bottom>=deviceLayout.searchTop,'Device choice stays beside search');
  await page.locator('#example-search').fill('Поймай');assert.equal(await page.locator('.example-card').count(),1);
  const card=page.locator('[data-example-id="catch-circle"]');
  await card.getByRole('button',{name:'Задание',exact:true}).click();
  assert(await card.locator('.example-task').isVisible());assert(await card.locator('[data-lesson-prompt]').first().isDisabled());
  assert.equal(await page.locator('#code').inputValue(),source);
  await geometry('#examples-dialog');
  for(const dark of [false,true]){
   if(dark)await page.locator('#examples-dialog [data-panel-theme]').click();
   await page.screenshot({path:join(output,`${name}-${width}-examples-${dark?'dark':'light'}.png`)});
   const colors=await card.evaluate(el=>({text:getComputedStyle(el.querySelector('strong')).color,bg:getComputedStyle(document.querySelector('#examples-dialog')).backgroundColor}));
   assert.notEqual(colors.text,colors.bg);
  }
  await page.locator('#examples-dialog [data-panel-theme]').click();
  await card.getByRole('button',{name:'Открыть копию',exact:true}).click();
  await page.locator('#replace-dialog button[value="replace"]').click();
  await page.waitForFunction(()=>document.querySelector('#code').value.includes('<!doctype html>'));
  await page.locator('#examples-open').click();
  assert(await page.locator('[data-example-id="catch-circle"] [data-lesson-prompt]').first().isEnabled());
  await page.locator('#example-search').fill('несуществующий пример');assert(await page.locator('.panel-ui-empty').isVisible());
  await page.locator('#example-search').fill('');await page.locator('[data-example-category="media"]').click();
  assert(await page.locator('#example-platform-tabs').isHidden());
  await geometry('#examples-dialog');
  await page.screenshot({path:join(output,`${name}-${width}-catalog.png`)});
  const download=page.waitForEvent('download');await page.locator('[data-example-id="glb-model"]').getByRole('button',{name:'Скачать GLB'}).click();assert.equal((await download).suggestedFilename(),'satellite.glb');
  await page.locator('[data-panel-help="example-guide"]').click();assert(await page.locator('#example-guide').isVisible());
  await page.locator('#examples-close').click();
  await page.locator('#code').fill(source);
  await page.locator('#library-extract-open').click();
  await page.waitForFunction(()=>!document.querySelector('#library-extraction-summary').textContent.includes('Проверяю'));
  assert(await page.locator('#library-convert-load').isVisible());assert(await page.locator('#library-extract-apply').isDisabled());
  await geometry('#library-extraction');await page.locator('#library-extract-close').click();
  // Prepare a tiny licensed fixture; conversion itself still uses the real cache and planners.
  await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="libraries"]').click();
  await page.locator('#library-search').fill('Three.js r160');
  const row=page.locator('#library-preparation-list > li').filter({has:page.locator('input[data-library-key="three@0.160.0"]')});
  await row.locator('input').check();await page.locator('#library-download-selected').click();
  await page.waitForFunction(()=>document.querySelector('#library-preparation-status').textContent.startsWith('Готово:'));
  await page.locator('#activity-close').click();
  await page.locator('#library-extract-open').click();await page.locator('#library-extract-apply').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);
  assert.equal(await page.locator('#code').inputValue(),source);
  await page.locator('#library-extraction [data-panel-theme]').click();
  await geometry('#library-extraction');await page.screenshot({path:join(output,`${name}-${width}-conversion-dark.png`)});
  await page.locator('#library-extract-apply').click();
  await page.locator('#library-extraction').waitFor({state:'hidden'});
  const embedded=await page.locator('#code').inputValue();assert.match(embedded,/data-onehtml-library/);assert.match(embedded,/Copyright/);
  for(const mode of ['files','cdn']){
   await page.locator('#library-extract-open').click();await page.locator(`[data-library-mode="${mode}"]`).click();
   await page.waitForFunction(()=>!document.querySelector('#library-extract-apply').disabled);
   assert.equal(await page.locator('#code').inputValue(),embedded);
   assert(await page.locator('.extraction-file').first().isVisible());await geometry('#library-extraction');
   if(mode==='cdn')await page.locator('#library-extract-apply').click();else await page.locator('#library-extract-close').click();
  }
  await page.locator('#library-extraction').waitFor({state:'hidden'});
  assert.match(await page.locator('#code').inputValue(),/src="https:/);
  await page.locator('#history-open').click();assert.match(await page.locator('#history-list').innerText(),/./);
  assert.deepEqual(errors,[]);await page.close();
  console.log(`${name} ${width}: panel geometry, themes, search, tasks, copy, GLB, licensed conversion and history passed.`);
 }}finally{await browser.close();}
}
console.log('Panel screenshots: '+output);
