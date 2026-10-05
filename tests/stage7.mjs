import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const url = new URL('../onehtml-lab.html', import.meta.url).href;
const example = await readFile(new URL('../src/examples/catch-circle.html', import.meta.url), 'utf8');
const brokenSnakes = await Promise.all(['snake3d-turns', 'snake3d-rewrite'].map(name =>
  readFile(new URL(`../src/examples/${name}.html`, import.meta.url), 'utf8')));
const engines = process.argv.includes('--engines=chromium') ? [['chromium', chromium]] : [['chromium', chromium], ['webkit', webkit]];

for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    const page = await context.newPage();
    await page.goto(url);
    const code = page.locator('#code');
    assert(await page.locator('#ai-open').isHidden());
    assert(await page.locator('#examples-open').isHidden());
    await page.locator('#expert-toggle').click();
    await page.locator('#ai-open').click();
    assert.equal(await page.locator('.service-list li').count(), 4);
    assert.equal(await page.locator('.service-list li').nth(1).locator('a').count(), 1);
    await page.locator('#prompt-create').click();
    assert(await page.locator('#copy-dialog').isVisible());
    assert.match(await page.locator('#copy-text').inputValue(), /Сделай игру про \[тема игры\] для телефона\. Сделай одним файлом HTML/);
    assert.doesNotMatch(await page.locator('#copy-text').inputValue(), /без сервера/);
    assert.doesNotMatch(await page.locator('#copy-text').inputValue(), /вырез экрана/);
    await page.locator('#copy-close').click();
    await page.locator('#ai-dialog .platform-tab[data-platform="desktop"]').click();
    await page.locator('#prompt-create').click();
    assert.match(await page.locator('#copy-text').inputValue(), /Сделай игру про \[тема игры\] для компьютера\. Сделай одним файлом HTML/);
    await page.locator('#copy-close').click();
    await page.locator('#ai-close').click();
    await page.locator('#examples-open').click();
    assert.equal(await page.locator('#examples-dialog .platform-tab[data-platform="desktop"]').getAttribute('aria-selected'), 'true');
    await page.locator('#examples-dialog .platform-tab[data-platform="mobile"]').click();
    assert.equal(await page.locator('.example-card').count(), 3);
    await page.locator('.example-card').first().getByRole('button', { name: 'Открыть копию' }).click();
    assert.equal((await code.inputValue()).replace(/\r\n/g, '\n'), example.replace(/\r\n/g, '\n'));
    await page.locator('#run').click();
    const frame = page.frameLocator('#preview > iframe');
    const fullScreen = async selector => {
      const bounds = await frame.locator(selector).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
      assert(Math.abs(bounds.width - bounds.viewportWidth) < 1);
      assert(Math.abs(bounds.height - bounds.viewportHeight) < 1);
    };
    await fullScreen('main');
    await frame.locator('#start').click();
    await frame.locator('#target').click();
    assert.equal(await frame.locator('#score').innerText(), '1');
    await page.locator('#run').click();
    await page.locator('#examples-open').click();
    await page.locator('.example-card').nth(1).getByRole('button', { name: 'Открыть копию' }).click();
    await page.locator('#replace-dialog').waitFor({ state: 'visible' });
    await page.locator('#replace-dialog button[value="cancel"]').click();
    assert.equal((await code.inputValue()).replace(/\r\n/g, '\n'), example.replace(/\r\n/g, '\n'));

    for (const [index, expectedTitle] of [[1, 'Найди пару'], [2, 'Проверь реакцию']]) {
      await page.locator('#examples-open').click();
      await page.locator('.example-card').nth(index).getByRole('button', { name: 'Открыть копию' }).click();
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(title => document.querySelector('#code').value.includes(`<title>${title}</title>`), expectedTitle);
      assert((await code.inputValue()).includes(`<title>${expectedTitle}</title>`));
      await page.locator('#run').click();
      await fullScreen('main');
      if (index === 1) {
        assert.equal(await page.frameLocator('#preview > iframe').locator('.card').count(), 12);
        await page.frameLocator('#preview > iframe').locator('.card').first().click();
        assert(await page.frameLocator('#preview > iframe').locator('.card.open').count() === 1);
      } else {
        await page.frameLocator('#preview > iframe').locator('#pad').click();
        await page.frameLocator('#preview > iframe').locator('#pad').click();
        assert.match(await page.frameLocator('#preview > iframe').locator('#pad').innerText(), /Рано/);
      }
      await page.locator('#run').click();
    }

    await page.setViewportSize({ width: 1365, height: 900 });
    await page.locator('#examples-open').click();
    await page.locator('#examples-dialog .platform-tab[data-platform="desktop"]').click();
    assert.equal(await page.locator('.example-card').count(), 3);
    for (const [index, expectedTitle] of [[0, 'Змейка'], [1, 'Лови звёзды'], [2, 'Реакция на пробел']]) {
      if (index > 0) await page.locator('#examples-open').click();
      await page.locator('.example-card').nth(index).getByRole('button', { name: 'Открыть копию' }).click();
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(title => document.querySelector('#code').value.includes(`<title>${title}</title>`), expectedTitle);
      await page.locator('#run').click();
      await fullScreen(index === 2 ? '#pad' : 'canvas');
      if (index < 2) {
        await frame.locator('#start').click();
        assert(await frame.locator('#overlay').isHidden());
      } else {
        await frame.locator('#pad').click();
        await frame.locator('#pad').click();
        assert.match(await frame.locator('#message').innerText(), /Рано/);
      }
      await page.locator('#run').click();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [index, expectedCode] of brokenSnakes.entries()) {
      await page.locator('#examples-open').click();
      await page.locator('.example-category[data-example-category="fix"]').click();
      assert(await page.locator('#example-platform-tabs').isHidden());
      assert.equal(await page.locator('.example-card').count(), 2);
      await page.locator('.example-card').nth(index).getByRole('button', { name: 'Открыть копию' }).click();
      await page.locator('#replace-dialog button[value="replace"]').click();
      await page.waitForFunction(expected => document.querySelector('#code').value.replace(/\r\n/g, '\n') === expected.replace(/\r\n/g, '\n'), expectedCode);
      assert.equal((await code.inputValue()).replace(/\r\n/g, '\n'), expectedCode.replace(/\r\n/g, '\n'));
      if (index === 0) {
        await page.locator('#network-toggle').click();
        await page.locator('#run').click();
        await page.locator('#library-skip').click();
        await page.waitForFunction(() => ['#local-access-status', '#runtime-error-message'].some(selector => document.querySelector(selector).textContent.includes('виртуальный localStorage')));
        assert.doesNotMatch(await page.locator('#runtime-error-message').innerText(), /SecurityError|Failed to read the 'localStorage'/);
        await page.locator('#run').click();
        await page.locator('#network-toggle').click();
      }
    }

    await code.fill('<script>try { localStorage.getItem("game") } catch {}</script>');
    await page.locator('#run').click();
    await page.locator('#local-access-status').waitFor({ state: 'visible' });
    assert.match(await page.locator('#local-access-status').innerText(), /виртуальный localStorage/);
    assert(await page.locator('#runtime-error').isHidden());
    await page.locator('#run').click();
    await code.fill('<script>sessionStorage.getItem("game")</script>');
    await page.locator('#run').click();
    await page.locator('#runtime-error').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#runtime-error-message').textContent.includes('sessionStorage'));
    assert(await page.locator('#local-access-status').isHidden());
    await page.locator('#copy-error').click();
    assert.match(await page.locator('#copy-text').inputValue(), /sessionStorage/);
    await page.locator('#copy-close').click();
    await page.locator('#run').click();

    await code.fill('<script>throw new Error("Проверка диагностики")</script>');
    await page.locator('#run').click();
    await page.locator('#runtime-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#runtime-error-message').innerText(), /Проверка диагностики|браузер не сообщил подробности/);
    await page.locator('#copy-error').click();
    assert(await page.locator('#copy-dialog').isVisible());
    assert.match(await page.locator('#copy-text').inputValue(), /Проверка диагностики|браузер не сообщил подробности/);
    await page.locator('#copy-close').click();
    await page.locator('#run').click();
    await code.fill('<p>Работает</p>');
    assert(await page.locator('#runtime-error').isHidden());
    assert(await page.locator('#local-access-status').isHidden());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL('../src/examples/catch-circle.html', import.meta.url).href);
    const mobileStandalone = await page.locator('main').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, screenWidth: innerWidth, screenHeight: innerHeight }));
    assert(Math.abs(mobileStandalone.width - mobileStandalone.screenWidth) < 1);
    assert(Math.abs(mobileStandalone.height - mobileStandalone.screenHeight) < 1);
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(new URL('../src/examples/snake.html', import.meta.url).href);
    const desktopStandalone = await page.locator('canvas').evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, screenWidth: innerWidth, screenHeight: innerHeight }));
    assert(Math.abs(desktopStandalone.width - desktopStandalone.screenWidth) < 1);
    assert(Math.abs(desktopStandalone.height - desktopStandalone.screenHeight) < 1);
    await context.close();
    console.log(`${name} file: six full-screen games, two original repair examples, local-storage hints, errors and copy fallback passed.`);
  } finally {
    await browser.close();
  }
}
