import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = join(root, 'assets');
await mkdir(assets, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(root, 'onehtml-lab.html')).href);
  await page.locator('#code').fill(`<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<title>Моя игра</title>
<style>
  body { font: 20px system-ui; text-align: center; }
  button { padding: 1rem; border-radius: 12px; }
</style>
<h1>Поймай очки</h1>
<button id="score">Счёт: 0</button>
<script>
  let score = 0;
  document.querySelector('#score').onclick = e => {
    e.target.textContent = 'Счёт: ' + ++score;
  };
</script>
</html>`);
  const screenshot = await page.screenshot({ path: join(assets, 'editor-mobile.png') });
  const social = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  const image = screenshot.toString('base64');
  const mark = await readFile(join(root, 'src/icons/app.svg'), 'utf8');
  await social.setContent(`<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1280px;height:640px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#203855;background:linear-gradient(125deg,#eaf2ff 0%,#f7fbff 54%,#dbeaff 100%)}
    .wrap{display:flex;height:100%;align-items:center;padding:64px 82px;gap:74px}.copy{flex:1}.mark{width:58px;height:58px;margin-bottom:30px}.mark svg{width:58px;height:58px}.name{font-size:52px;font-weight:700;letter-spacing:-2px;margin:0 0 22px}.name span{font-weight:400;color:#6c85a3}.tagline{font-size:29px;line-height:1.26;font-weight:520;max-width:580px;margin:0 0 28px}.detail{font-size:21px;color:#59728f}.phone{flex:0 0 310px;height:520px;overflow:hidden;border:9px solid #25466e;border-radius:29px;box-shadow:0 24px 55px #1c4d8636;background:white}.phone img{display:block;width:100%;height:auto}
  </style><div class="wrap"><div class="copy"><div class="mark">${mark}</div><h1 class="name">OneHTML <span>Lab</span></h1><p class="tagline">Вставьте HTML-игру.<br>Проверьте и сохраните её.</p><div class="detail">Один файл · без установки</div></div><div class="phone"><img src="data:image/png;base64,${image}" alt="Снимок редактора"></div></div>`);
  await social.screenshot({ path: join(assets, 'social-preview.png') });
} finally {
  await browser.close();
}
