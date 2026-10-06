import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const output=join(tmpdir(),'onehtml-lab-editor-touch');await mkdir(output,{recursive:true});
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
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
      console.log(`${name} ${width}: touch edits, undo, ranges, copy fallback, inline highlight, keyboard height and readonly passed.`);
    } catch(error) {await page.screenshot({path:join(output,`${name}-${width}-failure.png`)});throw error;}finally{await page.close();}
  }}finally{await browser.close();}
}
