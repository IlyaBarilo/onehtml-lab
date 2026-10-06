import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({absWorkingDir:root,entryPoints:['src/codemirror-entry.js'],bundle:true,minify:true,format:'iife',globalName:'OneHTMLCodeMirror',target:'es2020',write:false,metafile:true,legalComments:'none'});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.startsWith('node_modules/'))continue;
  const parts=input.slice(13).split('/'),name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
  if(packages.has(name))continue;
  const folder=join(root,'node_modules',name),meta=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
  const license=await readFile(join(folder,'LICENSE'),'utf8');
  if(meta.license!=='MIT')throw Error(`Review license before bundling ${name}: ${meta.license}`);
  packages.set(name,{version:meta.version,license});
}
const notices=[...packages].sort(([a],[b])=>a.localeCompare(b)).map(([name,meta])=>`${name} ${meta.version}\n${meta.license.trim()}`).join('\n\n----------------------------------------\n\n');
await mkdir(join(root,'src/vendor'),{recursive:true});
const normalize=text=>text.replace(/\r?\n/g,'\r\n');
await writeFile(join(root,'src/vendor/codemirror-LICENSE.txt'),normalize(notices+'\n'));
await writeFile(join(root,'src/vendor/codemirror.bundle.js'),normalize('/*\n'+notices.replace(/\*\//g,'* /')+'\n*/\n'+result.outputFiles[0].text));
const rows=[...packages].sort(([a],[b])=>a.localeCompare(b)).map(([name,meta])=>`| ${name} | ${meta.version} | MIT |`).join('\n');
await writeFile(join(root,'docs/THIRD_PARTY.md'),normalize('# Third-party licenses / Лицензии сторонних компонентов\n\nOneHTML Lab includes CodeMirror 6 and its runtime dependencies in the standalone HTML. Full copyright and permission notices are preserved in the bundled code and in [codemirror-LICENSE.txt](../src/vendor/codemirror-LICENSE.txt).\n\nOneHTML Lab включает CodeMirror 6 и его зависимости в самостоятельный HTML. Полные уведомления об авторских правах и условиях использования сохранены во встроенном коде и в файле лицензий выше.\n\n| Component / Компонент | Version / Версия | License / Лицензия |\n|---|---|---|\n'+rows+'\n\nProject / Проект: [CodeMirror](https://codemirror.net/). Build dependencies, including esbuild and Playwright, are not included in the application. / Зависимости сборки, включая esbuild и Playwright, не входят в приложение.\n'));
console.log(`Bundled CodeMirror with ${packages.size} MIT license notices (${result.outputFiles[0].contents.length} bytes before notices).`);
