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
for (const name of ['app', 'paste', 'clear', 'save', 'share', 'play', 'stop']) {
  const icon = await readFile(join(root, 'src/icons', name + '.svg'), 'utf8');
  template = template.replace(`<!-- ICON:${name} -->`, () => icon.trim());
}
const css = await readFile(join(root, 'src/styles.css'), 'utf8');
const files = ['sandbox.js', 'exporter.js', 'app.js'];
const script = '(function () {\n"use strict";\n' + (await Promise.all(files.map(name => readFile(join(root, 'src', name), 'utf8')))).join('\n') + '\n})();';
const license = (await readFile(join(root, 'LICENSE'), 'utf8')).trim();
const html = template.replace('/* APP_STYLES */', () => css.replace(/<\/style/gi, '<\\/style'))
  .replace('/* APP_SCRIPT */', () => script.replace(/<\/script/gi, '<\\/script'))
  .replace('<!doctype html>', `<!doctype html>\n<!--\n${license}\n-->`)
  .replace(/\r?\n/g, '\r\n');
await writeFile(join(root, 'onehtml-lab.html'), html, 'utf8');
console.log(`Built onehtml-lab.html (${Buffer.byteLength(html)} bytes)${releaseTag ? ` for ${releaseTag}` : ''}; no runtime dependencies.`);
