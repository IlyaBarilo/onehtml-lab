import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const fileURL = new URL('../onehtml-lab.html', import.meta.url).href;
const html = await readFile(new URL(fileURL));
const output = join(tmpdir(), 'onehtml-lab-learning');
await mkdir(output, { recursive: true });
const samples = ['interactive-poster', 'branching-story', 'interactive-infographic', 'catch-circle'];
const originals = new Map(await Promise.all(samples.map(async id => [id, (await readFile(new URL(`../src/examples/${id}.html`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')])));
const selectedEngines = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',');
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selectedEngines || selectedEngines.includes(name));
assert(engines.length);
const server = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const httpURL = `http://127.0.0.1:${server.address().port}/`;

async function useDemo(frame, id) {
  if (id === 'interactive-poster') {
    const program = frame.locator('#program-toggle');
    await program.click(); assert.equal(await frame.locator('#program li').count(), 3);
    assert(await frame.locator('#program').isVisible());
    await frame.locator('#remember').focus(); await frame.locator('#remember').press('Space');
    assert.equal(await frame.locator('#remember').getAttribute('aria-pressed'), 'true');
    await program.focus(); await program.press('Enter'); assert(await frame.locator('#program').isHidden());
  } else if (id === 'branching-story') {
    await frame.locator('#choices button').first().click();
    await frame.locator('#choices button').first().focus(); await frame.locator('#choices button').first().press('Enter');
    assert.equal(await frame.locator('#scene-title').innerText(), 'Город отвечает');
    assert(await frame.locator('#ending').isVisible());
    await frame.locator('#back').click(); await frame.locator('#choices button').last().click();
    assert.equal(await frame.locator('#scene-title').innerText(), 'Комната памяти');
    await frame.locator('#restart').click();
    assert.equal(await frame.locator('#step').textContent(), 'Шаг 1'); assert(await frame.locator('#back').isDisabled());
    await frame.locator('#choices button').last().click(); await frame.locator('#choices button').first().click();
    assert.equal(await frame.locator('#scene-title').innerText(), 'Новый кадр');
  } else if (id === 'interactive-infographic') {
    assert.equal(await frame.locator('#total').innerText(), '28');
    await frame.locator('[data-stage="prototype"]').click();
    assert.equal(await frame.locator('#total').innerText(), '32');
    const values = await frame.locator('.row-title span:last-child').allTextContents();
    assert.deepEqual(values, ['6 ч', '12 ч', '5 ч', '9 ч']);
    const bars = await frame.locator('.bar').evaluateAll(els => els.map(el => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width));
    bars.forEach((value, i) => assert(Math.abs(value - [6, 12, 5, 9][i] / 16) < .01));
    await frame.locator('.row').last().focus(); await frame.locator('.row').last().press('Enter');
    assert.equal(await frame.locator('#note-title').innerText(), 'Интерактив');
  } else {
    await frame.locator('#start').click(); await frame.locator('#target').click();
    assert.equal(await frame.locator('#score').innerText(), '1');
    return;
  }
  await frame.locator('#theme').click();
  assert.equal(await frame.locator('body').getAttribute('class'), 'dark');
  await frame.locator('#theme').focus(); await frame.locator('#theme').press('Enter');
  assert.equal(await frame.locator('#theme').getAttribute('aria-pressed'), 'false');
  const geometry = await frame.locator('body').evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, size: getComputedStyle(document.body).fontSize }));
  assert(geometry.content <= geometry.width + 1, JSON.stringify(geometry));
  assert.equal(geometry.size, '16px');
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const [protocol, url] of [['file', fileURL], ['http', httpURL]]) {
        for (const [width, editor, dark] of [[320, 'codemirror', false], [390, 'native', true], [1365, 'codemirror', true], [1365, 'native', false]]) {
          const prefix = `${name}-${protocol}-${width}-${editor}`;
          const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 800, acceptDownloads: true });
          const requests = [], errors = [];
          try {
            context.setDefaultTimeout(10000);
            await context.route(/^https?:/, route => {
              if (route.request().url().startsWith(httpURL)) return route.continue();
              requests.push(route.request().url()); return route.abort();
            });
            await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.clipboardInput, writeText: async text => { window.clipboardOutput = text; } } }));
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(url);
            const code = page.locator('#code');
            await page.waitForFunction(() => !document.querySelector('#code').disabled);
            assert(await page.locator('#examples-open').isHidden(), 'Catalogue remains expert-only');
            if (editor === 'native') await page.locator('#editor-toggle').click();
            if (dark) await page.locator('#theme-toggle').click();
            await page.locator('#expert-toggle').click();
            assert.equal(await page.locator('#examples-open').innerText(), 'Примеры');

            async function openCatalogue(category) {
              await page.locator('#examples-open').click();
              await page.locator(`[data-example-category="${category}"]`).click();
              if (category === 'games') await page.locator('#examples-dialog [data-platform="mobile"]').click();
            }
            for (const id of samples) {
              const category = id === 'catch-circle' ? 'games' : 'media';
              await openCatalogue(category);
              const card = page.locator(`[data-example-id="${id}"]`);
              const toggle = card.getByRole('button', { name: 'Задание', exact: true });
              const untouched = await code.inputValue();
              await toggle.click();
              assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
              assert(await card.locator('[data-lesson-prompt]').first().isDisabled(), 'A different example must be opened before requesting its task');
              assert.equal(await code.inputValue(), untouched, 'Reading a task must not replace code');
              await card.locator('summary').first().click(); assert(await card.locator('details').first().getAttribute('open') !== null);
              if (width === 320 && id === samples[0]) {
                const geometry = await page.locator('.example-category').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; }));
                assert(geometry.every(r => r.left >= 0 && r.right <= 320 && r.height >= 44));
                await page.screenshot({ path: join(output, `${prefix}-task.png`) });
              }
              const previous = await code.inputValue();
              await card.getByRole('button', { name: 'Открыть копию', exact: true }).click();
              if (previous) await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, originals.get(id));
              const field = page.locator(editor === 'native' ? '#code' : '#alternative-editor .cm-content');
              await field.click(); await field.press('Control+End'); await page.keyboard.insertText('<!-- Своя правка -->');
              const current = originals.get(id) + '<!-- Своя правка -->';
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, current);
              await openCatalogue(category);
              assert.equal(await card.locator('.example-task').getAttribute('hidden'), null, 'Task expansion survives catalogue navigation');
              for (const [index, label] of [[0, 'Базовое задание'], [1, 'Усложнение']]) {
                await card.locator('[data-lesson-prompt]').nth(index).click();
                await page.locator('#ai-copy').waitFor({ state: 'visible' });
                await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
                if (id === samples[0] && index === 0 && width === 1365) {
                  await page.locator('#ai-dialog [data-platform="desktop"]').click();
                  await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
                }
                assert.match(await page.locator('#ai-task').inputValue(), new RegExp(label));
                await page.locator('#ai-view').click();
                const prompt = await page.locator('#ai-output').inputValue();
                assert(prompt.endsWith(current), 'The prompt uses the edited code, not a pristine example');
                assert.match(prompt, id === 'catch-circle' ? /Измени игру ниже/ : /Измени приложение ниже/);
                if (id !== 'catch-circle' && width === 1365) assert.match(prompt, /Основное устройство — компьютер/);
                await page.locator('#ai-copy').click();
                assert.equal(await page.evaluate(() => window.clipboardOutput), prompt);
                assert.equal(await code.inputValue(), current, 'Preparing and copying a task must not alter code');
                await page.locator('#ai-close').click(); assert(await page.locator('#examples-dialog').isVisible());
              }
              await page.locator('#examples-close').click();
              await page.locator('#run').click();
              const frame = page.frameLocator('#preview > iframe');
              await frame.locator('main').waitFor();
              await useDemo(frame, id);
              if (width === 320 && id !== 'catch-circle') await page.screenshot({ path: join(output, `${prefix}-${id}.png`) });
              await page.locator('#run').click();

              // Simulated full reply from an external AI: archive, compare, then restore.
              const reply = current.replace('Своя правка', 'Ответ ИИ');
              await page.evaluate(text => { window.clipboardInput = text; }, reply);
              await page.locator('#paste').click(); await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, reply);
              await page.locator('#history-open').click();
              const entry = page.locator('.history-entry').first();
              await entry.getByRole('button', { name: 'Сравнить эту версию с текущей', exact: true }).click();
              assert(await page.locator('#comparison').isVisible());
              await page.locator('#comparison-close').click(); await page.locator('#history-open').click();
              await entry.getByRole('button', { name: 'Вернуть версию', exact: true }).click();
              await page.locator('#replace-dialog button[value="replace"]').click();
              await page.waitForFunction(expected => document.querySelector('#code').value === expected, current);
              await page.locator('#save').click(); await page.locator('#filename').fill(`${id}.html`);
              const pending = page.waitForEvent('download'); await page.locator('#confirm-save').click();
              const download = await pending, path = join(output, `${prefix}-${id}.html`);
              await download.saveAs(path); assert.equal(await readFile(path, 'utf8'), current);
              const saved = await context.newPage();
              saved.on('pageerror', error => errors.push(error.message));
              await saved.goto(pathToFileURL(path).href); await useDemo(saved, id); await saved.close();
            }
            // Clipboard denial returns through the manual-copy screen to the same task.
            await openCatalogue('games');
            await page.locator('[data-example-id="catch-circle"] [data-lesson-prompt]').first().click();
            await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
            const prompt = await page.locator('#ai-output').inputValue();
            await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
            await page.locator('#ai-copy').click(); assert(await page.locator('#copy-dialog').isVisible());
            assert.equal(await page.locator('#copy-text').inputValue(), prompt);
            await page.locator('#copy-close').click(); assert(await page.locator('#ai-dialog').isVisible());
            await page.locator('#ai-close').click(); assert(await page.locator('#examples-dialog').isVisible());
            const draft = await code.inputValue();
            await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
            await page.reload();
            await page.waitForFunction(expected => !document.querySelector('#code').disabled && document.querySelector('#code').value === expected, draft);
            await openCatalogue('games');
            const restoredCard = page.locator('[data-example-id="catch-circle"]');
            await restoredCard.getByRole('button', { name: 'Задание', exact: true }).click();
            await restoredCard.locator('[data-lesson-prompt]').first().click();
            await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
            assert((await page.locator('#ai-output').inputValue()).endsWith(draft), 'A restored draft keeps its task source');
            assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'Examples and tasks must work without external requests');
            console.log(`${prefix}: four lessons, edited-code prompts, interactions, clipboard fallback, history, exact export and offline saved files passed.`);
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
console.log(`Screenshots and saved examples: ${output}`);
