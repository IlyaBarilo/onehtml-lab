import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const html = await readFile(new URL('../onehtml-lab.html', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'onehtml-applications-'));
const server = createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [new URL('../onehtml-lab.html', import.meta.url).href, `http://127.0.0.1:${server.address().port}/`];
const selectedEngine = process.argv.find(value => value.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selectedEngine || selectedEngine === name);
assert(engines.length, 'Choose chromium or webkit');
const wav = Buffer.alloc(46);
wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(2, 40);
const application = '<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:18px sans-serif}img{width:100%;height:80px;object-fit:contain}button{min-height:44px}</style><h1>Моя афиша</h1><img id="hero" src="1.png"><button id="details">Программа</button><section id="program" hidden>Выставка в 12:00</section><audio id="sound" controls src="2.wav"></audio><script>document.querySelector("#details").onclick=()=>document.querySelector("#program").hidden=false;</script></html>';

async function prepared(page) {
  await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
  return page.locator('#ai-output').inputValue();
}
async function paste(page, text) {
  await page.evaluate(text => window.testClipboardRead = text, text);
  await page.locator('#paste').click();
  if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog [value="replace"]').click();
  await page.waitForFunction(() => !document.querySelector('#paste').disabled);
}
async function picture(frame, png) {
  await frame.locator('#hero').waitFor();
  await frame.locator('#hero').evaluate(image => image.decode());
  assert.equal(await frame.locator('#hero').getAttribute('src'), 'data:image/png;base64,' + png);
  assert.equal(await frame.locator('#sound').getAttribute('src'), 'data:audio/wav;base64,' + wav.toString('base64'));
  await frame.locator('#details').click();
  assert(await frame.locator('#program').isVisible());
}
async function layout(page) {
  assert(await page.locator('#prompt-create').evaluate(button => button.scrollWidth <= button.clientWidth), 'The application action label fits inside its button');
  const bounds = await page.evaluate(() => {
    const footer = document.querySelector('.ai-footer').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
      footer: { left: footer.left, right: footer.right, top: footer.top, bottom: footer.bottom } };
  });
  assert(bounds.scroll <= bounds.width, 'The application composer must fit the screen width');
  assert(bounds.footer.top >= 0 && bounds.footer.bottom <= bounds.height + 1, 'Copy/preview controls remain on screen');
  assert(bounds.footer.left >= 0 && bounds.footer.right <= bounds.width + 1);
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of urls) for (const width of [320, 1365]) for (const editor of ['native', 'codemirror']) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        context.setDefaultTimeout(10000);
        await context.addInitScript(() => {
          window.testClipboardRead = ''; window.testClipboardWrite = '';
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            readText: async () => window.testClipboardRead,
            writeText: async text => { window.testClipboardWrite = text; }
          } });
        });
        const errors = [], external = [];
        await context.route(/https?:\/\/(?!127\.0\.0\.1)/, route => { external.push(route.request().url()); return route.abort(); });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        if (editor === 'native') await useNativeEditor(page);
        const label = `${name}-${new URL(url).protocol.slice(0, -1)}-${width}-${editor}`;
        try {
          await page.goto(url);
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert(await page.locator('#ai-open').isHidden(), 'Simple mode keeps its existing tools');
          await page.locator('#expert-toggle').click();
          await page.locator('#ai-open').click();
          assert.equal(await page.locator('[data-ai-project="game"]').getAttribute('aria-pressed'), 'true');
          await page.locator('#ai-task').fill('Моя выставка');
          await page.locator('[data-ai-project="application"]').click();
          assert.equal(await page.locator('#ai-task').inputValue(), 'Моя выставка', 'Type selection preserves the task');
          assert.equal(await page.locator('#prompt-create').innerText(), 'Новое приложение');
          for (const kind of ['poster', 'story', 'infographic', 'quiz']) {
            await page.locator('#ai-starter').selectOption(kind);
            assert((await page.locator('#ai-task').inputValue()).startsWith('Моя выставка'));
          }
          const task = await page.locator('#ai-task').inputValue();
          for (const project of ['game', 'application']) await page.locator(`[data-ai-project="${project}"]`).click();
          assert.equal(await page.locator('#ai-task').inputValue(), task);
          await page.locator('#ai-dialog .platform-tabs [data-platform="desktop"]').click();
          assert((await prepared(page)).includes('Основное устройство — компьютер'));
          await page.locator('#ai-dialog .platform-tabs [data-platform="mobile"]').click();
          await prepared(page);
          await layout(page);
          await page.screenshot({ path: join(output, label + '-light.png') });
          await page.locator('#ai-media-open').click();
          const png = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
            canvas.getContext('2d').fillRect(0, 0, 8, 8); return canvas.toDataURL().split(',')[1];
          });
          await page.locator('#media-input').setInputFiles([
            { name: '1.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
            { name: '2.wav', mimeType: 'audio/wav', buffer: wav }
          ]);
          await page.waitForFunction(() => !document.querySelector('#media-prompt-add').disabled);
          await page.locator('#media-prompt-ai').click();
          await page.locator('#ai-task').fill('Моя выставка');
          await page.locator('#ai-starter').selectOption('poster');
          let prompt = await prepared(page);
          assert(prompt.startsWith('Сделай мультимедийное приложение для телефона. Задача: Моя выставка'));
          assert(prompt.includes('Используй 1.png')); assert(prompt.includes('Используй 2.wav'));
          assert(prompt.includes('Также обеспечь работу на компьютере'));
          assert(prompt.indexOf('Верни только полный HTML-код.') < prompt.indexOf('Доступные медиафайлы:'));
          assert(!prompt.includes('сыграть ещё раз')); assert(!prompt.includes('data:image'));
          await page.locator('#ai-copy').click();
          assert.equal(await page.evaluate(() => window.testClipboardWrite), prompt);
          await page.locator('#ai-close').click();
          await paste(page, application);
          const bound = await page.locator('#code').inputValue();
          assert(bound.includes('onehtml-media:1:'));
          await page.locator('#network-toggle').click();
          await page.locator('#run').click();
          const frame = page.frameLocator('#preview iframe');
          await picture(frame, png);
          await page.locator('#run').click();
          assert.equal(await page.locator('#code').inputValue(), bound);
          await page.locator('#save').click();
          await page.waitForFunction(() => !document.querySelector('#confirm-save').disabled);
          assert(await page.locator('#save-media').isChecked());
          const download = page.waitForEvent('download');
          await page.locator('#confirm-save').click();
          const file = await download, exported = join(output, label + '.html');
          await file.saveAs(exported);
          const saved = await readFile(exported, 'utf8');
          assert(!saved.includes('onehtml-media:1:'));
          const standalone = await context.newPage();
          await standalone.goto(pathToFileURL(exported).href);
          await picture(standalone, png); await standalone.close();
          assert.equal(await page.locator('#code').inputValue(), bound, 'Export does not rewrite the editor');
          await paste(page, application.replace('Моя афиша', 'Новая афиша'));
          await page.locator('#ai-open').click();
          for (const mode of ['change', 'fix', 'explain', 'check']) {
            await page.locator(`[data-ai-mode="${mode}"]`).click();
            await page.locator('#ai-task').fill('Раскрыть программу выставки');
            prompt = await prepared(page);
            assert(prompt.includes('Новая афиша')); assert(!prompt.includes('сыграть ещё раз'));
            assert(prompt.includes(mode === 'change' ? 'Измени приложение' : mode === 'fix' ? 'ошибку в приложении' : 'Тип работы — мультимедийное приложение'));
            assert(!prompt.includes('onehtml-media:1:'));
          }
          await page.locator('#ai-close').click();
          await page.locator('#history-open').click();
          await page.locator('#history-list [aria-label="Вернуть версию"]').first().click();
          if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog [value="replace"]').click();
          await page.waitForFunction(code => document.querySelector('#code').value === code, bound);
          await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          assert.equal(await page.locator('#code').inputValue(), bound);
          await page.locator('#ai-open').click();
          assert.equal(await page.locator('[data-ai-project="application"]').getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator('#ai-dialog .platform-tabs [data-platform="mobile"]').getAttribute('aria-selected'), 'true');
          await page.locator('#ai-close').click();
          await page.locator('#import-file').setInputFiles({ name: 'poster.html', mimeType: 'text/html', buffer: Buffer.from(saved) });
          await page.locator('#replace-dialog [value="replace"]').click();
          await page.waitForFunction(() => document.querySelector('#code').value.includes('data:image/png;base64,'));
          const imported = await page.locator('#code').inputValue();
          await page.locator('#theme-toggle').click();
          await page.locator('#ai-open').click();
          await page.locator('#prompt-change').click();
          prompt = await prepared(page);
          assert(prompt.startsWith('Измени приложение')); assert(!prompt.includes('data:image/png;base64,'));
          assert(!prompt.includes('data:audio/wav;base64,')); assert(prompt.includes('- 1.png'));
          assert.equal(await page.locator('#code').inputValue(), imported, 'Preparing an AI copy preserves source and bindings');
          await layout(page);
          await page.screenshot({ path: join(output, label + '-dark.png') });
          if (width === 320) {
            await page.setViewportSize({ width: 320, height: 420 }); await layout(page);
            await page.setViewportSize({ width: 844, height: 390 }); await layout(page);
          }
          assert.deepEqual(errors, []); assert.deepEqual(external, []);
          console.log(`${label}: project/device, starters, media, all prompt modes, history, reload and standalone export passed.`);
        } catch (error) {
          await page.screenshot({ path: join(output, label + '-failure.png') }); throw error;
        } finally { await context.close(); }
      }
      // Invalid or unavailable preferences must not prevent use of the application.
      for (const storage of ['malformed', 'invalid', 'denied']) {
        const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
        context.setDefaultTimeout(10000);
        await context.addInitScript(storage => {
          if (storage === 'denied') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
          else localStorage.setItem('onehtml-lab-ai-settings', storage === 'malformed' ? '{' : JSON.stringify({ project: 'wrong', platform: 'wrong' }));
        }, storage);
        try {
          const page = await context.newPage(); await page.goto(urls[1]);
          await page.waitForFunction(() => !document.querySelector('#code').disabled);
          await page.locator('#expert-toggle').click(); await page.locator('#ai-open').click();
          assert.equal(await page.locator('[data-ai-project="game"]').getAttribute('aria-pressed'), 'true');
          await page.locator('[data-ai-project="application"]').click();
          assert((await prepared(page)).startsWith('Сделай мультимедийное приложение'));
          assert.equal(await page.locator('#ai-settings-note').isVisible(), storage === 'denied');
          assert.equal(await page.locator('#code').inputValue(), '');
        } finally { await context.close(); }
      }
      console.log(`${name}: malformed/invalid preferences and denied local storage passed.`);
    } finally { await browser.close(); }
  }
} finally { server.close(); }
console.log('Application workflow screenshots and saved HTML: ' + output);
