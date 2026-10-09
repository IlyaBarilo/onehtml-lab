import assert from 'node:assert/strict';

export async function checkStructureFolding(page, prefix) {
  const code = page.locator('#code'), content = page.locator('#alternative-editor .cm-content');
  const scroller = page.locator('#alternative-editor .cm-scroller');
  const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const overview = async () => {
    const labels = new Set(); let text = '';
    const height = await scroller.evaluate(el => el.clientHeight);
    for (let top = 0; ; top += height) {
      await scroller.evaluate((el, top) => { el.scrollTop = top; }, top); await settled();
      text += '\n' + await content.innerText();
      for (const label of await content.locator('.cm-foldPlaceholder').allTextContents()) labels.add(label);
      if (await scroller.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)) break;
    }
    await scroller.evaluate(el => { el.scrollTop = 0; }); await settled();
    return { text, labels };
  };
  const original = await code.inputValue();
  const rows = name => Array.from({ length: 12 }, (_, n) => `<p>${name} ${n}</p>`).join('\n');
  const source = `<!doctype html>
<html>
<head>
<title>Структура</title>
<style>
body { color: #123456; }
</style>
</head>
<body>
<h1>Видимый заголовок</h1>
<main id="world">
<section id="nested">
${rows('ВНУТРЕННИЙ')}
</section>
</main>
<section id="controls">
${rows('УПРАВЛЕНИЕ')}
</section>
<script src="./library.js"></script>
<script>
const markup = '<section>Не HTML-узел</section>';
function update() { return 5; }
</script>
<script>${'const bundled = "' + 'x'.repeat(10000) + '";'}</script>
</body>
</html>`;
  const set = async value => {
    await code.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await code.evaluate(el => el.setSelectionRange(0, 0));
  };
  const fold = async () => {
    await page.locator('#edit-fold-structure').click();
    await page.waitForFunction(() => !document.querySelector('#edit-fold-structure').disabled);
    await settled();
  };
  await set(source);
  for (const dark of [false, true]) {
    if ((await page.locator('#theme-toggle').getAttribute('aria-pressed') === 'true') !== dark) await page.locator('#theme-toggle').click();
    await content.press('Control+End');
    await fold();
    assert(await scroller.evaluate(el => el.scrollTop < 1), 'The structural overview starts at the document beginning even from the last line');
    const placeholders = page.locator('#alternative-editor .cm-foldPlaceholder');
    const { text, labels } = await overview();
    assert.equal(labels.size, 5, 'One style, two outer sections and two scripts; no nested automatic folds');
    for (const label of ['<head>', '<body>', 'Видимый заголовок', 'id="world"', 'id="controls"', './library.js', '</html>']) assert(text.includes(label), 'Visible structure: ' + label);
    assert(!text.includes('ВНУТРЕННИЙ')); assert(!text.includes('УПРАВЛЕНИЕ')); assert(!text.includes('function update'));
    assert([...labels].some(label => label.includes('символов')), 'Minified single-line scripts have a useful count');
    assert.equal(await code.inputValue(), source);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${prefix}-structure-${dark ? 'dark' : 'light'}.png` });
    await content.locator('.cm-line').filter({ hasText: 'id="world"' }).locator('.cm-foldPlaceholder').click();
    await settled(); const opened = await overview();
    assert(opened.text.includes('ВНУТРЕННИЙ'), 'Clicking a placeholder reveals the entire section');
    assert.equal(opened.labels.size, 4);
    await fold(); assert.equal((await overview()).labels.size, 5, 'Repeated collapse restores the structural overview');
    await page.locator('#edit-unfold-all').click(); await settled(); assert.equal(await placeholders.count(), 0);
  }
  // Selecting and editing a previously hidden fragment updates the shared source.
  await fold();
  const at = source.indexOf('ВНУТРЕННИЙ');
  await code.evaluate((el, at) => { el.setSelectionRange(at, at + 'ВНУТРЕННИЙ'.length); el.focus(); }, at);
  await page.keyboard.insertText('НОВЫЙ');
  assert.equal(await code.inputValue(), source.replace('ВНУТРЕННИЙ', 'НОВЫЙ'));
  await page.locator('#edit-quick-undo').click(); assert.equal(await code.inputValue(), source);
  // Never fold through a missing closing tag or treat raw script/comment text as HTML.
  const broken = '<!-- <section>\n' + rows('КОММЕНТАРИЙ') + '\n</section> -->\n<section>\n' + rows('НЕЗАКРЫТЫЙ');
  await set(broken); await fold();
  assert.equal(await page.locator('#alternative-editor .cm-foldPlaceholder').count(), 0);
  assert.equal(await code.inputValue(), broken);
  await set(source); await fold();
  await page.locator('#editor-toggle').click(); assert(await page.locator('#edit-fold-structure').isHidden());
  assert.equal(await code.inputValue(), source);
  await page.locator('#editor-toggle').click(); await page.locator('#edit-unfold-all').click();
  // Per-block folding remains available in the gutter.
  await page.locator('#alternative-editor .cm-foldGutter').getByText('−', { exact: true }).first().click();
  assert(await page.locator('#alternative-editor .cm-foldPlaceholder').count() > 0);
  assert.equal(await code.inputValue(), source);
  await page.locator('#edit-unfold-all').click();
  if (await page.locator('#theme-toggle').getAttribute('aria-pressed') === 'true') await page.locator('#theme-toggle').click();
  await set(original);
}
