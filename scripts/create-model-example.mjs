import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

// Authored sample: shared box geometry, a panel texture and an animated antenna.
const chunks = [], views = [], accessors = [];
let length = 0;
function append(bytes) {
  const padding = (4 - length % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
  const index = views.length;
  views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
  chunks.push(bytes); length += bytes.length; return index;
}
function accessor(values, componentType, type, bounds) {
  const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  accessors.push({ bufferView: append(Buffer.from(array.buffer)), componentType, count: values.length / sizes[type], type, ...bounds });
  return accessors.length - 1;
}
const positions = [], normals = [], uv = [], indices = [];
for (const [normal, a, b] of [
  [[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]],
  [[0,1,0],[1,0,0],[0,0,-1]], [[0,-1,0],[1,0,0],[0,0,1]],
  [[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]]
]) {
  const start = positions.length / 3;
  for (const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
    positions.push(...normal.map((n,i) => (n + x*a[i] + y*b[i]) / 2)); normals.push(...normal); uv.push((x+1)/2,(y+1)/2);
  }
  indices.push(start,start+1,start+2,start,start+2,start+3);
}
const pos=accessor(positions,5126,'VEC3',{min:[-.5,-.5,-.5],max:[.5,.5,.5]}), nor=accessor(normals,5126,'VEC3'), tex=accessor(uv,5126,'VEC2'), ind=accessor(indices,5123,'SCALAR');
function crc32(bytes) {
  let crc=0xffffffff;
  for (const byte of bytes) { crc ^= byte; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function pngChunk(type, bytes) {
  const name=Buffer.from(type), head=Buffer.alloc(4), tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc32(Buffer.concat([name,bytes])));
  return Buffer.concat([head,name,bytes,tail]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(32*(32*3+1));
for(let y=0;y<32;y++) for(let x=0;x<32;x++) {
  const line=x%8===0 || y%8===0, offset=y*97+1+x*3;
  pixels.set(line?[95,147,189]:[19+Math.floor(x/8)*3,51+Math.floor(y/8)*4,107],offset);
}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))]);
const imageView=append(png);
const times=accessor([0,1,2,3,4],5126,'SCALAR',{min:[0],max:[4]});
const rotation=accessor([0,0,0,1, 0,Math.sin(.3),0,Math.cos(.3), 0,0,0,1, 0,-Math.sin(.3),0,Math.cos(.3), 0,0,0,1],5126,'VEC4');
const materials=[
  { name:'Корпус',pbrMetallicRoughness:{baseColorFactor:[.79,.84,.91,1],metallicFactor:.35,roughnessFactor:.6} },
  { name:'Солнечные панели',pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:.15,roughnessFactor:.65} },
  { name:'Золотая антенна',pbrMetallicRoughness:{baseColorFactor:[.95,.57,.15,1],metallicFactor:.45,roughnessFactor:.5} }
];
const nodes=[
  {name:'Спутник',children:[1,2,3,4,5,6,7]},
  {name:'Корпус',mesh:0,scale:[1.15,1.05,.85]},
  {name:'Левая панель',mesh:1,translation:[-1.8,0,0],scale:[2,.07,1.25]},
  {name:'Правая панель',mesh:1,translation:[1.8,0,0],scale:[2,.07,1.25]},
  {name:'Балка',mesh:2,scale:[5,.05,.06]},
  {name:'Антенна',translation:[0,.7,0],children:[8,9]},
  {name:'Датчик',mesh:2,translation:[0,0,.51],scale:[.35,.35,.17]},
  {name:'Нижний модуль',mesh:0,translation:[0,-.68,0],scale:[.45,.32,.45]},
  {name:'Стойка антенны',mesh:2,translation:[0,.2,0],scale:[.05,.6,.05]},
  {name:'Приёмник',mesh:2,translation:[0,.52,0],scale:[.75,.06,.75]}
];
const json={asset:{version:'2.0',copyright:'Copyright (c) 2026 Ilya Barilo. MIT License.'},scene:0,scenes:[{nodes:[0]}],nodes,
  meshes:materials.map((_,material)=>({primitives:[{attributes:{POSITION:pos,NORMAL:nor,TEXCOORD_0:tex},indices:ind,material}]})),materials,
  textures:[{source:0}],images:[{bufferView:imageView,mimeType:'image/png'}],bufferViews:views,accessors,buffers:[{byteLength:length}],
  animations:[{name:'Поворот антенны',samplers:[{input:times,output:rotation,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:5,path:'rotation'}}]}]};
const text=Buffer.from(JSON.stringify(json)), textPad=Buffer.alloc((4-text.length%4)%4,32), bin=Buffer.concat(chunks), binPad=Buffer.alloc((4-bin.length%4)%4);
const fileHeader=Buffer.alloc(12), jsonHeader=Buffer.alloc(8), binHeader=Buffer.alloc(8);
fileHeader.writeUInt32LE(0x46546c67,0);fileHeader.writeUInt32LE(2,4);fileHeader.writeUInt32LE(28+text.length+textPad.length+bin.length+binPad.length,8);
jsonHeader.writeUInt32LE(text.length+textPad.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);binHeader.writeUInt32LE(bin.length+binPad.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const glb=Buffer.concat([fileHeader,jsonHeader,text,textPad,binHeader,bin,binPad]);
await writeFile(new URL('../src/examples/satellite.glb',import.meta.url),glb);
console.log(`Created satellite.glb (${glb.length} bytes), embedded texture and animation.`);
