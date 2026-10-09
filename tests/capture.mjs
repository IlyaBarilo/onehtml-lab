// Optional Playwright instrumentation for the browser-check runner only.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const output = process.env.ONEHTML_ARTIFACT_DIR;
if (output) {
  await mkdir(output, { recursive: true });
  const pending = new Set();
  const completed = [];
  let serial = 0;
  async function captureContext(context) {
    const folder = join(output, `context-${String(++serial).padStart(4, '0')}`);
    await mkdir(folder);
    const messages = [];
    const errors = [];
    const record = page => {
      page.on('console', message => { messages.push(`${message.type()}: ${message.text().slice(0, 1500)}`); if (messages.length > 60) messages.shift(); });
      page.on('pageerror', error => { errors.push(String(error).slice(0, 2000)); if (errors.length > 30) errors.shift(); });
    };
    context.on('page', record);
    let tracing = false, saved;
    try { if (process.env.ONEHTML_CAPTURE_TRACE === '1') { await context.tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true; } }
    catch (error) { errors.push(`Trace setup: ${error.message}`); }
    const save = () => saved ||= (async () => {
      const pages = context.pages().slice(-2);
      const info = [];
      for (const [index, page] of pages.entries()) {
        info.push({ url: page.url(), viewport: page.viewportSize() });
        try { await page.screenshot({ path: join(folder, `page-${index + 1}.png`), timeout: 2000 }); }
        catch (error) { errors.push(`Screenshot: ${error.message}`); }
      }
      if (tracing) {
        try { await context.tracing.stop({ path: join(folder, 'trace.zip') }); }
        catch (error) { errors.push(`Trace save: ${error.message}`); }
      }
      await writeFile(join(folder, 'browser.json'), JSON.stringify({ pages: info, messages, errors }, null, 2));
      // Keep recent contexts; successful suites are removed by the parent runner.
      completed.push(folder);
      while (completed.length > 6) {
        const previous = resolve(completed.shift());
        if (!previous.startsWith(resolve(output) + sep)) throw new Error('Unexpected context artifact path');
        await rm(previous, { recursive: true, force: true });
      }
    })().catch(error => { console.error('Could not save browser artifacts:', error.message); });
    pending.add(save);
    const close = context.close.bind(context);
    context.close = async (...args) => { await save(); pending.delete(save); return close(...args); };
    return save;
  }
  for (const engine of [chromium, firefox, webkit]) {
    const launch = engine.launch.bind(engine);
    engine.launch = async (...args) => {
      const browser = await launch(...args);
      const contexts = new Set();
      const create = browser.newContext.bind(browser);
      browser.newContext = async (...options) => {
        const context = await create(...options);
        const save = await captureContext(context);
        contexts.add(save);
        return context;
      };
      const close = browser.close.bind(browser);
      browser.close = async (...options) => {
        for (const save of contexts) { await save(); pending.delete(save); }
        return close(...options);
      };
      return browser;
    };
  }
  process.once('uncaughtException', async error => {
    console.error(error);
    // Preserve failure status even if the test has no finally block.
    const guard = setTimeout(() => process.exit(1), 15000);
    for (const save of pending) await save();
    clearTimeout(guard);
    process.exit(1);
  });
}
