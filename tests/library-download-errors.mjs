import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium, webkit} from 'playwright';
import {useNativeEditor} from './native-editor.mjs';
import {additionalFixtures} from './additional-library-fixtures.mjs';
import {p5SourceFixtures} from './p5-source-fixtures.mjs';

const root = new URL('../', import.meta.url);
const fixtures = await additionalFixtures();
const license = await readFile(new URL('node_modules/three/LICENSE', root), 'utf8');
const p5License = await readFile(new URL('src/vendor/p5-LICENSE.txt', root), 'utf8');
const p5Source = await p5SourceFixtures(), archive = p5Source.archive;
const bundle = await readFile(new URL('src/library-bundle.js', root), 'utf8');
const modules = await readFile(new URL('src/library-modules.js', root), 'utf8');
const codeMirror = await readFile(new URL('src/vendor/codemirror.bundle.js', root), 'utf8');
const selected = process.argv.find(arg => arg.startsWith('--engines='))?.slice(10);
const engines = [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected || selected === name);
assert(engines.length);
for (const [name, engine] of engines) {
  const browser = await engine.launch();
  try {
    // Exercise code, license, NOTICE, module dependency and cancellation errors separately.
    const probe = await browser.newPage();
    await probe.goto(new URL('onehtml-lab.html', root).href);
    const result = await probe.evaluate(async ({bundle, modules, license, codeMirror}) => {
      const run = new Function(codeMirror + '\n' + bundle + '\n' + modules + '\nreturn {downloadLibrary,downloadModule,libraryCache,libraryCatalogReference};');
      const api = run();
      const failures = [];
      for (const resource of ['code', 'license', 'notice']) {
        const ref = {key:'example@1',title:'Пробная библиотека 1',url:'https://example.org/game.js',licenseUrl:'https://example.org/LICENSE',noticeUrl:'https://example.org/NOTICE'};
        const original = window.fetch;
        window.fetch = async url => new Response(url.endsWith(resource === 'code' ? 'game.js' : resource === 'license' ? 'LICENSE' : 'NOTICE') ? 'unavailable' : url.endsWith('.js') ? 'window.test = true;' : license, {status:url.endsWith(resource === 'code' ? 'game.js' : resource === 'license' ? 'LICENSE' : 'NOTICE') ? 503 : 200});
        try { await api.downloadLibrary(ref); } catch (error) { failures.push({message:error.message, key:error.libraryKey,resource:error.resource}); } finally {window.fetch = original;}
      }
      const ref = api.libraryCatalogReference('three-gltf@0.160.0'), original = window.fetch;
      window.fetch = async url => new Response(url.endsWith('LICENSE') ? license : url.endsWith('GLTFLoader.js') ? "import {x} from '../utils/BufferGeometryUtils.js'; export const GLTFLoader=x;" : 'not found', {status:url.endsWith('BufferGeometryUtils.js') ? 404 : 200, headers:{'content-type':url.endsWith('.js') ? 'text/javascript' : 'text/plain'}});
      try {await api.downloadModule(ref);} catch(error) {failures.push({message:error.message,key:error.libraryKey,resource:error.resource});} finally {window.fetch=original;}
      const controller = new AbortController();controller.abort();window.fetch = async () => {throw controller.signal.reason;};
      let aborted = false;try {await api.downloadLibrary({key:'cancel',title:'Отмена',url:'https://example.org/game.js',licenseText:license},{signal:controller.signal});} catch(error) {aborted=error.name==='AbortError'&&!error.libraryDownload;} finally {window.fetch=original;}
      return {failures,aborted,count:api.libraryCache.size};
    }, {bundle, modules, license, codeMirror});
    assert.equal(result.failures.length,4);
    for (const failure of result.failures.slice(0,3)) {assert.match(failure.message,/Пробная библиотека 1/);assert.match(failure.message,/HTTP 503/);assert.equal(failure.key,'example@1');}
    assert.match(result.failures[0].message,/код библиотеки.*game\.js/);
    assert.match(result.failures[1].message,/лицензию.*LICENSE/);
    assert.match(result.failures[2].message,/NOTICE/);
    assert.match(result.failures[3].message,/Three\.js.*модуль зависимости.*BufferGeometryUtils\.js.*HTTP 404/);
    assert(result.aborted);assert.equal(result.count,0);await probe.close();

    const context = await browser.newContext({viewport:{width:320,height:800}});
    const page = await context.newPage();await useNativeEditor(page);
    const requests = [];
    await context.route('https://**/*', route => {
      const url = route.request().url();requests.push(url);
      if (url.includes('p5@2.3.4')) return route.fulfill({contentType:'text/javascript',body:fixtures.p5});
      if (p5Source.assets.has(url)) return route.fulfill({status:404,body:'not found'});
      if (url.startsWith('https://cdn.jsdelivr.net/gh/processing/p5.js@v2.3.4/')) return route.fulfill({status:404,body:'not found'});
      if (url.endsWith('LICENSE')) return route.fulfill({contentType:'text/plain',body:license});
      return route.fulfill({contentType:'text/javascript',body:'window.THREE = {REVISION:"160"};'});
    });
    await page.goto(new URL('onehtml-lab.html', root).href);
    const code = '<!doctype html><p>Test</p><script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script><script src="https://cdn.jsdelivr.net/npm/p5@2.3.4/lib/p5.min.js"></script>';
    await page.locator('#code').fill(code);await page.locator('#run').click();await page.locator('#library-download').click();
    await page.waitForFunction(() => document.querySelector('#library-request-text').textContent.includes('HTTP 404'));
    assert.match(await page.locator('#library-request-text').innerText(),/p5\.js 2\.3\.4.*исходник.*HTTP 404/);
    assert(await page.locator('#library-files-button').isVisible());assert(await page.locator('#library-download').isEnabled());
    await page.locator('#library-download').click();await page.waitForFunction(() => !document.querySelector('#library-download').disabled);
    assert.equal(requests.filter(url => url.includes('three@')).length,2,'Retry must reuse the successfully installed Three.js code and license');
    await page.locator('#library-files').setInputFiles([{name:'p5.min.js',mimeType:'text/javascript',buffer:fixtures.p5},{name:'LICENSE.txt',mimeType:'text/plain',buffer:Buffer.from(p5License)},{name:'p5-source-2.3.4.tar.gz',mimeType:'application/gzip',buffer:archive}]);
    await page.locator('#library-request').waitFor({state:'hidden'});
    assert.equal(await page.locator('#code').inputValue(),code,'Recovery must leave game code unchanged');
    await page.locator('#run').click();await page.locator('#preview iframe').waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await context.close();
    console.log(`${name}: named resource errors, module dependency, cancellation, retry cache and local p5 recovery passed.`);
  } finally {await browser.close();}
}
