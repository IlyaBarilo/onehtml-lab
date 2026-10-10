// Text-only module planning. Downloaded code runs only inside the game.
const moduleDataCache = new WeakMap();
let moduleScanCache = { code: null, plan: null };
function moduleReference(url) {
  if (/^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/three@0\.160\.0\/examples\/jsm\/loaders\/GLTFLoader\.js$/.test(url)) return {
    key: 'three-gltf@0.160.0', title: 'Three.js r160 · GLB-загрузчик', format: 'module', downloadBytes: 1413400,
    url: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js', originalUrl: url,
    licenseUrl: 'https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE'
  };
  const m = /^https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/three@0\.(\d{3})\.0\/build\/(three\.module(?:\.min)?\.js)$/.exec(url);
  if (!m || +m[1] < 160 || +m[1] > 180) return null;
  const version = `0.${m[1]}.0`, name = m[2];
  return { key: `three-esm@${version}:${name}`, title: `Three.js r${m[1]} · модуль`, format: 'module',
    downloadBytes: version === '0.160.0' ? (name === 'three.module.js' ? 1272972 : 670681) : undefined,
    url: `https://cdn.jsdelivr.net/npm/three@${version}/build/${name}`, originalUrl: url,
    licenseUrl: `https://cdn.jsdelivr.net/npm/three@${version}/LICENSE` };
}
function moduleCatalog(key) {
  if (key === 'three-gltf@0.160.0') return moduleReference('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
  const m = /^three-esm@(0\.\d{3}\.0):(three\.module(?:\.min)?\.js)$/.exec(key || '');
  return m && moduleReference(`https://cdn.jsdelivr.net/npm/three@${m[1]}/build/${m[2]}`);
}
function moduleMappedUrl(value, imports) {
  if (Object.hasOwn(imports,value)) return imports[value];
  const prefix = Object.keys(imports).filter(key => key.endsWith('/') && value.startsWith(key)).sort((a,b) => b.length-a.length)[0];
  return prefix && typeof imports[prefix] === 'string' && imports[prefix].endsWith('/') ? imports[prefix]+value.slice(prefix.length) : value;
}
function moduleString(text) {
  if (!/^["']/.test(text) || text.at(-1) !== text[0]) throw Error('Invalid import');
  return text.slice(1, -1).replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|\r?\n|([^\r\n]))/gi,
    (_, a, b, c, d) => a || b || c ? String.fromCodePoint(parseInt(a || b || c,16)) : d === undefined ? '' : ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'}[d] ?? d));
}
function moduleImports(source) {
  const prefix = '<script type="module">', wrapped=prefix+source, tree = OneHTMLCodeMirror.html().language.parser.parse(wrapped + '</script>'), imports = [];
  tree.iterate({ enter(ref) {
    if (ref.name === 'ImportDeclaration' || ref.name === 'ExportDeclaration') {
      const string = ref.node.getChild('String');
      if(string && /^\s*(?:with|assert)\s*\{/.test(wrapped.slice(string.to))) {
        imports.push({reason:'Атрибуты импорта пока не поддерживаются.'});return;
      }
      if (string) imports.push({ from: string.from-prefix.length, to: string.to-prefix.length,
        value: moduleString(wrapped.slice(string.from,string.to)) });
    } else if (ref.name === 'DynamicImport') imports.push({ reason: 'Динамический импорт пока не поддерживается.' });
    else if(ref.type.isError) {
      for(let node=ref.node.parent;node;node=node.parent) if(['ImportDeclaration','ExportDeclaration'].includes(node.name)) {
        imports.push({reason:'Некорректный импорт или экспорт модуля.'});break;
      }
    }
  } });
  return imports;
}
function moduleScripts(code) {
  let tree;const records = [];
  for (const match of code.matchAll(libraryScriptTag)) {
    if (match[2] === undefined) continue;
    const attrs = scriptAttributes(match[2]), type = attrs.get('type')?.value.trim();
    if (!['module','importmap'].includes(type?.toLowerCase())) continue;
    tree ||= OneHTMLCodeMirror.html().language.parser.parse(code);
    let node = tree.resolveInner(match.index+1,1), inert = false;
    for (; node; node = node.parent) if (node.name === 'Element' && /^<(?:template|noscript|iframe|object)\b/i.test(code.slice(node.from,node.from+20))) inert = true;
    if (inert) continue;
    const from = match.index + 8 + match[2].length, end = match.index + match[0].length;
    records.push({ index:match.index, end, tag:match[0], attrs, type:type.toLowerCase(), from,
      body:code.slice(from, end-match[0].match(/<\/script\s*>$/i)[0].length) });
  }
  return records;
}
function scanModules(code) {
  if (moduleScanCache.code === code) return moduleScanCache.plan;
  const plan = { records:[], references:[], issues:[], map:null, imports:Object.create(null), reason:'' };
  if (!/\b(?:module|importmap)\b/i.test(code)) return plan;
  plan.records = moduleScripts(code);
  const maps = plan.records.filter(r => r.type === 'importmap');
  try {
    if (maps.length > 1) throw Error('Несколько importmap пока не поддерживаются.');
    plan.map = maps[0] || null;
    if(plan.map && plan.records.some(r=>r.type==='module' && r.index<plan.map.index)) throw Error('Importmap должен находиться перед модулями.');
    if (plan.map) {
      const data = JSON.parse(plan.map.body);
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.scopes || data.integrity || plan.map.attrs.has('src')) throw Error('Importmap со scopes, integrity или src пока не поддерживается.');
      if (data.imports && (typeof data.imports !== 'object' || Array.isArray(data.imports))) throw Error('Некорректный importmap.');
      Object.assign(plan.imports, data.imports || {});
    }
  } catch (error) { plan.reason = error.message || 'Некорректный importmap.'; }
  if(plan.reason) plan.issues.push({title:'Importmap',path:'',state:'Подмена не поддерживается',note:plan.reason});
  function add(value, record, position) {
    const mapped = moduleMappedUrl(value,plan.imports);
    if(plan.map?.attrs.has('data-onehtml-modules') && typeof mapped==='string' && mapped.startsWith('data:text/javascript;base64,')) return;
    let ref = typeof mapped === 'string' && moduleReference(mapped);
    if (typeof mapped === 'string' && plan.map?.attrs.has('data-onehtml-module-links')) {
      try {
        const links=JSON.parse(moduleDecode(plan.map.attrs.get('data-onehtml-module-links').value));
        const link=links.find(item=>item.path===mapped && moduleCatalog(item.key));
        if(link && (!ref || ref.key===link.key)) ref={...moduleCatalog(link.key),originalUrl:ref?.originalUrl || moduleCatalog(link.key).url,assetKey:/^module-asset@[a-f\d]{64}$/.test(link.assetKey)?link.assetKey:undefined,
          filename:!/^https:/.test(mapped)?mapped.split('/').pop():'',modulePath:mapped,moduleLocal:!/^https:/.test(mapped)};
      } catch {}
    }
    const reason = plan.reason || (!ref ? 'Поддерживаются ядро Three.js r160–r180 и GLTFLoader r160 с точными CDN-ссылками. Другие дополнения, локальные пути и модули не встраиваются.' : '');
    if (reason) plan.issues.push({ title:'Модуль JavaScript', path: typeof mapped === 'string' ? mapped : value, state:'Подмена не поддерживается', note:reason });
    else plan.references.push({ ...ref, index:record.index, record, value, position });
  }
  for (const record of plan.records.filter(r => r.type === 'module')) {
    const path = decodeScriptUrl(record.attrs.get('src')?.value || '');
    if (['async','defer','nomodule','integrity'].some(name => record.attrs.has(name))) {
      plan.issues.push({ title:'Модуль JavaScript', path, state:'Подмена не поддерживается', note:'Атрибуты async, defer, nomodule или integrity не преобразуются.' }); continue;
    }
    if (path) add(path,record,null);
    else for (const item of moduleImports(record.body)) {
      if (item.reason) plan.issues.push({ title:'Модуль JavaScript',path:'',state:'Подмена не поддерживается',note:item.reason });
      else add(item.value,record,item);
    }
  }
  if (plan.references.some(ref => ref.key === 'three-gltf@0.160.0')) {
    const core = typeof plan.imports.three === 'string' && (moduleReference(plan.imports.three) || plan.references.find(ref => ref.value === 'three'));
    if (typeof plan.imports.three === 'string' && !core?.key.startsWith('three-esm@0.160.0:')
      || plan.references.some(ref => ref.key.startsWith('three-esm@') && !ref.key.startsWith('three-esm@0.160.0:'))) {
      plan.references = plan.references.filter(ref => ref.key !== 'three-gltf@0.160.0');
      plan.issues.push({title:'GLTFLoader', path:'', state:'Подмена не поддерживается', note:'GLTFLoader r160 требует ядро Three.js той же версии. Существующая версия сохранена.'});
    }
  }
  moduleScanCache = { code, plan }; return plan;
}
function moduleFileUrl(path, base) {
  const root = /^(https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.\d{3}\.0\/)/.exec(base)?.[1];
  const addon = base.includes('/examples/jsm/');
  const url = path === 'three' && addon ? root + 'build/three.module.js' : new URL(path,base).href;
  const allowed = addon ? ['examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'build/three.module.js'] : [];
  if (!root || !url.startsWith(root) || !(allowed.includes(url.slice(root.length))
    || /^build\/three\.(?:module|core)(?:\.min)?\.js$/.test(url.slice(root.length)))) throw Error('Неподдерживаемая зависимость модуля.');
  if (addon && !root.includes('three@0.160.0/')) throw Error('Неподдерживаемая версия загрузчика.');
  return url;
}
function moduleEntryData(entry) {
  const prior=moduleDataCache.get(entry);
  if (prior && prior.source===entry.source && prior.license===entry.license && prior.key===entry.key && prior.catalog===entry.catalogKey && prior.url===entry.sourceUrl) return prior.data;
  let data = null;
  try {
    const ref = moduleCatalog(entry.catalogKey || entry.key), files = JSON.parse(entry.source);
    if(entry.key!==ref?.key && !/^module-asset@[a-f\d]{64}$/.test(entry.key)) throw Error('Invalid module key');
    if (!ref || entry.format !== 'module' || ref.url !== entry.sourceUrl || !Array.isArray(files) || !files.length
      || !validLibraryAsset(entry.source,entry.license)) throw Error('Invalid module copy');
    const seen = new Set(); let bytes = 0;
    for (const file of files) {
      if (!file || moduleFileUrl(file.url,ref.url) !== file.url || seen.has(file.url) || !validLibraryAsset(file.source,entry.license)) throw Error('Invalid module file');
      seen.add(file.url); bytes += new TextEncoder().encode(file.source).length;
    }
    if (!seen.has(ref.url)) throw Error('Incomplete module copy');
    for (const file of files) {
      file.imports=moduleImports(file.source);
      for (const item of file.imports) if (item.reason || !seen.has(moduleFileUrl(item.value,file.url))) throw Error('Incomplete dependency');
    }
    data = { files, bytes, ref };
  } catch {}
  moduleDataCache.set(entry,{source:entry.source,license:entry.license,key:entry.key,catalog:entry.catalogKey,url:entry.sourceUrl,data});return data;
}
async function downloadModule(reference) {
  const ref = moduleCatalog(reference.key);
  if (!ref || ref.url !== reference.url) throw Error('Unknown module');
  const response = await fetch(ref.licenseUrl,{credentials:'omit',redirect:'error'});
  const license = await readLibraryResponse(response), files = [], queue = [ref.url], reused = new Map();
  for (const entry of libraryCache.values()) if (entry.format === 'module' && moduleCatalog(entry.key)) {
    const data = moduleEntryData(entry);
    if (data && entry.license.trim() === license.trim()) for (const file of data.files) reused.set(file.url,file.source);
  }
  let bytes = 0;
  for (let i=0;i<queue.length;i++) {
    let source = reused.get(queue[i]);
    if (source === undefined) {
      const response=await fetch(queue[i],{credentials:'omit',redirect:'error'});
      if(!/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw Error('Module MIME type');
      source = await readLibraryResponse(response);
    }
    bytes += new TextEncoder().encode(source).length;
    if (!validLibraryAsset(source,license)) throw Error('Invalid module source or license');
    files.push({url:queue[i],source});
    for (const item of moduleImports(source)) {
      if (item.reason) throw Error(item.reason);
      const url = moduleFileUrl(item.value,queue[i]); if (!queue.includes(url)) queue.push(url);
    }
  }
  const entry = { ...ref, sourceUrl:ref.url, source:JSON.stringify(files), license:license.trim(), bytes, savedAt:Date.now() };
  if (!moduleEntryData(entry)) throw Error('Invalid module graph');
  let persisted = true; try { await saveLibraryToCache(entry); } catch { persisted=false; }
  libraryCache.set(entry.key,entry); return persisted;
}
function moduleBase64(text) {
  const bytes = new TextEncoder().encode(text); let binary='';
  for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
function moduleDecode(value) { return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))); }
function moduleReplace(text, changes) {
  for (const change of changes.sort((a,b)=>b.from-a.from || b.to-a.to)) text=text.slice(0,change.from)+change.text+text.slice(change.to);
  return text;
}
function moduleNoticeReference(entry) {
  return entry.key === 'three-gltf@0.160.0' || entry.catalogKey === 'three-gltf@0.160.0'
    ? moduleReference('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js') : entry;
}
function moduleFileSource(file,entry,targets) {
  const changes=(file.imports || moduleImports(file.source)).map(item=>({from:item.from,to:item.to,text:JSON.stringify(targets.get(moduleFileUrl(item.value,file.url)) || moduleFileUrl(item.value,file.url))}));
  return licensedLibrarySource(moduleNoticeReference(entry), { ...entry, source:moduleReplace(file.source,changes) });
}
async function prepareModuleLibraries(code, mode='inline', reserved=[], copies=new Map()) {
  const plan=scanModules(code), missingLibraries=[], bundledLibraries=[], bundledLibraryDetails=[], files=[], groups=[];
  if(plan.map?.attrs.has('data-onehtml-modules')) {
    const extracted=await embeddedModulePlan(code);
    if(extracted.count) return prepareModuleLibraries(extracted.html,mode,reserved,new Map([...copies,...extracted.assets.map(e=>[e.key,e])]));
    return {html:code,missingLibraries,bundledLibraries,bundledLibraryDetails,files,modules:false};
  }
  if (!plan.references.length) return {html:code,missingLibraries,bundledLibraries,bundledLibraryDetails,files,modules:false};
  const selected=new Map();
  for (const ref of plan.references) {
    const entry=copies.get(ref.assetKey) || cachedLibrary(ref), data=entry && moduleEntryData(entry);
    if (!data) { if (!missingLibraries.some(r=>r.key===ref.key)) missingLibraries.push(ref); }
    else selected.set(ref.key,{entry,data});
  }
  if (!selected.size) return {html:code,missingLibraries,bundledLibraries,bundledLibraryDetails,files,modules:false};
  const imports=Object.assign(Object.create(null),plan.imports), outputs=new Map(), targets=new Map(), names=new Set(reserved.map(s=>s.toLowerCase()));
  for (const {entry,data} of selected.values()) for (const file of data.files) {
    if (outputs.has(file.url)) continue;
    const version=/@0\.(\d{3})\.0/.exec(file.url)[1], base=`three-r${version}-${file.url.split('/').pop()}`;
    let name=base,n=2;while(names.has(name.toLowerCase())) name=base.replace(/\.js$/,`-${n++}.js`);
    names.add(name.toLowerCase()); outputs.set(file.url,{file,entry,name});
    if (mode==='files') targets.set(file.url,'./'+encodeURIComponent(name));
  }
  const gltfCore = selected.has('three-gltf@0.160.0') && (plan.references.find(ref => ref.originalUrl === plan.imports.three && ref.key.startsWith('three-esm@0.160.0:'))
    || plan.references.find(ref => ref.key.startsWith('three-esm@0.160.0:')));
  const gltfCoreUrl = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  if (gltfCore && gltfCore.url !== gltfCoreUrl) outputs.delete(gltfCoreUrl);
  if (mode === 'files' && gltfCore && targets.has(gltfCore.url)) targets.set(gltfCoreUrl,targets.get(gltfCore.url));
  for (const [url,item] of outputs) {
    const source=moduleFileSource(item.file,item.entry,mode==='files'?targets:new Map());
    if (mode==='files') files.push({name:item.name,content:source});
    else targets.set(url,'data:text/javascript;base64,'+moduleBase64(source));
    imports[url]=targets.get(url);
  }
  if (selected.has('three-gltf@0.160.0')) {
    if (gltfCore && targets.has(gltfCore.url)) { targets.set(gltfCoreUrl,targets.get(gltfCore.url)); imports[gltfCoreUrl]=targets.get(gltfCore.url); }
  }
  for (const ref of plan.references) if (selected.has(ref.key)) {
    imports[ref.originalUrl]=targets.get(ref.url);
    if (Object.hasOwn(plan.imports,ref.value) || moduleMappedUrl(ref.value,plan.imports) !== ref.value) imports[ref.value]=targets.get(ref.url);
  }
  for (const {entry,data} of selected.values()) {
    groups.push({key:data.ref.key,license:entry.license,files:data.files.map(file=>({url:file.url}))});
    bundledLibraries.push(entry.title);
  }
  const body=JSON.stringify({imports}).replace(/</g,'\\u003c'), changes=[];
  let tag;
  if (mode==='inline') {
    const info=moduleBase64(JSON.stringify({map:plan.map?.tag || '',groups})), hash=await librarySourceHash(body+'\0'+info);
    if (!hash) throw Error('Module integrity unavailable');
    const licenses=[...selected.values()].map(x=>x.entry.license).join('\n');
    tag=`<${'!--'}onehtml-modules\n${licenses}\n-->\n<script type="importmap" data-onehtml-modules="1" data-onehtml-info="${info}" data-onehtml-sha256="${hash}">${body}</script>`;
  } else {
    const links=[...selected.values()].map(({entry,data})=>({key:data.ref.key,assetKey:entry.key,path:targets.get(entry.sourceUrl)}));
    tag=`<script type="importmap" data-onehtml-module-links="${moduleBase64(JSON.stringify(links))}">${body}</script>`;
  }
  const at=plan.map?.index ?? plan.records.find(r=>r.type==='module').index;
  changes.push({from:at,to:plan.map?.end ?? at,text:tag});
  for (const ref of plan.references.filter(r=>!r.position && selected.has(r.key))) {
    const attr=libraryInlineAttributes(ref.record.attrs);
    const pin=mode==='inline' ? ` data-onehtml-module-src="${libraryAttribute(ref.originalUrl)}"` : '';
    if(mode==='files') imports[targets.get(ref.url)]=targets.get(ref.url);
    changes.push({from:ref.record.index,to:ref.record.end,text:`<script ${attr} src="${libraryAttribute(targets.get(ref.url))}"${pin}></script>`});
  }
  const html=moduleReplace(code,changes), increase=new Blob([html]).size-new Blob([code]).size;
  let remaining=increase, i=0;
  const total=[...selected.values()].reduce((n,x)=>n+x.data.bytes,0);
  for (const {entry,data} of selected.values()) {
    const addedBytes=++i===selected.size?remaining:Math.round(increase*data.bytes/total);remaining-=addedBytes;
    bundledLibraryDetails.push({title:entry.title,addedBytes});
  }
  return {html,missingLibraries,bundledLibraries,bundledLibraryDetails,files,modules:true};
}
async function embeddedModulePlan(code,mode='cdn') {
  if(!/data-onehtml-modules\s*=/i.test(code)) return {html:code,rows:[],assets:[],count:0};
  const records=moduleScripts(code), map=records.find(r=>r.attrs.has('data-onehtml-modules'));
  if (!map) return {html:code,rows:[],assets:[],count:0};
  const row={title:'Модульные библиотеки',path:'',source:'',key:'',filename:'',originalUrl:'',reason:'',removedBytes:0,removable:false}, assets=[];
  try {
    const infoText=map.attrs.get('data-onehtml-info')?.value || '', expected=map.attrs.get('data-onehtml-sha256')?.value;
    if (await librarySourceHash(map.body+'\0'+infoText)!==expected || !expected) throw Error('Встроенная карта модулей изменена — оставлена в коде.');
    const info=JSON.parse(moduleDecode(infoText)), imports=JSON.parse(map.body).imports;
    if (!Array.isArray(info.groups) || info.groups.length>8 || typeof info.map!=='string') throw Error('Некорректная карта модулей.');
    for(const group of info.groups) {
      const ref=moduleCatalog(group.key);if(!ref || !Array.isArray(group.files) || group.files.length>3) throw Error('Неподдерживаемая копия модуля.');
      const files=group.files.map(file=>{
        const value=imports[file.url];if(typeof value!=='string' || !value.startsWith('data:text/javascript;base64,')) throw Error('Модульная копия неполная.');
        const source=moduleDecode(value.slice(28)), prefix=licensedLibrarySource(moduleNoticeReference(ref),{source:'',license:group.license});
        if(!source.startsWith(prefix)) throw Error('Не найдена лицензия модуля.');
        return {url:file.url,source:source.slice(prefix.length)};
      });
      const entry={...ref,sourceUrl:ref.url,source:JSON.stringify(files),license:group.license,bytes:0,savedAt:Date.now()};
      const data=moduleEntryData(entry);if(!data) throw Error('Не удалось проверить модули и лицензию.');
      entry.bytes=data.bytes;entry.catalogKey=ref.key;entry.key='module-asset@'+await librarySourceHash(entry.source+'\0'+entry.license);assets.push(entry);
    }
    const commentStart=code.lastIndexOf('<'+'!--onehtml-modules',map.index), commentEnd=code.indexOf('-->',commentStart)+3;
    if(commentStart<0 || commentEnd>map.index || !/^\s*$/.test(code.slice(commentEnd,map.index))
      || !assets.every(e=>normalizedLibraryText(code.slice(commentStart,commentEnd)).includes(normalizedLibraryText(e.license)))) throw Error('Не найдена лицензия карты модулей.');
    let html=moduleReplace(code,[{from:commentStart,to:map.end,text:info.map}]);
    for(const record of records.filter(r=>r.attrs.has('data-onehtml-module-src'))) {
      const url=decodeScriptUrl(record.attrs.get('data-onehtml-module-src').value), ref=moduleReference(url);
      if(!ref || imports[url]!==decodeScriptUrl(record.attrs.get('src')?.value || '')) throw Error('Подключение модуля изменено — оставлено в коде.');
      const attrs=new Map(record.attrs);attrs.delete('data-onehtml-module-src');
      html=html.replace(record.tag,`<script ${libraryInlineAttributes(attrs)} src="${libraryAttribute(url)}"></script>`);
    }
    const plain=scanModules(html), links=plain.references.map(ref=>({key:ref.key,path:ref.originalUrl,assetKey:assets.find(e=>e.catalogKey===ref.key)?.key}));
    const pin=`data-onehtml-module-links="${moduleBase64(JSON.stringify(links))}"`;
    if(plain.map) html=moduleReplace(html,[{from:plain.map.index,to:plain.map.end,text:plain.map.tag.replace(/\sdata-onehtml-module-links="[^"]*"/g,'').replace('>',` ${pin}>`)}]);
    else html=moduleReplace(html,[{from:plain.records.find(r=>r.type==='module').index,to:plain.records.find(r=>r.type==='module').index,text:`<script type="importmap" ${pin}>{"imports":{}}</script>`}]);
    if(mode==='files') {
      html=(await prepareModuleLibraries(html,'files',[],new Map(assets.map(e=>[e.key,e])))).html;
    }
    row.removable=true;row.removedBytes=new Blob([code]).size-new Blob([html]).size;
    if(mode==='files') row.warning='Модульные файлы рядом требуют HTTP; без сервера используйте встраивание в HTML.';
    row.title=assets.map(e=>e.title).join(', ');row.source=assets.map(e=>e.source).join('');row.bytes=assets.reduce((n,e)=>n+e.bytes,0);
    row.path=assets.map(e=>e.sourceUrl).join(', ');
    return {html,rows:[row],assets,count:assets.length,removedBytes:row.removedBytes};
  } catch(error) {row.reason=error.message || 'Не удалось проверить модульную копию.';row.note=row.reason;return {html:code,rows:[row],assets:[],count:0};}
}
