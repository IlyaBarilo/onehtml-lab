import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
const source=(await Promise.all(['format.js','library-bundle.js','library-modules.js','media-models.js','media-assets.js','media-prompts.js','media-images.js'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const api=runInNewContext(source+'\n({glbInfo,mediaCache,mediaHash,scanMedia,attachMedia,prepareMediaHtml,validMediaEntry,promptMediaIntro,planPromptMedia,modelPromptInstructions})',
  {Uint8Array,DataView,Blob,TextEncoder,TextDecoder,btoa,atob,crypto:webcrypto,localStorage:{getItem:()=>null,setItem:()=>{}}});
const bytes=new Uint8Array(await readFile(new URL('../src/examples/satellite.glb',import.meta.url)));
assert.equal(api.glbInfo(bytes).meshes,3);assert.equal(api.glbInfo(bytes).animations,1);assert.match(api.glbInfo(bytes).copyright,/Ilya Barilo/);
const buffer=Buffer.from(bytes), jsonSize=buffer.readUInt32LE(12), original=JSON.parse(buffer.subarray(20,20+jsonSize));
function modified(edit) {
  const json=structuredClone(original);edit(json);const text=Buffer.from(JSON.stringify(json));const padding=Buffer.alloc((4-text.length%4)%4,32), head=Buffer.from(buffer.subarray(0,20));
  head.writeUInt32LE(text.length+padding.length,12);head.writeUInt32LE(20+text.length+padding.length+buffer.length-20-jsonSize,8);
  return new Uint8Array(Buffer.concat([head,text,padding,buffer.subarray(20+jsonSize)]));
}
for(const invalid of [bytes.subarray(0,bytes.length-1),new Uint8Array(24),modified(json=>json.asset.version='1.0'),modified(json=>json.bufferViews[0].byteLength=999999)])assert.throws(()=>api.glbInfo(invalid),/целостность/);
assert.throws(()=>api.glbInfo(modified(json=>json.buffers[0].uri='https://example.test/file.bin')),/внешние файлы/);
assert.throws(()=>api.glbInfo(modified(json=>json.images=[{uri:'../texture.png'}])),/внешние файлы/);
for(const extension of ['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'])assert.throws(()=>api.glbInfo(modified(json=>json.meshes[0].primitives[0].extensions={[extension]:{}})),/дополнительные расширения/);
const id=await api.mediaHash(bytes),entry={id,name:'Мой спутник.glb',type:'model/gltf-binary',blob:new Blob([bytes],{type:'model/gltf-binary'}),model:api.glbInfo(bytes)};
api.mediaCache.set(id,entry);assert(await api.validMediaEntry(entry));
assert(!await api.validMediaEntry({...entry,blob:new Blob([modified(json=>json.buffers[0].uri='a.bin')],{type:entry.type})}));
const path=encodeURIComponent(entry.name),code=`<!doctype html><div id="source" data-model-src="${path}" hidden></div><script>const s='<div data-model-src="fake.glb">';</script><!-- <div data-model-src="comment.glb"> --><template><div data-model-src="inert.glb"></div></template>`;
assert.deepEqual(Array.from(api.scanMedia(code).refs,ref=>[ref.kind,ref.path]),[['model',path]]);
const bound=api.attachMedia(code,path,entry),prepared=await api.prepareMediaHtml(bound);
assert.equal(prepared.media.length,1);assert.equal(prepared.missingMedia.length,0);assert(prepared.html.includes('data:model/gltf-binary;base64,'));assert(!prepared.html.includes('onehtml-media:1:'));
assert.equal(Buffer.compare(Buffer.from(api.scanMedia(prepared.html).embedded[0].path.split(',')[1],'base64'),buffer),0,'GLB bytes must be preserved');
assert.equal((await api.prepareMediaHtml(bound,false)).html,bound,'Unchecked export is exact');
assert.throws(()=>api.attachMedia('<img src="'+path+'">',path,entry),/подходит/);
const shortened=await api.planPromptMedia(prepared.html,[],true);assert(shortened.html.includes(path));assert(!shortened.html.includes('data:model/'));assert.equal(shortened.files[0].id,id);
const intro=api.promptMediaIntro(shortened.files,'babylon');assert(intro.includes(entry.name));assert(intro.includes('data-model-src'));assert(intro.includes('babylonjs-loaders@9.30.0'));assert(!intro.includes('GLTFLoader'));
assert(api.modelPromptInstructions('three').includes('GLTFLoader.js'));assert(api.modelPromptInstructions('',true).includes('Сохрани существующий'));assert(!api.modelPromptInstructions('',true).includes('three@'));
api.mediaCache.delete(id);assert.deepEqual(Array.from((await api.prepareMediaHtml(bound)).missingMedia),[path]);
console.log('GLB integrity, self-contained resources, codec guards, exact bindings/exports, prompt shortening and engine-specific instructions passed.');
