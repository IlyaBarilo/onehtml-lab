import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const app = await readFile(new URL('../onehtml-lab.html', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-images-'));
const server = createServer((_, res) => res.writeHead(200, {'Content-Type':'text/html'}).end(app));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [new URL('../onehtml-lab.html', import.meta.url).href, `http://127.0.0.1:${server.address().port}/`];
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const game = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>img{max-width:100%}.bg{width:30px;height:30px;background:url(hero.png)}</style><img id="hero" src="hero.png"><div class="bg"></div>';
const links = html => JSON.parse(Buffer.from(/<!--onehtml-media:1:([^>]+)-->/.exec(html)[1], 'base64').toString());
async function ready(page) { await page.waitForFunction(() => !document.querySelector('#code').disabled); }
async function add(page, files) { await page.locator('#media-input').setInputFiles(files); await page.waitForFunction(() => !document.querySelector('#media-prompt-add').disabled); }
function row(page, name) { return page.locator('#media-prompt-list > li').filter({has:page.getByText(name,{exact:true})}); }
async function openMedia(page) { if (!(await page.locator('#media-panel').isVisible())) await page.locator('#media-open').click(); }
async function paste(page, code) {
  await page.evaluate(text => { window.clipboardText = text; }, code);
  await page.locator('#paste').click();
  if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog [value="replace"]').click();
  await page.waitForFunction(() => !document.querySelector('#paste').disabled);
}
async function layout(page) {
  const geometry = await page.evaluate(() => {
    const r = id => document.querySelector(id).getBoundingClientRect();
    const code = document.querySelector('#alternative-editor').hidden ? r('#code') : r('#alternative-editor');
    const strip = r('#media-strip'), tools = r('#edit-quick');
    return { codeBottom:code.bottom, stripTop:strip.top, stripBottom:strip.bottom, toolsTop:tools.top, overflow:document.documentElement.scrollWidth > innerWidth };
  });
  assert(!geometry.overflow, JSON.stringify(geometry));
  assert(Math.abs(geometry.codeBottom - geometry.stripTop) < 2, JSON.stringify(geometry));
  assert(geometry.stripBottom <= geometry.toolsTop + 1, JSON.stringify(geometry));
}
try {
 for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
   for (const url of urls) for (const width of [320,1365]) {
    const context = await browser.newContext({viewport:{width,height:850}}); context.setDefaultTimeout(15000);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{readText:async()=>window.clipboardText || '',writeText:async text=>{window.copiedText=text;}}});
    });
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/https?:\/\/(?!127\.0\.0\.1)/, route => {external.push(route.request().url());return route.abort();});
    try {
      await page.goto(url); await ready(page); assert(await page.locator('#media-strip').isHidden());
      await page.locator('#expert-toggle').click(); await openMedia(page);
      const base64 = await page.evaluate(() => {
        const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;
        const x=canvas.getContext('2d'),g=x.createLinearGradient(0,0,2400,1200);g.addColorStop(0,'#2070cb');g.addColorStop(1,'#dc6080');x.fillStyle=g;x.fillRect(80,80,2240,1040);x.fillStyle='white';x.font='160px sans-serif';x.fillText('OneHTML',240,700);
        return canvas.toDataURL().split(',')[1];
      });
      const image={name:'hero.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')};
      await add(page, image); assert.match(await row(page,'hero.png').innerText(),/2[\s\u00a0]400 × 1[\s\u00a0]200/);
      await page.locator('#media-prompt-copy').click(); assert.equal(await page.evaluate(()=>window.copiedText),'hero.png');
      await page.locator('#media-prompt-close').click(); await paste(page,game);
      const original=await page.locator('#code').inputValue(), originalId=links(original)[0].id;
      await page.locator('#media-strip').waitFor();await page.waitForTimeout(100);await layout(page);
      assert.equal(await page.locator('#media-strip .media-card.is-selected').count(),1);
      await page.locator('#media-strip .media-card').click();assert(await row(page,'hero.png').isVisible());
      await row(page,'hero.png').getByRole('button',{name:'Уменьшить',exact:true}).click();
      await page.locator('#media-image-size').selectOption('1024');
      const webp=await page.evaluate(()=>document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'));
      if(!webp) {await page.locator('#media-image-preview').click();await page.locator('#media-image-feedback').getByText(/не поддерживает этот формат/).waitFor();assert(await page.locator('#media-image-apply').isDisabled());await page.locator('#media-image-format').selectOption('original');}
      await page.locator('#media-image-preview').click();await page.locator('#media-image-apply').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#media-image-apply').disabled);
      assert.equal(await page.locator('#code').inputValue(),original,'Preview does not change current code');
      assert.equal(await page.locator('#media-prompt-names').inputValue(),'hero.png','Preview does not change prompt selection');
      assert.match(await page.locator('#media-image-after-info').innerText(),/1[\s\u00a0]024 × 512/);
      assert(await page.locator('#media-image-after').evaluate(image=>{const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,1,1).data[3]===0;}),'Transparency survives encoding');
      await page.locator('#media-image-edit').scrollIntoViewIfNeeded();await page.screenshot({path:join(scratch,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-prepare.png`)});
      await page.locator('#media-image-apply').click();await page.waitForFunction(()=>document.querySelector('#media-image-edit').hidden);
      const optimized=await page.locator('#code').inputValue(), optimizedId=links(optimized)[0].id;
      assert.notEqual(optimizedId,originalId);assert(optimized.includes('src="hero.png"'));assert(optimized.includes('url(hero.png)'),'Existing references keep their paths');
      const optimizedName=await page.locator('#media-prompt-names').inputValue();assert.notEqual(optimizedName,'hero.png');
      assert.equal(await page.locator('#media-prompt-list > li').count(),2,'Original and derivative remain available');
      await page.locator('#media-prompt-close').click();await page.locator('#ai-open').click();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
      const prompt=await page.locator('#ai-output').inputValue();assert(prompt.includes(optimizedName));assert.match(prompt,/1[\s\u00a0]024 × 512 пикселей/);assert(!prompt.includes('горизонтальное изображение'));assert(!prompt.includes('пропорции 2:1'));
      const aiGeometry=await page.evaluate(()=>({panel:document.querySelector('#ai-dialog').getBoundingClientRect().bottom,strip:document.querySelector('#media-strip').getBoundingClientRect().top}));assert(Math.abs(aiGeometry.panel-aiGeometry.strip)<2,JSON.stringify(aiGeometry));
      if(width===320) {
        await page.setViewportSize({width,height:450});await page.waitForTimeout(100);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const short=await page.evaluate(()=>({panel:document.querySelector('#ai-dialog').getBoundingClientRect().bottom,strip:document.querySelector('#media-strip').getBoundingClientRect().top}));assert(Math.abs(short.panel-short.strip)<2,JSON.stringify(short));
        await page.setViewportSize({width,height:850});await page.waitForTimeout(100);
      }
      await page.locator('#ai-close').click();await page.locator('#theme-toggle').click();await layout(page);
      await page.screenshot({path:join(scratch,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-strip-dark.png`)});
      await page.locator('#editor-toggle').click();await page.waitForTimeout(100);await layout(page);
      await page.locator('#editor-toggle').click();await page.locator('#media-strip-toggle').click();assert(await page.locator('#media-strip-list').isHidden());await page.waitForTimeout(100);await layout(page);
      await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');await page.reload();await ready(page);
      assert.equal(await page.locator('#code').inputValue(),optimized);assert(await page.locator('#media-strip-list').isHidden(),'Collapse preference persists');await page.locator('#media-strip-toggle').click();
      await page.locator('#run').click();const frame=page.frameLocator('#preview iframe');await frame.locator('#hero').waitFor();assert.equal(await frame.locator('#hero').evaluate(image=>image.naturalWidth),1024);
      await page.locator('#preview-expand').click();assert(await page.locator('#media-strip').isHidden());await page.locator('#preview-expand').click();await page.locator('#run').click();
      await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);const download=page.waitForEvent('download');await page.locator('#confirm-save').click();const file=await download;
      const exported=join(scratch,`${name}-${width}-${new URL(url).protocol.slice(0,-1)}.html`);await file.saveAs(exported);const html=await readFile(exported,'utf8');assert(!html.includes('onehtml-media:1:'));assert(html.includes(webp?'data:image/webp;base64,':'data:image/png;base64,'));
      const standalone=await context.newPage();await standalone.goto(pathToFileURL(exported).href);assert.equal(await standalone.locator('#hero').evaluate(image=>image.naturalWidth),1024);await standalone.close();
      await page.locator('#history-open').click();await page.locator('#history-list [aria-label="Вернуть версию"]').first().click();if(await page.locator('#replace-dialog').isVisible())await page.locator('#replace-dialog [value="replace"]').click();
      await page.waitForFunction(expected=>document.querySelector('#code').value===expected,original);
      await page.locator('#run').click();await frame.locator('#hero').waitFor();assert.equal(await frame.locator('#hero').evaluate(image=>image.naturalWidth),2400);await page.locator('#run').click();
      // A copied request still binds the original image even after optimizing the selection.
      await paste(page,game);assert.equal(links(await page.locator('#code').inputValue())[0].id,originalId);
      await openMedia(page);await row(page,optimizedName).getByRole('button',{name:'Уменьшить',exact:true}).click();assert(await page.locator('#media-image-restore').isEnabled());await page.locator('#media-image-restore').click();await page.waitForFunction(()=>document.querySelector('#media-image-edit').hidden);assert.equal(await page.locator('#media-prompt-names').inputValue(),'hero.png');
      // Changed controls invalidate an in-flight conversion and its old preview.
      await row(page,'hero.png').getByRole('button',{name:'Уменьшить',exact:true}).click();await page.locator('#media-image-format').selectOption('original');
      await page.evaluate(()=>{window.encode=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,...args){window.finishEncoding=()=>window.encode.call(this,callback,...args);};});
      await page.locator('#media-image-preview').click();await page.waitForFunction(()=>window.finishEncoding);await page.locator('#media-image-size').selectOption('1024');await page.evaluate(()=>{window.finishEncoding();HTMLCanvasElement.prototype.toBlob=window.encode;});await page.waitForTimeout(100);assert(await page.locator('#media-image-apply').isDisabled());assert.equal(await page.locator('#media-image-after').getAttribute('src'),null);
      await page.locator('#media-image-cancel').click();
      if(width===320 && url.startsWith('file:')) {
        // A settings change while content hashing/storage is pending cancels applying that copy.
        await row(page,'hero.png').getByRole('button',{name:'Уменьшить',exact:true}).click();await page.locator('#media-image-format').selectOption('original');await page.locator('#media-image-size').selectOption('1024');await page.locator('#media-image-preview').click();await page.waitForFunction(()=>!document.querySelector('#media-image-apply').disabled);
        const beforePending=await page.locator('#code').inputValue();
        await page.evaluate(()=>{window.savedDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...args)=>new Promise(resolve=>{window.finishDigest=()=>resolve(window.savedDigest(...args));});});
        await page.locator('#media-image-apply').click();await page.waitForFunction(()=>window.finishDigest);await page.locator('#media-image-size').selectOption('2048');await page.evaluate(()=>{crypto.subtle.digest=window.savedDigest;window.finishDigest();});await page.locator('#media-image-feedback').getByText(/Подготовленная копия сохранена/).waitFor();assert.equal(await page.locator('#code').inputValue(),beforePending);assert(await page.locator('#media-image-apply').isDisabled());await page.locator('#media-image-cancel').click();
      }
      // Applying only to future requests must leave the current document byte-for-byte intact.
      const unchanged=await page.locator('#code').inputValue();
      await row(page,'hero.png').getByRole('button',{name:'Уменьшить',exact:true}).click();await page.locator('#media-image-format').selectOption('original');await page.locator('#media-image-size').selectOption('1024');await page.locator('#media-image-preview').click();await page.waitForFunction(()=>!document.querySelector('#media-image-apply').disabled);await page.locator('#media-image-code').uncheck();await page.locator('#media-image-apply').click();await page.waitForFunction(()=>document.querySelector('#media-image-edit').hidden);assert.equal(await page.locator('#code').inputValue(),unchanged);
      const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
      await add(page,{name:'sound.wav',mimeType:'audio/wav',buffer:wav});
      // APNG and oversized headers remain importable but are never flattened/decoded by optimization.
      const animated=Buffer.alloc(45);Buffer.from([137,80,78,71,13,10,26,10]).copy(animated);animated.writeUInt32BE(13,8);animated.write('IHDR',12);animated.writeUInt32BE(10,16);animated.writeUInt32BE(10,20);animated.write('acTL',37);
      await add(page,{name:'animation.png',mimeType:'image/png',buffer:animated});await row(page,'animation.png').getByRole('button',{name:'Уменьшить',exact:true}).click();assert(await page.locator('#media-image-preview').isDisabled());await page.locator('#media-image-size').selectOption('1024');assert(await page.locator('#media-image-preview').isDisabled());await page.locator('#media-image-cancel').click();
      await page.locator('#media-prompt-close').click();
      assert.equal(await page.locator('#media-strip .media-audio-icon').count(),1);
      if(width===320) {
        assert(await page.locator('#media-strip-list').evaluate(list=>list.scrollWidth>list.clientWidth));
        await page.locator('#media-strip-list').evaluate(list=>list.scrollLeft=list.scrollWidth);assert(await page.locator('#media-strip-list').evaluate(list=>list.scrollLeft>0));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await page.locator('#expert-toggle').click();assert(await page.locator('#media-strip').isHidden());
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      console.log(`${name} ${new URL(url).protocol} ${width}: image copies, dimensions, transparency, bindings/history, original recovery, strip geometry, themes, both editors and offline export passed.`);
    } catch(error) {await page.screenshot({path:join(scratch,`${name}-${width}-failure.png`)});throw error;}
    finally {await context.close();}
   }
  } finally {await browser.close();}
 }
} finally {server.close();}
console.log(`Image preparation screenshots: ${scratch}`);
