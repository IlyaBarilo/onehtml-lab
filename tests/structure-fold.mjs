import assert from 'node:assert/strict';

export async function checkStructureFolding(page, prefix) {
  const code = page.locator('#code'), content = page.locator('#alternative-editor .cm-content');
  const scroller = page.locator('#alternative-editor .cm-scroller'), toggle = page.locator('#edit-fold-structure');
  const placeholders = content.locator('.cm-foldPlaceholder');
  const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const finished = async () => { await settled(); await page.waitForFunction(() => !document.querySelector('#edit-fold-structure').hasAttribute('aria-busy')); await settled(); };
  const mode = async on => { if ((await toggle.getAttribute('aria-pressed') === 'true') !== on) await toggle.click(); await finished(); };
  const fold = async () => { await mode(false); await mode(true); };
  const expand = async () => { await page.locator('#edit-unfold-all').click(); await settled(); };
  const set = async value => {
    await code.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.setSelectionRange(0, 0); }, value);
    await settled();
  };
  const scan = async visit => {
    const height = await scroller.evaluate(el => el.clientHeight);
    for (let top = 0; ; top += height) {
      await scroller.evaluate((el, top) => { el.scrollTop = top; }, top); await settled();
      if (await visit()) return;
      if (await scroller.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)) break;
    }
    await scroller.evaluate(el => { el.scrollTop = 0; }); await settled();
  };
  const overview = async () => {
    const labels = new Set(); let text = '';
    await scan(async () => {
      text += '\n' + await content.innerText();
      for (const label of await placeholders.allTextContents()) labels.add(label);
    });
    return { text, labels };
  };
  const open = async (label, index = 0) => {
    let found = false;
    await scan(async () => {
      const line = content.locator('.cm-line').filter({ hasText: label }).first();
      if (!await line.count() || !await line.locator('.cm-foldPlaceholder').nth(index).count()) return false;
      await line.locator('.cm-foldPlaceholder').nth(index).click(); await settled(); found = true; return true;
    });
    assert(found, 'Folded block can be opened: ' + label);
  };
  const original = await code.inputValue();
  const rows = name => Array.from({ length: 12 }, (_, n) => '<p>' + name + ' ' + n + '</p>').join('\n');
  const source = [
    '<!doctype html>', '<html>', '<head>', '<title>Структура</title>', '<style>', 'body {',
    '  color: #123456;', '  background: #abcdef;', '}', '</style>', '</head>', '<body>',
    '<h1>Видимый заголовок</h1>', '<main id="world">', '<section id="nested">', rows('ВНУТРЕННИЙ'),
    '</section>', '</main>', '<section id="controls">', rows('УПРАВЛЕНИЕ'), '</section>',
    '<script src="./library.js"></script>', '<script id="logic">',
    'function outer() {', '  function inner() { return "ТЕЛО ВЛОЖЕННОЙ"; }', '  return inner();', '}',
    'const arrow = value => value * 2;', 'const blockArrow = () => { return "ТЕЛО СТРЕЛКИ"; };',
    'const expression = function() { return "ТЕЛО ВЫРАЖЕНИЯ"; };',
    'class Player {', '  update() { return "ТЕЛО МЕТОДА"; }', '}',
    'const points = [', '  [1, 2],', '  [3, 4]', '];',
    'const options = {', '  speed: 5,', '  start() { return "ТЕЛО ОБЪЕКТА"; }', '};',
    'if (points.length) {', '  const active = true;', '  console.log(active);', '}',
    'const markup = "<section>Не HTML-узел</section>";', '</script>',
    '<script>const bundled = "' + 'x'.repeat(10000) + '";</script>', '</body>', '</html>'
  ].join('\n');
  await mode(false); await set(source);
  for (const dark of [false, true]) {
    if ((await page.locator('#theme-toggle').getAttribute('aria-pressed') === 'true') !== dark) await page.locator('#theme-toggle').click();
    await content.press('Control+End'); await fold();
    assert(await scroller.evaluate(el => el.scrollTop < 1), 'Overview starts at the beginning even from the last line');
    const { text, labels } = await overview();
    for (const label of ['<head>', '<body>', 'Видимый заголовок', 'id="world"', 'id="controls"', './library.js', '</html>']) assert(text.includes(label), 'Visible structure: ' + label);
    for (const hidden of ['ВНУТРЕННИЙ', 'УПРАВЛЕНИЕ', 'function outer', 'background:']) assert(!text.includes(hidden), 'Hidden block: ' + hidden);
    assert([...labels].some(label => label.includes('символов')), 'Minified single-line scripts have a useful count');
    assert.equal(await code.inputValue(), source);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: prefix + '-structure-' + (dark ? 'dark' : 'light') + '.png' });
    await open('id="world"');
    let opened = await overview();
    assert(opened.text.includes('id="nested"')); assert(!opened.text.includes('ВНУТРЕННИЙ'), 'Nested HTML remains folded');
    await open('id="nested"'); assert((await overview()).text.includes('ВНУТРЕННИЙ'));
    await open('id="logic"'); opened = await overview();
    for (const header of ['function outer', 'const arrow', 'const blockArrow', 'class Player', 'const points', 'const options', 'if (points.length)']) assert(opened.text.includes(header), header);
    for (const hidden of ['function inner', 'value * 2', 'ТЕЛО СТРЕЛКИ', 'ТЕЛО ВЫРАЖЕНИЯ', 'ТЕЛО МЕТОДА', '[1, 2]', 'speed: 5', 'const active']) assert(!opened.text.includes(hidden), 'Nested code remains folded: ' + hidden);
    await open('function outer'); opened = await overview();
    assert(opened.text.includes('function inner')); assert(!opened.text.includes('ТЕЛО ВЛОЖЕННОЙ'));
    await open('function inner'); assert((await overview()).text.includes('ТЕЛО ВЛОЖЕННОЙ'));
    await open('class Player'); assert(!(await overview()).text.includes('ТЕЛО МЕТОДА'));
    await open('update()'); assert((await overview()).text.includes('ТЕЛО МЕТОДА'));
    await open('const points'); assert((await overview()).text.includes('[1, 2]'), 'Small coordinate arrays stay open');
    await open('const options'); assert(!(await overview()).text.includes('ТЕЛО ОБЪЕКТА'));
    await open('start()'); assert((await overview()).text.includes('ТЕЛО ОБЪЕКТА'));
    await open('<style>'); assert(!(await overview()).text.includes('background:'));
    await open('body {'); assert((await overview()).text.includes('background:'));
    await expand(); assert.equal((await overview()).labels.size, 0, 'Expand all reveals every nested level');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true', 'Expand all keeps the mode for the next paste');
  }
  // Revealing and editing hidden text opens every ancestor without refolding while typing.
  await fold();
  const at = source.indexOf('ТЕЛО ВЛОЖЕННОЙ');
  await code.evaluate((el, at) => { el.setSelectionRange(at, at + 'ТЕЛО ВЛОЖЕННОЙ'.length); el.focus(); }, at);
  assert(await content.innerText().then(text => text.includes('ТЕЛО ВЛОЖЕННОЙ')));
  await page.keyboard.insertText('НОВЫЙ'); await finished();
  assert.equal(await code.inputValue(), source.replace('ТЕЛО ВЛОЖЕННОЙ', 'НОВЫЙ'));
  assert(await content.innerText().then(text => text.includes('НОВЫЙ')), 'Typing stays visible');
  await page.locator('#edit-quick-undo').click(); assert.equal(await code.inputValue(), source);
  // Two folds on one line: the second placeholder must open only the second function.
  const siblings = '<script>\nfunction first() { return "ПЕРВОЕ"; } function second() { return "ВТОРОЕ"; }\n</script>';
  await set(siblings); await fold(); await open('<script>'); await open('function first', 1);
  assert(!(await content.innerText()).includes('ПЕРВОЕ')); assert((await content.innerText()).includes('ВТОРОЕ'));
  const json = '<script type="importmap">\n{\n  "imports": {\n    "one": "./one.js",\n    "two": "./two.js"\n  }\n}\n</script>';
  await set(json); await fold(); await open('<script');
  assert(!(await content.innerText()).includes('imports'));
  await open('{'); assert(!(await content.innerText()).includes('./one.js'));
  await open('imports'); assert((await content.innerText()).includes('./one.js'));
  // Gutter folding works with the mode on and off, including expression arrows.
  const arrow = '<script>\nconst double = value => value * 2;\n</script>';
  await mode(false); await set(arrow);
  for (const on of [false, true]) {
    await mode(on); await expand();
    await page.locator('#alternative-editor .cm-foldGutter').getByText('−', { exact: true }).last().click();
    assert(!(await content.innerText()).includes('value * 2'));
    await placeholders.first().click(); assert((await content.innerText()).includes('value * 2'));
    await finished(); assert.equal(await placeholders.count(), 0, 'Manual opening is not immediately undone');
  }
  // Paste through both routes, import and restore refresh the structure.
  await page.evaluate(value => { window.__editorClipboard = value; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => window.__editorClipboard } }); }, source);
  await page.locator('#paste').click(); await page.locator('#replace-dialog button[value="replace"]').click(); await finished();
  assert.equal(await code.inputValue(), source); assert(!(await overview()).text.includes('function outer'));
  await expand(); await content.press('Control+a');
  await content.evaluate((el, value) => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, siblings);
  await finished(); assert.equal(await code.inputValue(), siblings); assert(!(await content.innerText()).includes('function first'));
  await page.locator('#import-file').setInputFiles({ name: 'structure.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  await page.locator('#replace-dialog button[value="replace"]').click(); await finished();
  assert.equal(await code.inputValue(), source); assert(!(await overview()).text.includes('function outer'));
  await page.locator('#history-open').click();
  await page.locator('.history-entry').first().getByRole('button', { name: /Вернуть/ }).click();
  await page.locator('#replace-dialog button[value="replace"]').click();
  await finished(); assert.equal(await code.inputValue(), siblings); assert(!(await content.innerText()).includes('function first'));
  // The setting and restored draft survive reload. The ordinary editor is unchanged.
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled); await finished();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true'); assert.equal(await code.inputValue(), siblings);
  assert(!(await content.innerText()).includes('function first'));
  await page.locator('#editor-toggle').click(); assert(await toggle.isHidden()); assert.equal(await code.inputValue(), siblings);
  await code.fill(source); await finished(); assert.equal(await code.inputValue(), source);
  await page.locator('#editor-toggle').click(); await finished(); assert(!(await overview()).text.includes('function outer'));
  await mode(false); assert.equal((await overview()).labels.size, 0);
  await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Сохранено');
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#code').disabled); await finished();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false'); assert.equal(await placeholders.count(), 0);
  await toggle.evaluate(el => { el.click(); el.click(); }); await finished();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false'); assert.equal(await placeholders.count(), 0, 'Turning the mode off cancels queued folding');
  const broken = '<!-- <section>\n' + rows('КОММЕНТАРИЙ') + '\n</section> -->\n<section>\n' + rows('НЕЗАКРЫТЫЙ');
  await set(broken); await fold(); assert.equal(await placeholders.count(), 0); assert.equal(await code.inputValue(), broken);
  await mode(false);
  if (await page.locator('#theme-toggle').getAttribute('aria-pressed') === 'true') await page.locator('#theme-toggle').click();
  await set(original);
}
