import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../src/ai-prompts.js',import.meta.url),'utf8');
const api=runInNewContext(source+'\n({aiPromptText,aiStarterTask})',{document:{querySelector:()=>({})}});
const snapshot={mode:'create',project:'application',platform:'mobile',task:'афиша моей выставки',pastCode:null,quality:'',selection:'',error:''};
const phone=api.aiPromptText(snapshot,'',[]);assert(phone.startsWith('Сделай мультимедийное приложение'));assert(phone.includes('афиша моей выставки'));assert(phone.includes('Основное устройство — телефон'));assert(phone.includes('Также обеспечь работу на компьютере'));assert(!phone.includes('сыграть ещё раз'));assert(!phone.includes('Сделай игру'));
const desktop=api.aiPromptText({...snapshot,platform:'desktop'},'',[]);assert(desktop.includes('Основное устройство — компьютер'));assert(desktop.includes('Также обеспечь работу на телефоне'));
const game=api.aiPromptText({...snapshot,project:'game'},'',[]);assert(game.startsWith('Сделай игру про'));assert(game.includes('сыграть ещё раз'));
const code='<p>Программа</p>';
for(const mode of ['change','fix']) {const prompt=api.aiPromptText({...snapshot,mode},code,[]);assert(prompt.startsWith(mode==='change'?'Измени приложение':'Исправь ошибку в приложении'));assert(prompt.endsWith(code));assert(prompt.includes('существующие подключения медиа'));}
for(const mode of ['explain','check']){const prompt=api.aiPromptText({...snapshot,mode,code,selectionStart:0,selectionEnd:0},code,[]);assert(prompt.includes('Тип работы — мультимедийное приложение'));assert(prompt.includes('не возвращай новый полный HTML'));assert(prompt.endsWith(code));}
for(const kind of ['poster','story','infographic','quiz']){
 const plain=api.aiStarterTask(kind);assert(plain);assert(!plain.includes('undefined'));assert(!plain.includes('Используй'));
 const media=api.aiStarterTask(kind,[{name:'1.jpg'},{name:'2.wav'}]);assert(media.includes('1.jpg'));assert(media.includes('2.wav'));assert(media.includes('выключить звук'));
}
assert.equal(api.aiStarterTask('unknown'), '');assert(api.aiStarterTask('infographic').includes('[данные]'));
console.log('Application/game prompts, both primary devices, analysis modes and optional media starters passed.');
