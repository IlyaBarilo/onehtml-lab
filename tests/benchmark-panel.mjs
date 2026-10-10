import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium, webkit} from 'playwright';

const source = await readFile(new URL('../src/examples/performance-libraries.html', import.meta.url), 'utf8');
// Test the real markup and stylesheet without executing or downloading game engines.
const fixture = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-benchmark-panel-'));
const path = join(scratch, 'panel.html'); await writeFile(path, fixture);
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium',chromium],['webkit',webkit]].filter(([name]) => !selected || name === selected);
assert(engines.length, 'Select chromium or webkit');
const cases = [
  ['canvas',null,'Canvas 2D — рисование 2D без игровой библиотеки.'],
  ['three160','three-quality','Текстуры, рельеф, отражения и тени'],
  ['babylon','three-quality','Однотонные материалы · без теней'],
  ['cannon','cannon-physics','Three.js рисует, cannon-es рассчитывает движение и удары.'],
  ['cannon','cannon-physics','Та же башня · упрощённое движение без физических тел.'],
  ['matter',null,'Matter.js — физика: масса, столкновения и связи.'],
  ['phaser','phaser-renderer','Свет на гранях панелей'],
  ['phaser4','phaser-renderer','Тени в пазах панелей']
];
try {
  for (const [name,engine] of engines) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage(); let requests = 0;
      await page.route('https://**/*',route => {requests++; return route.abort();});
      for (const [width,height] of [[320,650],[390,650],[768,650],[1024,650],[1365,800],[320,367],[390,367],[320,317],[1365,420]]) {
        await page.setViewportSize({width,height}); await page.goto(pathToFileURL(path).href);
        for (const font of ['system-ui','Arial, sans-serif','Verdana, sans-serif']) for (const load of [false,true]) for (const populated of [false,true]) {
          await page.locator('html').evaluate((node,font) => {node.style.fontFamily=font;},font);
          let reference;
          for (const [mode,defaultGroup,text] of cases) {
            const group = load && !mode.startsWith('phaser') ? null : defaultGroup;
            await page.evaluate(({mode,group,text,load,populated}) => {
              document.querySelector('.load').hidden=!load;
              document.querySelector('#load-value').textContent='10 000';
              document.querySelector('.description-row').classList.toggle('cannon-description',mode==='cannon');
              document.querySelector('#library-description').textContent=text;
              for(const id of ['three-quality','cannon-physics','phaser-renderer'])document.getElementById(id).hidden=id!==group;
              document.querySelector('#fps').textContent=populated?'60':'—'; document.querySelector('#frame-time').textContent=populated?'Кадр: 16,7 мс':'Кадр: —';
              document.querySelector('#input-time').textContent=populated?'До кадра: 25,1 мс':'До кадра: —'; document.querySelector('#coordinates').textContent=populated?'X/Y: 320/367':'X/Y: —';
            },{mode,group,text,load,populated});
            const layout = await page.evaluate(() => {
              const row=document.querySelector('.description-row').getBoundingClientRect(), text=document.querySelector('#library-description');
              const r=text.getBoundingClientRect();
              const visible=Array.from(document.querySelectorAll('.description-row > div:not([hidden]) button')).map(button=>button.getBoundingClientRect().toJSON());
              const stage=document.querySelector('#stage').getBoundingClientRect(), header=document.querySelector('header').getBoundingClientRect();
              return {top:row.top,height:row.height,bottom:row.bottom,stageTop:stage.top,stageHeight:stage.height,headerTop:header.top,headerBottom:header.bottom,
                textVisible:getComputedStyle(text).display!=='none',textTop:r.top,textBottom:r.bottom,visible,scroll:document.documentElement.scrollWidth};
            });
            const detail=`${name} ${width}x${height} ${font} ${mode} load=${load} populated=${populated}: ${JSON.stringify(layout)}`;
            reference??=layout;
            assert(Math.abs(layout.height-reference.height)<1,'Description area must keep the same height: '+detail);
            assert(Math.abs(layout.stageTop-reference.stageTop)<1,'Changing library options must not move the scene: '+detail);
            assert(layout.scroll<=width,'No horizontal overflow: '+detail);
            assert(layout.headerTop>=0 && layout.headerBottom<=height && layout.stageHeight>=64,'Keep controls and the scene inside the preview: '+detail);
            if(layout.textVisible)assert(layout.textTop>=layout.top && layout.textBottom<=layout.bottom,'Keep the whole description inside its area: '+detail);
            assert(layout.visible.every(button=>button.height>=44 && button.width>0 && button.left>=0 && button.right<=width && button.top>=layout.top && button.bottom<=layout.bottom),'Visible options remain touch-sized and inside the row: '+detail);
            for(const id of ['three-quality','cannon-physics','phaser-renderer'])if(id!==group)assert(await page.locator('#'+id).isHidden(),'Reserved option slots must stay invisible');
          }
        }
      }
      assert.equal(requests,0);
      await page.close(); console.log(`${name}: uniform description height, stable scene boundary, hidden option slots and touch targets passed at phone/tablet/desktop sizes.`);
    } finally {await browser.close();}
  }
} finally {
  assert(resolve(scratch).startsWith(resolve(tmpdir())+sep)); await rm(scratch,{recursive:true,force:true});
}
