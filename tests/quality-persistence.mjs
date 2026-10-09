import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const key='onehtml-lab-quality-manual';
const selected=process.argv.find(arg=>arg.startsWith('--engines='))?.slice(10).split(',');
const engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected || selected.includes(name));
const code='<!doctype html><meta name="viewport" content="width=device-width"><p>Проверка заметок</p>';
async function open(page) { await page.locator('#diagnostic-open').click();await page.locator('[data-diagnostic-tab="quality"]').click(); }
async function ready(page) { await page.goto(new URL('../onehtml-lab.html',import.meta.url).href);await page.waitForFunction(()=>!document.querySelector('#code').disabled); }
for(const [name,engine] of engines) {
  const browser=await engine.launch();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}}), page=await context.newPage();let stored;
    try {
      await ready(page);await page.locator('#expert-toggle').click();await page.locator('#alternative-editor .cm-content').fill(code);await open(page);
      await page.locator('#quality-touch').selectOption('issue');await page.locator('#quality-note-touch').fill('После поворота не работает нажатие.');
      await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key))?.notes.touch==='После поворота не работает нажатие.',key);
      const record=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
      stored=record;
      assert.match(record.hash,/^[a-f\d]{64}$/);assert(!Object.hasOwn(record,'code'),'The report stores a hash, not a second HTML copy');
      await page.locator('#activity-close').click();await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');
      await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);await open(page);
      await page.waitForFunction(()=>!document.querySelector('#quality-touch').disabled && document.querySelector('#quality-touch').value==='issue');
      assert.equal(await page.locator('#quality-note-touch').inputValue(),record.notes.touch);
      await page.locator('#activity-close').click();await page.locator('#alternative-editor .cm-content').fill(code+'<!-- changed -->');await open(page);
      assert(await page.locator('#quality-touch').isDisabled());assert.match(await page.locator('#quality-manual-note').innerText(),/прежней версии/);
    } finally { await context.close(); }
    // Seed before application initialization; pagehide correctly saves the in-memory report.
    for(const invalid of [false,true]) {
      const seeded=await browser.newContext({viewport:{width:390,height:844}}), seededPage=await seeded.newPage();
      try {
        await seeded.addInitScript(([key,record,invalid])=>localStorage.setItem(key,JSON.stringify(invalid?{...record,notes:{touch:'x'.repeat(1001)}}:{...record,scope:'different-work'})),[key,stored,invalid]);
        await ready(seededPage);await seededPage.locator('#expert-toggle').click();await seededPage.locator('#alternative-editor .cm-content').fill(code);await open(seededPage);
        if(invalid)assert.equal(await seededPage.locator('#quality-touch').inputValue(),'','Malformed or oversized records are ignored');
        else {assert(await seededPage.locator('#quality-touch').isDisabled());assert.equal(await seededPage.locator('#quality-touch').inputValue(),'issue','Exact HTML cannot reuse another work’s answers');}
      } finally {await seeded.close();}
    }
    const denied=await browser.newContext({viewport:{width:320,height:844}}), deniedPage=await denied.newPage();
    try {
      await denied.addInitScript(key=>{
        const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
        Storage.prototype.getItem=function(name){if(name===key)throw new DOMException('denied','SecurityError');return get.call(this,name);};
        Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('full','QuotaExceededError');return set.call(this,name,value);};
      },key);
      await ready(deniedPage);await deniedPage.locator('#expert-toggle').click();await deniedPage.locator('#alternative-editor .cm-content').fill(code);await open(deniedPage);
      await deniedPage.locator('#quality-touch').selectOption('issue');await deniedPage.locator('#quality-note-touch').fill('Заметка в памяти.');
      await deniedPage.waitForFunction(()=>document.querySelector('#quality-manual-note').textContent.includes('Не удалось сохранить'));
      assert.equal(await deniedPage.locator('#quality-touch').inputValue(),'issue');assert.equal(await deniedPage.locator('#quality-note-touch').inputValue(),'Заметка в памяти.');
      assert.equal(await deniedPage.locator('#code').inputValue(),code);assert(await deniedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    } finally { await denied.close(); }
    console.log(`${name}: quality notes persist by exact source/work, reject invalid records, and remain usable when storage is denied.`);
  } finally { await browser.close(); }
}
