import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const output=join(tmpdir(),'onehtml-lab-editor-touch');await mkdir(output,{recursive:true});
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
async function checkCodeScreens(browser,name,width) {
  const page=await browser.newPage({viewport:{width,height:680},hasTouch:true});await useNativeEditor(page);page.setDefaultTimeout(8000);
  try {
    await page.goto(new URL('../onehtml-lab.html',import.meta.url).href);await page.locator('#expert-toggle').click();
    const original='<!doctype html>\n'+Array.from({length:80},(_,i)=>`<p>Строка ${i}: ${'Текст '.repeat(5)}</p>`).join('\n');
    await page.locator('#code').fill(original);
    for(let i=0;i<3;i++) {const next=original.replace('Строка 0',`Версия ${i}`);await page.locator('#import-file').setInputFiles({name:'sample.html',mimeType:'text/html',buffer:Buffer.from(next)});await page.locator('#replace-dialog button[value="replace"]').click();await page.waitForFunction(value=>document.querySelector('#code').value===value,next);}
    const source=await page.locator('#code').inputValue();
    for(const engine of ['native','codemirror']) for(const dark of [false,true]) {
      if((await page.locator('html').evaluate(el=>el.classList.contains('theme-dark')))!==dark)await page.locator('#theme-toggle').click();
      await page.locator('#edit-open').click();await page.locator('#editor-engine').selectOption(engine);
      if(await page.locator('#edit-panel').isHidden())await page.locator('#edit-open').click();
      const panel=await page.locator('#edit-panel').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,theme:el.querySelector('[data-panel-theme]').getBoundingClientRect().right,right:el.getBoundingClientRect().right,fonts:[...el.querySelectorAll('input:not([type=checkbox]),select')].map(n=>parseFloat(getComputedStyle(n).fontSize))}));
      assert(panel.scroll<=panel.width && panel.right-panel.theme<=16 && panel.fonts.every(n=>n>=16),'Editor settings fit and remain readable: '+JSON.stringify(panel));
      await page.screenshot({path:join(output,`${name}-${width}-${engine}-${dark?'dark':'light'}-settings.png`)});
      await page.locator('#edit-panel-find').click();await page.locator('#edit-query').fill('Строка');
      if(await page.locator('#edit-replace-box').isHidden())await page.locator('#edit-replace-toggle').click();
      await page.locator('#edit-replacement').fill('Новая строка');
      await page.setViewportSize({width,height:400});
      await page.waitForTimeout(100);
      const search=await page.locator('#edit-inline').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,box:el.getBoundingClientRect().bottom,actions:[...el.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom};})}));
      assert(search.scroll<=search.width && search.actions.every(r=>r.width>=44 && r.height>=44),'Search actions remain touchable: '+JSON.stringify(search));
      await page.locator('#edit-replace-all').scrollIntoViewIfNeeded();
      assert((await page.locator('#edit-replace-all').boundingBox()).y+44<=(await page.locator('#edit-inline').boundingBox()).y+(await page.locator('#edit-inline').boundingBox()).height+1,'Replacement stays reachable in a short viewport');
      await page.locator('#edit-inline').evaluate(el=>{el.scrollTop=0;});
      const visibleTheme=await page.locator('#theme-toggle svg').evaluateAll(nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none').length);assert.equal(visibleTheme,1,'Only the current theme icon is visible');
      await page.screenshot({path:join(output,`${name}-${width}-${engine}-${dark?'dark':'light'}-search.png`)});
      await page.locator('#edit-find-close').click();await page.locator('#history-open').click();
      const history=await page.locator('#history-view').evaluate(el=>{const current=el.querySelector('#history-current'),body=el.querySelector('#history-body'),top=current.getBoundingClientRect().top;body.scrollTop=body.scrollHeight;return {width:el.clientWidth,scroll:el.scrollWidth,fixed:current.getBoundingClientRect().top===top,bodyScroll:body.scrollWidth,bodyWidth:body.clientWidth,buttons:[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().width)};});
      assert(history.scroll<=history.width && history.bodyScroll<=history.bodyWidth && history.fixed && history.buttons.every(n=>n>=44),'History stays dense, fixed and touchable');
      await page.screenshot({path:join(output,`${name}-${width}-${engine}-${dark?'dark':'light'}-history.png`)});
      await page.locator('.history-entry').first().getByRole('button',{name:'Сравнить эту версию с текущей',exact:true}).click();
      assert.equal(await page.locator('#comparison-code-tab svg').count(),1);assert.equal(await page.locator('#comparison-game-tab svg').count(),1);
      await page.locator('#comparison-compact').click();assert.equal(await page.locator('#comparison-compact svg').count(),1);await page.locator('#comparison-compact').click();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('#code').inputValue(),source);
      await page.screenshot({path:join(output,`${name}-${width}-${engine}-${dark?'dark':'light'}-comparison.png`)});
      await page.locator('#comparison-close').click();await page.setViewportSize({width,height:680});
    }
  } catch(error) {await page.screenshot({path:join(output,`${name}-${width}-code-ui-failure.png`)});throw error;} finally {await page.close();}
}
for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try { for(const width of [320,1365]) {
    const page=await browser.newPage({viewport:{width,height:844},hasTouch:true});page.setDefaultTimeout(10000);
    await useNativeEditor(page);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
    const field=page.locator('#code');
    const select=async(start,end=start)=>{await field.focus();await field.evaluate((el,[a,b])=>el.setSelectionRange(a,b),[start,end]);};
    const value=()=>field.inputValue();
    const undo=()=>page.locator('#edit-quick-undo').click();
    try {
      await page.goto(new URL('../onehtml-lab.html',import.meta.url).href);await page.waitForFunction(()=>!document.querySelector('#code').disabled);
      await page.locator('#expert-toggle').click();
      const original='first\n  second\n\tthird\nlast';await field.fill(original);
      assert.equal(await page.locator('[data-edit-indent], [data-edit-pair], #edit-quick-settings').count(),0,'Simplified footer omits extra editing controls');
      assert.equal(await page.locator('#edit-copy-selection svg').count(),1);
      assert.equal(await page.locator('#edit-copy-selection').innerText(),'','Copy uses an icon with an accessible name');
      await select(0,5);await page.keyboard.insertText('FIRST');
      assert.equal(await value(),original.replace('first','FIRST'));await undo();assert.equal(await value(),original);
      await field.fill(original);
      await page.locator('#edit-open').click();
      await page.locator('#edit-range-start').fill('3');await page.locator('#edit-range-end').fill('2');await page.locator('#edit-range-form button').click();
      assert.match(await page.locator('#edit-range-feedback').innerText(),/последняя не меньше/);
      await page.locator('#edit-range-start').fill('2');await page.locator('#edit-range-end').fill('3');await page.locator('#edit-range-form button').click();
      const chosen=await field.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd));assert.equal(chosen,'  second\n\tthird\n');
      await page.locator('#edit-copy-selection').click();assert.equal(await page.locator('#copy-text').inputValue(),chosen);
      await page.locator('#copy-close').click();assert.equal(await value(),original);assert.equal(await field.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),chosen);
      await page.locator('#edit-find').click();await page.locator('#edit-query').fill('second');
      assert(await field.isVisible());await page.locator('#edit-highlight span').first().waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'edit-query');
      await page.locator('#edit-query').fill('missing');await page.locator('#edit-highlight').waitFor({state:'hidden'});
      await page.locator('#edit-query').fill('second');await page.locator('#edit-highlight span').first().waitFor();
      if(width===320) {
        await page.setViewportSize({width,height:340});
        await page.waitForFunction(()=>document.querySelector('#code').clientHeight>=80);
        await page.screenshot({path:join(output,`${name}-keyboard.png`)});
        await page.locator('#edit-replace-toggle').click();await page.locator('#edit-replacement').fill('new');await page.locator('#edit-replace').click();
        assert.equal(await value(),original.replace('second','new'));
        assert(await field.evaluate(el=>el.clientHeight>=80));
        await page.setViewportSize({width,height:844});
      }
      await page.locator('#edit-find-close').click();
      await page.locator('#edit-open').click();await page.locator('#edit-numbers').uncheck();await page.locator('#edit-close').click();
      await page.locator('#edit-find').click();await page.locator('#edit-query').fill('first');await page.locator('#edit-highlight span').first().waitFor();
      await page.locator('#edit-find-close').click();
      // Apply the native readonly flag: synthetic invocations still cannot mutate source.
      await field.evaluate(el=>{el.readOnly=true;});await page.locator('#help-open').click();await page.locator('#help-close').click();
      assert(await page.locator('#edit-quick-tools').isHidden());const locked=await value();
      await page.locator('#edit-quick-undo').evaluate(el=>el.click());assert.equal(await value(),locked);
      await field.evaluate(el=>{el.readOnly=false;});await page.locator('#help-open').click();await page.locator('#help-close').click();
      if(width===1365) {
        await page.locator('#split-toggle').click();await page.locator('#run').click();
        await field.focus();await page.keyboard.press('Control+f');await page.locator('#edit-query').fill('first');
        assert(await page.locator('#preview').isVisible());
        const search=await page.locator('#edit-inline').boundingBox(), preview=await page.locator('#preview').boundingBox();assert(search.x+search.width<=preview.x);
      }
      await page.screenshot({path:join(output,`${name}-${width}.png`)});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
      await checkCodeScreens(browser,name,width);
      console.log(`${name} ${width}: touch edits, undo, ranges, copy fallback, inline highlight, keyboard height, readonly and code screens in both editors/themes passed.`);
    } catch(error) {await page.screenshot({path:join(output,`${name}-${width}-failure.png`)});throw error;}finally{await page.close();}
  }}finally{await browser.close();}
}
