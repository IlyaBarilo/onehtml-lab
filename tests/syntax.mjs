import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const output=join(tmpdir(),'onehtml-lab-syntax');await mkdir(output,{recursive:true});
const sample=`<!doctype html>
<html lang="ru">
<head>
  <title>Моя игра</title>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
  <style>
    body { background: #edf4ff; color: #234567; }
    .player { width: 40px; height: 40px; background: rgb(20, 90, 160); }
  </style>
</head>
<body>
  <h1>Поймай звезду ⭐</h1>
  <button title="Начать новую игру и сбросить счёт">Играть</button>
  <script>
    // Скорость игрока
    const speed = 5;
    function movePlayer(x) { return x + speed; }
    const text = '<img src=x onerror="window.compromised=true">';
  </script>
</body>
</html>`;
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
for(const [name,engine] of engines){
  const browser=await engine.launch();
  try{for(const width of [320,1365]){
    const page=await browser.newPage({viewport:{width,height:844},hasTouch:width===320,acceptDownloads:true});page.setDefaultTimeout(15000);
    await useNativeEditor(page);
    let requests=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**',route=>{requests++;return route.abort();});
    const code=page.locator('#code');
    const settings=async()=>{await page.locator('#edit-open').click();};
    const paint=()=>page.waitForFunction(()=>document.querySelector('#code').classList.contains('has-colors')&&!document.querySelector('#code-colors').hidden);
    try{
      await page.goto(new URL('../onehtml-lab.html',import.meta.url).href);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      await code.fill(sample);await paint();assert(await page.locator('#code-colors .syntax-tag').count()>0);
      assert.equal(await page.locator('#code-colors img').count(),0);assert.equal(requests,0);
      await page.locator('#expert-toggle').click();
      const at=sample.indexOf('https://');await code.focus();await code.evaluate((el,at)=>el.setSelectionRange(at,at),at);
      await page.locator('#syntax-caption').getByText(/Three.js r128/).waitFor();
      await page.screenshot({path:join(output,`${name}-${width}-colors.png`)});
      // Compare every visible colored span with the existing plain measurement
      // layer. Token boundaries must not shift text or line wrapping.
      const mismatches=await page.evaluate(()=>{
        const mirror=document.querySelector('#code-measure'), field=document.querySelector('#code'), layer=document.querySelector('#code-colors');
        const base=mirror.getBoundingClientRect(), box=layer.getBoundingClientRect(), failures=[];
        for(const row of layer.children){
          const line=mirror.children[Number(row.dataset.line)-1];let offset=0;
          for(const span of row.querySelectorAll('span')){
            for(let j=0;j<span.textContent.length;j++){
              if(/\s/.test(span.textContent[j]))continue;
              const range=document.createRange();range.setStart(line.firstChild,offset+j);range.setEnd(line.firstChild,offset+j+1);
              const painted=document.createRange();painted.setStart(span.firstChild,j);painted.setEnd(span.firstChild,j+1);
              const r=range.getBoundingClientRect(),a=painted.getBoundingClientRect();
              if(Math.abs(a.left-box.left-(r.left-base.left-field.scrollLeft))>1||Math.abs(a.top-box.top-(r.top-base.top-field.scrollTop))>1)failures.push('position: '+span.textContent);
            }
            offset+=span.textContent.length;
          }
        }return failures;
      });assert.deepEqual(mismatches,[]);
      await settings();assert.equal(await page.locator('#edit-colors').inputValue(),'accents');
      await page.locator('#edit-colors').selectOption('syntax');await page.locator('#edit-close').click();await paint();
      assert(await page.locator('#syntax-caption').isHidden());assert.equal(await page.locator('#code-colors .syntax-accent').count(),0);
      await settings();await page.locator('#edit-colors').selectOption('off');await page.locator('#edit-close').click();await page.locator('#code-colors').waitFor({state:'hidden'});
      assert.notEqual(await code.evaluate(el=>getComputedStyle(el).color),'rgba(0, 0, 0, 0)');
      await settings();await page.locator('#edit-colors').selectOption('accents');await page.locator('#edit-font').selectOption('20');await page.locator('#edit-close').click();await paint();
      await page.locator('#edit-find').click();await page.locator('#edit-query').fill('movePlayer');await page.locator('#edit-highlight span').first().waitFor();await paint();
      assert.equal(await code.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'movePlayer');
      await page.locator('#edit-find-close').click();await code.press('End');await page.keyboard.insertText('!');await code.press('Control+z');assert.equal(await code.inputValue(),sample);
      await code.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));assert(await page.locator('#code-colors').isHidden());
      await code.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await paint();
      await settings();await page.locator('#edit-wrap').uncheck();await page.locator('#edit-close').click();
      await code.evaluate(el=>{el.scrollLeft=100;el.dispatchEvent(new Event('scroll'));});await paint();
      await page.locator('#expert-toggle').click();await paint();
      await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);await paint();
      assert.equal(await code.inputValue(),sample);assert.equal(await code.getAttribute('wrap'),'off');
      await page.locator('#save').click();assert(!await page.locator('#save-libraries').isChecked());
      const event=page.waitForEvent('download');await page.locator('#confirm-save').click();const download=await event;assert.equal(await readFile(await download.path(),'utf8'),sample);
      await code.fill('x'.repeat(1_000_001));await page.locator('#code-colors').waitFor({state:'hidden'});assert(!await code.evaluate(el=>el.classList.contains('has-colors')));
      await code.fill(sample);await paint();assert.equal(requests,0);assert.deepEqual(errors,[]);
      await code.fill('<style>p { color: white; background: black; border-color: yellow; outline-color: transparent; caret-color: rgba(0, 0, 0, 0.1); fill: #0008; stroke: hsl(240, 100%, 20%); }</style>');
      await page.waitForFunction(()=>document.querySelectorAll('.syntax-color').length===7);
      // evaluateAll resolves its node list before evaluating the callback.
      // Repainting can detach those nodes in between, giving empty CSS values.
      // Query and read computed styles together, then assert the plain snapshot.
      for(let repaint=0;repaint<5;repaint++){
        const previous=await page.locator('#code-colors .syntax-color').first().elementHandle();
        try{
          await code.evaluate(el=>el.dispatchEvent(new Event('scroll')));
          await page.waitForFunction(el=>!el.isConnected,previous);
        }finally{await previous.dispose();}
        const swatches=await page.evaluate(()=>Array.from(document.querySelectorAll('#code-colors .syntax-color'),el=>{
          const css=getComputedStyle(el);return {text:el.textContent,ink:css.color,background:css.backgroundImage,decoration:css.textDecorationLine};
        }));
        assert.deepEqual(swatches.map(s=>s.ink),['rgb(0, 0, 0)','rgb(255, 255, 255)','rgb(0, 0, 0)','rgb(0, 0, 0)','rgb(0, 0, 0)','rgb(255, 255, 255)','rgb(255, 255, 255)']);
        assert(swatches.every(s=>s.background.includes('conic-gradient')&&s.decoration==='none'));
      }
      await page.screenshot({path:join(output,`${name}-${width}-swatches.png`)});
      const cases=[
        ['<script src="./three-r160.min.js"></script>','library','three-r160',/Библиотека: Three.js r160 · локальный путь/],
        ['<img src="https://site.test/a.png">','resource','https:',/Изображение · внешний адрес/],
        ['<button>Начать игру</button>','text','Начать',/Текст HTML/],
        ['<script>fetch("/data")</script>','network','fetch',/Сеть · fetch/],
        ['<script>localStorage.clear()</script>','storage','localStorage',/Хранилище · localStorage/]
      ];
      for(const [source,kind,needle,label] of cases){
        await code.fill(source);await code.evaluate((el,at)=>el.setSelectionRange(at,at),source.indexOf(needle));
        await page.locator(`.syntax-accent-${kind}`).first().waitFor();await page.locator('#syntax-caption').getByText(label).waitFor();
        assert.notEqual(await page.locator(`.syntax-accent-${kind}`).first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
        assert.equal(await code.inputValue(),source);
      }
      await code.fill('<h1>Моя игра</h1>\n<script src="./three-r160.min.js"></script>\n<img src="./player.png">\n<script>\nfetch("/scores");\nlocalStorage.setItem("score", "10");\n</script>');await paint();
      await page.screenshot({path:join(output,`${name}-${width}-semantic.png`)});
      // Check painting against native hit testing, not just the measurement
      // layer: fractional line heights can drift over a long document.
      const longSource=Array.from({length:1500},(_,i)=>`// ${i+1}: ${'wrapped source '.repeat(7)}`).join('\n')+'\n<p>ФИНИШ</p>';
      await page.locator('#expert-toggle').click();
      await code.evaluate(el=>{el.style.scrollbarGutter='stable';});
      for(const font of ['14','16','18','20','22']){
        console.log(`${name} ${width}: checking final line at ${font}px`);
        await settings();await page.locator('#edit-font').selectOption(font);await page.locator('#edit-wrap').check();await page.locator('#edit-close').click();
        await code.fill(longSource);await code.press('Control+End');
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('#code-colors .syntax-line')).some(el=>el.textContent.includes('ФИНИШ')));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const target=await page.evaluate(()=>{
          const field=document.querySelector('#code'),box=field.getBoundingClientRect();
          const span=Array.from(document.querySelectorAll('#code-colors span')).find(el=>el.textContent.includes('ФИНИШ'));
          const range=document.createRange(),at=span.textContent.indexOf('ФИНИШ');range.setStart(span.firstChild,at);range.setEnd(span.firstChild,at+1);
          const rect=range.getBoundingClientRect();
          return {x:rect.left+1,y:(rect.top+rect.bottom)/2,top:rect.top,bottom:rect.bottom,fieldTop:box.top,fieldBottom:box.top+field.clientHeight};
        });
        assert(target.top>=target.fieldTop&&target.bottom<=target.fieldBottom,`${font}px: Last painted line is inside the native input: ${JSON.stringify(target)}`);
        await page.mouse.click(target.x,target.y);
        assert.equal(await code.evaluate(el=>el.selectionStart),longSource.indexOf('ФИНИШ'),`${font}px: Clicking colored text edits that exact character`);
        await page.keyboard.insertText('!');assert.equal(await code.inputValue(),longSource.replace('ФИНИШ','!ФИНИШ'));
        await code.press('Control+End');await code.press('Enter');await page.keyboard.insertText('ПОСЛЕДНЯЯ');
        assert.equal(await code.inputValue(),longSource.replace('ФИНИШ','!ФИНИШ')+'\nПОСЛЕДНЯЯ','Keyboard reaches and edits the final empty line');
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('#code-colors .syntax-line')).some(el=>el.textContent.includes('ПОСЛЕДНЯЯ')));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const finalGeometry=await page.evaluate(()=>{
          const field=document.querySelector('#code'),box=field.getBoundingClientRect();
          const row=Array.from(document.querySelectorAll('#code-colors .syntax-line')).find(el=>el.textContent.includes('ПОСЛЕДНЯЯ'));
          const range=document.createRange();range.selectNodeContents(row);
          const rect=range.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,fieldTop:box.top,fieldBottom:box.top+field.clientHeight};
        });
        assert(finalGeometry.top>=finalGeometry.fieldTop&&finalGeometry.bottom<=finalGeometry.fieldBottom,`${font}px: Keyboard caret and final painted line remain visible: ${JSON.stringify(finalGeometry)}`);
      }
      assert.equal(requests,0);assert.deepEqual(errors,[]);
      console.log(`${name} ${width}: syntax, accents, geometry, native input, settings, inert rendering and exact export passed.`);
    }catch(error){await page.screenshot({path:join(output,`${name}-${width}-failure.png`)});throw error;}finally{await page.close();}
  }}finally{await browser.close();}
}
