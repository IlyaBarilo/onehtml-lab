// Portable library copies contain source text, never executable editor resources.
const portableManifestName = 'onehtml-libraries.json';
const portableEncoder = new TextEncoder();
const portableDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const portableCRCtable = Uint32Array.from({length:256}, (_, value) => {
  for (let bit=0;bit<8;bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function portableCRC(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = portableCRCtable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function portableFilename(name) {
  if (typeof name !== 'string' || !name || name !== packageFilename(name)
    || /[\\/]/.test(name) || name === '.' || name === '..') throw Error('Недопустимое имя файла в наборе.');
  return name;
}
function portableFilesMap(files) {
  const map = new Map();
  for (const file of files) {
    const name = portableFilename(file.name), key = name.toLowerCase();
    if (map.has(key)) throw Error('Повторяются имена файлов: ' + name);
    map.set(key, file.bytes);
  }
  return map;
}
async function makeLibraryPack(entries) {
  const files = [], libraries = [], names = new Set([portableManifestName]);
  function add(name, text) {
    name = packageFilename(name);
    const stem = name.replace(/\.[^.]+$/, ''), extension = name.slice(stem.length);
    let index = 2, unique = name;
    while (names.has(unique.toLowerCase())) unique = `${stem}-${index++}${extension}`;
    names.add(unique.toLowerCase());
    const bytes = portableEncoder.encode(text);
    files.push({name:unique, bytes});
    return {name:unique, bytes:bytes.length, crc32:portableCRC(bytes)};
  }
  for (const entry of entries) {
    if (!await allowedLibraryCacheEntry(entry)) throw Error('Нельзя экспортировать неполную копию: ' + entry.title);
    const ref = libraryCatalogReference(entry.catalogKey || entry.key);
    const prefix = packageFilename((ref?.key || entry.key).replace(/[@:]/g, '-')).slice(0, 100);
    const item = {};
    for (const key of ['key','title','format','catalogKey','sourceUrl','licenseUrl','noticeUrl','localPath','documentScope','filename','originalUrl']) {
      if (typeof entry[key] === 'string') item[key] = entry[key];
    }
    item.licenseFile = add(prefix + '-LICENSE.txt', entry.license);
    if (entry.notice) item.noticeFile = add(prefix + '-NOTICE.txt', entry.notice);
    const module = entry.format === 'module' && moduleEntryData(entry);
    item.scripts = module ? module.files.map(file => ({url:file.url, ...add(prefix + '-' + new URL(file.url).pathname.split('/').pop(), file.source)}))
      : [add(libraryFilename(ref || {}, entry), entry.source)];
    libraries.push(item);
  }
  files.unshift({name:portableManifestName, bytes:portableEncoder.encode(JSON.stringify({format:'onehtml-lab-libraries', version:1, libraries}, null, 2))});
  return files;
}
async function readLibraryPack(files) {
  const map = portableFilesMap(files), manifest = map.get(portableManifestName);
  if (!manifest) throw Error('Выберите onehtml-libraries.json вместе со всеми файлами набора или ZIP-архив.');
  let data;
  try { data = JSON.parse(portableDecoder.decode(manifest).replace(/^\uFEFF/, '')); } catch { throw Error('Не удалось прочитать манифест набора.'); }
  if (data?.format !== 'onehtml-lab-libraries' || data.version !== 1 || !Array.isArray(data.libraries) || !data.libraries.length) throw Error('Неподдерживаемый формат набора библиотек.');
  function textFile(ref) {
    if (!ref || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || !Number.isInteger(ref.crc32) || ref.crc32 < 0 || ref.crc32 > 0xffffffff) throw Error('Некорректная запись файла в манифесте.');
    const name = portableFilename(ref.name), bytes = map.get(name.toLowerCase());
    if (!bytes) throw Error('Не хватает файла: ' + name);
    if (bytes.length !== ref.bytes || portableCRC(bytes) !== ref.crc32) throw Error('Файл повреждён или изменён: ' + name);
    return portableDecoder.decode(bytes);
  }
  const entries = [], keys = new Set();
  for (const item of data.libraries) {
    if (!item || typeof item.key !== 'string' || keys.has(item.key) || !Array.isArray(item.scripts) || !item.scripts.length) throw Error('Некорректный список библиотек.');
    keys.add(item.key);
    const entry = {};
    for (const key of ['key','title','format','catalogKey','sourceUrl','licenseUrl','noticeUrl','localPath','documentScope','filename','originalUrl']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw Error('Некорректные свойства библиотеки.');
      if (typeof item[key] === 'string') entry[key] = item[key];
    }
    entry.license = textFile(item.licenseFile);
    entry.notice = item.noticeFile ? textFile(item.noticeFile) : '';
    entry.licenseType = libraryLicenseType(entry.license);
    entry.source = entry.format === 'module' ? JSON.stringify(item.scripts.map(file => ({url:file.url, source:textFile(file)}))) : item.scripts.length === 1 ? textFile(item.scripts[0]) : '';
    entry.bytes = entry.format === 'module' ? moduleEntryData(entry)?.bytes : portableEncoder.encode(entry.source).length;
    entry.savedAt = Date.now();
    if (!await allowedLibraryCacheEntry(entry)) throw Error('Неполная библиотека, зависимости, лицензия или NOTICE: ' + (entry.title || entry.key));
    entries.push(entry);
  }
  return entries;
}
async function installLibraryPack(entries) {
  // Validate everything before touching either storage; use one database transaction.
  if (!entries.length || new Set(entries.map(entry => entry.key)).size !== entries.length) throw Error('Пустой набор или повторяющиеся библиотеки.');
  for (const entry of entries) if (!await allowedLibraryCacheEntry(entry)) throw Error('Некорректная копия библиотеки.');
  let persistent = false;
  try {
    const database = await libraryDatabase();
    await new Promise((resolve, reject) => {
      const tx = database.transaction('libraries', 'readwrite');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      try { const store = tx.objectStore('libraries'); for (const entry of entries) store.put(entry); }
      catch (error) { tx.abort(); reject(error); }
    });
    persistent = true;
  } catch {}
  for (const entry of entries) {
    libraryCache.set(entry.key, entry);
    if (persistent) persistedLibraries.set(entry.key, entry);
  }
  libraryCachePersistent = persistent;
  return persistent;
}
async function readRawLibraryFiles(reference, files) {
  const map = portableFilesMap(files);
  const decoded = [...map].map(([name, bytes]) => ({name, source:portableDecoder.decode(bytes)}));
  const scripts = decoded.filter(file => /\.js$/i.test(file.name));
  const license = decoded.find(file => /(?:^|[-_.])licen[sc]e(?:\.|$)/i.test(file.name))?.source || (scripts.length === 1 ? localLibraryNotices(scripts[0].source).license : '');
  const notice = decoded.find(file => /(?:^|[-_.])notice(?:\.|$)/i.test(file.name))?.source || (scripts.length === 1 ? localLibraryNotices(scripts[0].source).notice : '');
  const entry = {key:reference.key, title:reference.title, sourceUrl:reference.url, licenseUrl:reference.licenseUrl,
    format:reference.format, license:license.trim(), notice:notice.trim(), licenseType:libraryLicenseType(license), savedAt:Date.now()};
  if (reference.format === 'module') {
    const queue = [reference.url], graph = [];
    for (let at=0;at<queue.length;at++) {
      const url = queue[at], name = new URL(url).pathname.split('/').pop().toLowerCase();
      const file = scripts.find(file => file.name === name);
      if (!file) throw Error('Не хватает модуля: ' + name + '. Для готового набора используйте импорт с манифестом.');
      graph.push({url, source:file.source});
      for (const imported of moduleImports(file.source)) {
        if (imported.reason) throw Error(imported.reason);
        const target = moduleFileUrl(imported.value, url); if (!queue.includes(target)) queue.push(target);
      }
    }
    if (scripts.length !== graph.length) throw Error('Выберите только модули этой библиотеки и её лицензию.');
    entry.source = JSON.stringify(graph); entry.bytes = moduleEntryData(entry)?.bytes;
  } else {
    if (scripts.length !== 1) throw Error('Выберите один JS-файл этой версии, полный LICENSE и при необходимости NOTICE.');
    entry.source = scripts[0].source; entry.bytes = portableEncoder.encode(entry.source).length;
  }
  if (!await allowedLibraryCacheEntry(entry)) throw Error('Нужны JS, полный текст лицензии и все зависимости; для Babylon.js — также NOTICE.');
  return [entry];
}
function makeLibraryZip(files) {
  const parts = [], directory = []; let offset = 0, directorySize = 0;
  if (files.length > 65535) throw Error('Для такого количества файлов выберите сохранение по одному.');
  portableFilesMap(files);
  for (const file of files) {
    const name = portableEncoder.encode(file.name), size = file.bytes.length, crc = portableCRC(file.bytes);
    if (size > 0xffffffff || offset + size + 30 + name.length > 0xffffffff) throw Error('Архив больше 4 ГБ: выберите отдельные файлы.');
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x800,true);
    lv.setUint32(14,crc,true); lv.setUint32(18,size,true); lv.setUint32(22,size,true); lv.setUint16(26,name.length,true); local.set(name,30);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x800,true);
    cv.setUint32(16,crc,true); cv.setUint32(20,size,true); cv.setUint32(24,size,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); central.set(name,46);
    parts.push(local,file.bytes); directory.push(central); offset += local.length + size; directorySize += central.length;
  }
  if (offset + directorySize > 0xffffffff) throw Error('Архив больше 4 ГБ: выберите отдельные файлы.');
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0,0x06054b50,true); view.setUint16(8,files.length,true); view.setUint16(10,files.length,true);
  view.setUint32(12,directorySize,true); view.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end], {type:'application/zip'});
}
async function readLibraryZip(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const bad = () => { throw Error('Повреждённый или неподдерживаемый ZIP. Распакуйте архив и выберите файлы с манифестом.'); };
  let end = bytes.length - 22;
  for (;end>=Math.max(0,bytes.length-65557);end--) if (view.getUint32(end,true)===0x06054b50 && end+22+view.getUint16(end+20,true)===bytes.length) break;
  if (end<0 || end<bytes.length-65557 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) bad();
  const count = view.getUint16(end+10,true), size = view.getUint32(end+12,true), start = view.getUint32(end+16,true);
  if (count!==view.getUint16(end+8,true) || start+size!==end) bad();
  const files = [], ranges = []; let position = start;
  for (let i=0;i<count;i++) {
    if (position+46>end || view.getUint32(position,true)!==0x02014b50) bad();
    const flags=view.getUint16(position+8,true), method=view.getUint16(position+10,true), crc=view.getUint32(position+16,true);
    const packed=view.getUint32(position+20,true), length=view.getUint32(position+24,true), nl=view.getUint16(position+28,true);
    const extra=view.getUint16(position+30,true), comment=view.getUint16(position+32,true), local=view.getUint32(position+42,true);
    if (flags & 1 || ![0,8].includes(method) || view.getUint16(position+34,true) || position+46+nl+extra+comment>end || local+30>start) bad();
    const name=portableDecoder.decode(bytes.subarray(position+46,position+46+nl)); portableFilename(name);
    if (view.getUint32(local,true)!==0x04034b50 || view.getUint16(local+6,true)!==flags || view.getUint16(local+8,true)!==method) bad();
    const localName=view.getUint16(local+26,true), dataStart=local+30+localName+view.getUint16(local+28,true), dataEnd=dataStart+packed;
    if (dataEnd>start || portableDecoder.decode(bytes.subarray(local+30,local+30+localName))!==name) bad();
    if (ranges.some(([from,to])=>local<to && dataEnd>from)) bad(); ranges.push([local,dataEnd]);
    if (!(flags & 8) && (view.getUint32(local+14,true)!==crc || view.getUint32(local+18,true)!==packed || view.getUint32(local+22,true)!==length)) bad();
    let content=bytes.subarray(dataStart,dataEnd);
    if (method===8) {
      let stream;
      try { stream=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { throw Error('Распакуйте этот ZIP и выберите файлы вместе с манифестом.'); }
      const reader=stream.getReader(), chunks=[]; let total=0;
      try {
        for (;;) { const {done,value}=await reader.read(); if(done) break; total+=value.length;
          if(total>length) { await reader.cancel(); bad(); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      content=new Uint8Array(total); let at=0; for(const chunk of chunks) {content.set(chunk,at);at+=chunk.length;}
    }
    if (content.length!==length || portableCRC(content)!==crc) bad();
    files.push({name,bytes:content}); position+=46+nl+extra+comment;
  }
  if(position!==end) bad(); portableFilesMap(files); return files;
}
