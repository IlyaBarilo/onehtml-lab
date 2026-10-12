import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';

const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10) || 'chromium';
assert(['chromium', 'webkit'].includes(selected), 'Choose chromium or webkit');
const engine = selected === 'webkit' ? webkit : chromium;
const file = new URL('../onehtml-lab.html', import.meta.url);
const html = await readFile(file);
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sample = '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><h1>Игра ⭐</h1><button id="counter">0</button><script>let count=0;document.querySelector("#counter").onclick=()=>document.querySelector("#counter").textContent=String(++count);</script></html>';
let browser;
try {
  browser = await engine.launch();
  for (const url of [file.href, `http://127.0.0.1:${server.address().port}/`]) for (const width of [320, 1365]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 900, acceptDownloads: true });
    context.setDefaultTimeout(10000);
    try {
      await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.clipboardSample } }));
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('https://**', route => { requests.push(route.request().url()); return route.abort(); });
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('#code').disabled);
      const code = page.locator('#code'), content = page.locator('#alternative-editor .cm-content');
      assert(await page.locator('#alternative-editor').isVisible(), 'Default editor must be CodeMirror');
      assert(await content.evaluate(el => el.classList.contains('cm-lineWrapping')));
      assert(await page.locator('#expert-tools').isHidden());
      await page.evaluate(value => { window.clipboardSample = value; }, sample);
      await page.locator('#paste').click();
      await page.waitForFunction(value => document.querySelector('#code').value === value, sample);
      await content.click();
      await content.press('ControlOrMeta+End');
      await page.keyboard.insertText('\n<!-- edited -->');
      const edited = sample + '\n<!-- edited -->';
      await page.waitForFunction(value => document.querySelector('#code').value === value, edited);
      await page.locator('#run').click();
      assert(await page.locator('#alternative-editor').isHidden());
      const frame = await (await page.locator('#preview > iframe').elementHandle()).contentFrame();
      await frame.locator('#counter').click();
      assert.equal(await frame.locator('#counter').innerText(), '1');
      assert.equal(await page.locator('#preview > iframe').getAttribute('sandbox'), 'allow-scripts');
      await page.locator('#run').click();
      assert(frame.isDetached(), 'Stop must discard the running game');
      assert(await page.locator('#alternative-editor').isVisible());
      assert.equal(await code.inputValue(), edited);
      await page.locator('#save').click();
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#confirm-save').click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), 'game.html');
      assert.equal(await readFile(await download.path(), 'utf8'), edited, 'Export must preserve all source bytes');
      await page.locator('#expert-toggle').click();
      const imported = sample.replace('Игра ⭐', 'Импорт');
      await page.locator('#import-file').setInputFiles({ name: 'imported.html', mimeType: 'text/html', buffer: Buffer.from(imported) });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(value => document.querySelector('#code').value === value, imported);
      await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.locator('#theme-toggle').click();
      await page.reload();
      await page.waitForFunction(value => !document.querySelector('#code').disabled && document.querySelector('#code').value === value, imported);
      assert(await page.locator('#alternative-editor').isVisible());
      assert(await page.locator('#expert-tools').isVisible());
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true');
      await page.locator('#ai-open').click();await page.locator('[data-ai-project="application"]').click();
      const font=await page.addStyleTag({content:'#ai-dialog .ai-modes button { font-family:monospace; }'});
      assert(await page.locator('#prompt-create').evaluate(el=>el.scrollWidth<=el.clientWidth),'Application label fits with wide font metrics');
      await font.evaluate(el=>el.remove());await page.locator('#ai-close').click();
      await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#confirm-save').disabled);
      // Exercise the warning presentation without large binary fixtures in quick CI.
      await page.locator('#save-result-size').evaluate(el=>{el.classList.add('resource-warning');el.textContent='Большой объём: 32 МБ.';});
      assert.equal(await page.locator('#save-result-size').evaluate(el=>getComputedStyle(el).color),'rgb(234, 212, 164)','Size warnings retain the dark-theme foreground');
      await page.locator('#save-close').click();
      const linked='<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
      await page.evaluate(value=>{window.clipboardSample=value;},linked);await page.locator('#paste').click();await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(value=>document.querySelector('#code').value===value,linked);
      await page.locator('#library-extract-open').click();await page.waitForFunction(()=>!document.querySelector('#library-extraction-summary').textContent.includes('Проверяю'));
      await page.setViewportSize({width:320,height:350});await page.waitForTimeout(50);
      // Wide metrics reproduce the extra footer row seen with Linux system fonts.
      const extractionFont=await page.addStyleTag({content:'#library-extraction { font-family:monospace; } #library-extraction-summary { line-height:1.5; } #library-extraction .library-conversion-actions button { letter-spacing:1px; }'});
      for(const mode of ['embed','cdn','files']) {
        await page.locator(`[data-library-mode="${mode}"]`).click();
        await page.waitForFunction(()=>!document.querySelector('#library-extraction-summary').textContent.includes('Проверяю'));
        const layout=await page.locator('#library-extraction').evaluate(el=>{
          const body=el.querySelector('.library-extraction-body'),css=getComputedStyle(body);
          const actions=el.querySelector('.library-conversion-actions').getBoundingClientRect(),theme=el.querySelector('.panel-ui-theme').getBoundingClientRect();
          return {usable:body.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom),actionsCenter:(actions.top+actions.bottom)/2,themeCenter:(theme.top+theme.bottom)/2,themeBottom:theme.bottom,overflow:el.scrollWidth>el.clientWidth};
        });
        assert(layout.usable>=80,'Library details remain readable in a short viewport: '+JSON.stringify({mode,...layout}));
        assert(Math.abs(layout.actionsCenter-layout.themeCenter)<1,'Library actions and theme stay on the same footer row: '+JSON.stringify(layout));
        assert(layout.themeBottom<=350&&!layout.overflow,'Conversion controls fit the viewport');
      }
      await extractionFont.evaluate(el=>el.remove());
      await page.locator('#library-extract-close').click();await page.setViewportSize({width,height:844});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(requests, [], 'A self-contained game must not require the network');
      assert.deepEqual(errors, []);
      console.log(`${selected} ${new URL(url).protocol} ${width}: default CodeMirror, paste/edit, run/stop, exact export, import, persisted draft/settings and critical panel layouts passed.`);
    } finally { await context.close(); }
  }
} finally { await browser?.close(); server.close(); }
