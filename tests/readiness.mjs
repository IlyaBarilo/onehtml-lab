import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const file = new URL('../onehtml-lab.html', import.meta.url);
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const output = join(tmpdir(), 'onehtml-lab-readiness'); await mkdir(output,{recursive:true});
const urls = [file.href];
let server;
if(process.argv.includes('--http')) {
  const html=await readFile(file);
  server=createServer((_,res)=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); urls.push(`http://127.0.0.1:${server.address().port}/`);
}
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const game=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;margin:16px}button{padding:15px;display:block;margin:12px 0}</style>
<link rel="stylesheet" href="https://assets.onehtml.test/style.css"><img width="16" src="https://assets.onehtml.test/image.svg">
<button id="load">Загрузить данные</button><button id="slow">Нагрузка</button><p id="result">Игра</p>
<script>window.ticks=0;function tick(){ticks++;requestAnimationFrame(tick)}requestAnimationFrame(tick);
document.querySelector('#load').onclick=()=>fetch('https://assets.onehtml.test/data.json').then(r=>r.text()).then(()=>document.querySelector('#result').textContent='Готово').catch(()=>document.querySelector('#result').textContent='Нет сети');
document.querySelector('#slow').onclick=()=>{const end=performance.now()+180;while(performance.now()<end){}};</script>`;
async function open(page,tab) {
  if(await page.locator('#activity-panel').isHidden()) await page.locator('#diagnostic-open').click();
  await page.locator(`[data-diagnostic-tab="${tab}"]`).click();
  await page.waitForFunction(()=>!document.querySelector('#diagnostic-copy').disabled);
}
try {
  for(const [name,engine] of engines){
    const browser=await engine.launch();
    try {
      for(const url of urls) for(const width of [320,1365]) {
        const context=await browser.newContext({viewport:{width,height:844},hasTouch:width===320});
        context.setDefaultTimeout(10000);
        const page=await context.newPage();
        await useNativeEditor(page);
        const requests=[];
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await context.route('https://assets.onehtml.test/**',route=>{
          requests.push(route.request().url());
          const path=new URL(route.request().url()).pathname;
          return route.fulfill({contentType:path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/json',headers:{'Access-Control-Allow-Origin':'*','Timing-Allow-Origin':'*'},body:path.endsWith('.css')?'body{color:#25466d}':path.endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>':'{}'});
        });
        await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
        try {
          await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
          assert(await page.locator('#speed-strip').isHidden());
          await page.locator('#expert-toggle').click();await page.locator('#code').fill(game);
          await open(page,'resources');
          assert.match(await page.locator('#resource-source-list').innerText(),/style.css/);
          assert.match(await page.locator('#resource-source-list').innerText(),/image.svg/);
          assert(!(await page.locator('#resource-source-list').innerText()).includes('data.json'),'Dynamic URL is not presented as a static scan');
          assert.equal(requests.length,0,'Inspecting code cannot load resources');
          await page.locator('[data-diagnostic-tab="speed"]').click();assert(await page.locator('#speed-toggle').isChecked(), 'Speed measurement is enabled by default');
          await page.locator('#activity-close').click();
          await page.locator('#run').click();
          const frame=await (await page.locator('#preview > iframe').elementHandle()).contentFrame();
          await page.waitForFunction(()=>/^FPS \d+/.test(document.querySelector('#speed-strip').textContent));
          assert(await page.locator('#speed-strip').isVisible());
          await frame.locator('#load').click();await frame.locator('#result').getByText('Готово').waitFor();
          await frame.locator('#slow').click();
          await page.waitForFunction(()=>Number(/>100 мс: (\d+)/.exec(document.querySelector('#speed-strip').textContent)?.[1])>0);
          await open(page,'resources');assert(await page.locator('#speed-strip').isHidden());
          await page.locator('#resource-observed-list').getByText('https://assets.onehtml.test/data.json',{exact:true}).waitFor();
          const observed=await page.locator('#resource-observed-list').innerText();assert.match(observed,/Загрузка замечена/);
          await page.screenshot({path:join(output,`${name}-${width}-resources.png`)});
          await page.locator('[data-diagnostic-tab="speed"]').click();
          assert.match(await page.locator('#speed-result').innerText(),/FPS \d+/);
          await page.screenshot({path:join(output,`${name}-${width}-speed.png`)});
          // A message from the host window cannot impersonate the active game frame.
          await page.evaluate(()=>window.postMessage({type:'onehtml-lab:resource-result',url:'https://spoof.test/',status:'blocked'},'*'));
          await page.locator('#diagnostic-copy').click();
          const report=await page.locator('#copy-text').inputValue();
          assert.match(report,/Ресурсы текущего кода/);assert.match(report,/data.json/);assert.match(report,/Частота кадров браузера/);assert(!report.includes('spoof.test'));
          await page.locator('#copy-close').click();await page.locator('#activity-close').click();
          // Synthetic visibility events model suspension deterministically; the clock also has unit coverage.
          await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
          const before=await frame.evaluate(()=>performance.now());
          await page.waitForTimeout(250);
          await frame.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
          assert(await frame.evaluate(t=>performance.now()>t,before));
          await page.locator('#run').click();
          await page.locator('#code').fill(game+'\n<!-- new version -->');
          await open(page,'speed');assert.match(await page.locator('#speed-run-note').innerText(),/Код изменён/);
          assert.match(await page.locator('#speed-result').innerText(),/FPS/);
          await page.locator('#speed-toggle').uncheck();await page.locator('#activity-close').click();
          await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');
          await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
          await open(page,'speed');assert(!await page.locator('#speed-toggle').isChecked(),'An explicitly disabled measurement survives reload');
          await page.locator('#activity-close').click();
          await page.locator('#network-toggle').click();
          const count=requests.length;await page.locator('#run').click();
          assert(await page.locator('#speed-strip').isHidden());
          const offline=await (await page.locator('#preview > iframe').elementHandle()).contentFrame();
          await offline.locator('#load').click();await offline.locator('#result').getByText('Нет сети').waitFor();
          await open(page,'resources');
          await page.waitForFunction(()=>document.querySelector('#resource-observed-list').textContent.includes('Заблокировано'));
          assert.equal(requests.length,count,'Disabling network still blocks requests');
          await page.locator('[data-diagnostic-tab="speed"]').click();assert.equal(await page.locator('#speed-result').innerText(),'Нет измерений.','New run has its own results');
          await page.locator('#speed-toggle').check();await page.locator('#activity-close').click();
          await page.locator('#expert-toggle').click();
          await page.locator('#run').click();
          await page.waitForFunction(()=>/^FPS \d+/.test(document.querySelector('#speed-strip').textContent));
          assert(await page.locator('#speed-strip').isVisible(),'Setting works in simple mode');
          await page.locator('#run').click();
          await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');
          await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
          await page.locator('#run').click();await page.waitForFunction(()=>/^FPS \d+/.test(document.querySelector('#speed-strip').textContent));
          if (width === 320 && url.startsWith('file:')) {
            await page.locator('#run').click();await page.locator('#expert-toggle').click();
            const cdn='https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
            await context.route(cdn,route=>route.fulfill({contentType:'text/javascript',body:'window.THREE={REVISION:"128"};',headers:{'Access-Control-Allow-Origin':'*'}}));
            await context.route('https://cdn.jsdelivr.net/npm/three@0.128.0/LICENSE',route=>route.fulfill({body:license,headers:{'Access-Control-Allow-Origin':'*'}}));
            await page.locator('#code').fill(`<script src="${cdn}"></script><p id="lib"></p><script>document.querySelector('#lib').textContent=THREE.REVISION</script>`);
            await page.locator('#run').click();await page.locator('#library-download').click();
            await page.locator('#library-request').waitFor({state:'hidden'});
            await page.locator('#run').click();
            await page.frameLocator('#preview > iframe').locator('#lib').getByText('128',{exact:true}).waitFor();
            assert.match(await page.locator('#activity-summary').innerText(), /Three\.js r128 \(\+[\d,]+ КБ\)/, 'Each embedded library includes its added size');
            await open(page,'resources');
            assert.match(await page.locator('#resource-source-list').innerText(),/Копия доступна для подмены/);
            assert.match(await page.locator('#resource-bundled').innerText(),/three/);
            assert(!(await page.locator('#resource-observed-list').innerText()).includes(cdn),'Host library downloads are not game downloads');
          }
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual(errors,[]);
          console.log(`${name} ${new URL(url).protocol} ${width}: static/observed resources, blocked requests, FPS, report, stale code and persisted toggle passed.`);
        } catch(error){await page.screenshot({path:join(output,`${name}-${width}-failure.png`)});throw error;}
        finally{await context.close();}
      }
    } finally{await browser.close();}
  }
} finally{server?.close();}
console.log(`Readiness screenshots: ${output}`);
