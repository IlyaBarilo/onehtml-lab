import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';
import {useNativeEditor} from './native-editor.mjs';
const app=await readFile(new URL('../onehtml-lab.html',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'onehtml-prompt-media-'));
const server=createServer((_,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end(app));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const urls=[new URL('../onehtml-lab.html',import.meta.url).href,`http://127.0.0.1:${server.address().port}/`];
const engines=process.argv.includes('--engines=chromium')?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
const game='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}img{width:100%;height:80px;object-fit:contain}.bg{height:40px;background:url(cat.png)}</style><img id="hero" src="cat.png"><div class="bg"></div><audio id="win" controls src="win.mp3"></audio>';
const audioGame=game.replace('win.mp3','win.wav');
async function add(page,files){await page.locator('#media-input').setInputFiles(files);await page.waitForFunction(()=>!document.querySelector('#media-prompt-add').disabled);}
async function paste(page,text,native=false){
  if(native && await page.locator('#alternative-editor').evaluate(host=>!host.hidden)){
    await page.locator('.cm-content').click();await page.keyboard.press('Control+A');
    await page.locator('.cm-content').evaluate((node,text)=>{const data=new DataTransfer();data.setData('text/plain',text);node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},text);
    await page.waitForFunction(()=>document.querySelector('#code').value.includes('onehtml-media:1:'));
  }
  else if(native)await page.evaluate(text=>{
    const field=document.querySelector('#code');field.dispatchEvent(new Event('paste'));field.value=text;field.setSelectionRange(text.length,text.length);field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
  },text);
  else {await page.evaluate(text=>window.testClipboardRead=text,text);await page.locator('#paste').click();if(await page.locator('#replace-dialog').isVisible())await page.locator('#replace-dialog [value="replace"]').click();await page.waitForFunction(()=>!document.querySelector('#paste').disabled);}
}
async function ai(page){await page.locator('#ai-open').click();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);}
try {
 for(const [engineName,engine] of engines){const browser=await engine.launch();try{
  for(const url of urls)for(const width of [320,1365])for(const editor of ['native','codemirror']){
   const context=await browser.newContext({viewport:{width,height:800}});
   await context.addInitScript(()=>{
    window.testClipboardRead='';window.testClipboardWrite='';
     Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>window.testClipboardRead,writeText:async text=>window.testClipboardWrite=text,read:async()=>{
       if(window.testImageDenied)throw new DOMException('denied','NotAllowedError');
       return (window.testImages || []).map(image=>({types:[image.type],getType:async()=>new Blob([Uint8Array.from(atob(image.base64),char=>char.charCodeAt(0))],{type:image.type})}));
     }}});
   });
   const page=await context.newPage();const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
   if(editor==='native')await useNativeEditor(page);
   await page.route('**/*',route=>{if(new URL(route.request().url()).protocol==='https:'){external.push(route.request().url());return route.abort();}return route.continue();});
   try{
    await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#code').disabled);assert(await page.locator('#media-open').isHidden());
    await page.locator('#expert-toggle').click();assert.equal(await page.locator('#alternative-editor').evaluate(host=>!host.hidden),editor==='codemirror');
    const red=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,8,8);return c.toDataURL().split(',')[1];}),'base64');
    const blue=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;const x=c.getContext('2d');x.fillStyle='blue';x.fillRect(0,0,8,8);return c.toDataURL().split(',')[1];}),'base64');
    await page.locator('#media-open').click();assert(await page.locator('#code').evaluate(field=>field.inert));
    await add(page,[{name:'cat.png',mimeType:'image/png',buffer:red},{name:'win.wav',mimeType:'audio/wav',buffer:wav}]);
    assert.equal(await page.locator('#media-prompt-names').inputValue(),'cat.png\nwin.wav');
    await page.locator('#media-prompt-copy').click();assert.equal(await page.evaluate(()=>window.testClipboardWrite),'cat.png\nwin.wav');
    await page.locator('#media-prompt-ai').click();await page.locator('#ai-task').fill('Кот — герой. win.wav — звук победы.');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
     let prompt=await page.locator('#ai-output').inputValue();assert(prompt.startsWith('Сделай игру про Кот'));assert(prompt.includes('\n\nДоступные медиафайлы:\n- cat.png\n- win.wav'));assert(prompt.indexOf('Верни только полный HTML-код.')<prompt.indexOf('Доступные медиафайлы:'));assert(prompt.endsWith('srcset или внешнем CSS.'));assert(prompt.includes('без подкаталогов'));assert(prompt.includes('data URL'));assert(!prompt.includes('./media/'));assert(!prompt.includes('onehtml-media:1:'));assert(!prompt.includes('data:image/png;base64'));
    assert.equal(await page.locator('#code').inputValue(),'');await page.locator('#ai-copy').click();assert.equal(await page.evaluate(()=>window.testClipboardWrite),prompt);
    // A different selection cannot change the bytes belonging to the copied request.
    await page.locator('#ai-media-open').click();await add(page,[{name:'cat.png',mimeType:'image/png',buffer:blue}]);
    assert.match(await page.locator('#media-prompt-feedback').innerText(),/одинаковое имя/);
    const boxes=page.getByRole('checkbox',{name:'Включить cat.png в запрос',exact:true});assert.equal(await boxes.count(),2);assert(await boxes.nth(0).isChecked());assert(!await boxes.nth(1).isChecked());await boxes.nth(1).check();
    await page.locator('#media-prompt-close').click();await page.locator('#ai-close').click();
    await paste(page,audioGame,editor==='native');const bound=await page.locator('#code').inputValue();assert(bound.includes('onehtml-media:1:'));
    await page.locator('#network-toggle').click();await page.locator('#run').click();const frame=page.frameLocator('#preview iframe');await frame.locator('#hero').waitFor();
    assert.equal(await frame.locator('#hero').getAttribute('src'),'data:image/png;base64,'+red.toString('base64'));assert.match(await frame.locator('#win').getAttribute('src'),/^data:audio\/wav;base64/);await page.locator('#run').click();
    // New request explicitly picks the blue copy, then the returned HTML uses it.
    await ai(page);await page.locator('#prompt-change').click();await page.locator('#ai-task').fill('Замени кота, сохрани фон и звук.');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
    prompt=await page.locator('#ai-output').inputValue();assert(!prompt.includes('onehtml-media:1:'));await page.locator('#ai-copy').click();await page.locator('#ai-close').click();await paste(page,audioGame);
    const changed=await page.locator('#code').inputValue();assert.notEqual(changed,bound);await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Сохранено');await page.reload();await page.waitForFunction(()=>!document.querySelector('#code').disabled);
    await page.locator('#run').click();await frame.locator('#hero').waitFor();assert.equal(await frame.locator('#hero').getAttribute('src'),'data:image/png;base64,'+blue.toString('base64'));await page.locator('#run').click();
    await page.locator('#history-open').click();await page.locator('#history-list [aria-label="Вернуть версию"]').first().click();if(await page.locator('#replace-dialog').isVisible())await page.locator('#replace-dialog [value="replace"]').click();
    await page.waitForFunction(code=>document.querySelector('#code').value===code,bound);assert.equal(await page.locator('#code').inputValue(),bound);await page.locator('#run').click();await frame.locator('#hero').waitFor();assert.equal(await frame.locator('#hero').getAttribute('src'),'data:image/png;base64,'+red.toString('base64'));await page.locator('#run').click();
    await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);const download=page.waitForEvent('download');await page.locator('#confirm-save').click();const file=await download,path=join(scratch,`${engineName}-${width}-${editor}-${new URL(url).protocol.slice(0,-1)}.html`);await file.saveAs(path);
    const html=await readFile(path,'utf8');assert(html.includes('data:image/png;base64,'+red.toString('base64')));assert(html.includes('data:audio/wav;base64'));assert(!html.includes('onehtml-media:1:'));
    const standalone=await context.newPage();await standalone.goto(pathToFileURL(path).href);assert(await standalone.locator('#hero').evaluate(image=>image.complete&&image.naturalWidth===8));await standalone.close();
    // Reopen the exported data HTML and shorten only the copy sent to the bot.
    await paste(page,html);const expanded=await page.locator('#code').inputValue();await ai(page);await page.locator('#prompt-change').click();await page.locator('#ai-task').fill('Увеличь героя.');await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
    prompt=await page.locator('#ai-output').inputValue();assert(prompt.includes('- cat.png'));assert(!prompt.includes('data:image/png;base64,'));assert(!prompt.includes('data:audio/wav;base64,'));assert.equal(await page.locator('#code').inputValue(),expanded);
    await page.locator('#ai-shorten').uncheck();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);assert((await page.locator('#ai-output').inputValue()).includes('data:image/png;base64,'));
    await page.locator('#ai-close').click();await page.locator('#theme-toggle').click();await page.locator('#media-open').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await page.locator('#media-prompt-names').boundingBox()).height<=170);await page.waitForFunction(()=>{const img=document.querySelector('#media-prompt-list img');return img?.complete&&img.naturalWidth===8;});await page.screenshot({path:join(scratch,`${engineName}-${width}-${editor}-media.png`)});
    // Original Unicode/space names, real CodeMirror paste, and removal invalidate a prepared request.
    await add(page,[{name:'Герой 1.png',mimeType:'image/png',buffer:red}]);await page.locator('#media-prompt-ai').click();await page.locator('#ai-shorten').check();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
    assert((await page.locator('#ai-output').inputValue()).includes('- Герой 1.png'));await page.locator('#ai-copy').click();await page.locator('#ai-close').click();
    const unicode='<!doctype html><img id="hero" src="'+encodeURIComponent('Герой 1.png')+'"><audio src="win.wav"></audio>';
    await paste(page,unicode,true);assert((await page.locator('#code').inputValue()).includes('onehtml-media:1:'));await page.locator('#run').click();await frame.locator('#hero').waitFor();assert.equal(await frame.locator('#hero').getAttribute('src'),'data:image/png;base64,'+red.toString('base64'));await page.locator('#run').click();
    await ai(page);await page.locator('#ai-media-open').click();await page.getByRole('button',{name:'Удалить Герой 1.png',exact:true}).click();await page.locator('#media-prompt-delete-yes').click();await page.waitForFunction(()=>document.querySelector('#media-prompt-feedback').textContent.startsWith('Файл удалён'));
    await page.locator('#media-prompt-ai').click();await page.waitForFunction(()=>document.querySelector('#ai-summary').textContent.includes('отсутствует'));assert(await page.locator('#ai-copy').isDisabled());
    await page.locator('#ai-media-open').click();await add(page,[{name:'Герой 1.png',mimeType:'image/png',buffer:red}]);await page.locator('#media-prompt-ai').click();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);await page.locator('#ai-close').click();
     await paste(page,'<!doctype html><img src="wrong.png">');assert.match(await page.locator('#status').innerText(),/wrong.png/);
     // Clipboard images use actual format, keep text/code separate and support a native fallback.
     const beforeClipboard=await page.locator('#code').inputValue();await page.locator('#media-open').click();
     const images=await page.evaluate(()=>['png','jpeg'].map((format,i)=>{const c=document.createElement('canvas');c.width=9;c.height=9;const x=c.getContext('2d');x.fillStyle=i?'orange':'green';x.fillRect(0,0,9,9);const url=c.toDataURL('image/'+format);return {type:url.slice(5,url.indexOf(';')),base64:url.split(',')[1]};}));
     await page.evaluate(images=>window.testImages=images,images);await page.locator('#media-prompt-paste').click();await page.waitForFunction(()=>!document.querySelector('#media-prompt-paste').disabled);
     assert.match(await page.locator('#media-prompt-feedback').innerText(),/Добавлено изображений: 2/);assert((await page.locator('#media-prompt-names').inputValue()).includes('1.png'));assert((await page.locator('#media-prompt-names').inputValue()).includes('2.jpg'));
     await page.locator('#media-prompt-paste').click();await page.waitForFunction(()=>!document.querySelector('#media-prompt-paste').disabled);assert.equal(await page.getByRole('checkbox',{name:'Включить 1.png в запрос',exact:true}).count(),1,'Repeated bytes keep one image/name');
     await page.evaluate(()=>window.testImageDenied=true);await page.locator('#media-prompt-paste').click();await page.locator('#media-paste-field').waitFor();assert.match(await page.locator('#media-prompt-feedback').innerText(),/Браузер не разрешил/);assert((await page.locator('#media-paste-field').boundingBox()).height<=170);
     await page.locator('#media-paste-field').fill('обычный текст');assert.equal(await page.locator('#media-paste-field').inputValue(),'');assert.match(await page.locator('#media-prompt-feedback').innerText(),/текст, а не изображение/);
     const nativeImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=9;c.height=9;c.getContext('2d').fillRect(0,0,9,9);return c.toDataURL().split(',')[1];});
     await page.locator('#media-paste-field').evaluate((field,base64)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),char=>char.charCodeAt(0))],'clipboard.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});field.dispatchEvent(event);if(!event.defaultPrevented)throw Error('Image paste must be handled');},nativeImage);
     await page.waitForFunction(()=>!document.querySelector('#media-prompt-paste').disabled);assert(await page.locator('#media-paste-fallback').isHidden());assert((await page.locator('#media-prompt-names').inputValue()).includes('3.png'));
     assert.equal(await page.locator('#code').inputValue(),beforeClipboard,'Clipboard images never overwrite HTML');
     const names=await page.locator('#media-prompt-names').inputValue();await page.evaluate(()=>{window.testImageDenied=false;window.testImages=[{type:'image/png',base64:btoa('<svg></svg>')}];});await page.locator('#media-prompt-paste').click();await page.waitForFunction(()=>!document.querySelector('#media-prompt-paste').disabled);assert.match(await page.locator('#media-prompt-feedback').innerText(),/Формат/);assert.equal(await page.locator('#media-prompt-names').inputValue(),names);
     await page.evaluate(()=>window.testImages=[]);await page.locator('#media-prompt-paste').click();await page.locator('#media-paste-field').waitFor();assert.match(await page.locator('#media-prompt-feedback').innerText(),/нет изображения/);
     await page.evaluate(()=>navigator.clipboard.read=undefined);await page.locator('#media-prompt-paste').click();await page.waitForFunction(()=>!document.querySelector('#media-prompt-paste').disabled);assert.match(await page.locator('#media-prompt-feedback').innerText(),/кнопка не может/);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(scratch,`${engineName}-${width}-${editor}-clipboard.png`)});
     await page.locator('#media-prompt-ai').click();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);prompt=await page.locator('#ai-output').inputValue();assert(prompt.indexOf('Увеличь героя.')<prompt.indexOf('Доступные медиафайлы:'));assert(prompt.includes('- 3.png'));await page.locator('#ai-copy').click();await page.locator('#ai-close').click();
     await paste(page,'<!doctype html><img id="pasted" src="3.png">');await page.locator('#run').click();const pasted=frame.locator('#pasted');await pasted.waitFor();assert.equal(await pasted.getAttribute('src'),'data:image/png;base64,'+nativeImage);assert(await pasted.evaluate(img=>img.complete&&img.naturalWidth===9));await page.locator('#run').click();
    assert.equal(external.length,0);assert.deepEqual(errors,[]);console.log(`${engineName} ${new URL(url).protocol} ${width} ${editor}: names, prompt, exact bytes, paste, cache, history, offline export and shortening passed.`);
   }catch(error){await page.screenshot({path:join(scratch,`${engineName}-${width}-${editor}-failure.png`)});throw error;}finally{await context.close();}
  }
 }finally{await browser.close();}}
}finally{server.close();}
console.log('Prompt media screenshots: '+scratch);
