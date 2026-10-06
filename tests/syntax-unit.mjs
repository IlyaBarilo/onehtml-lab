import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=(await Promise.all(['library-bundle.js','syntax.js'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const {scanCodeColors}=runInNewContext(source+'\n({scanCodeColors})',{document:{querySelector:()=>({})}});
const code=`<!doctype html><html><head><style>#abc { color: #fff; background:url('./image.png'); content:"#123456"; } /* #000 */</style><script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script></head><body><h1 title="x > y">Привет</h1><div style="color: red; background: #123456">Текст</div><!-- <script src="fake.js"></script> --><script>const text = '<img src="fake.png">'; // comment
function jump() { return 12; } let multiline = \`строка
продолжение\`;</script></body></html>`;
const result=scanCodeColors(code);
assert(!result.limited);
let cursor=0;
for(const token of result.tokens){assert(token.start>=cursor,JSON.stringify(token));assert(token.end>token.start);cursor=token.end;}
assert(result.tokens.some(t=>t.kind==='keyword'&&code.slice(t.start,t.end)==='const'));
assert(result.tokens.some(t=>t.kind==='function'&&code.slice(t.start,t.end)==='jump'));
assert(result.tokens.some(t=>t.kind==='text'&&code.slice(t.start,t.end)==='Привет'));
assert(result.accents.some(a=>a.label.includes('Three.js r128')));
assert(!result.accents.some(a=>a.label.includes('fake')));
assert.deepEqual(Array.from(result.accents.filter(a=>a.color),a=>a.color),['#fff','red','#123456']);
assert(result.accents.some(a=>a.label.includes('image.png')));
const marked='<script data-onehtml-library="three@0.160.0" data-onehtml-filename="three-r160.min.js">fetch("inside-library");</script>';
const libraryMarks=scanCodeColors(marked).accents;
assert.equal(libraryMarks.length,2);
assert(libraryMarks.every(a=>a.kind==='library'));
assert.match(libraryMarks[0].label,/Начало встроенной библиотеки.*three-r160/);
assert.equal(marked.slice(libraryMarks[1].start,libraryMarks[1].end),'</script>');
const local=scanCodeColors('<script src="../libs/three-r160.min.js"></script>').accents[0];
assert.match(local.label,/Three.js r160 · локальный путь/);
assert.match(result.accents.find(a=>a.kind==='library').label,/CDN/);
const resources=scanCodeColors('<img src="https://site.test/a.png"><audio src="./a.mp3"></audio><style>p{background:url(data:image/png;base64,aaa)}</style>').accents;
assert(resources.every(a=>a.kind==='resource'));
assert.match(resources[0].label,/Изображение · внешний адрес/);
assert.match(resources[1].label,/Звук · локальный путь/);
assert.match(resources[2].label,/встроенные данные/);
const semantic=`<h1>Заголовок</h1><button>Играть</button><script>
// fetch('comment'); localStorage.clear();
const text="fetch('string'); sessionStorage.clear()";
function fetch() {} other.fetch(); other.localStorage.getItem('x');
window.fetch('/data'); new XMLHttpRequest(); new WebSocket('wss://site.test'); new EventSource('/events');
localStorage.setItem('x','1'); window.sessionStorage.getItem('x');
</script>`;
const semanticMarks=scanCodeColors(semantic).accents;
assert.deepEqual(Array.from(semanticMarks.filter(a=>a.kind==='text'),a=>semantic.slice(a.start,a.end)),['Заголовок','Играть']);
assert.equal(semanticMarks.filter(a=>a.kind==='network').length,4);
assert.equal(semanticMarks.filter(a=>a.kind==='storage').length,2);
assert(semanticMarks.filter(a=>['network','storage'].includes(a.kind)).every(a=>a.label.includes('выполнение не проверялось')));
assert(!scanCodeColors('<script>const unfinished = "abc').limited);
for(const source of ['<br/><img src=x/>','<div title="unfinished','<a '+ 'x'.repeat(10000)]) {
  let end=0;for(const token of scanCodeColors(source).tokens){assert(token.start>=end);end=token.end;}
}
assert(scanCodeColors('x'.repeat(1_000_001)).limited);
assert(scanCodeColors('<b>x</b>'.repeat(16000)).limited);
console.log('Display lexer: mixed HTML/CSS/JS, inert text, attributes, accents and size limits passed.');
