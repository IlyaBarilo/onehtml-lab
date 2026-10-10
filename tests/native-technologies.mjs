import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium, webkit} from 'playwright';
import {useNativeEditor} from './native-editor.mjs';

const source = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
// Keep the actual native demos; omit only the trailing external engine loaders.
const fixture = source.slice(0, source.indexOf('  <!-- Exact classic builds')) + '</body></html>';
assert(fixture.includes('function nativeWebGPU()'));
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-native-'));
const fixturePath = join(scratch, 'native.html'); await writeFile(fixturePath, fixture);
const appPath = new URL('../onehtml-lab.html', import.meta.url);
const app = await readFile(appPath);
const server = createServer((request, response) => response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(request.url === '/app' ? app : fixture));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const http = `http://127.0.0.1:${server.address().port}`;
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium',chromium],['webkit',webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length, 'Select chromium or webkit');
const modes = ['webgl','svg','dom','audio','worker','webgpu'];
async function select(page, mode) {
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.waitForFunction(() => ['ready','unavailable'].includes(document.querySelector('#scene').dataset.nativeState));
  return page.locator('#scene').getAttribute('data-native-state');
}
async function geometry(page) {
  const value = await page.evaluate(() => {
    const stage = document.querySelector('#stage').getBoundingClientRect(), header = document.querySelector('header').getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth > innerWidth, top:header.top, bottom:header.bottom, stage:stage.height, height:innerHeight};
  });
  assert(!value.overflow && value.top >= 0 && value.bottom < value.height && value.stage >= 64, JSON.stringify(value));
}
try {
  for (const [name,engine] of engines) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({viewport:{width:390,height:844}});
      let external = 0; const errors = [];
      await context.route('https://**/*', route => {external++; return route.abort();});
      await context.addInitScript(() => {
        window.nativeTest = {workers:[],audio:[],arcs:[],vertices:null};
        if(window.Worker){const Original=window.Worker;window.Worker=class extends Original{constructor(...args){super(...args);nativeTest.workers.push(this);}terminate(){this.terminated=true;super.terminate();}};}
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(Audio)window.AudioContext=class extends Audio{constructor(...args){super(...args);nativeTest.audio.push(this);}};
        const arc=CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.parentElement?.id==='scene'&&nativeTest.arcs.length<120)nativeTest.arcs.push(args.slice(0,3));return arc.apply(this,args);};
        for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
          const data=Type.prototype.bufferData;Type.prototype.bufferData=function(...args){if(args[1] instanceof Float32Array&&args[1].length===840&&!nativeTest.vertices)nativeTest.vertices=Array.from(args[1]);return data.apply(this,args);};
          const draw=Type.prototype.drawArrays;Type.prototype.drawArrays=function(...args){const result=draw.apply(this,args);if(args[0]===this.TRIANGLES){const pixels=new Uint8Array(this.drawingBufferWidth*this.drawingBufferHeight*4);this.readPixels(0,0,this.drawingBufferWidth,this.drawingBufferHeight,this.RGBA,this.UNSIGNED_BYTE,pixels);const colors=new Set();for(let i=0;i<pixels.length;i+=64)colors.add(pixels.slice(i,i+3).join(','));nativeTest.colors=colors.size;}return result;};
        }
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      for (const url of [pathToFileURL(fixturePath).href, http]) {
        await page.goto(url); await page.locator('#pause').click();
        await page.locator('#scenario').selectOption('load');
        await page.evaluate(() => nativeTest.arcs=[]); await page.locator('#reset').click();
        const canvasParticles = await page.evaluate(() => nativeTest.arcs);
        assert.equal(canvasParticles.length,120);
        assert.equal(await select(page,'webgl'),'ready');
        const glParticles = await page.evaluate(() => nativeTest.vertices);
        assert(glParticles);
        for(let i=0;i<120;i++)for(let j=0;j<3;j++)assert(Math.abs(glParticles[i*7+j]-canvasParticles[i][j])<.001,'Canvas and WebGL start with identical positions and radii');
        for(const version of [1,2]){
          await page.locator(`#native-webgl [data-version="${version}"]`).click();
          assert.equal(await page.locator('#scene').getAttribute('data-native-api'),'webgl'+version);
          await page.locator('#scenario').selectOption('compare');
          const distinct = await page.evaluate(() => nativeTest.colors);
          assert(distinct>5,'WebGL must actually render colored geometry');
        }
        await page.locator('#scenario').selectOption('load');
        for(const mode of ['svg','dom']){
          assert.equal(await select(page,mode),'ready');
          const positions=await page.locator(mode==='svg'?'#scene circle':'#scene .native-dot').evaluateAll((nodes,mode)=>nodes.map(node=>{if(mode==='svg')return[+node.getAttribute('cx'),+node.getAttribute('cy'),+node.getAttribute('r')];const r=parseFloat(node.style.width)/2,xy=node.style.transform.match(/translate\(([-.\d]+)px,([- .\d]+)px\)/);return[+xy[1]+r,+xy[2]+r,r];}),mode);
          for(let i=0;i<120;i++)for(let j=0;j<3;j++)assert(Math.abs(positions[i][j]-canvasParticles[i][j])<.001);
          await page.locator('#load').fill('10000'); await page.locator('#load').dispatchEvent('change');
          assert.equal(await page.locator(mode==='svg'?'#scene circle':'#scene .native-dot').count(),10000);
          await page.locator('#load').fill('120');await page.locator('#load').dispatchEvent('change');
        }
        for(const mode of modes)for(const scenario of ['showcase','compare','load']){
          await page.locator('#scenario').selectOption(scenario);const state=await select(page,mode);
          if(state==='unavailable')assert.match(await page.locator('#scene').innerText(),/недоступен/);
          else if(mode==='svg'&&scenario==='showcase'){
            const box=await page.locator('#scene svg').boundingBox(),host=await page.locator('#scene').boundingBox();assert(Math.abs(box.width-host.width)<1&&Math.abs(box.height-host.height)<1);
          }
          await geometry(page);await page.locator('#info-toggle').click();assert((await page.locator('#info-body').innerText()).length>80);await page.locator('#info-close').click();
        }
        await page.locator('#scenario').selectOption('showcase');
        if(await select(page,'audio')==='ready'){
          await page.locator('#pause').click();await page.locator('#stage').click({position:{x:100,y:150}});
          await page.waitForFunction(()=>document.querySelector('#scene').dataset.nativeAudio==='running');
          await select(page,'dom');await page.waitForFunction(()=>nativeTest.audio.every(audio=>audio.state==='closed'));
          await page.locator('#pause').click();
        }
        if(await select(page,'worker')==='ready'){
          await select(page,'svg');await page.waitForFunction(()=>nativeTest.workers.every(worker=>worker.terminated));
          await page.evaluate(()=>{document.querySelector('[data-mode="worker"]').click();setTimeout(()=>document.querySelector('[data-mode="dom"]').click(),0);});
          await page.waitForFunction(()=>nativeTest.workers.every(worker=>worker.terminated));
          assert.equal(await page.locator('#scene').getAttribute('data-native-mode'),'dom');
        }
        await page.evaluate(()=>Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:()=>new Promise(resolve=>{window.finishAdapter=()=>{window.adapterFinished=true;resolve({requestDevice(){window.staleDevice=true;}});};})}}));
        await page.locator('[data-mode="webgpu"]').click();await page.waitForFunction(()=>typeof window.finishAdapter==='function');await select(page,'svg');await page.evaluate(()=>finishAdapter());await page.waitForFunction(()=>window.adapterFinished);
        assert.equal(await page.evaluate(()=>Boolean(window.staleDevice)),false,'A stale adapter must not create a device or overwrite the current scene');
        assert.equal(await page.locator('#scene').getAttribute('data-native-mode'),'svg');
        await page.evaluate(()=>Object.defineProperty(navigator,'gpu',{configurable:true,value:{requestAdapter:async()=>({requestDevice:()=>new Promise(resolve=>{window.finishDevice=()=>resolve({destroy(){window.staleDeviceDestroyed=true;}});})})}}));
        await page.locator('[data-mode="webgpu"]').click();await page.waitForFunction(()=>typeof window.finishDevice==='function');await select(page,'dom');await page.evaluate(()=>finishDevice());await page.waitForFunction(()=>window.staleDeviceDestroyed);
        assert.equal(await page.locator('#scene').getAttribute('data-native-mode'),'dom');
        await page.evaluate(()=>Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}));
        assert.equal(await select(page,'webgpu'),'unavailable');
        for(const width of [320,1365]){await page.setViewportSize({width,height:width===320?367:800});await select(page,'webgl');await geometry(page);}
        await page.setViewportSize({width:390,height:844});
      }
      await useNativeEditor(page);await page.goto(http+'/app');
      await page.locator('#network-toggle').click();await page.locator('#code').fill(fixture);await page.locator('#run').click();
      const frame=page.frames().find(frame=>frame.parentFrame());assert(frame);
      if(await select(frame,'worker')==='ready'){
        await frame.waitForFunction(()=>document.querySelector('#scene').dataset.nativeWorker==='running');
        await frame.waitForFunction(()=>/^\d/.test(document.querySelector('#fps').textContent));
        const blocked=await frame.evaluate(()=>new Promise(resolve=>{
          const code='fetch("https://native-test.invalid/resource").then(()=>postMessage(false)).catch(()=>postMessage(true))';
          const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);
          worker.onmessage=event=>{worker.terminate();URL.revokeObjectURL(url);resolve(event.data);};
        }));assert.equal(blocked,true,'Offline policy must also restrict fetch inside blob workers');
        const remote=await frame.evaluate(()=>{try{new Worker('https://native-test.invalid/worker.js');return false;}catch{return true;}});assert(remote,'Remote workers must remain blocked');
      }
      assert.equal(external,0,'Native modes must not fetch external dependencies');assert.deepEqual(errors,[]);
      await context.close();console.log(`${name}: native demos, shared particles, 10 000 objects, rendering, API fallback, lifecycle, layout and offline worker policy passed.`);
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
