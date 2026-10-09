import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const app = await readFile(new URL('../onehtml-lab.html', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'onehtml-picker-'));
const server = createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(app));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [new URL('../onehtml-lab.html', import.meta.url).href, `http://127.0.0.1:${server.address().port}/`];
const requested = process.argv.find(arg => arg.startsWith('--engines='))?.split('=')[1];
assert(!requested || ['chromium','webkit'].includes(requested));
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !requested || requested === name);
const source = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:12px;font:18px sans-serif;color:#eee;background:#142236}button,a{display:block;min-height:48px;margin:8px 0}canvas{display:block;background:#285a87;width:220px;height:80px}#far{margin-top:700px}</style></head><body>
<button id="play" class="primary"><span>Играть</span></button><a id="link" href="#far">Перейти</a>
<canvas id="scene" width="220" height="80"></canvas><input id="private" type="password" value="secret-value">
<p id="text">Программа выставки</p><p id="far">Далёкий текст</p>
<script>window.hits=0;window.downs=0;window.clock=0;setInterval(()=>clock++,100);
addEventListener('pointerdown',()=>downs++,true);document.querySelector('#play').onclick=()=>hits++;
const img=document.createElement('img');img.id='generated';img.alt='<b>Иллюстрация</b>';img.width=100;img.height=48;document.body.append(img);</script>
</body></html>`;
async function paste(page, code) {
  await page.evaluate(value => { window.toPaste = value; }, code); await page.locator('#paste').click();
  if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog [value="replace"]').click();
  await page.waitForFunction(() => !document.querySelector('#paste').disabled);
}
async function prepared(page) { await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled); return page.locator('#ai-output').inputValue(); }
async function begin(page) {
  await page.waitForFunction(() => !document.querySelector('#preview-pick').disabled);
  await page.locator('#preview-pick').click();
  await page.locator('#picker-bar').waitFor();
  await page.waitForFunction(() => document.querySelector('#preview-pick').getAttribute('aria-busy') === 'false');
  assert.match(await page.locator('#picker-description').innerText(), /Нажмите на элемент один раз.*Обводить область не нужно/);
  assert(await page.locator('#picker-description').evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'Selection instructions must not be clipped');
}
async function geometry(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const id of ['preview-pick','preview-expand','run']) {
    const box = await page.locator('#' + id).boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= (await page.viewportSize()).width + 1, id);
  }
}
try {
 for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
   for (const url of urls) for (const width of [320,1365]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width === 320 }); context.setDefaultTimeout(15000);
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: async () => window.toPaste || '', writeText: async text => { window.copied = text; }
    } }));
    await context.addInitScript(() => addEventListener('message', event => {
      if (event.data?.type === 'onehtml-lab:picked') window.lastPick = event.data;
    }));
    const page = await context.newPage(), errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/https?:\/\/(?!127\.0\.0\.1)/, route => { external.push(route.request().url()); return route.abort(); });
    try {
      await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
      await paste(page, source); await page.locator('#run').click();
      assert(await page.locator('#preview-pick').isHidden(), 'Simple mode is unchanged');
      await page.locator('#run').click(); await page.locator('#expert-toggle').click();
      await page.locator('#run').click(); await begin(page); await geometry(page);
      await page.screenshot({path:join(output,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-instructions.png`)});
      const frame = await (await page.locator('#preview iframe').elementHandle()).contentFrame();
      const click = async selector => width === 320 ? frame.locator(selector).tap() : frame.locator(selector).click();
      await click('#play span');
      await page.waitForFunction(() => !document.querySelector('#picker-accept').disabled);
      assert.match(await page.locator('#picker-description').innerText(), /Кнопка «Играть»/);
      assert.equal(await frame.evaluate(() => hits),0); assert.equal(await frame.evaluate(() => downs),0);
      assert.equal(await page.locator('#preview iframe').getAttribute('sandbox'),'allow-scripts');
      // A parent-window message, an old generation or malformed data must not select anything.
      await page.evaluate(() => window.postMessage({type:'onehtml-lab:picked',element:{tag:'evil'}},'*'));
      await frame.evaluate(() => {
        const control = [...document.scripts].map(script => script.textContent).find(text => text.includes('function previewElementPicker'));
        const token = /\)\("([a-z0-9-]+)"\);/.exec(control)[1];
        parent.postMessage({type:'onehtml-lab:picked',token,generation:-100,element:{tag:'evil'}},'*');
      });
      // Capture a fresh valid description rather than the deliberately stale message.
      await click('#play span');
      await page.waitForFunction(() => window.lastPick?.element?.id === 'play');
      const currentPick = await page.evaluate(() => window.lastPick);
      await frame.evaluate(data => {
        parent.postMessage({...data,element:{...data.element,text:'x'.repeat(1000)}},'*');
        parent.postMessage({...data,element:{...data.element,tag:['p']}},'*');
      }, currentPick);
      await page.waitForFunction(() => Array.isArray(window.lastPick?.element?.tag));
      assert.match(await page.locator('#picker-description').innerText(), /Кнопка «Играть»/);
      const before = await frame.evaluate(() => clock); await page.waitForTimeout(130); assert(await frame.evaluate(() => clock) > before, 'Selection does not recreate the game');
      await page.screenshot({path:join(output,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-selection.png`)});
      await page.locator('#picker-accept').click(); assert(await page.locator('#ai-dialog').isVisible());
      assert.match(await page.locator('#ai-element-title').innerText(),/Кнопка «Играть»/);
      await page.locator('#ai-task').fill('Сделай эту кнопку крупнее');
      let prompt = await prepared(page); assert(prompt.startsWith('Что изменить:\nСделай эту кнопку крупнее'));
      assert(prompt.includes('"id": "play"')); assert(prompt.includes('button:nth-of-type(1)')); assert(prompt.endsWith(source));
      assert(!prompt.slice(0,prompt.indexOf('Текущий код:')).includes('secret-value'));
      assert.equal(await page.locator('#code').inputValue(),source);
      assert.match(await page.locator('#ai-next-status').innerText(), /готов к отправке/);
      assert.match(await page.locator('#ai-next-help').innerText(), /внешнего ИИ.*Принять ответ/);
      await page.locator('#ai-copy-next').click(); assert.equal(await page.evaluate(() => window.copied),prompt);
      assert.match(await page.locator('#ai-next-status').innerText(), /Теперь отправьте/);
      assert.match(await page.locator('#ai-next-help').innerText(), /Откройте ИИ-бота/);
      assert.equal(await page.locator('#code').inputValue(),source,'Copying the request does not edit the game');
      await page.screenshot({path:join(output,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-next-step.png`)});
      await page.locator('#ai-prompts-open').click(); await page.locator('#ai-prompts-list button').first().click();
      assert.equal(await page.locator('#ai-prompts-text').inputValue(),prompt);
      await page.waitForFunction(() => document.querySelector('#ai-prompts-source').textContent.includes('совпадает'));
      await page.locator('#ai-prompts-reuse').click();
      await page.waitForFunction(() => !document.querySelector('#ai-element-card').hidden);
      assert.equal(await prepared(page), prompt, 'Reusing a source-matched request preserves its element');
      await page.locator('#ai-element-repick').click(); await click('#scene');
      await page.waitForFunction(() => document.querySelector('#picker-description').textContent.includes('Canvas'));
      await page.locator('#picker-accept').click(); assert.match(await page.locator('#ai-element-note').innerText(),/всё игровое поле/);
      prompt = await prepared(page); assert(prompt.includes('отдельные нарисованные объекты не определялись')); assert(!prompt.includes('"id": "play"'));
      await page.locator('#prompt-create').click(); assert(await page.locator('#ai-element-card').isHidden());
      assert(!(await prepared(page)).includes('Выбранный элемент'));
      await page.locator('#prompt-change').click(); await page.locator('#ai-element-remove').click();
      assert(!(await prepared(page)).includes('Выбранный элемент')); assert(await page.locator('#ai-element-card').isHidden());
      await page.locator('#ai-close').click(); await begin(page); await click('#link');
      assert.equal(await frame.evaluate(() => location.hash),'', 'Selection must not activate links');
      await page.locator('#picker-cancel').click(); await click('#play'); assert.equal(await frame.evaluate(() => hits),1);
      await begin(page); await frame.locator('#text').press('Escape'); assert(await page.locator('#picker-bar').isHidden());
      if (width === 1365) {
        await begin(page);
        const box = await frame.locator('#scene').boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + 40, {steps:5}); await page.mouse.up();
        // Dragging within a canvas must not be mistaken for a short selection tap.
        assert(await page.locator('#picker-accept').isDisabled());
        await page.mouse.wheel(0, 600); await frame.waitForFunction(() => scrollY > 0);
        await page.locator('#picker-cancel').click(); await frame.evaluate(() => scrollTo(0,0));
      }
      await begin(page); await click('#generated');
      await page.locator('#picker-accept').click(); assert.match(await page.locator('#ai-element-title').innerText(), /<b>Иллюстрация<\/b>/);
      assert.equal(await page.locator('#ai-element-title b').count(),0, 'Element descriptions are inert text');
      prompt = await prepared(page); assert(prompt.includes('"id": "generated"')); assert(prompt.includes('создан скриптом'));
      await page.locator('#ai-close').click(); await page.locator('#run').click();
      // Repeat in the dark theme and native fallback editor.
      await page.locator('#theme-toggle').click(); await page.locator('#editor-toggle').click();
      await page.locator('#run').click(); await begin(page); await geometry(page);
      const darkFrame = await (await page.locator('#preview iframe').elementHandle()).contentFrame();
      await darkFrame.locator('#private').click(); await page.locator('#picker-accept').click();
      prompt = await prepared(page); assert(!prompt.slice(0,prompt.indexOf('Текущий код:')).includes('secret-value'), 'Form values are not observed');
      await page.locator('#ai-element-repick').click(); await darkFrame.locator('#text').click(); await page.locator('#picker-accept').click();
      await page.screenshot({path:join(output,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-prompt-dark.png`)});
      await page.locator('#ai-close').click();
      if (width === 1365) {
        for (const w of [390,700,701,844,1365]) { await page.setViewportSize({width:w,height:650}); await geometry(page); }
        await page.setViewportSize({width,height:850});
        await page.locator('#split-toggle').click();
        await page.locator('#code').fill(source + '\n<!-- changed beside preview -->');
        assert(await page.locator('#preview-pick').isDisabled(), 'Outdated running preview cannot be selected');
        await page.locator('#ai-open').click(); assert(await page.locator('#ai-element-card').isHidden()); await page.locator('#ai-close').click();
      }
      await page.locator('#run').click();
      await paste(page,'<!doctype html><html><body><p>Новая работа</p></body></html>');
      await page.locator('#ai-open').click(); assert(await page.locator('#ai-element-card').isHidden());
      assert(!(await prepared(page)).includes('Выбранный элемент'));
      await page.locator('#ai-prompts-open').click(); await page.locator('#ai-prompts-list button').first().click();
      await page.locator('#ai-prompts-reuse').click(); await prepared(page);
      assert(await page.locator('#ai-element-card').isHidden(), 'An old request must not bind its element to different code');
      if (width === 320 && url.startsWith('file:')) {
        await page.locator('#ai-close').click(); await page.locator('#run').click();
        await page.waitForFunction(() => !document.querySelector('#preview-pick').disabled);
        const replaced = await (await page.locator('#preview iframe').elementHandle()).contentFrame();
        await replaced.evaluate(() => { document.open(); document.write('<p>Replaced document</p>'); document.close(); });
        await page.locator('#preview-pick').click();
        await page.waitForFunction(() => document.querySelector('#picker-bar').hidden && document.querySelector('#status').textContent.includes('Выбор элемента недоступен'));
        assert.equal(await page.locator('#preview iframe').evaluate(frame => frame.inert),false, 'A lost probe must not leave the frame inert');
      }
      assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
      console.log(`${name} ${new URL(url).protocol} ${width}: touch/mouse selection, isolation, cancellation, prompts/history, dynamic elements, Canvas, both themes/editors and stale-code reset passed.`);
    } catch (error) { await page.screenshot({path:join(output,`${name}-${new URL(url).protocol.slice(0,-1)}-${width}-failure.png`)}); throw error; }
    finally { await context.close(); }
   }
  } finally { await browser.close(); }
 }
} finally { server.close(); }
console.log(`Picker screenshots: ${output}`);
