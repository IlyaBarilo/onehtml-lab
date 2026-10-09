import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const releaseMatch = args.length === 1 ? /^--release-tag=(v\d+(?:\.\d+){0,3})$/.exec(args[0]) : null;
if (args.length && !releaseMatch) throw new Error('Use: node build.mjs [--release-tag=v1.2.3]');
const releaseTag = releaseMatch?.[1];
let template = await readFile(join(root, 'src/template.html'), 'utf8');
template = template.replace(/^([ \t]*)<!-- APP_VERSION -->\r?\n/m, (_, indent) =>
  releaseTag ? `${indent}<span class="app-version" aria-label="Версия ${releaseTag}">${releaseTag}</span>\n` : '');
const appIcon = await readFile(join(root, 'src/icons/app.svg'), 'utf8');
template = template.replace('<!-- APP_FAVICON -->', `data:image/svg+xml,${encodeURIComponent(appIcon)}`);
for (const name of ['app', 'paste', 'clear', 'save', 'share', 'play', 'stop', 'expert', 'network-on', 'network-off', 'storage-on', 'storage-off', 'import', 'compare', 'history', 'library-out', 'expand', 'edit', 'split', 'diagnostics']) {
  const icon = await readFile(join(root, 'src/icons', name + '.svg'), 'utf8');
  template = template.replace(`<!-- ICON:${name} -->`, () => icon.trim());
}
const css = await readFile(join(root, 'src/styles.css'), 'utf8');
const files = ['format.js', 'vendor/codemirror.bundle.js', 'game-storage.js', 'library-bundle.js', 'library-modules.js', 'media-assets.js', 'media-prompts.js', 'quality.js', 'sandbox.js', 'exporter.js', 'library-extract.js', 'draft.js', 'compare.js', 'comparison-game.js', 'workspace.js', 'syntax.js', 'editor.js', 'alternative-editor.js', 'desktop.js', 'readiness.js', 'diagnostics.js', 'ai-profiles.js', 'ai-prompts.js', 'ai-session.js', 'example-lessons.js', 'code-guide.js', 'app.js'];
const exampleFiles = [
  { id: 'catch-circle', platform: 'mobile', title: 'Поймай круг', description: 'Касайтесь цели на всём экране.' },
  { id: 'memory', platform: 'mobile', title: 'Найди пару', description: 'Открывайте пары касанием карточек.' },
  { id: 'reaction', platform: 'mobile', title: 'Проверь реакцию', description: 'Коснитесь экрана после смены цвета.' },
  { id: 'interactive-poster', category: 'media', platform: 'mobile', title: 'Интерактивная афиша', description: 'Анимация, программа мероприятия и смена темы.' },
  { id: 'branching-story', category: 'media', platform: 'mobile', title: 'История с выбором', description: 'Развилки, разные окончания и возврат к выбору.' },
  { id: 'interactive-infographic', category: 'media', platform: 'mobile', title: 'Интерактивная инфографика', description: 'Данные, диаграмма и пояснения по нажатию.' },
  { id: 'sound-panel', category: 'media', platform: 'all', title: 'Звуковая панель', description: 'Четыре синтезируемых звука, формы и цвета. Работает без внешних ресурсов.' },
  { id: '3d-showcase', category: 'media', platform: 'all', title: '3D-витрина', description: 'Лампа, материалы, свет и тени. Three.js r160 можно встроить при сохранении.' },
  { id: 'snake', platform: 'desktop', title: 'Змейка', description: 'Управляйте стрелками или WASD.' },
  { id: 'falling-stars', platform: 'desktop', title: 'Лови звёзды', description: 'Двигайте платформу мышью.' },
  { id: 'space-reaction', platform: 'desktop', title: 'Реакция на пробел', description: 'Нажмите пробел после сигнала.' },
  { id: 'performance-libraries', category: 'tests', platform: 'all', title: 'Тест работы библиотек', description: 'Возможности движков, общая сцена сравнения и нагрузка до 10 000 объектов. Пояснения, FPS, касания, размеры и подключение библиотек.' },
  { id: 'snake3d-turns', category: 'fix', platform: 'mobile', title: 'Змейка 3D: повороты', description: 'Первый ответ ИИ: повороты влево и вправо перепутаны.' },
  { id: 'snake3d-rewrite', category: 'fix', platform: 'mobile', title: 'Змейка 3D: после правки', description: 'Следующий ответ ИИ: игра переписана, камера смотрит сквозь голову.' }
];
const examples = await Promise.all(exampleFiles.map(async entry => ({
  ...entry,
  code: await readFile(join(root, 'src/examples', entry.id + '.html'), 'utf8')
})));
const script = '(function () {\n"use strict";\n'
  + `const examples = ${JSON.stringify(examples)};\n`
  + (await Promise.all(files.map(name => readFile(join(root, 'src', name), 'utf8')))).join('\n') + '\n})();';
const license = (await readFile(join(root, 'LICENSE'), 'utf8')).trim();
const html = template.replace('/* APP_STYLES */', () => css.replace(/<\/style/gi, '<\\/style'))
  .replace('/* APP_SCRIPT */', () => script.replace(/<\/script/gi, '<\\/script'))
  .replace('<!doctype html>', `<!doctype html>\n<!--\n${license}\n-->`)
  .replace(/\r?\n/g, '\r\n');
await writeFile(join(root, 'onehtml-lab.html'), html, 'utf8');
console.log(`Built onehtml-lab.html (${Buffer.byteLength(html)} bytes)${releaseTag ? ` for ${releaseTag}` : ''}; no runtime dependencies.`);
