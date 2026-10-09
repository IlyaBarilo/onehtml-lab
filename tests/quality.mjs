import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { useNativeEditor } from './native-editor.mjs';

const artifact = new URL('../onehtml-lab.html', import.meta.url);
const html = await readFile(artifact);
const output = join(tmpdir(), 'onehtml-lab-quality'); await mkdir(output, { recursive: true });
const server = createServer((_, response) => response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const urls = [artifact.href, `http://127.0.0.1:${server.address().port}/`];
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10).split(',');
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || selected.includes(name));
const widths = process.argv.find(arg => arg.startsWith('--widths='))?.slice(9).split(',').map(Number);
const profiles = [{ width: 320, native: false, dark: false }, { width: 390, native: true, dark: true }, { width: 1365, native: false, dark: true }, { width: 1365, native: true, dark: false }].filter(profile => !widths || widths.includes(profile.width));
const bad = `<!doctype html><html><head><title>Проверка</title><style>body{margin:0;font:18px system-ui}button{font:16px system-ui}#wide{width:3000px;height:12px}#tiny{width:28px;height:25px;padding:0}#large{width:100px;height:48px}.hidden{display:none}</style></head><body>
<!-- <meta name="viewport" content="width=device-width"> --><textarea hidden><meta name="viewport" content="width=device-width"></textarea><template><meta name="viewport" content="width=device-width"></template>
<script>window.demoHits=0;const fake='<meta name="viewport" content="width=device-width">';console.warn('Учебное предупреждение');</script>
<div id="wide"></div><button id="tiny" aria-label="Малая">+</button><button id="large" onclick="demoHits++;this.textContent='Нажато '+demoHits">Нажать</button><button id="unnamed" style="width:48px;height:48px"></button><input id="unlabelled" placeholder="Введите текст"><input aria-label="Подписанное поле"><div class="hidden"><button>Скрытая малая</button></div><canvas width="100" height="60"></canvas><img width="30" height="30" src="https://quality.onehtml.test/missing.svg"><img width="30" height="30" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><p style="margin-top:2000px"><button>Вне экрана</button></p></body></html>`;
const changed = bad.replace('<title>', '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>') + '\n<!-- правка -->';
const good = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:18px system-ui}button{width:100px;height:48px;font:16px system-ui}label{display:flex;align-items:center;min-height:48px}</style><button id="good" onclick="this.textContent='Готово'">Нажать</button><label><input type="checkbox">Удобная область касания</label><button disabled style="width:20px;height:20px">–</button><canvas width="100" height="60"></canvas>`;
async function source(page, code) {
  if (await page.locator('#code').isVisible()) await page.locator('#code').fill(code);
  else await page.locator('#alternative-editor .cm-content').fill(code);
  assert.equal(await page.locator('#code').inputValue(), code);
}
async function open(page) {
  if (await page.locator('#activity-panel').isHidden()) await page.locator('#diagnostic-open').click();
  await page.locator('[data-diagnostic-tab="quality"]').click();
  await page.waitForFunction(() => !document.querySelector('#diagnostic-copy').disabled);
}
async function report(page) {
  await page.locator('#diagnostic-copy').click();
  await page.locator('#copy-dialog').waitFor({ state: 'visible' });
  const text = await page.locator('#copy-text').inputValue();
  await page.locator('#copy-close').click(); return text;
}
async function history(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('onehtml-lab-draft', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const query = db.transaction('drafts', 'readonly').objectStore('drafts').get('history');
      query.onerror = () => { db.close(); reject(query.error); };
      query.onsuccess = () => { db.close(); resolve(JSON.stringify(query.result ?? null)); };
    };
  }));
}
try {
  assert(engines.length && profiles.length);
  for (const [name, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const url of urls) for (const profile of profiles) {
        const context = await browser.newContext({ viewport: { width: profile.width, height: 844 }, hasTouch: profile.width < 600, acceptDownloads: true });
        context.setDefaultTimeout(10000);
        const page = await context.newPage(); if (profile.native) await useNativeEditor(page);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        let requests = 0;
        await context.route('https://quality.onehtml.test/**', route => { requests++; return route.abort(); });
        await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('no clipboard'); } } }));
        const prefix = `${name}-${new URL(url).protocol.slice(0, -1)}-${profile.width}-${profile.native ? 'native' : 'cm'}`;
        try {
          await page.goto(url); await page.waitForFunction(() => !document.querySelector('#code').disabled);
          if (profile.dark) await page.locator('#theme-toggle').click();
          await page.locator('#expert-toggle').click();
          await source(page, bad); await open(page);
          let findings = await page.locator('#quality-findings').textContent();
          assert.match(findings, /мобильный экран/); assert.match(findings, /Автономность требует проверки/);
          assert.equal(requests, 0, 'Inspecting source must not fetch resources or execute scripts');
          assert.equal(await page.evaluate(() => window.demoHits), undefined);
          assert(await page.locator('#quality-measure').isDisabled());
          assert.equal(await page.locator('#quality-manual-list select').count(), 6);
          await page.locator('#quality-touch').selectOption('ok');
          assert.equal(await page.locator('#quality-touch').inputValue(), 'ok', 'First manual answer must survive initialization');
          await page.locator('#quality-offline').selectOption('issue');
          await page.locator('#quality-note-offline').fill('Не загружается изображение после отключения сети.');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({path:join(output,`${prefix}-notes.png`)});
          const firstHistory = await history(page);
          await page.locator('#activity-close').click(); await open(page);
          assert.equal(await page.locator('#quality-touch').inputValue(), 'ok');
          await page.locator('#activity-close').click(); await source(page, changed); await open(page);
          assert.match(await page.locator('#quality-manual-note').innerText(), /Отметки прежней версии/);
          assert(await page.locator('#quality-touch').isDisabled());
          assert(!(await page.locator('#quality-findings').textContent()).includes('мобильный экран'), 'Real viewport is distinguished from comments, strings and textarea text');
          let text = await report(page);
          assert.match(text, /Прежняя версия: эти отметки не подтверждают текущий код/);
          assert.match(text, /Касания: Проверено/);
          assert.match(text,/Заметка участника: Не загружается изображение/);
          const before = await history(page);
          await page.locator('#quality-ai').click();
          await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
          text = await page.locator('#ai-output').inputValue();
          assert.match(text, /Отчёт участника/); assert.match(text, /Прежняя версия/); assert(text.endsWith(changed));
          assert.match(await page.locator('#ai-quality-context').innerText(), /добавлен отчёт/);
          await page.locator('#ai-view').click(); await page.locator('#ai-copy').click();
          assert.equal(await page.locator('#copy-text').inputValue(), text);
          await page.locator('#copy-close').click(); await page.locator('#ai-close').click();
          assert(await page.locator('#diagnostic-quality').isVisible(), 'Nested prompt returns to the quality panel');
          assert.equal(await history(page), before, 'Reports and prompts do not rewrite history');
          assert.equal(await page.locator('#code').inputValue(), changed);
          assert.equal(requests, 0);
          await page.locator('#activity-close').click(); await source(page, bad); await open(page);
          assert.equal(await page.locator('#quality-touch').inputValue(), 'ok');
          assert(await page.locator('#quality-touch').isEnabled(), 'Returning to the exact tested source restores its answers');
          await page.locator('#activity-close').click(); await source(page, changed); await open(page);
          await page.locator('#quality-manual-start').click();
          assert.equal(await page.locator('#quality-touch').inputValue(), '');
          assert(await page.locator('#quality-touch').isEnabled());
          await page.locator('#quality-touch').selectOption('issue'); await page.locator('#quality-audio').selectOption('na');
          await page.locator('#activity-close').click(); await page.locator('#run').click();
          let frame = await (await page.locator('#preview > iframe').elementHandle()).contentFrame();
          await frame.locator('#large').waitFor();
          await open(page); await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Снимок'));
          findings = await page.locator('#quality-findings').textContent();
          assert.match(findings, /Содержимое шире экрана/); assert.match(findings, /Малая \(28 × 25\)/);
          assert.match(findings,/Масштабирование страницы ограничено/);assert.match(findings,/Элемент без понятного названия.*unnamed/);
          assert.match(findings,/Поле без подписи.*unlabelled/);assert.match(findings,/Изображение без описания/);
          assert.equal(await page.locator('.quality-finding').filter({hasText:'Изображение без описания'}).count(),1,'Explicit decorative alt must not be reported');
          assert(!findings.includes('Скрытая малая')); assert(!findings.includes('Вне экрана'));
          assert.match(findings, /Есть Canvas или 3D/); assert.match(findings, /предупреждений 1/);
          await page.waitForFunction(() => document.querySelector('#quality-findings').textContent.includes('Проблемы с ресурсами'));
          const hits = await frame.evaluate(() => window.demoHits); assert.equal(hits, 0);
          const unnamed=page.locator('.quality-finding').filter({hasText:'Элемент без понятного названия'});
          await unnamed.locator('summary').click();await unnamed.scrollIntoViewIfNeeded();
          await page.screenshot({path:join(output,`${prefix}-actions.png`)});
          await unnamed.getByRole('button',{name:'Показать',exact:true}).click();
          await page.locator('#quality-show-bar').waitFor();assert(await page.locator('#activity-panel').isHidden());
          assert.match(await page.locator('#quality-show-description').innerText(),/unnamed/);
          assert.equal(await frame.evaluate(()=>window.demoHits),hits);assert.equal(await page.locator('#code').inputValue(),changed);
          await page.screenshot({path:join(output,`${prefix}-highlight.png`)});
          await page.locator('#quality-show-back').click();assert(await page.locator('#diagnostic-quality').isVisible());
          await unnamed.getByRole('button',{name:'Исправить с ИИ',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#ai-copy').disabled);
          const targeted=await page.locator('#ai-output').inputValue();assert(targeted.startsWith('Что изменить:\nИсправь замечание проверки: Элемент без понятного названия'));assert(targeted.includes('"id": "unnamed"'));assert(targeted.endsWith(changed));
          assert.equal(await frame.evaluate(()=>window.demoHits),hits);assert.equal(await page.locator('#code').inputValue(),changed);
          await page.locator('#ai-close').click();assert(await page.locator('#diagnostic-quality').isVisible());
          await unnamed.getByRole('button',{name:'Показать',exact:true}).click();await frame.locator('#unnamed').evaluate(node=>node.remove());
          await page.waitForFunction(()=>!document.querySelector('#activity-panel').hidden && document.querySelector('#quality-layout-note').textContent.includes('больше не доступен'));
          assert(await page.locator('#quality-show-bar').isHidden());
          await page.evaluate(() => window.postMessage({ type: 'onehtml-lab:quality-result', id: 9999, width: 1, height: 1, scrollWidth: 999999, small: [] }, '*'));
          await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Снимок'));
          text = await report(page); assert(!text.includes('999999')); assert.match(text, /Звук: Не применимо/); assert.match(text, /Касания: Нужна правка/);
          assert.equal(await frame.evaluate(() => window.demoHits), hits, 'Observation must not simulate user actions');
          await page.screenshot({ path: join(output, `${prefix}.png`) });
          const contrast = await page.locator('#quality-layout-note').evaluate(node => {
            const luminance = color => {
              const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => { const n = Number(value) / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
              return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
            };
            const foreground = luminance(getComputedStyle(node).color), background = luminance(getComputedStyle(document.querySelector('#activity-panel')).backgroundColor);
            return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
          });
          assert(contrast >= 4.5, 'Quality notes must remain readable in both themes');
          const geometry = await page.locator('#diagnostic-quality').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, fonts: [...node.querySelectorAll('select')].map(el => parseFloat(getComputedStyle(el).fontSize)), controls: [...node.querySelectorAll('select,button')].map(el => el.getBoundingClientRect().height) }));
          assert(geometry.scroll <= geometry.width + 1); assert(geometry.fonts.every(size => size >= 16)); assert(geometry.controls.every(size => size >= 44));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.setViewportSize({ width: profile.width + 120, height: 740 }); await page.waitForTimeout(100);
          text = await report(page); assert.match(text, /Размер области изменён/);
          await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Снимок'));
          await frame.goto('about:blank');
          await frame.evaluate(() => {
            window.unavailableReply = false;
            addEventListener('message', event => {
              if (event.data?.type !== 'onehtml-lab:quality-request') return;
              parent.postMessage({ type: 'onehtml-lab:quality-result', token:event.data.token, id: event.data.id, unavailable: window.unavailableReply ? true : 'invalid', width: -1, height: 'bad', small: [] }, '*');
            });
          });
          await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Нет ответа.'));
          await frame.evaluate(() => { window.unavailableReply = true; });
          await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Не удалось получить размеры'));
          assert(!(await report(page)).includes('NaN'));
          await page.locator('#activity-close').click(); await page.locator('#run').click();
          await source(page, good); await open(page);
          assert.match(await page.locator('#quality-layout-note').innerText(), /прежней версии/);
          await page.locator('#activity-close').click(); await page.locator('#run').click();
          frame = await (await page.locator('#preview > iframe').elementHandle()).contentFrame(); await frame.locator('#good').waitFor();
          await open(page); await page.locator('#quality-measure').click(); await page.waitForFunction(() => document.querySelector('#quality-layout-note').textContent.startsWith('Снимок'));
          findings = await page.locator('#quality-findings').textContent(); assert.match(findings, /малые кнопки не замечены/); assert(!findings.includes('Малая (28')); assert(!findings.includes('предупреждений 1'));
          assert.match(await page.locator('#quality-manual-note').innerText(), /Отметки прежней версии/);
          await page.locator('#quality-manual-start').click(); await page.locator('#quality-reading').selectOption('ok');
          await page.locator('#quality-reading').locator('..').locator('details summary').click();await page.locator('#quality-note-reading').fill('На узком экране текст читается.');
          await page.waitForFunction(()=>document.querySelector('#quality-manual-note').textContent.includes('заметки сохранены'));
          await page.locator('#quality-ai').click(); await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
          assert((await page.locator('#ai-output').inputValue()).endsWith(good));
          await page.locator('#ai-close').click(); await page.locator('#activity-close').click(); await page.locator('#run').click();
          // Opening the ordinary prompt must not silently reuse the quality report.
          await page.locator('#ai-open').click(); await page.locator('#prompt-check').click(); await page.waitForFunction(() => !document.querySelector('#ai-copy').disabled);
          assert(!(await page.locator('#ai-output').inputValue()).includes('Отчёт участника')); await page.locator('#ai-close').click();
          await page.locator('#save').click(); await page.locator('#save-dialog').waitFor({ state: 'visible' });
          const pending = page.waitForEvent('download'); await page.locator('#confirm-save').click(); const download = await pending;
          const path = join(output, `${prefix}-saved.html`); await download.saveAs(path);
          assert.equal((await readFile(path, 'utf8')).replace(/\r\n/g, '\n'), good, 'Export contains exactly the source, without the probe or checklist');
          await page.locator('#expert-toggle').click();
          assert(await page.locator('#diagnostic-tabs').isHidden()); assert(await page.locator('#diagnostic-quality').isHidden());
          await page.locator('#expert-toggle').click(); await open(page);
          assert.equal(await page.locator('#quality-reading').inputValue(), 'ok', 'Mode changes retain manual state');
          await page.locator('#activity-close').click(); await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
          await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled); await open(page);
          await page.waitForFunction(()=>document.querySelector('#quality-reading').value === 'ok' && !document.querySelector('#quality-reading').disabled);
          assert.equal(await page.locator('#quality-reading').inputValue(), 'ok', 'Persisted manual answers belong to the exact checked source, not to a new run');
          assert.equal(await page.locator('#quality-note-reading').inputValue(),'На узком экране текст читается.');
          assert.deepEqual(errors, []);
          console.log(`${prefix}: inert observations, sizes, source-bound answers, reports/AI, stale runs, no writes, exact export and layout passed.`);
        } catch (error) { await page.screenshot({ path: join(output, `${prefix}-failure.png`) }); throw error; }
        finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { server.close(); }
console.log(`Quality screenshots: ${output}`);
await import('./quality-persistence.mjs');
