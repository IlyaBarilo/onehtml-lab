import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source=(await Promise.all(['library-bundle.js','library-modules.js','ai-profiles.js'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const api=runInNewContext(source+'\n({moduleReference,moduleCatalog,moduleFileUrl,localModuleReference,aiGameUsesPhysics,aiGameInstructions,aiGameWarnings})',{document:{querySelector:()=>({})},URL});
const url='https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
assert.equal(api.moduleReference(url).key,'cannon-es@0.20.0');
assert.equal(api.moduleCatalog('cannon-es@0.20.0').downloadBytes,346256);
assert.equal(api.moduleReference(url.replace('cdn.jsdelivr.net/npm','unpkg.com')).url,url);
for(const unsupported of [url.replace('0.20.0','0.19.0'),url.replace('0.20.0','latest'),url.replace('cannon-es.js','cannon-es.cjs.js'),url.replace('https:','http:')])assert.equal(api.moduleReference(unsupported),null);
for(const path of ['./lib/cannon-es-0.20.0.js','../vendor/cannon-es@0.20.0/dist/cannon-es.js','./libs/cannon-es/0.20.0/cannon-es.js','file:///C:/games/cannon-es-0.20.0.js','./my%20files/cannon-es-0.20.0.js']) {
  const reference=api.localModuleReference(path);assert(reference?.moduleLocal,path);assert.equal(reference.key,'cannon-es@0.20.0');assert.equal(reference.originalUrl,path);assert.equal(reference.url,url);
}
for(const path of ['./cannon-es.js','./cannon-es-0.19.0.js','https://unknown.test/cannon-es-0.20.0.js','//unknown.test/cannon-es-0.20.0.js','data:text/javascript,cannon-es-0.20.0.js','./cannon-es-0.20.0.cjs.js'])assert.equal(api.localModuleReference(path),null,path);
assert.equal(api.moduleFileUrl(url,url),url);assert.equal(api.moduleFileUrl('./cannon-es.js',url),url);
for(const dependency of ['./extra.js','../cannon-es.js','https://unknown.test/cannon-es.js','cannon-es'])assert.throws(()=>api.moduleFileUrl(dependency,url),/зависимость/);
assert(api.aiGameUsesPhysics({dimension:'3d',physics:'bodies'}));assert(api.aiGameUsesPhysics({dimension:'3d',basis:'three',physics:'bodies'}));
for(const settings of [{dimension:'2d',physics:'bodies'},{dimension:'3d',physics:'simple'},{dimension:'3d',basis:'babylon',physics:'bodies'}])assert(!api.aiGameUsesPhysics(settings));
const prompt=api.aiGameInstructions({dimension:'3d',physics:'bodies'},true);assert(prompt.includes(url));assert(prompt.includes('GLTFLoader'));assert(prompt.includes('CANNON.World'));assert(prompt.includes('quaternion'));assert(!prompt.includes('three.min.js'));
assert.equal(api.aiGameWarnings({dimension:'3d',physics:'bodies'}).length,0);assert.match(api.aiGameWarnings({dimension:'3d',basis:'babylon',physics:'bodies'}).join(' '),/ваш выбор сохранён/);
console.log('cannon-es exact ESM/local versions, byte size, dependency guards and optional 3D physics profiles passed.');
