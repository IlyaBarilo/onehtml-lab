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
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.__editorClipboard } });
    });
    let requests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => { requests++; return route.abort(); });
    const code = page.locator('#code'), content = page.locator('#alternative-editor .cm-content');
    const settings = async () => {
      if (await page.locator('#edit-panel').isHidden()) await page.locator('#edit-open').click();
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
      assert(await page.locator('#alternative-editor').isVisible(), 'A fresh profile starts with CodeMirror');
      assert(await content.evaluate(el => el.classList.contains('cm-lineWrapping')), 'New profiles wrap long lines');
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'false');
      assert(await page.locator('#editor-toggle').isVisible(), 'Display controls are also available in simple mode');
      const firstPaste = '<h1>Первая вставка</h1>';
      await page.evaluate(value => { window.__editorClipboard = value; }, firstPaste);
      await page.locator('#paste').click();
      await page.waitForFunction(value => document.querySelector('#code').value === value, firstPaste);
      await content.getByText('Первая вставка').waitFor();
      await content.press('Control+End'); await page.keyboard.insertText('!');
      assert.equal(await source(), firstPaste + '!', 'Fresh default CodeMirror supports toolbar paste and native typing');
      await page.locator('#save').click();
      const firstDownloadEvent = page.waitForEvent('download'); await page.locator('#confirm-save').click();
      const firstDownload = await firstDownloadEvent;
      assert.equal(await readFile(await firstDownload.path(), 'utf8'), firstPaste + '!', 'Simple-mode export uses the complete CodeMirror source');
      await page.locator('#editor-toggle').click();
      assert(await page.locator('#alternative-editor').isHidden());
      await code.fill(sample);
      await code.evaluate(el => el.setSelectionRange(0, 0));
      await page.locator('#expert-toggle').click();
      assert.equal(await page.locator('[data-edit-indent], [data-edit-pair], #edit-quick-settings').count(), 0);
      for (const id of ['edit-copy-selection', 'edit-fold', 'edit-unfold-all']) {
        assert.equal(await page.locator('#' + id + ' svg').count(), 1);
        assert.equal(await page.locator('#' + id).innerText(), '');
        assert(await page.locator('#' + id).getAttribute('aria-label'));
      }
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
      const displaySource = '<style>body { background: #ffdead; color: #112233; }</style>\n<h1>Моя игра</h1>\n<script>function play() { return 7; }</script>';
      await setSource(displaySource);
      await content.press('Control+Home'); await content.press('ArrowRight');
      const caretBeforeTheme = await code.evaluate(el => el.selectionStart);
      await page.locator('#theme-toggle').click();
      assert(await page.locator('html').evaluate(el => el.classList.contains('theme-dark')));
      assert.equal(await content.getByText('function', { exact: true }).evaluate(el => getComputedStyle(el).color), 'rgb(198, 163, 238)', 'CodeMirror syntax uses the dark palette');
      assert.equal(await source(), displaySource); assert.equal(await code.evaluate(el => el.selectionStart), caretBeforeTheme);
      assert.equal(await page.locator('#alternative-editor').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 30, 42)');
      const pinned = async () => {
        await page.locator('#edit-quick-tools').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        const engine = await page.locator('#editor-toggle').boundingBox(), theme = await page.locator('#theme-toggle').boundingBox();
        assert(engine && theme && engine.width >= 44 && theme.width >= 44 && engine.x + engine.width <= theme.x && theme.x + theme.width <= width && theme.y + theme.height <= 844, 'Display buttons stay pinned at the right with touch targets');
      };
      await pinned();
      await page.screenshot({ path: join(output, `${name}-${width}-dark-codemirror.png`) });
      await page.locator('#compare').click();
      const diffEditor = page.locator('#comparison-editor .cm-content');
      await diffEditor.waitFor();
      assert.equal(await diffEditor.getAttribute('contenteditable'), 'false', 'Comparison preserves CodeMirror in a read-only view');
      assert(await page.locator('#comparison-editor .cm-lineNumbers').isVisible());
      assert.equal(await page.locator('#comparison-editor').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 30, 42)');
      assert.equal(await page.locator('#comparison-editor .diff-added').first().evaluate(el => getComputedStyle(el).color), 'rgb(185, 232, 197)');
      assert.equal(await page.locator('#comparison-editor .diff-removed').first().evaluate(el => getComputedStyle(el).color), 'rgb(241, 187, 182)');
      await page.locator('#comparison-editor .cm-foldGutter').getByText('−', { exact: true }).first().click();
      await page.locator('#comparison-editor .cm-foldPlaceholder').first().waitFor();
      assert.equal(await source(), displaySource, 'Folding comparison leaves the source intact');
      await page.locator('#comparison-editor .cm-foldPlaceholder').first().click();
      await diffEditor.click(); await page.keyboard.insertText('НЕ МЕНЯТЬ');
      assert.equal(await source(), displaySource, 'Comparison cannot modify the source');
      await page.screenshot({ path: join(output, `${name}-${width}-dark-comparison-codemirror.png`) });
      await page.locator('#comparison-game-tab').click();
      assert(await page.locator('#comparison-editor').isHidden());
      await page.locator('#comparison-code-tab').click(); await diffEditor.waitFor();
      await page.locator('#comparison-close').click();
      assert.equal(await source(), displaySource); assert.equal(await code.evaluate(el => el.selectionStart), caretBeforeTheme, 'Closing comparison restores the source cursor');
      await page.locator('#editor-toggle').click();
      await code.waitFor({ state: 'visible' });
      assert.equal(await source(), displaySource); assert.equal(await code.evaluate(el => el.selectionStart), caretBeforeTheme);
      await page.keyboard.insertText('!');
      assert.equal(await source(), displaySource.slice(0, caretBeforeTheme) + '!' + displaySource.slice(caretBeforeTheme));
      await code.press('Control+z'); assert.equal(await source(), displaySource);
      await page.locator('#code-colors').waitFor();
      assert.equal(await code.evaluate(el => getComputedStyle(el).color), 'rgba(0, 0, 0, 0)', 'Native text stays transparent over the dark syntax layer');
      assert.equal(await page.locator('#code-colors').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 30, 42)');
      await page.waitForFunction(() => [...document.querySelectorAll('#code-colors .syntax-keyword')].some(el => el.textContent === 'function' && getComputedStyle(el).color === 'rgb(198, 163, 238)'), null, { timeout: 10000 });
      await settings(); await page.locator('#edit-colors').selectOption('off'); await page.locator('#edit-close').click();
      await page.waitForFunction(() => !document.querySelector('#code').classList.contains('has-colors'));
      assert.equal(await code.evaluate(el => getComputedStyle(el).color), 'rgb(217, 226, 239)', 'Native plain text is light in dark mode');
      assert.equal(await code.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 30, 42)');
      await settings(); await page.locator('#edit-colors').selectOption('accents'); await page.locator('#edit-close').click();
      await page.screenshot({ path: join(output, `${name}-${width}-dark-native.png`) });
      await page.locator('#compare').click();
      assert(await page.locator('#comparison-editor').isHidden());
      assert.equal(await page.locator('#diff-content').evaluate(el => getComputedStyle(el).color), 'rgb(217, 226, 239)', 'Unchanged comparison text is readable in the dark theme');
      assert.equal(await page.locator('#diff-content').evaluate(el => getComputedStyle(el).fontSize), '20px', 'Native comparison keeps the chosen text size');
      await page.screenshot({ path: join(output, `${name}-${width}-dark-comparison-native.png`) });
      await page.locator('#comparison-close').click();
      await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
      await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled);
      assert(await content.isHidden(), 'Native choice persists');
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true', 'Dark theme persists');
      assert.equal(await source(), displaySource);
      await page.locator('#run').click();
      await page.frameLocator('#preview iframe').locator('h1').waitFor();
      assert.equal(await page.frameLocator('#preview iframe').locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 222, 173)', 'App theme preserves game colors');
      await page.locator('#run').click();
      await page.locator('#editor-toggle').click(); await content.waitFor();
      await page.locator('#theme-toggle').click();
      assert(!await page.locator('html').evaluate(el => el.classList.contains('theme-dark')));
      await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled);
      assert(await content.isVisible(), 'CodeMirror choice persists');
      assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'false', 'Light theme persists');
      assert.equal(await source(), displaySource);
      await pinned();
      // Different wrapping and line heights must never scroll the workspace itself.
      const switchingSource = Array.from({ length: 200 }, (_, i) => `<p>Строка ${i} ${'длинный текст '.repeat(i % 5 === 0 ? 15 : 1)}</p>`).join('\n') + '\nПОСЛЕДНЯЯ';
      await setSource(switchingSource);
      await content.press('Control+End');
      const workspaceTop = await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().top);
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.locator('#editor-toggle').click(); await code.waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const field = document.querySelector('#code');
          const line = [...document.querySelectorAll('#code-colors .syntax-line')].find(el => el.textContent === 'ПОСЛЕДНЯЯ');
          if (!line) return false;
          const range = document.createRange(); range.selectNodeContents(line);
          const glyph = range.getBoundingClientRect(), editor = field.getBoundingClientRect();
          return glyph.top >= editor.top && glyph.bottom <= editor.top + field.clientHeight;
        });
        assert.equal(await code.evaluate(el => el.selectionStart), switchingSource.length);
        await page.locator('#editor-toggle').click(); await content.waitFor();
        await page.waitForFunction(() => {
          const line = [...document.querySelectorAll('.cm-line')].find(el => el.textContent === 'ПОСЛЕДНЯЯ');
          const editor = document.querySelector('#alternative-editor').getBoundingClientRect();
          if (!line) return false;
          const range = document.createRange(); range.selectNodeContents(line);
          const glyph = range.getBoundingClientRect();
          return glyph.top >= editor.top && glyph.bottom <= editor.bottom;
        });
        assert.equal(await source(), switchingSource);
        assert.equal(await code.evaluate(el => el.selectionStart), switchingSource.length);
        assert.equal(await page.locator('.workspace').evaluate(el => el.scrollTop), 0, 'Outer workspace cannot be scrolled by cursor reveal');
        assert.equal(await page.locator('#alternative-editor').evaluate(el => el.getBoundingClientRect().top), workspaceTop, 'Editor stays under the toolbar');
      }
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
