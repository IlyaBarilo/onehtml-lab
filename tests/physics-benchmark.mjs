import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/examples/performance-libraries.html', root), 'utf8');
const three = await readFile(new URL('node_modules/three/build/three.min.js', root), 'utf8');
const cannon = await readFile(new URL('node_modules/cannon-es/dist/cannon-es.js', root), 'utf8');
const license = await readFile(new URL('node_modules/cannon-es/LICENSE', root), 'utf8');
const cannonUrl = 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
const moduleData = 'data:text/javascript;base64,' + Buffer.from(license.split(/\r?\n/).map(line => '// ' + line).join('\n') + '\n' + cannon).toString('base64');
const probe = `THREE.WebGLRenderer = new Proxy(THREE.WebGLRenderer, {construct(target,args){const renderer=Reflect.construct(target,args),render=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{window.testScene={renderer,scene,camera};return render(scene,camera)};return renderer}});`;
const fixture = source.replace(/<script src="https:[^"]+"><\/script>/g, tag => '<script>\n' + (tag.includes('three@0.160.0') ? (three + '\n' + probe).replace(/<\/script/gi, '<\\/script') : '') + '\n</script>')
  .replace('<script type="module" id="cannon-module">', '<script type="importmap">' + JSON.stringify({imports:{[cannonUrl]:moduleData}}) + '</script><script type="module" id="cannon-module">');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-cannon-benchmark-'));
