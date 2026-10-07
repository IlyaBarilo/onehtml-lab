import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { chromium, webkit } from 'playwright';

const url = new URL('../onehtml-lab.html', import.meta.url).href;
const html = await readFile(new URL(url));
const output = join(tmpdir(), 'onehtml-lab-code-guide');
await mkdir(output, { recursive: true });
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const http = `http://127.0.0.1:${server.address().port}/`;
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',');
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || selected.includes(name));
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9).split(',').map(Number);
assert(engines.length);
const samples = ['interactive-poster', 'branching-story', 'interactive-infographic', 'catch-circle', 'sound-panel', '3d-showcase'];
const originals = new Map(await Promise.all(samples.map(async id => [id, (await readFile(new URL(`../src/examples/${id}.html`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')])));
const firstStarts = ['<h1', 'const scenes', 'const stages', '<h1', 'const sounds', 'function makeLamp'];
const libraryHelpers = { TextEncoder, TextDecoder, Blob, crypto: webcrypto, window: {} };
const librarySource = (await Promise.all(['library-bundle.js', 'exporter.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
runInNewContext(librarySource + '\nthis.api={libraryCache,prepareGameHtml};', libraryHelpers);
const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
libraryHelpers.api.libraryCache.set('three@0.128.0', { key: 'three@0.128.0', title: 'Three.js r128', sourceUrl: cdn, source: '/* guide-test-library */\nwindow.THREE={REVISION:"128"};', license: await readFile(new URL('../LICENSE', import.meta.url), 'utf8') });
const embeddedPast = (await libraryHelpers.api.prepareGameHtml(`<script src="${cdn}"></script><p>Старая подпись</p>`)).html.replace(/\r\n/g, '\n');
const embeddedCurrent = embeddedPast.replace('Старая подпись', 'Новая подпись');

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const [protocol, app] of [['file', url], ['http', http]]) {
        for (const [width, editor, dark] of [[320, 'codemirror', false], [390, 'native', true], [1365, 'codemirror', true], [1365, 'native', false]]) {
          if (widths && !widths.includes(width)) continue;
          const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 800, acceptDownloads: true });
          context.setDefaultTimeout(10000);
          const page = await context.newPage(), errors = [], requests = [];
          page.on('pageerror', error => errors.push(error.message));
          await context.route(/^https?:/, route => { if (route.request().url().startsWith(http)) return route.continue(); requests.push(route.request().url()); return route.abort(); });
          await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.nextCode, writeText: async text => { window.copied = text; } } }));
          try {
            await page.goto(app); await page.waitForFunction(() => !document.querySelector('#code').disabled);
            const code = page.locator('#code');
            assert(await page.locator('#edit-open').isHidden());
            if (editor === 'native') await page.locator('#editor-toggle').click();
            if (dark) await page.locator('#theme-toggle').click();
            await page.locator('#expert-toggle').click();
            await page.locator('#ai-open').click();
            assert(await page.locator('#prompt-explain').isDisabled()); assert(await page.locator('#prompt-check').isDisabled());
            await page.locator('#ai-close').click();
            const prepared = async () => { await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled); return page.locator('#ai-output').inputValue(); };
            const selection = () => code.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) }));
            const state = async () => {
              await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
              return page.evaluate(async () => {
                const history = await new Promise((resolve, reject) => {
                  const request = indexedDB.open('onehtml-lab-draft', 1);
                  request.onerror = () => reject(request.error);
                  request.onsuccess = () => { const db = request.result, read = db.transaction('drafts', 'readonly').objectStore('drafts').get('history'); read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => { db.close(); reject(read.error); }; };
                });
                return JSON.stringify({ code: document.querySelector('#code').value, history, undo: document.querySelector('#edit-undo').disabled, redo: document.querySelector('#edit-redo').disabled });
              });
            };
            const manual = text => code.evaluate((el, text) => { el.value = text; el.setSelectionRange(0, 0); el.dispatchEvent(new Event('input', { bubbles: true })); }, text);
            const settings = async () => { await page.locator('#edit-open').click(); assert(await page.locator('#edit-panel').isVisible()); };
            const replace = async text => {
              await page.evaluate(text => { window.nextCode = text; }, text);
              await page.locator('#paste').click();
              if (await page.locator('#replace-dialog').isVisible()) await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, text);
            };
            for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
              const id = samples[sampleIndex], previous = await code.inputValue();
              await page.locator('#examples-open').click();
              await page.locator(`[data-example-category="${id === 'catch-circle' ? 'games' : 'media'}"]`).click();
              if (id === 'catch-circle') await page.locator('#examples-dialog [data-platform="mobile"]').click();
              await page.locator(`[data-example-id="${id}"]`).getByRole('button', { name: 'Открыть копию', exact: true }).click();
              if (previous) await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, originals.get(id));
              await settings();
              assert.equal(await page.locator('[data-guide-part]').count(), 5);
              assert.equal(await page.locator('[data-guide-part]:disabled').count(), 0, id);
              if (sampleIndex === 0) await page.screenshot({ path: join(output, `${name}-${protocol}-${width}-${editor}-guide.png`) });
              const before = await state();
              for (let index = 0; index < 5; index++) {
                await page.locator(`[data-guide-part="${index}"]`).click();
                assert(await page.locator('#edit-panel').isHidden());
                const at = await selection(); assert(at.end > at.start);
                if (index === 0) assert(at.text.startsWith(firstStarts[sampleIndex]), at.text);
                assert.equal(await state(), before, 'Navigation is read-only');
                if (editor === 'codemirror') {
                  const selectedText = await page.locator('#alternative-editor .cm-content').evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return data.getData('text/plain'); });
                  assert.equal(selectedText, at.text, 'Both editors use the same source offsets');
                }
                await settings();
              }
              await page.locator('#edit-close').click();
              // Add lines above every mapped section and change visible text.
              const current = '<!-- Своя правка 😀 -->\n\n' + originals.get(id).replaceAll('Поймай круг', 'Поймай звезду');
              const input = page.locator(editor === 'native' ? '#code' : '#alternative-editor .cm-content');
              await input.click(); await input.press('Control+Home'); await page.keyboard.insertText('<!-- Своя правка 😀 -->\n\n');
              // A normal editor transaction ensures manual changes retain the source association.
              if (id === 'catch-circle') await manual(current);
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, current);
              await settings(); await page.locator('[data-guide-part="0"]').click();
              const at = await selection(); assert(at.start > 20); assert(at.text.startsWith(firstStarts[sampleIndex]));
              if (id === 'catch-circle') assert.match(at.text, /Поймай звезду/);
              const unchanged = await state();
              await settings(); await page.locator('#edit-explain').click();
              let prompt = await prepared();
              assert.match(await page.locator('.ai-instruction').innerText(), /Прочитайте объяснение/);
              assert.match(prompt, /Выделенный фрагмент/); assert(prompt.includes(at.text)); assert(prompt.endsWith(current));
              assert(!prompt.includes('Верни полный HTML-файл'));
              assert.match(prompt, /не возвращай новый полный HTML/);
              await page.locator('#ai-view').click(); await page.locator('#ai-copy').click();
              assert.equal(await page.evaluate(() => window.copied), prompt);
              assert.equal(await state(), unchanged);
              if (sampleIndex === 0) {
                await page.locator('#ai-view').click();
                await page.locator('#ai-task').fill('Объяснить эту часть'); await prepared();
                await page.locator('#prompt-check').click(); prompt = await prepared();
                assert(await page.locator('#ai-history').isDisabled()); assert.match(prompt, /Прошлая версия не включена/);
                await page.locator('#prompt-explain').click(); assert.equal(await page.locator('#ai-task').inputValue(), 'Объяснить эту часть'); await prepared();
              }
              await page.locator('#ai-close').click(); assert(await page.locator('#edit-panel').isVisible());
              await page.locator('#edit-close').click();
              // Remove a real mapped node. Fake occurrences in comments must not take its place.
              const removed = current.slice(0, at.start) + '<!-- ' + at.text + ' -->' + current.slice(at.end);
              await manual(removed);
              await settings(); assert(await page.locator('[data-guide-part="0"]').isDisabled());
              assert.match(await page.locator('#code-guide-list li').first().innerText(), /Участок удалён/);
              await page.locator('#edit-close').click();
              await manual(current);
              await settings(); assert(await page.locator('[data-guide-part="0"]').isEnabled());
              await page.locator('#edit-close').click();
              // Duplicate a semantic section: refuse an ambiguous jump.
              const duplicated = current.slice(0, at.end) + '\n' + at.text + current.slice(at.end);
              await manual(duplicated);
              await settings(); assert(await page.locator('[data-guide-part="0"]').isDisabled());
              await page.locator('#edit-close').click();
              await manual(current);
              if (id === 'interactive-infographic') {
                await manual(current.replace(/const stages[^\n]*;/, 'const stages = ;'));
                await settings(); assert(await page.locator('[data-guide-part="0"]').isDisabled(), 'A broken declaration must not be offered as an editable section');
                await page.locator('#edit-close').click(); await manual(current);
              }
              if (editor === 'codemirror' && id === 'interactive-infographic') {
                await settings(); await page.locator('[data-guide-part="2"]').click();
                await code.evaluate(el => el.setSelectionRange(el.selectionStart, el.selectionStart));
                await page.locator('#edit-fold').click();
                assert(await page.locator('#alternative-editor .cm-foldPlaceholder').count() > 0);
                await settings(); await page.locator('[data-guide-part="2"]').click();
                assert.equal(await page.locator('#alternative-editor .cm-foldPlaceholder').count(), 0);
              }
            }
            const baseline = await code.inputValue();
            if (width === 320 && protocol === 'file') {
              await manual(baseline + '\n<!--' + 'x'.repeat(500000) + '-->');
              await settings(); assert.equal(await page.locator('[data-guide-part]:disabled').count(), 5);
              assert.match(await page.locator('#code-guide-list').innerText(), /слишком большой/);
              await page.locator('#edit-close').click(); await manual(baseline);
            }
            await replace(baseline + '\n<!-- Первый ответ ИИ -->');
            const first = await code.inputValue();
            await replace(first + '\n<!-- Второй ответ ИИ -->');
            await page.locator('#history-open').click();
            // Explicitly select the older of two versions, not the most recent.
            await page.locator('.history-entry').nth(1).getByRole('button', { name: 'Сравнить эту версию с текущей', exact: true }).click();
            await page.locator('#comparison-close').click();
            const unchanged = await state();
            await settings(); await page.locator('#edit-check').click();
            await page.locator('#ai-task').fill('Проверить добавленные комментарии и управление');
            let prompt = await prepared();
            assert.match(await page.locator('.ai-instruction').innerText(), /проверьте результат/);
            assert.match(await page.locator('#ai-analysis-context').innerText(), /выбранной/);
            assert(prompt.includes('Первый ответ ИИ')); assert(prompt.includes('Второй ответ ИИ')); assert.match(prompt, /Добавлено:/);
            assert(prompt.endsWith(await code.inputValue())); assert.match(prompt, /Не утверждай, что запускал/);
            assert.equal(await state(), unchanged);
            await page.locator('#ai-history').uncheck(); prompt = await prepared();
            assert.match(prompt, /Прошлая версия не включена/); assert(!prompt.includes('Сравнение с прошлой версией'));
            await page.locator('#ai-history').check(); await prepared();
            const geometry = await page.locator('[data-ai-mode]').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, height: r.height }; }));
            assert(geometry.every(r => r.x >= 0 && r.right <= width + 1 && r.height >= 44));
            if (width < 800) assert.equal(new Set(geometry.map(r => r.y)).size, 2);
            await page.screenshot({ path: join(output, `${name}-${protocol}-${width}-${editor}-check.png`) });
            await page.locator('#ai-close').click(); await page.locator('#edit-close').click();
            // Removing the chosen baseline falls back to an existing version, never a stale copy.
            await page.locator('#history-open').click();
            await page.locator('.history-entry').nth(1).getByRole('button', { name: 'Удалить версию', exact: true }).click();
            await page.locator('#history-close').click(); await settings(); await page.locator('#edit-check').click();
            prompt = await prepared(); assert.match(await page.locator('#ai-analysis-context').innerText(), /последней прошлой/);
            assert(prompt.endsWith(await code.inputValue()));
            await page.locator('#ai-close').click(); await page.locator('#edit-close').click();
            // Generic HTML: no invented guide; whole-document explanation and exact export.
            const generic = '<h1>Самостоятельный проект</h1><script>window.guideLeak=true</script>';
            await page.locator('#import-file').setInputFiles({ name: 'own.html', mimeType: 'text/html', buffer: Buffer.from(generic) });
            await page.locator('#replace-dialog button[value="replace"]').click();
            await page.waitForFunction(expected => document.querySelector('#code').value === expected, generic);
            await settings(); assert(await page.locator('#code-guide').isHidden()); assert(await page.locator('#code-guide-note').isVisible());
            await page.locator('#edit-explain').click(); prompt = await prepared(); assert.match(prompt, /Фрагмент не выделен/); assert(prompt.endsWith(generic));
            await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
            await page.locator('#ai-copy').click(); assert.equal(await page.locator('#copy-text').inputValue(), prompt);
            await page.locator('#copy-close').click(); assert(await page.locator('#ai-dialog').isVisible());
            await page.locator('#ai-close').click(); assert(await page.locator('#edit-panel').isVisible()); await page.locator('#edit-close').click();
            await page.locator('#save').click(); const pending = page.waitForEvent('download'); await page.locator('#confirm-save').click();
            assert.equal(await readFile(await (await pending).path(), 'utf8'), generic);
            assert.equal(await page.evaluate(() => window.guideLeak), undefined);
            // Shorten both sides using verified library metadata; keep the real game difference.
            for (const text of [embeddedPast, embeddedCurrent]) {
              await page.locator('#import-file').setInputFiles({ name: 'libraries.html', mimeType: 'text/html', buffer: Buffer.from(text) });
              await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, text);
            }
            await page.locator('#history-open').click();
            await page.locator('.history-entry').first().getByRole('button', { name: 'Сравнить эту версию с текущей', exact: true }).click();
            await page.locator('#comparison-close').click(); await settings();
            const libraryState = await state();
            await page.locator('#edit-check').click(); prompt = await prepared();
            assert(prompt.includes(cdn)); assert(!prompt.includes('guide-test-library'));
            assert.match(await page.locator('#ai-libraries').innerText(), /В прошлой версии заменены/);
            assert(prompt.includes('Старая')); assert(prompt.includes('Новая'));
            await page.locator('#ai-shorten').uncheck(); prompt = await prepared(); assert(prompt.endsWith(embeddedCurrent)); assert(prompt.includes('guide-test-library'));
            assert.equal(await state(), libraryState);
            assert.deepEqual(errors, []); assert.deepEqual(requests, []);
            console.log(`${name} ${protocol} ${width} ${editor}: maps, shifted/removed/ambiguous nodes, selection, folding, explanation, selected-history checks, read-only copy and exact export passed.`);
          } catch (error) { await page.screenshot({ path: join(output, `${name}-${protocol}-${width}-${editor}-failure.png`) }); throw error; }
          finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
console.log(`Code guide screenshots: ${output}`);
