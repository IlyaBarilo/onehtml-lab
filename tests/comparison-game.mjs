import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const output=join(tmpdir(),'onehtml-lab-comparison-game');await mkdir(output,{recursive:true});
const license=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const game=label=>`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#e9f3ff;font:18px sans-serif;padding:12px}button{padding:12px;margin:6px}h1{font-size:22px}</style><h1>${label}</h1><output id="score"></output><button id="fail">Ошибка</button><button id="fetch">Сеть</button><script>const n=Number(localStorage.getItem('n')||0)+1;localStorage.setItem('n',String(n));document.querySelector('#score').textContent=String(n);document.querySelector('#fail').onclick=()=>{throw Error('${label} failure')};document.querySelector('#fetch').onclick=()=>fetch('https://example.test/ping').catch(()=>{});try{parent.document.body;document.body.dataset.escaped='yes'}catch{};</script>`;
for(const [name,engine] of engines){
  const browser=await engine.launch();
  try{for(const width of [320,1365]){
    const page=await browser.newPage({viewport:{width,height:width===320?568:844},hasTouch:width===320,acceptDownloads:true});page.setDefaultTimeout(15000);
    await useNativeEditor(page);
    let network=0,libraryRequests=0;const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://example.test/**',route=>{network++;return route.fulfill({body:'ok',headers:{'access-control-allow-origin':'*','timing-allow-origin':'*'}});});
    await page.route('https://cdn.jsdelivr.net/**',route=>{libraryRequests++;return route.fulfill({body:route.request().url().endsWith('LICENSE')?license:'window.Matter={fixture:true};',headers:{'access-control-allow-origin':'*'}});});
    const code=page.locator('#code'), current=game('Текущая игра'), past=game('Прошлая игра');
    const paste=next=>code.evaluate((el,next)=>{el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true}));el.value=next;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));},next);
    const score=()=>page.frameLocator('#comparison-stage iframe').locator('#score');
    const expectScore=async n=>{await score().getByText(String(n),{exact:true}).waitFor();};
    try{
      await page.goto(new URL('../onehtml-lab.html',import.meta.url).href);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      await code.fill(past);await paste(game('Промежуточная игра'));await paste(current);
      await page.locator('#expert-toggle').click();
      // A real persistent record must survive all comparison runs.
      await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#score').getByText('1',{exact:true}).waitFor();await page.locator('#run').click();
      await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('onehtml-lab-game-storage-v1:')));
      const stores=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('onehtml-lab-game-storage')).map(k=>[k,localStorage.getItem(k)])));
      const originalStores=await stores();
      await page.locator('#history-open').click();assert.equal(await page.locator('.history-entry').count(),2);
      await page.locator('.history-entry').nth(1).getByRole('button',{name:'Сравнить эту версию с текущей'}).click();
      assert(await page.locator('#diff-content').isVisible());
      await page.locator('#comparison-game-tab').click();await expectScore(1);
      assert.equal(await page.locator('#comparison-stage iframe').getAttribute('sandbox'),'allow-scripts');
      assert.equal(await page.frameLocator('#comparison-stage iframe').locator('body').getAttribute('data-escaped'),null);
      assert(await page.locator('#comparison-scrollbar').isHidden());assert(await page.locator('#run').isDisabled());
      const warn=()=>page.frameLocator('#comparison-stage iframe').locator('body').evaluate(()=>console.warn('WARNING: Multiple instances of Three.js being imported.'));
      await warn();await page.locator('#comparison-game-warning').getByText(/Предупреждение \(1\).*Подключено несколько экземпляров Three.js/).waitFor();
      assert(await page.locator('#comparison-game-error').isHidden());
      assert.equal(await page.locator('#comparison-game-warning').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 248, 232)');
      await page.locator('#comparison-game-warning summary').click();assert(await page.locator('#comparison-game-warning details div').isVisible());
      assert.match(await page.locator('#comparison-game-warning details div').innerText(),/WARNING: Multiple instances/);
      await page.locator('#comparison-game-warning summary').click();
      await page.frameLocator('#comparison-stage iframe').locator('#fail').click();await page.locator('#comparison-game-error').getByText(/Текущая версия.*(?:Текущая игра failure|браузер не сообщил подробности)/).waitFor();
      assert.match(await page.locator('#comparison-game-error').innerText(),/Ошибка \(1\)/);
      await warn();await page.locator('#comparison-game-warning').getByText(/Предупреждение \(2\)/).waitFor();
      assert(await page.locator('#comparison-game-error').isVisible());assert.match(await page.locator('#comparison-game-error').innerText(),/Ошибка \(1\)/);
      assert.equal(await page.locator('#comparison-game-error').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 237, 237)');
      await page.screenshot({path:join(output,`${name}-${width}-messages.png`)});
      await page.locator('#comparison-past').click();await expectScore(1);
      await page.frameLocator('#comparison-stage iframe').locator('h1').getByText('Прошлая игра',{exact:true}).waitFor();
      assert(await page.locator('#comparison-game-error').isHidden());
      assert(await page.locator('#comparison-game-warning').isHidden());
      await page.frameLocator('#comparison-stage iframe').locator('#fail').click();await page.locator('#comparison-game-error').getByText(/Выбранная версия.*(?:Прошлая игра failure|браузер не сообщил подробности)/).waitFor();
      await page.locator('#comparison-current').click();await expectScore(2);
      assert.equal(await page.locator('iframe').count(),1);
      await page.frameLocator('#comparison-stage iframe').locator('#fetch').click();await page.locator('#comparison-game-status').getByText(/Сеть:/).waitFor();assert(network>0);
      await page.locator('#network-toggle').click();await expectScore(3);
      const priorNetwork=network;await page.frameLocator('#comparison-stage iframe').locator('#fetch').click();
      await page.waitForTimeout(150);assert.equal(network,priorNetwork);
      assert.equal(await code.inputValue(),current);assert.deepEqual(await stores(),originalStores);
      const layout=await page.evaluate(()=>{const stage=document.querySelector('#comparison-stage').getBoundingClientRect(),close=document.querySelector('#comparison-close').getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:stage.height,bottom:stage.bottom,view:innerHeight,close:close.right};});
      assert(layout.scroll<=layout.width);assert(layout.height>180);assert(layout.bottom<=layout.view+1);assert(layout.close<=layout.width);
      await page.screenshot({path:join(output,`${name}-${width}.png`)});
      await page.locator('#comparison-code-tab').click();assert.equal(await page.locator('#comparison-stage iframe').count(),0);assert(await page.locator('#diff-content').isVisible());
      await page.locator('#comparison-game-tab').click();await expectScore(4);
      // Turn storage off without allowing a comparison write into persistent storage.
      await page.locator('#comparison-code-tab').click();await page.locator('#storage-toggle').click();await page.locator('#comparison-game-tab').click();await page.locator('#comparison-game-error').waitFor();await page.locator('#comparison-game-status').getByText(/Недоступно: localStorage/).waitFor();
      await page.locator('#comparison-code-tab').click();await page.locator('#storage-toggle').click();await page.locator('#comparison-game-tab').click();await expectScore(5);
      await page.locator('#comparison-close').click();assert.equal(await page.locator('#comparison-stage iframe').count(),0);assert(await code.isVisible());
      assert.deepEqual(await stores(),originalStores);
      await page.locator('#history-open').click();assert.equal(await page.locator('.history-entry').count(),2);await page.locator('#history-close').click();
      await page.locator('#compare').click();await page.locator('#comparison-game-tab').click();await expectScore(1);await page.locator('#comparison-close').click();
      await page.locator('#run').click();await page.frameLocator('#preview iframe').locator('#score').getByText('2',{exact:true}).waitFor();await page.locator('#run').click();
      // Missing libraries in a past version use that source, never the editor source.
      const libraryGame='<script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script><output id="library"></output><script>document.querySelector("#library").textContent=String(Matter.fixture)</script>';
      await paste(libraryGame);await paste(current);await page.locator('#compare').click();await page.locator('#comparison-game-tab').click();await expectScore(1);
      await page.locator('#comparison-past').click();await page.locator('#library-request').waitFor({state:'visible'});assert.equal(libraryRequests,0);
      await page.locator('#library-download').click();
      await page.frameLocator('#comparison-stage iframe').locator('#library').getByText('true',{exact:true}).waitFor();
      assert(libraryRequests>=2);assert.equal(await code.inputValue(),current);
      await page.locator('#comparison-game-status').getByText(/Встроено: Matter/).waitFor();
      await page.locator('#comparison-close').click();
      const localGame=libraryGame.replace('https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js','./libs/custom-engine.js');
      await paste(localGame);await paste(current);await page.locator('#compare').click();await page.locator('#comparison-game-tab').click();await expectScore(1);await page.locator('#comparison-past').click();
      await page.locator('#library-request').waitFor({state:'visible'});
      await page.locator('#library-files').setInputFiles([{name:'custom-engine.js',mimeType:'text/javascript',buffer:Buffer.from('window.Matter={fixture:true};')},{name:'LICENSE',mimeType:'text/plain',buffer:Buffer.from(license)}]);
      await page.frameLocator('#comparison-stage iframe').locator('#library').getByText('true',{exact:true}).waitFor();
      assert.equal(await code.inputValue(),current);
      // Export still takes the current editor, even if a past game was shown.
      await page.locator('#save').click();assert.equal(await page.locator('#comparison-stage iframe').count(),0);const download=page.waitForEvent('download');await page.locator('#confirm-save').click();assert.equal(await readFile(await (await download).path(),'utf8'),current);
      // Rapid switches/close cancel pending async preparation.
      await page.locator('#compare').click();await page.evaluate(()=>{document.querySelector('#comparison-game-tab').click();document.querySelector('#comparison-past').click();document.querySelector('#comparison-close').click();});
      await page.waitForTimeout(100);assert.equal(await page.locator('#comparison-stage iframe').count(),0);assert(await code.isVisible());
      assert.equal(errors.length,3);assert.match(errors[0],/Текущая игра failure/);assert.match(errors[1],/Прошлая игра failure/);assert.match(errors[2],/localStorage|operation is insecure/);
      console.log(`${name} ${width}: selected versions, isolation, temporary storage, errors, network, library download, export and cancellation passed.`);
    }catch(error){await page.screenshot({path:join(output,`${name}-${width}-failure.png`)});throw error;}finally{await page.close();}
  }}finally{await browser.close();}
}