const file = join(scratch, 'benchmark.html'); await writeFile(file, fixture);
const server = createServer((_, response) => response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end(fixture));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const host = `http://127.0.0.1:${server.address().port}/`;
const selected = process.argv.find(value => value.startsWith('--engines='))?.slice(10);
const engines = [['chromium',chromium],['webkit',webkit]].filter(([name]) => !selected || name === selected);

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const [url,width,height] of [[pathToFileURL(file).href,320,800],[host,1365,800]]) {
        const context = await browser.newContext({viewport:{width,height},hasTouch:width===320});
        let external = 0;
        await context.route('https://**/*',route => { external++; return route.abort(); });
        // Wrap the actual module's constructor, retaining all real body/solver implementations.
        await context.addInitScript(() => {
          window.testWorlds=[];
          Object.defineProperty(window,'registerLabPhysics',{configurable:true,set(callback){
            Object.defineProperty(window,'registerLabPhysics',{configurable:true,value:(library,url)=>callback({...library,World:new Proxy(library.World,{construct(target,args){const world=Reflect.construct(target,args);window.testWorlds.push(world);return world;}})},url)});
          }});
        });
        const page = await context.newPage(), errors = []; page.setDefaultTimeout(20000);
        page.on('pageerror',error => errors.push(error.message));
        try {
          await page.goto(url);
          await page.locator('[data-mode="cannon"]:enabled').waitFor();
          assert.equal(await page.locator('[data-mode="cannon"] small').innerText(),'Встроена в HTML');
          assert((await page.locator('[data-mode="cannon"] .library-size').innerText()).includes('КБ'));
          await page.locator('#pause').click();
          await page.locator('[data-mode="cannon"]').click();
          assert.equal(await page.locator('#scene').getAttribute('data-physics'),'cannon');
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const initial = await page.evaluate(() => ({bodies:testWorlds.at(-1).bodies.length,blocks:testScene.scene.getObjectByName('physics-blocks').count,positions:testWorlds.at(-1).bodies.filter(body=>body.mass===1).map(body=>[body.position.x,body.position.y,body.position.z])}));
          assert.equal(initial.bodies,14); assert.equal(initial.blocks,12);
          await page.locator('[data-physics="simple"]').click();
          assert.equal(await page.locator('#scene').getAttribute('data-physics'),'simple');
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(await page.evaluate(() => testWorlds.at(-1).bodies.length),0,'Switching away disposes the physics world');
          const manual = await page.evaluate(() => testScene.scene.children.filter(node=>node.isMesh && node.geometry.type==='BoxGeometry' && node.geometry.parameters.height!==.25).map(node=>node.position.toArray()));
          assert.equal(manual.length,12);
          manual.forEach((position,index)=>position.forEach((coordinate,axis)=>assert(Math.abs(coordinate-initial.positions[index][axis])<.00001,'The same tower must occupy the same initial positions')));
          await page.locator('[data-physics="bodies"]').click();
          await page.locator('#pause').click();
          const stage = await page.locator('#stage').boundingBox();
          if (width===320) await page.locator('#stage').tap({position:{x:stage.width*.7,y:stage.height*.65}});
          else await page.locator('#stage').click({position:{x:stage.width*.7,y:stage.height*.65}});
          await page.waitForFunction(() => /Выстрелов: 1/.test(document.querySelector('#scene-stats').textContent));
          await page.waitForFunction(() => testWorlds.at(-1).bodies.some(body=>body.mass===1 && Math.abs(body.quaternion.w)<.99));
          await page.locator('#fps').filter({hasText:/^\d+$/}).waitFor();
          const motion = await page.evaluate(() => {const world=testWorlds.at(-1);return {contacts:world.contacts.length,rotated:world.bodies.filter(body=>body.mass===1&&Math.abs(body.quaternion.w)<.99).length};});
          assert(motion.rotated>0,'Impacts must rotate actual 3D bodies');
          await page.locator('#pause').click();
          // WebKit clears the readable WebGL back buffer after compositing; sample the rendered frame immediately.
          const colors = await page.evaluate(() => {testScene.renderer.render(testScene.scene,testScene.camera);const sample=document.createElement('canvas');sample.width=sample.height=64;const ctx=sample.getContext('2d');ctx.drawImage(testScene.renderer.domElement,0,0,64,64);const pixels=ctx.getImageData(0,0,64,64).data,colors=new Set();for(let i=0;i<pixels.length;i+=4)if(pixels[i+3])colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]);return colors.size;});
          assert(colors>20,'Actual rendering must show geometry');
          await page.screenshot({path:join(scratch,`${name}-${width}.png`)});
          const time = await page.evaluate(() => testWorlds.at(-1).time);
          await page.locator('#scene').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(80);
          assert.equal(await page.evaluate(() => testWorlds.at(-1).time),time,'Paused input must not advance physics');
          await page.locator('#reset').click(); assert.equal(await page.locator('#scene-stats').innerText(),'Сдвинуто: 0/12 · Выстрелов: 0');
          await page.locator('#pause').click();
          await page.locator('#scene').focus(); await page.keyboard.press('Space');
          await page.locator('#scene-stats').filter({hasText:/Выстрелов: 1/}).waitFor();
          await page.locator('#info-toggle').click();
          assert.match(await page.locator('#info-body').innerText(),/Подключайте для башен/);
          assert.match(await page.locator('#info-body').innerText(),/Matter.js/);
          const infoTime=await page.evaluate(() => testWorlds.at(-1).time); await page.waitForTimeout(80);
          assert.equal(await page.evaluate(() => testWorlds.at(-1).time),infoTime,'Reading help pauses simulation');
          await page.locator('#info-close').click(); await page.locator('#pause').click();
          if (width===320) {
            await page.setViewportSize({width:320,height:367});
            await page.waitForTimeout(100);
            const layout=await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,stage:document.querySelector('#stage').clientHeight,bottom:document.querySelector('footer').getBoundingClientRect().bottom}));
            assert(layout.scroll<=layout.width && layout.stage>=64 && layout.bottom<=368,'Cannon controls and scene must fit a short phone preview: '+JSON.stringify(layout));
          }
          await page.locator('#scenario').selectOption('load');
          assert(await page.locator('#cannon-physics').isHidden());
          for (const count of [20,120,10000]) {
            await page.locator('#load').evaluate((node,count)=>{node.value=String(count);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},count);
            assert.equal(await page.evaluate(() => testWorlds.at(-1).bodies.filter(body=>body.mass>0).length),count+1,'Every requested object must be a real body, with one additional ball');
            assert.equal(await page.evaluate(() => testScene.scene.getObjectByName('physics-blocks').count),count);
          }
          assert.match(await page.locator('#message').innerText(),/10\s000/);
          assert.match(await page.locator('#scene-stats').innerText(),/Тел: 10\s001/);
          await page.locator('[data-mode="canvas"]').click();
          assert.equal(await page.evaluate(() => testWorlds.at(-1).bodies.length),0);
          assert(await page.locator('#cannon-physics').isHidden());
          assert.equal(external,0); assert.deepEqual(errors,[]);
          console.log(`${name} ${width}: benchmark physics/manual tower, rotations, input, pause/reset, rendered geometry, short phone layout, help and 10000 real bodies passed.`);
        } finally {await context.close();}
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
console.log('Cannon benchmark screenshots: '+scratch);
