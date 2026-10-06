import { useNativeEditor } from './native-editor.mjs';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const url = new URL('../onehtml-lab.html', import.meta.url).href;
const output = join(tmpdir(), 'onehtml-lab-editor');
await mkdir(output, { recursive: true });
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];
const sample = '<!doctype html>\n<!-- Кот кот КОТ .*$ [x] 😀 -->\n' + Array.from({ length: 120 }, (_, i) => `<!-- Строка ${i + 3}: ${'длинный текст '.repeat(10)} -->`).join('\n');

for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 620, height: 800 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, acceptDownloads: true });
      context.setDefaultTimeout(10000);
      const page = await context.newPage();
      await useNativeEditor(page);
      const errors = [];
      page.on('pageerror', error => { if (!error.message.includes('editor-location')) errors.push(error.message); });
      const settings = async () => { if (await page.locator('#edit-panel').isHidden()) await page.locator('#edit-open').click(); };
      const open = async () => { if (await page.locator('#edit-panel').isVisible()) await page.locator('#edit-panel-find').click(); else if (await page.locator('#edit-inline').isHidden()) await page.locator('#edit-find').click(); if (await page.locator('#edit-replace-box').isHidden()) await page.locator('#edit-replace-toggle').click(); };
      const selection = () => page.locator('#code').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, selected: el.value.slice(el.selectionStart, el.selectionEnd) }));
      try {
        await page.goto(url);
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        assert(await page.locator('#edit-open').isHidden());
        await page.locator('#code').fill(sample);
        await page.locator('#expert-toggle').click();
        for (const id of ['import', 'edit-open', 'compare', 'history-open', 'storage-toggle', 'library-extract-open', 'ai-open', 'examples-open']) {
          const bounds = await page.locator(`#${id}`).boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, `${id} fits at ${viewport.width}`);
        }
        await open();
        assert(await page.locator('#code').isVisible());
        await page.locator('#edit-query').fill('кот');
        assert.equal(await page.locator('#edit-result').innerText(), '1 из 3');
        await page.locator('#edit-next').click();
        assert.equal(await page.locator('#edit-result').innerText(), '2 из 3');
        await page.locator('#edit-find-close').click();
        assert.equal((await selection()).selected, 'кот');
        await open();
        assert.equal(await page.locator('#edit-result').innerText(), '2 из 3');
        await page.locator('#edit-prev').click();
        await page.locator('#edit-case').check();
        assert.equal(await page.locator('#edit-result').innerText(), '1 из 1');
        await page.locator('#edit-query').fill('.*$');
        assert.equal(await page.locator('#edit-result').innerText(), '1 из 1', 'Search is literal');
        await page.locator('#edit-replacement').fill('$&😀');
        await page.locator('#edit-replace').click();
        assert((await page.locator('#code').inputValue()).includes('$&😀'), 'Replacement is literal');
        await page.locator('#edit-quick-undo').click();
        assert.equal(await page.locator('#code').inputValue(), sample);
        await open();
        await page.locator('#edit-quick-redo').click();
        assert((await page.locator('#code').inputValue()).includes('$&😀'));
        await open();
        await page.locator('#edit-quick-undo').click();
        await open();
        await page.locator('#edit-query').fill('кот');
        await page.locator('#edit-case').uncheck();
        await page.locator('#edit-replacement').fill('пёс');
        await page.locator('#edit-replace-all').click();
        assert.equal(await page.locator('#code').inputValue(), sample.replace(/кот/gi, 'пёс'));
        assert.match(await page.locator('#edit-feedback').innerText(), /Заменено: 3/);
        await page.locator('#edit-quick-undo').click();
        assert.equal(await page.locator('#code').inputValue(), sample, 'Replace all is one undo step');
        await page.keyboard.insertText('X');
        await open();
        assert(await page.locator('#edit-quick-redo').isDisabled(), 'New edit discards redo');
        await page.locator('#edit-quick-undo').click();
        assert.equal(await page.locator('#code').inputValue(), sample);
        await page.locator('#code').evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
        await page.keyboard.type('abc');
        await page.keyboard.press('Control+z');
        assert.equal(await page.locator('#code').inputValue(), sample, 'Typing is grouped');
        await page.keyboard.press('Control+Shift+z');
        assert.equal(await page.locator('#code').inputValue(), sample + 'abc');
        await page.keyboard.press('Control+z');
        if (viewport.width === 320) {
          await page.keyboard.press('End');
          await page.keyboard.press('Backspace');
          await page.keyboard.press('Backspace');
          await page.keyboard.press('Control+z');
          assert.equal(await page.locator('#code').inputValue(), sample, 'Consecutive deletions undo together');
          await page.keyboard.type('новое');
          await page.locator('#code').evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' })));
          assert.equal(await page.locator('#code').inputValue(), sample, 'Native undo command uses the same chain');
        }
        await settings();
        await page.locator('#edit-font').selectOption('20');
        await page.locator('#edit-numbers').check();
        await page.locator('#edit-line').fill('99999');
        await page.locator('#edit-line-form button').click();
        assert.match(await page.locator('#edit-line-feedback').innerText(), /от 1 до 122/);
        await page.locator('#edit-line').fill('90');
        await page.locator('#edit-line-form button').click();
        assert((await selection()).selected.startsWith('<!-- Строка 90:'));
        await page.waitForFunction(() => [...document.querySelectorAll('#code-lines span')].some(el => el.textContent === '90'));
        assert((await page.locator('#code').evaluate(el => el.scrollTop)) > 0);
        assert.equal(await page.locator('#code').evaluate(el => getComputedStyle(el).fontSize), '20px');
        await page.screenshot({ path: join(output, `${name}-${viewport.width}-code.png`) });
        await settings();
        await page.locator('#edit-wrap').uncheck();
        await open(); await page.locator('#edit-query').fill('Строка 90:');
        await page.screenshot({ path: join(output, `${name}-${viewport.width}-tools.png`) });
        await page.locator('#edit-find-close').click();
        assert.equal(await page.locator('#code').getAttribute('wrap'), 'off');
        assert(await page.locator('#code').evaluate(el => el.scrollWidth > el.clientWidth));
        await page.locator('#expert-toggle').click();
        assert(await page.locator('#edit-open').isHidden());
        assert(await page.locator('#code-lines').isVisible(), 'View applies in simple mode');
        await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#code').disabled);
        assert.equal(await page.locator('#code').inputValue(), sample);
        assert.equal(await page.locator('#code').getAttribute('wrap'), 'off');
        assert.equal(await page.locator('#code').evaluate(el => getComputedStyle(el).fontSize), '20px');
        await page.locator('#expert-toggle').click();
        await open();
        assert(await page.locator('#edit-quick-undo').isDisabled(), 'Undo is session-local');
        await page.locator('#edit-query').fill('');
        assert(await page.locator('#edit-replace-all').isDisabled());
        await page.locator('#edit-find-close').click();

        // Saving and preview must keep source text, not line numbers or display wrapping.
        await page.locator('#save').click();
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#confirm-save').click();
        const download = await downloadEvent;
        assert.equal(await readFile(await download.path(), 'utf8'), sample);
        const game = '<!doctype html>\n<html><body><script>\nthrow new Error("editor-location");\n</script></body></html>';
        await page.locator('#code').fill(game);
        await page.locator('#run').click();
        assert(await page.locator('#edit-open').isDisabled());
        await page.waitForFunction(() => !document.querySelector('#runtime-error').hidden);
        await page.locator('#activity-toggle').click();
        if (name === 'chromium') {
          assert.match(await page.locator('#runtime-error-message').innerText(), /строка кода 3/);
          await page.locator('#error-line').click();
          assert(await page.locator('#preview').isHidden());
          assert.equal(await page.locator('#run').getAttribute('aria-label'), 'Запустить');
          assert(await page.locator('#edit-open').isEnabled());
          const at = (await selection()).start;
          assert.equal(game.slice(0, at).split('\n').length, 3);
          // Reject locations in external scripts, even if their line numbers are plausible.
          await page.locator('#run').click();
          await page.waitForFunction(() => document.querySelector('#runtime-error-message').textContent.includes('editor-location'));
          const frame = await (await page.locator('#preview iframe').elementHandle()).contentFrame();
          await frame.evaluate(() => parent.postMessage({ type: 'onehtml-lab:runtime-error', kind: 'error', message: 'external', filename: 'https://example.invalid/lib.js', line: 1, column: 1 }, '*'));
          await page.waitForFunction(() => document.querySelector('#runtime-error-message').textContent.includes('external'));
          assert(await page.locator('#error-line').isHidden());
          await page.locator('#run').click();
          if (viewport.width === 320) {
            await page.locator('#network-toggle').click();
            await page.locator('#storage-toggle').click();
            await page.locator('#code').fill('<script>throw new Error("editor-location")</script>');
            await page.locator('#run').click();
            await page.waitForFunction(() => !document.querySelector('#runtime-error').hidden);
            await page.locator('#activity-toggle').click();
            assert.match(await page.locator('#runtime-error-message').innerText(), /строка кода 1/);
            await page.locator('#error-line').click();
            assert((await selection()).start < 20, 'First-line column excludes the injected prefix');
          }
        } else {
          // WebKit may mask cross-origin script locations in a sandbox.
          await page.locator('#activity-close').click();
          await page.locator('#run').click();
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        console.log(`${name} ${viewport.width}: search, literal replacement, undo/redo, navigation, view persistence and errors passed.`);
      } catch (error) {
        await page.screenshot({ path: join(output, `${name}-${viewport.width}-failure.png`) });
        throw error;
      } finally { await context.close(); }
    }
    // Large documents: virtual line labels, end-of-file navigation and safe snippets.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await useNativeEditor(page);
    try {
      await page.goto(url);
      await page.waitForFunction(() => !document.querySelector('#code').disabled);
      const large = '<!-- <img src=x onerror=alert(1)> -->\n' + ('x'.repeat(110) + '\n').repeat(20000) + 'ФИНИШ';
      await page.locator('#expert-toggle').click();
      await page.locator('#import-file').setInputFiles({ name: 'large.html', mimeType: 'text/html', buffer: Buffer.from(large) });
      await page.waitForFunction(() => document.querySelector('#code').value.endsWith('ФИНИШ'));
      await page.locator('#edit-open').click();
      await page.locator('#edit-numbers').check(); await page.locator('#edit-panel-find').click();
      await page.locator('#edit-query').fill('x');
      assert.equal(await page.locator('#edit-result').innerText(), '1 из 2200001');
      await page.locator('#edit-query').fill('ФИНИШ');
      await page.locator('#edit-find-close').click();
      assert.equal(await page.locator('#code').evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), 'ФИНИШ');
      assert((await page.locator('#code-lines span').count()) < 100);
      await page.locator('#edit-find').click();
      await page.locator('#edit-query').fill('<img');
      assert.equal(await page.locator('#edit-inline img').count(), 0);
      console.log(`${name}: 2 MB document and escaped snippets passed.`);
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
console.log(`Editor screenshots: ${output}`);
await import('./editor-touch.mjs');
