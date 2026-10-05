import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = (await Promise.all(['library-bundle.js','sandbox.js','readiness.js'].map(name => readFile(new URL('../src/'+name,import.meta.url),'utf8')))).join('\n');
const { inspectResources, createFrameClock } = runInNewContext(source + '\n({inspectResources,createFrameClock})', { TextEncoder, URL });
const html = `<!-- <img src="https://ignored.test/comment"> -->
<script>const text='<img src="https://ignored.test/js">';fetch('https://dynamic.test/data');</script>
<textarea><img src="https://ignored.test/text"></textarea>
<script src="./libs/three.js"></script><script defer src="./libs/three.js"></script>
<style>/* url(https://ignored.test/css) */ .x{content:"url(https://ignored.test/string)";background:url("../a.png")} @import "theme.css"; @font-face {src:url('font.woff2')} .y{background:url(https\\3a //assets.test/b.png)}</style>
<img src="https://assets.test/img?a=1&amp;b=2" srcset="one.png 1x, two.png 2x"><video src="movie.mp4" poster="poster.jpg"></video>
<link rel="stylesheet" href="style.css"><link rel="preload" as="font" href="other.woff2">
<div style="background:url(&quot;inline.png&quot;)"></div>
<img src="data:image/png;base64,AAAA"><img srcset="data:image/png;base64,BBBB 1x, three.png 2x"><a href="https://ignored.test/link">link</a>`;
const index = html.indexOf('<script src=');
const scan = inspectResources(html,[{reference:{index},usedKey:'copy',path:'./libs/three.js'}]);
assert(!scan.rows.some(row => /ignored|dynamic|AAAA|BBBB/.test(row.path)));
for(const path of ['../a.png','theme.css','font.woff2','https://assets.test/b.png','https://assets.test/img?a=1&b=2','one.png','two.png','three.png','movie.mp4','poster.jpg','style.css','other.woff2','inline.png']) assert(scan.rows.some(row=>row.path===path),path);
assert.equal(scan.rows.filter(row=>row.path==='./libs/three.js').length,2,'Supported and unsupported duplicate references stay distinct');
assert.equal(scan.rows.find(row=>row.state==='Копия доступна для подмены').path,'./libs/three.js');
assert.equal(scan.rows.find(row=>row.path==='font.woff2').kind,'Шрифт');
const limited = inspectResources(Array.from({length:220},(_,i)=>`<img src="${i}.png">`).join(''));
assert.equal(limited.rows.length,200); assert(limited.overflow);
const clock = createFrameClock();
clock.frame(0);clock.frame(1000);assert.equal(clock.snapshot().frames,0,'Off by default');
clock.active(true);clock.frame(1000);clock.frame(1016);clock.frame(1032);clock.frame(1132);clock.frame(1283);
assert.deepEqual(JSON.parse(JSON.stringify(clock.snapshot())),{frames:4,elapsed:283,max:151,slow:1});
clock.active(false);clock.frame(9000);clock.active(true);clock.frame(12000);clock.frame(12016);
assert.equal(clock.snapshot().elapsed,299,'Background interval is excluded');
assert.equal(clock.snapshot().slow,1);
clock.reset();clock.frame(13000);clock.frame(13020);assert.equal(clock.snapshot().frames,1);
assert.equal(clock.snapshot().max,20);
console.log('Static resources, inert scanning, source limits and foreground frame timing passed.');
