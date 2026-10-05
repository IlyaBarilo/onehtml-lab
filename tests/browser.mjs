import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const args = process.argv.slice(2);
assert(args.every(arg => arg === '--http' || /^--engines=(chromium|firefox|webkit)(,(chromium|firefox|webkit))*$/.test(arg)), 'Use: node tests/browser.mjs [--http] [--engines=chromium,webkit]');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.TEST_RESULTS_DIR || join(tmpdir(), 'onehtml-lab-test-results');
await mkdir(output, { recursive: true });
const htmlPath = resolve(root, 'onehtml-lab.html');
// File-first checks are the default. An ephemeral HTTP test is opt-in only;
// no server is needed to open or demonstrate the application.
let server;
const urls = [pathToFileURL(htmlPath).href];
if (args.includes('--http') || process.env.TEST_HTTP === '1') {
  const html = await readFile(htmlPath);
  server = createServer((req, res) => {
    if (req.url !== '/') return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  urls.push(`http://127.0.0.1:${server.address().port}/`);
}
const result = { generatedAt: new Date().toISOString(), cases: [], limitations: [
  'Desktop browser engines with mobile viewport/touch emulation; no physical Android or iPhone.',
  'Clipboard success, rejection, empty and pending states use a controlled API double; OS paste menu needs manual testing.',
  'HTTP loopback is a secure context but is not a deployed HTTPS / GitHub Pages test.',
  'WebKit offline emulation rejects even a plain local file before load (see offline-probe.json); its file scenario switches offline after loading.',
  'No infinite loop is executed: a blocking script can prevent the Stop button from receiving input.'
] };

const sample = `<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#edf8f0;padding:24px}button{font:inherit;padding:16px;border-radius:12px}</style></head><body><h1>Моя игра 🐱</h1><button id="counter">Счёт: 0</button><script>let n=0;document.querySelector('#counter').onclick=()=>document.querySelector('#counter').textContent='Счёт: '+(++n);window.ticks=0;setInterval(()=>window.ticks++,20);</script></body></html>`;

async function waitUntil(fn, message, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(message);
}

async function runCase(browser, engine, url, mode) {
  const viewport = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1365, height: 900 };
  const context = await browser.newContext({ viewport, hasTouch: mode === 'mobile', acceptDownloads: true });
  const offline = url.startsWith('file:');
  // See offline.mjs: this WebKit runner rejects even a plain file if offline
  // is set before navigation. Preserve the limitation instead of calling it a pass.
  if (offline && engine !== 'webkit') await context.setOffline(true);
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const escapes = [];
  await context.route('**/*', route => {
    const requestUrl = route.request().url();
    if (requestUrl === url || requestUrl.startsWith('file:')) return route.continue();
    escapes.push(requestUrl);
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__clipboardState = 'success';
    window.__clipboardValue = '';
    window.__actualClipboard = { secureContext: isSecureContext, readTextAvailable: typeof navigator.clipboard?.readText === 'function' };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: () => {
        if (window.__clipboardState === 'denied') return Promise.reject(new Error('denied'));
        if (window.__clipboardState === 'pending') return new Promise(resolve => { window.__resolveClipboard = resolve; });
        return Promise.resolve(window.__clipboardValue);
      }
    } });
  });
  const entry = { engine, version: browser.version(), protocol: new URL(url).protocol, offline, offlineBeforeLoad: offline && engine !== 'webkit', mode, checks: [] };
  const check = name => entry.checks.push(name);
  try {
    await page.goto(url);
    if (offline && engine === 'webkit') await context.setOffline(true);
    entry.clipboardAvailability = await page.evaluate(() => window.__actualClipboard);
    const code = page.locator('#code');
    assert(await page.locator('#run').isDisabled());
    assert(await page.locator('#save').isDisabled());
    assert(await page.locator('#clear').isDisabled());
    check('Empty state disables run/save/clear');

    await code.fill('код для очистки');
    await page.locator('#clear').click();
    assert(await page.locator('#clear-dialog').isVisible());
    assert.equal(await code.inputValue(), 'код для очистки');
    await page.locator('#cancel-clear').click();
    assert.equal(await code.inputValue(), 'код для очистки');
    await page.locator('#clear').click();
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    assert.equal(await code.inputValue(), '');
    assert(await page.locator('#clear').isDisabled());
    check('Clear requires confirmation; cancellation preserves code');

    await code.fill('old code must disappear');
    await page.evaluate(text => { window.__clipboardValue = text; }, sample);
    await page.locator('#paste').click();
    await waitUntil(async () => await code.inputValue() === sample, 'Clipboard must replace the entire source');
    check('Paste button replaces all existing code');

    await page.evaluate(() => { window.__clipboardValue = '  '; });
    await page.locator('#paste').click();
    assert.equal(await code.inputValue(), sample);
    assert.match(await page.locator('#status').innerText(), /нет текста/);
    await page.evaluate(() => { window.__clipboardState = 'denied'; });
    await page.locator('#paste').click();
    assert.equal(await code.inputValue(), sample);
    assert.match(await page.locator('#status').innerText(), /меню поля/);
    check('Empty/denied clipboard preserves code with manual-paste guidance');

    await page.evaluate(() => { window.__clipboardState = 'pending'; });
    await page.locator('#paste').click();
    await code.fill('new edit while clipboard pending');
    await page.evaluate(() => window.__resolveClipboard('stale result'));
    await waitUntil(async () => !await page.locator('#paste').isDisabled(), 'Clipboard completion');
    assert.equal(await code.inputValue(), 'new edit while clipboard pending');
    check('Pending clipboard read does not overwrite subsequent editing');

    // Checks editable textarea behavior, not a claim of OS clipboard-menu testing.
    await code.fill('before after');
    await code.focus();
    await code.evaluate(el => el.setSelectionRange(7, 7));
    await page.keyboard.insertText('native input ');
    assert.equal(await code.inputValue(), 'before native input after');
    check('Textarea retains ordinary caret-based text editing');

    await code.fill(sample);
    await page.locator('#run').click();
    assert(await code.isHidden());
    assert.equal(await page.locator('#run').getAttribute('aria-label'), 'Стоп');
    assert(await page.locator('#stop-icon').isVisible());
    assert(await page.locator('#play-icon').isHidden());
    assert(await page.locator('#paste').isDisabled());
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    const frame = await page.locator('iframe').elementHandle().then(el => el.contentFrame());
    await frame.locator('#counter').click();
    assert.equal(await frame.locator('#counter').innerText(), 'Счёт: 1');
    assert.equal(await frame.evaluate(() => document.compatMode), 'CSS1Compat');
    await waitUntil(async () => await frame.evaluate(() => window.ticks) > 1, 'Game timer running');
    check('Inline HTML/CSS/JS game runs and replaces editor');

    await page.locator('#save').click();
    assert.equal(await page.locator('#filename').inputValue(), 'game.html');
    const dialogBounds = await page.locator('#save-dialog').boundingBox();
    const okBounds = await page.getByRole('button', { name: 'ОК', exact: true }).boundingBox();
    const workspaceBounds = await page.locator('.workspace').boundingBox();
    assert.equal(dialogBounds.y, workspaceBounds.y, 'Save screen starts at the workspace edge');
    assert.equal(dialogBounds.width, workspaceBounds.width, 'Save screen uses the workspace width');
    assert(okBounds.y + okBounds.height <= viewport.height, 'Save action is visible in the viewport');
    if (url.startsWith('file:')) await page.screenshot({ path: join(output, `${engine}-file-${mode}-save-dialog.png`) });
    let downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ОК', exact: true }).click();
    let download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'game.html');
    assert.equal(await readFile(await download.path(), 'utf8'), sample);
    check('Workspace save screen downloads unchanged source as game.html while running');

    await page.locator('#save').click();
    await page.locator('#filename').fill('Кот');
    downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ОК', exact: true }).click();
    download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'Кот.html');
    assert.equal(await readFile(await download.path(), 'utf8'), sample);
    check('Custom filename receives .html extension');

    await page.locator('#save').click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert(await page.locator('#save-dialog').isHidden());
    await page.locator('#run').click();
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.locator('#run').getAttribute('aria-label'), 'Запустить');
    assert(await page.locator('#play-icon').isVisible());
    assert(frame.isDetached());
    assert(await code.isVisible());
    assert.equal(await code.inputValue(), sample);
    await page.locator('#run').click();
    assert.equal(await page.frameLocator('iframe').locator('#counter').innerText(), 'Счёт: 0');
    await page.locator('#run').click();
    check('Stop destroys the old frame, restores exact code and rerun starts fresh');

    const hostile = `<!doctype html><body><h1>Isolation test</h1><script>
      const outcomes={};
      try{parent.document.body.dataset.compromised='yes';outcomes.parent='allowed'}catch(e){outcomes.parent=e.name}
      try{localStorage.setItem('attack','1');outcomes.storage='allowed'}catch(e){outcomes.storage=e.name}
      outcomes.popup=window.open('https://onehtml.invalid/popup')===null;
      try{top.location.href='https://onehtml.invalid/top'}catch(e){outcomes.top=e.name}
      fetch('https://onehtml.invalid/fetch').catch(()=>{});
      try{const x=new XMLHttpRequest();x.open('GET','https://onehtml.invalid/xhr');x.send()}catch(e){}
      try{new WebSocket('wss://onehtml.invalid/socket')}catch(e){}
      try{navigator.sendBeacon('https://onehtml.invalid/beacon','hello')}catch(e){}
      parent.postMessage({type:'replaceCode',html:'HACKED'},'*');
      document.body.dataset.outcomes=JSON.stringify(outcomes);
    </script><script src="https://onehtml.invalid/script.js"></script><link rel="stylesheet" href="https://onehtml.invalid/style.css"><img src="https://onehtml.invalid/image.png"><iframe src="https://onehtml.invalid/frame"></iframe><form action="https://onehtml.invalid/form" method="post"><input name="x" value="1"></form><script>document.querySelector('form').submit()</script>`;
    await code.fill(hostile);
    await page.locator('#run').click();
    const securityFrame = await page.locator('#preview > iframe').elementHandle().then(el => el.contentFrame());
    await securityFrame.waitForFunction(() => document.body.dataset.outcomes);
    const outcomes = await securityFrame.evaluate(() => JSON.parse(document.body.dataset.outcomes));
    assert.equal(outcomes.parent, 'SecurityError');
    assert.equal(outcomes.storage, 'allowed');
    assert.equal(await page.evaluate(() => { try { return localStorage.getItem('attack'); } catch { return null; } }), null);
    assert.equal(outcomes.popup, true);
    assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
    assert.equal(page.url(), url);
    assert.equal(context.pages().length, 1);
    // Let asynchronous load attempts reach the interception boundary.
    await page.waitForTimeout(150);
    assert((await page.locator('#preview > iframe').getAttribute('srcdoc')).includes("script-src 'unsafe-inline' https:"), 'Network-enabled preview permits HTTPS resources');
    assert(!escapes.some(request => /\/(?:popup|top|frame|form)$/.test(request)), 'Sandbox still blocks popups, navigation, nested frames and forms');
    check('Sandbox blocks parent DOM and host storage while permitting isolated game storage and HTTPS resources');
    await page.locator('#run').click();
    assert.equal(await code.inputValue(), hostile);
    escapes.length = 0;

    for (const navigation of [
      `<script>location.href='https://onehtml.invalid/self'</script>`,
      `<meta http-equiv="refresh" content="0;url=https://onehtml.invalid/refresh">`,
      `<a href="https://onehtml.invalid/link" id="link">link</a><script>document.querySelector('#link').click()</script>`,
      `<script>location.href='data:text/html,<h1>escaped</h1>'</script>`,
      `<script>location.href=URL.createObjectURL(new Blob(['<h1>escaped</h1>'],{type:'text/html'}))</script>`
    ]) {
      await code.fill(navigation);
      await page.locator('#run').click();
      await page.waitForTimeout(150);
      assert.equal(page.url(), url);
      assert.deepEqual(escapes, [], navigation);
      const frameUrl = (await page.locator('#preview > iframe').elementHandle().then(el => el.contentFrame())).url();
      entry.navigationOutcomes ??= [];
      entry.navigationOutcomes.push({ navigation, frameUrl });
      assert(!/^https?:/i.test(frameUrl), navigation);
      await page.locator('#run').click();
    }
    check('Preview navigation attempts do not produce external requests or navigate the host');

    const large = '<!doctype html><body><h1>Large source</h1><!--' + 'x'.repeat(1024 * 1024) + '--></body>';
    await code.fill(large);
    await page.locator('#run').click();
    assert.equal(await page.frameLocator('#preview > iframe').locator('h1').innerText(), 'Large source');
    await page.locator('#run').click();
    assert.equal(await code.inputValue(), large);
    check('1 MiB HTML survives run/stop without source loss');

    await code.fill(sample);
    for (const size of [viewport, { width: 320, height: 568 }, { width: 441, height: 700 }, { width: 480, height: 700 }, { width: 600, height: 700 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      const layout = await page.evaluate(() => {
        const header = document.querySelector('.toolbar').getBoundingClientRect();
        const work = document.querySelector('.workspace').getBoundingClientRect();
        const editor = document.querySelector('#code').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.actions button')].filter(el => !el.hidden).map(el => {
          const rect = el.getBoundingClientRect();
          return { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, right: rect.right, name: el.getAttribute('aria-label'), svg: el.querySelectorAll('svg').length };
        });
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, header: { top: header.top, bottom: header.bottom }, work: { left: work.left, right: work.right, top: work.top, bottom: work.bottom }, editor: { width: editor.width, height: editor.height }, buttons, background: getComputedStyle(document.querySelector('#code')).backgroundColor };
      });
      assert(layout.scrollWidth <= layout.width, 'No horizontal overflow');
      assert.equal(layout.header.top, 0, 'Toolbar touches viewport top');
      assert.equal(layout.work.left, 0, 'Workspace has no outside side margin');
      assert.equal(layout.work.right, layout.width);
      assert.equal(layout.work.top, layout.header.bottom, 'No gap below toolbar');
      // WebKit can round 100dvh by 1/64 CSS px. Treat subpixel rounding as
      // equivalent while still detecting any visible outside gutter.
      assert(Math.abs(layout.work.bottom - layout.height) < 1, 'Workspace fills remaining height');
      assert.equal(layout.editor.width, layout.width);
      assert(Math.abs(layout.editor.height - (layout.height - layout.header.bottom)) < 1);
      assert.equal(layout.background, 'rgb(252, 253, 255)');
      assert.equal(layout.buttons.length, 7);
      assert(layout.buttons.every(button => button.width >= 44 && button.height >= 44 && button.top >= 0 && button.bottom <= layout.header.bottom && button.right <= layout.width && button.name && button.svg), 'All icon controls fit the toolbar and have accessible names');
    }
    await page.setViewportSize(viewport);
    await page.screenshot({ path: join(output, `${engine}-${entry.protocol.slice(0, -1)}-${mode}-editor.png`) });
    await page.locator('#run').click();
    await page.frameLocator('#preview > iframe').locator('#counter').waitFor({ state: 'visible' });
    await page.screenshot({ path: join(output, `${engine}-${entry.protocol.slice(0, -1)}-${mode}-preview.png`) });
    await page.locator('#run').click();
    await code.fill('');
    await code.blur();
    await page.screenshot({ path: join(output, `${engine}-${entry.protocol.slice(0, -1)}-${mode}-empty.png`) });
    check('Edge-to-edge light layout, inline SVG controls and 44px touch targets at mobile, narrow and landscape sizes');
    entry.status = 'passed';
  } catch (error) {
    entry.status = 'failed';
    entry.error = error.stack;
    await page.screenshot({ path: join(output, `${engine}-${mode}-failure.png`) }).catch(() => {});
    process.exitCode = 1;
  } finally {
    console.log(`${engine} ${entry.protocol} ${mode}: ${entry.status} (${entry.checks.length} checks)${entry.error ? '\n' + entry.error : ''}`);
    result.cases.push(entry);
    await context.close();
  }
}

try {
  for (const engine of (args.find(arg => arg.startsWith('--engines='))?.split('=')[1] || process.env.TEST_ENGINES || 'chromium,webkit').split(',')) {
    let browser;
    try { browser = await playwright[engine].launch({ headless: true, timeout: 20000 }); }
    catch (error) {
      result.cases.push({ engine, status: 'unavailable', error: error.message });
      console.log(`${engine}: unavailable: ${error.message}`);
      process.exitCode = 1;
      continue;
    }
    try {
      for (const url of urls) {
        for (const mode of ['mobile', 'desktop']) await runCase(browser, engine, url, mode);
      }
    } finally { await browser.close(); }
  }
} finally {
  server?.close();
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`Report: ${join(output, 'results.json')}`);
}
