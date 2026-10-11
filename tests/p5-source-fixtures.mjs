import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = new URL('../', import.meta.url);
export const p5Manifest = JSON.parse(await readFile(new URL('src/vendor/p5-source-2.3.4.json',root),'utf8'));
export const p5SourceScript = (await readFile(new URL('src/p5-source.js',root),'utf8')).replace('/* P5_SOURCE_MANIFEST */ null',()=>JSON.stringify(p5Manifest));
const api = new Function(p5SourceScript+'\nreturn {p5SourceTar,p5SourceFileUrl};')();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let loaded;
export async function p5SourceFixtures() {
  return loaded ||= (async () => {
    const upstreamHash='efd86925ca0a8e66c53ffdbe8c5799b1abfc85c2921a99a1a03fd5147fd7ef21';
    const directory=join(tmpdir(),'onehtml-additional-library-fixtures');await mkdir(directory,{recursive:true});
    const path=join(directory,upstreamHash);let bytes;
    try{bytes=await readFile(path);}catch{}
    if(!bytes || hash(bytes)!==upstreamHash){const response=await fetch('https://codeload.github.com/processing/p5.js/tar.gz/refs/tags/v2.3.4',{signal:AbortSignal.timeout(90000)});assert(response.ok,'Upstream p5 source: HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),upstreamHash);await writeFile(path,bytes);}
    const tar=gunzipSync(bytes),files=new Map(),field=b=>b.toString('utf8').split('\0')[0];let at=0,pax=null;
    while(at+512<=tar.length){const start=at,header=tar.subarray(at,at+512),name=field(header.subarray(0,100));if(!name)break;const size=parseInt(field(header.subarray(124,136)).trim(),8)||0;at+=512+Math.ceil(size/512)*512;assert(at<=tar.length);if(header[156]===120){pax=tar.subarray(start,at);continue;}if(header[156]===103)continue;const prefix=field(header.subarray(345,500)),long=pax&&/\d+ path=([^\n]+)/.exec(pax.subarray(512).toString())?.[1];const namePath=(long||(prefix?prefix+'/':'')+name).replace(/^[^/]+\//,'');if(header[156]===0||header[156]===48)files.set(namePath,tar.subarray(start+512,start+512+size));pax=null;}
    const selected=p5Manifest.files.map(([name,size,digest])=>{const file=files.get(name);assert(file,'Missing '+name);assert.equal(file.length,size,name);assert.equal(hash(file),digest,name);return file;});
    const assets=new Map(p5Manifest.files.map(([name],i)=>[api.p5SourceFileUrl(name),selected[i]]));
    return {archive:gzipSync(api.p5SourceTar(selected),{level:9}),assets,files:selected};
  })();
}
