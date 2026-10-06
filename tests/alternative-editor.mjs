import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const output = join(tmpdir(), 'onehtml-lab-alternative-editor');
await mkdir(output, { recursive: true });
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const fileURL = new URL('../onehtml-lab.html', import.meta.url).href;
const html = await readFile(new URL(fileURL));
const server = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const httpURL = `http://127.0.0.1:${server.address().port}/`;
const sample = `<!doctype html>
<html lang="ru">
<head>
  <title>Проверка редактора</title>
  <style>
    body { background: #edf4ff; color: #234567; }
  </style>
</head>
<body>
  <h1>Играть ⭐</h1>
  <script>
    function calculate(value) {
      const message = 'Скрытый текст';
      return value + message.length;
    }
    document.body.dataset.result = calculate(2);
  </script>
</body>
</html>`;
try { for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try { for (const [url, width] of [[fileURL, 320], [fileURL, 390], [fileURL, 1365], [httpURL, 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 900, acceptDownloads: true });
    context.setDefaultTimeout(15000);
    const page = await context.newPage(), errors = [];
    await page.addInitScript(() => {
      const original = window.requestAnimationFrame.bind(window);
      window.__editorLayouts = 0;
      window.requestAnimationFrame = callback => original(time => { if (callback.name === 'drawCodeLines') window.__editorLayouts++; callback(time); });
    });
    let requests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => { requests++; return route.abort(); });
    const code = page.locator('#code'), content = page.locator('#alternative-editor .cm-content');
    const settings = async () => {
      if (await page.locator('#edit-panel').isHidden()) await page.locator(await page.locator('#edit-open').isVisible() ? '#edit-open' : '#edit-quick-settings').click();
    };
    const choose = async value => { await settings(); await page.locator('#editor-engine').selectOption(value); };
    const source = () => code.inputValue();
    const setSource = async value => {
      await code.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      await page.waitForFunction(value => document.querySelector('#alternative-editor .cm-content')?.textContent.includes(value.split('\n').at(-1)), value);
    };
    try {
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('#code').disabled);
      assert(await page.locator('#alternative-editor').isHidden());
      await code.fill(sample);
      await code.evaluate(el => el.setSelectionRange(0, 0));
      await page.locator('#expert-toggle').click();
      await choose('codemirror');
      await content.waitFor();
      assert.equal(await source(), sample);
      const bounds = await page.locator('#alternative-editor').boundingBox();
      assert(bounds && Math.abs(bounds.width - width) < 1, 'Editor fills mobile and desktop workspace');
      assert(await page.locator('#alternative-editor .cm-lineNumbers').isVisible());
      await page.keyboard.insertText('<!-- Новое -->\n');
      assert.equal(await source(), '<!-- Новое -->\n' + sample);
      await page.keyboard.press('Control+z');
      assert.equal(await source(), sample, 'CodeMirror uses the shared undo chain');
      await page.keyboard.press('Control+Shift+z');
      assert.equal(await source(), '<!-- Новое -->\n' + sample);
      await choose('native');
      assert.equal(await code.inputValue(), '<!-- Новое -->\n' + sample);
      await code.press('Control+z');
      assert.equal(await source(), sample, 'Undo survives changing editors');
      await choose('codemirror');
      // Fold a JS function, preserving its hidden text in copy, export and search.
      await code.evaluate((el, at) => el.setSelectionRange(at, at), sample.indexOf('function'));
      await page.locator('#edit-fold').click();
      await page.locator('.cm-foldPlaceholder').waitFor();
      assert.equal(await source(), sample);
      assert(!await content.innerText().then(text => text.includes('Скрытый текст')));
      await content.press('Control+a');
      const copied = await content.evaluate(el => {
        const transfer = new DataTransfer();
        el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }));
        return transfer.getData('text/plain');
      });
      assert.equal(copied, sample, 'Copy includes folded code, not placeholder text');
      await code.evaluate((el, at) => el.setSelectionRange(at, at), sample.indexOf('function'));
      await page.locator('#edit-fold').click();
      await page.locator('#edit-unfold-all').click();
      assert(await page.locator('.cm-foldPlaceholder').isHidden());
      await page.locator('#edit-fold').click();
      await page.screenshot({ path: join(output, `${name}-${width}-fold.png`) });
      await page.locator('#save').click();
      const downloading = page.waitForEvent('download');
      await page.locator('#confirm-save').click();
      const downloaded = await downloading;
      assert.equal(await readFile(await downloaded.path(), 'utf8'), sample, 'Folding never deletes exported source');
      await page.locator('#edit-find').click();
      await page.locator('#edit-query').fill('Скрытый текст');
      assert.equal(await page.locator('#edit-result').innerText(), '1 из 1');
      assert(await page.locator('.cm-foldPlaceholder').isHidden(), 'Search unfolds the matching block');
      assert.equal(await code.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), 'Скрытый текст');
      await page.locator('#edit-replace-toggle').click();
      await page.locator('#edit-replacement').fill('Другой текст');
      await page.locator('#edit-replace').click();
      assert((await source()).includes('Другой текст'));
      await page.locator('#edit-find-close').click();
      await page.locator('#edit-quick-undo').click();
      assert.equal(await source(), sample);
      // Ordinary paste participates in full-source history without using visible folded DOM.
      await content.evaluate(el => {
        const transfer = new DataTransfer(); transfer.setData('text/plain', '\n<!-- Вставка -->');
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
      });
      assert((await source()).includes('Вставка'));
      await page.locator('#history-open').click();
      assert(await page.locator('#alternative-editor').isHidden());
      assert.equal(await page.locator('.history-entry').count(), 1, 'Paste archives the previous full source');
      await page.locator('#history-close').click();
      await page.locator('#edit-quick-undo').click();
      assert.equal(await source(), sample);
      // Import replaces the document in both editors.
      const imported = sample.replace('Играть ⭐', 'Импорт ⭐');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#import-file').setInputFiles({ name: 'import.html', mimeType: 'text/html', buffer: Buffer.from(imported) });
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(() => document.querySelector('#alternative-editor .cm-content').textContent.includes('Импорт ⭐'));
      assert.equal(await source(), imported);
      await settings();
      await page.locator('#edit-font').selectOption('20');
      await page.locator('#edit-colors').selectOption('off');
      await page.locator('#edit-wrap').uncheck();
      await page.locator('#edit-numbers').uncheck();
      await page.locator('#edit-close').click();
      assert.equal(await page.locator('.cm-editor').evaluate(el => getComputedStyle(el).fontSize), '20px');
      assert(await page.locator('.cm-lineNumbers').isHidden());
      assert.equal(await page.locator('#alternative-editor .syntax-accent').count(), 0);
      await settings();
      await page.locator('#edit-colors').selectOption('accents');
      await page.locator('#edit-wrap').check(); await page.locator('#edit-numbers').check();
      await page.locator('#edit-close').click();
      await page.locator('#alternative-editor .syntax-color').first().waitFor();
      await code.evaluate((el, at) => el.setSelectionRange(at, at), imported.indexOf('background'));
      await page.locator('#syntax-caption').waitFor();
      const idleLayouts = await page.evaluate(() => new Promise(resolve => {
        const start = window.__editorLayouts; let frames = 0;
        const tick = () => ++frames === 20 ? resolve(window.__editorLayouts - start) : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      }));
      assert(idleLayouts < 6, 'An idle accented editor does not keep scheduling layout frames');
      if (width >= 1000) await page.locator('#split-toggle').click();
      await page.locator('#run').click();
      if (width < 900) assert(await page.locator('#alternative-editor').isHidden());
      else assert(await page.locator('#alternative-editor').isVisible(), 'Desktop split keeps the selected editor');
      await page.locator('#preview iframe').waitFor();
      await page.locator('#run').click();
      assert(await content.isVisible());
      await page.locator('#expert-toggle').click();
      assert(await content.isVisible(), 'Chosen editor also works in simple mode');
      await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#code').disabled);
      await content.waitFor();
      assert.equal(await source(), imported);
      await page.locator('#expert-toggle').click();
      await choose('native');
      assert.equal(await code.inputValue(), imported);
      await choose('codemirror');
      await code.evaluate(el => { el.readOnly = true; });
      await page.waitForFunction(() => document.querySelector('.cm-content').getAttribute('contenteditable') === 'false');
      await content.click(); await page.keyboard.insertText('НЕ ВСТАВЛЯТЬ');
      assert.equal(await source(), imported, 'Read-only state applies to CodeMirror');
      await code.evaluate(el => { el.readOnly = false; });
      await page.waitForFunction(() => document.querySelector('.cm-content').getAttribute('contenteditable') === 'true');
      await setSource('<!-- Безопасный текст <img src=x onerror=alert(1)> -->\n<script src="./three-r160.min.js"></script>\n<script>localStorage.setItem("x", "1"); fetch("/scores");</script>');
      await page.locator('.syntax-accent-library').waitFor();
      assert.equal(await content.locator('img').count(), 0);
      await page.screenshot({ path: join(output, `${name}-${width}-accents.png`) });
      if (width === 390 && url === fileURL) {
        const large = '<!-- Большой документ -->\n' + ('x'.repeat(110) + '\n').repeat(20000) + 'ФИНИШ';
        await setSource(large);
        await page.locator('#edit-find').click(); await page.locator('#edit-query').fill('ФИНИШ');
        assert.equal(await code.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), 'ФИНИШ');
        await page.locator('#edit-find-close').click();
        assert(await content.locator('.cm-line').count() < 100, 'Large source uses a virtual viewport');
        await page.keyboard.insertText('КОНЕЦ'); await page.keyboard.press('Control+z');
        assert.equal(await source(), large, 'Large source editing and undo preserve exact text');
      }
      assert.equal(requests, 0, 'Both editors work offline');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      console.log(`${name} ${new URL(url).protocol} ${width}: switching, folding, undo, search, paste/history, import, exact export, preview, settings and offline persistence passed.`);
    } catch (error) { await page.screenshot({ path: join(output, `${name}-${width}-failure.png`) }); throw error; }
    finally { await context.close(); }
  } } finally { await browser.close(); }
} } finally { await new Promise(resolve => server.close(resolve)); }
console.log(`Alternative editor screenshots: ${output}`);
