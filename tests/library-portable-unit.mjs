import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { deflateRawSync } from 'node:zlib';
const root=new URL('../',import.meta.url),encoder=new TextEncoder();
const scripts=(await Promise.all(['vendor/codemirror.bundle.js','library-bundle.js','library-modules.js','library-portable.js'].map(name=>readFile(new URL('src/'+name,root),'utf8')))).join('\n');
const context={URL,TextEncoder,TextDecoder,Blob,DecompressionStream,crypto:webcrypto,window:{},Uint8Array,Uint32Array,DataView};
runInNewContext(scripts+'\nthis.api={libraryCache,persistedLibraries,libraryCatalogReference,makeLibraryPack,readLibraryPack,installLibraryPack,readRawLibraryFiles,makeLibraryZip,readLibraryZip,portableCRC,setDatabase(db){libraryDatabasePromise=Promise.resolve(db);}};',context);
const a=context.api,file=(name,text)=>({name,bytes:encoder.encode(text)});
const license=await readFile(new URL('node_modules/three/LICENSE',root),'utf8');
const apache=await readFile(new URL('docs/licenses/babylonjs-9.30.0-LICENSE.txt',root),'utf8');
const notice=await readFile(new URL('docs/licenses/babylonjs-9.30.0-NOTICE.txt',root),'utf8');
const ref=a.libraryCatalogReference('three@0.160.0'),classic={...ref,sourceUrl:ref.url,source:'\uFEFFwindow.THREE={REVISION:"160"};\r\n',license};
const mr=a.libraryCatalogReference('three-gltf@0.160.0'),core=mr.url.replace('examples/jsm/loaders/GLTFLoader.js','build/three.module.js'),utils=mr.url.replace('loaders/GLTFLoader','utils/BufferGeometryUtils');
const graph=[{url:mr.url,source:"import {REVISION} from 'three'; import {x} from '../utils/BufferGeometryUtils.js'; export const loader=REVISION+x;"},{url:core,source:"export const REVISION='160';"},{url:utils,source:"export const x='ok';"}];
const module={...mr,sourceUrl:mr.url,source:JSON.stringify(graph),license};
const br=a.libraryCatalogReference('babylonjs@9.30.0'),babylon={...br,sourceUrl:br.url,source:'window.BABYLON={};',license:apache,notice};
const pack=await a.makeLibraryPack([classic,module,babylon]),decoded=await a.readLibraryPack(pack);
assert.equal(decoded.length,3);assert.equal(decoded[0].source,classic.source);assert.equal(decoded[0].license,license);assert.equal(decoded[2].notice,notice);
assert.deepEqual(JSON.parse(decoded[1].source),graph);assert.equal(a.libraryCache.size,0);assert.equal(context.THREE,undefined,'Import must not execute scripts');
const zip=new Uint8Array(await a.makeLibraryZip(pack).arrayBuffer());
assert.equal((await a.readLibraryPack(await a.readLibraryZip(zip)))[0].source,classic.source);
let offset=0,records=0;
while(new DataView(zip.buffer).getUint32(offset,true)===0x04034b50) {
  const v=new DataView(zip.buffer),length=v.getUint32(offset+22,true),nl=v.getUint16(offset+26,true),name=new TextDecoder().decode(zip.subarray(offset+30,offset+30+nl));
  assert.equal(v.getUint16(offset+8,true),0);assert.deepEqual(Buffer.from(zip.subarray(offset+30+nl,offset+30+nl+length)),Buffer.from(pack.find(f=>f.name===name).bytes));offset+=30+nl+length;records++;
}
assert.equal(records,pack.length,'ZIP must be independently readable');
const clone=()=>pack.map(f=>({name:f.name,bytes:f.bytes.slice()})),manifest=JSON.parse(new TextDecoder().decode(pack[0].bytes));
const withManifest=data=>[file('onehtml-libraries.json',JSON.stringify(data)),...pack.slice(1)];
for(const bad of [clone().filter(f=>f.name!==manifest.libraries[0].licenseFile.name),clone().filter(f=>f.name!==manifest.libraries[2].noticeFile.name),[...clone(),file(pack[1].name.toUpperCase(),'duplicate')],[...clone(),file('../escape.js','bad')],withManifest({...manifest,version:2}),withManifest({...manifest,libraries:[...manifest.libraries,manifest.libraries[0]]})])await assert.rejects(a.readLibraryPack(bad));
const changed=clone();changed[1].bytes[0]^=1;await assert.rejects(a.readLibraryPack(changed),/изменён/);
const incomplete=structuredClone(manifest);incomplete.libraries[1].scripts.pop();await assert.rejects(a.readLibraryPack(withManifest(incomplete)),/зависимости/);
const invalid=structuredClone(manifest);invalid.libraries[0].sourceUrl='https://unknown.test/a.js';await assert.rejects(a.readLibraryPack(withManifest(invalid)));
const fakeModule=structuredClone(manifest);fakeModule.libraries[0].format='module';await assert.rejects(a.readLibraryPack(withManifest(fakeModule)));
const broken=zip.slice();broken[45]^=1;await assert.rejects(a.readLibraryZip(broken));
for(const size of [0,10,zip.length-1])await assert.rejects(a.readLibraryZip(zip.slice(0,size)));
// A separately constructed compressed ZIP checks compatibility with desktop archives.
function deflated(files) {
  const local=[],directory=[];let position=0;
  for(const f of files) {
    const name=Buffer.from(f.name),data=Buffer.from(f.bytes),compressed=deflateRawSync(data),crc=a.portableCRC(data),h=Buffer.alloc(30+name.length),c=Buffer.alloc(46+name.length);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);name.copy(h,30);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(position,42);name.copy(c,46);local.push(h,compressed);directory.push(c);position+=h.length+compressed.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.reduce((n,c)=>n+c.length,0),12);end.writeUInt32LE(position,16);return new Uint8Array(Buffer.concat([...local,...directory,end]));
}
assert.equal((await a.readLibraryPack(await a.readLibraryZip(deflated(pack))))[1].source,module.source);
assert.equal((await a.readRawLibraryFiles(ref,[file('three.min.js',classic.source),file('LICENSE',license)]))[0].key,ref.key);
await assert.rejects(a.readRawLibraryFiles(br,[file('babylon.js',babylon.source),file('LICENSE.md',apache)]),/NOTICE/);
assert.equal((await a.readRawLibraryFiles(br,[file('babylon.js',babylon.source),file('LICENSE.md',apache),file('NOTICE.md',notice)]))[0].notice,notice.trim());
assert.deepEqual(JSON.parse((await a.readRawLibraryFiles(mr,[...graph.map(f=>file(new URL(f.url).pathname.split('/').pop(),f.source)),file('LICENSE',license)]))[0].source),graph);
await assert.rejects(a.readRawLibraryFiles(mr,[file('GLTFLoader.js',graph[0].source),file('LICENSE',license)]),/модуля/);
let writes=[];
function database(fail=false){return {transaction(){const tx={error:Error('quota'),objectStore(){return {put(entry){writes.push(entry.key);}}},abort(){queueMicrotask(()=>tx.onabort?.());}};queueMicrotask(()=>fail?tx.onabort?.():tx.oncomplete?.());return tx;}};}
a.setDatabase(database());assert.equal(await a.installLibraryPack(decoded),true);assert.equal(writes.length,3);assert.equal(a.persistedLibraries.size,3);
writes=[];await assert.rejects(a.installLibraryPack([decoded[0],{...decoded[2],notice:''}]));assert.equal(writes.length,0,'Validation must finish before any write');
a.setDatabase(database(true));const temporary={...decoded[0],source:decoded[0].source+'// session'};assert.equal(await a.installLibraryPack([temporary]),false);assert.equal(a.libraryCache.get(temporary.key),temporary);assert.notEqual(a.persistedLibraries.get(temporary.key),temporary);
console.log('Portable libraries: exact bytes, store/deflate ZIP, dependencies, licenses/NOTICE, corruption guards and atomic/session storage passed.');
