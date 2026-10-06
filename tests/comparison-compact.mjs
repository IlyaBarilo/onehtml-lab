import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const context = {};
runInNewContext(await readFile(new URL('../src/compare.js', import.meta.url), 'utf8'), context);
const lines = Array.from({ length: 55 }, (_, i) => `<!-- Строка ${String(i).padStart(2, '0')} -->`);
lines[0] = '<!-- <img src=x onerror=alert(1)> -->';
lines[13] = '<p>Старая игра</p>';
lines[37] = '<h1>Приз ⭐</h1>';
const before = lines.join('\n');
const after = before.replace('Старая', 'Новая').replace('⭐', '🏆');
const parts = context.codeDiff(before, after);
const full = parts.map(part => part.text).join('');
const counts = type => Array.from(parts.filter(part => part.type === type).map(part => part.text).join('')).length;

// Called by the existing editor suite on phone/desktop and file/HTTP profiles.
export async function checkCompactComparison(page, screenshotPrefix) {
  const code = page.locator('#code');
  for (const editor of ['codemirror', 'native']) {
    if (await page.locator('#editor-current').innerText() !== (editor === 'codemirror' ? 'CM' : 'Aa')) await page.locator('#editor-toggle').click();
    await code.evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, before);
    await page.evaluate(value => { window.__editorClipboard = value; }, after);
    await page.locator('#paste').click();
    await page.locator('#replace-dialog button[value="replace"]').click();
    await page.waitForFunction(value => document.querySelector('#code').value === value, after);
    await page.locator('#history-open').click();
    const historyCount = await page.locator('.history-entry').count();
    await page.locator('#history-close').click();
    const editorContent = page.locator(editor === 'codemirror' ? '#alternative-editor .cm-content' : '#code');
    await editorContent.press('Control+End');
    const cursor = await code.evaluate(el => el.selectionStart);
    for (const dark of [false, true]) {
      if ((await page.locator('#theme-toggle').getAttribute('aria-pressed') === 'true') !== dark) await page.locator('#theme-toggle').click();
      await page.locator('#compare').click();
      const region = page.locator(editor === 'codemirror' ? '#comparison-editor' : '#diff-content');
      const gaps = region.locator('.comparison-gap');
      await gaps.first().waitFor();
      assert.equal(await page.locator('#comparison-compact').getAttribute('aria-pressed'), 'true', 'Every new comparison starts compact');
      assert.deepEqual(await gaps.evaluateAll(elements => elements.map(el => Number(el.dataset.lines))), [10, 17, 14]);
      assert(!(await region.innerText()).includes('Строка 00'));
      assert(!(await region.innerText()).includes('Строка 54'));
      assert((await region.innerText()).includes('Строка 10'));
      assert((await region.innerText()).includes('Строка 40'));
      assert.equal(parseInt(await page.locator('#comparison-added').innerText(), 10), counts('added'));
      assert.equal(parseInt(await page.locator('#comparison-removed').innerText(), 10), counts('removed'));
      const total = () => page.locator('#comparison-total').innerText().then(text => Number(text.replace(/\D/g, '')));
      assert.equal(await total(), Array.from(after).length, 'Total counts the current code including spaces, newlines and Unicode symbols');
      assert.equal(await page.locator('.comparison-legend > span').first().getAttribute('class'), 'legend-total', 'Total precedes the added and removed counts');
      const buttonBounds = await gaps.first().boundingBox();
      assert(buttonBounds && buttonBounds.height >= 44 && buttonBounds.width > 100, 'Hidden lines have a touch target');
      assert.equal(await gaps.first().evaluate(el => getComputedStyle(el).color), dark ? 'rgb(180, 199, 225)' : 'rgb(69, 99, 131)');
      assert.equal(await region.locator('img').count(), 0, 'Hidden source remains inert');
      await page.screenshot({ path: `${screenshotPrefix}-compact-${editor}-${dark ? 'dark' : 'light'}.png` });
      if (editor === 'codemirror') {
        const content = region.locator('.cm-content');
        await content.press('Control+a');
        const copied = await content.evaluate(el => {
          const transfer = new DataTransfer();
          el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer }));
          return transfer.getData('text/plain');
        });
        assert.equal(copied, full, 'CodeMirror copy retains all hidden lines');
      }
      await gaps.first().click();
      assert.deepEqual(await gaps.evaluateAll(elements => elements.map(el => Number(el.dataset.lines))), [17, 14], 'Opening one gap preserves the others');
      assert((await region.innerText()).includes('<img src=x onerror=alert(1)>'));
      const expandedLine = full.split('\n').findIndex(line => line.includes('Строка 10')) + 1;
      if (editor === 'codemirror') assert((await region.locator('.cm-lineNumbers').innerText()).split('\n').includes(String(expandedLine)), 'Line numbers refer to the full diff');
      await page.locator('#comparison-compact').click();
      assert.equal(await page.locator('#comparison-compact').getAttribute('aria-pressed'), 'false');
      assert.equal(await gaps.count(), 0);
      assert.equal(await total(), Array.from(after).length, 'Expanding the comparison leaves the total unchanged');
      if (editor === 'native') assert.equal(await region.textContent(), full, 'Full comparison restores exact text');
      assert.equal(await code.inputValue(), after);
      await page.locator('#comparison-compact').click();
      assert.deepEqual(await gaps.evaluateAll(elements => elements.map(el => Number(el.dataset.lines))), [10, 17, 14]);
      await page.locator('#comparison-game-tab').click();
      assert(await page.locator('#comparison-compact').isHidden());
      await page.locator('#comparison-code-tab').click();
      assert(await page.locator('#comparison-compact').isVisible());
      assert.equal(await gaps.count(), 3);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Compact comparison fits the phone');
      await page.locator('#comparison-close').click();
      assert.equal(await code.inputValue(), after);
      assert.equal(await code.evaluate(el => el.selectionStart), cursor, 'Comparison restores the source cursor');
      await page.locator('#history-open').click();
      assert.equal(await page.locator('.history-entry').count(), historyCount, 'Display changes do not create history entries');
      await page.locator('#history-close').click();
    }
  }
  await page.locator('#editor-toggle').click();
  await page.locator('#theme-toggle').click();
}
