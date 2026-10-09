// Local user-selected media only. Neither scanning nor attachment executes HTML.
const mediaCache = new Map();
const mediaPersisted = new Set();
const mediaLimits = { file: 8 * 1024 * 1024, document: 16 * 1024 * 1024, cache: 32 * 1024 * 1024, count: 64 };
const mediaTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' };
let mediaDatabasePromise;
let mediaBusy = false;
let mediaFeedback = '';
let mediaSelection = null;
let mediaRendered = null;
let mediaDelete = null;
const mediaObjectUrls = new Set();
let mediaScanCache = { code: null, result: null };

function mediaDatabase() {
  if (!mediaDatabasePromise) mediaDatabasePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(Error('IndexedDB unavailable'));
    const request = indexedDB.open('onehtml-lab-media', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('IndexedDB blocked'));
  });
  return mediaDatabasePromise;
}

async function mediaTransaction(mode, action) {
  const db = await mediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', mode);
    let request;
    try { request = action(transaction.objectStore('assets')); }
    catch (error) { transaction.abort(); reject(error); return; }
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || Error('Media transaction failed'));
  });
}

function mediaPath(value) {
  const path = String(value || '').trim();
  return path && path.length <= 500 && !/^(?:[a-z][a-z\d+.-]*:|[\\/#])/i.test(path)
    && !/[\u0000-\u001f\u007f\\<>"']/.test(path) ? path : '';
}

function mediaSignature(bytes, type) {
  const starts = text => [...text].every((char, i) => bytes[i] === char.charCodeAt(0));
  if (type === 'image/png') return bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 16 && starts('RIFF') && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (type === 'audio/wav') return bytes.length >= 44 && starts('RIFF') && String.fromCharCode(...bytes.slice(8,12)) === 'WAVE';
  if (type === 'audio/ogg') return bytes.length >= 27 && starts('OggS');
  if (type === 'audio/mpeg') return bytes.length >= 4 && (starts('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224));
  return false;
}

async function validMediaEntry(entry) {
  if (!entry || !/^[a-f\d]{64}$/.test(entry.id) || typeof entry.name !== 'string' || entry.name.length > 170
    || !Object.values(mediaTypes).includes(entry.type) || !(entry.blob instanceof Blob) || entry.blob.type !== entry.type
    || !entry.blob.size || entry.blob.size > mediaLimits.file) return false;
  const bytes = new Uint8Array(await entry.blob.arrayBuffer());
  return mediaSignature(bytes, entry.type) && await mediaHash(bytes) === entry.id;
}

async function mediaHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

async function loadMediaCache() {
  let timeout;
  try {
    const entries = await Promise.race([mediaTransaction('readonly', store => store.getAll()),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Media timeout')), 4000); })]);
    let total = 0;
    for (const saved of (Array.isArray(entries) ? entries : []).slice(0, mediaLimits.count)) {
      const entry = saved?.bytes instanceof ArrayBuffer && saved.bytes.byteLength <= mediaLimits.file
        ? {id:saved.id,name:saved.name,type:saved.type,originalId:saved.originalId,blob:new Blob([saved.bytes],{type:saved.type})} : saved;
      if (total + (entry?.blob?.size || 0) > mediaLimits.cache || !await validMediaEntry(entry)) continue;
      total += entry.blob.size;
      const image = typeof mediaImageInfo === 'function' ? mediaImageInfo(new Uint8Array(await entry.blob.arrayBuffer()),entry.type) : null;
      const originalId = /^[a-f\d]{64}$/.test(entry.originalId || '') && entry.originalId !== entry.id ? entry.originalId : undefined;
      mediaCache.set(entry.id, {id:entry.id,name:entry.name,type:entry.type,blob:entry.blob,image,originalId});
      mediaPersisted.add(entry.id);
    }
  } catch { mediaFeedback = 'Хранилище медиа недоступно. Новые файлы будут доступны только до закрытия редактора.'; }
  finally { clearTimeout(timeout); }
}

async function addMediaFile(file, originalId) {
  const type = mediaTypes[(/\.([a-z]+)$/i.exec(file.name)?.[1] || '').toLowerCase()];
  if (!type) throw Error('Выберите PNG, JPEG, WebP, MP3, OGG или WAV.');
  if (!file.size || file.size > mediaLimits.file) throw Error('Один файл должен быть не больше 8 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!mediaSignature(bytes, type)) throw Error('Содержимое файла не соответствует его формату.');
  const id = await mediaHash(bytes);
  if (mediaCache.has(id)) return mediaCache.get(id);
  const total = [...mediaCache.values()].reduce((sum, entry) => sum + entry.blob.size, 0);
  if (mediaCache.size >= mediaLimits.count || total + file.size > mediaLimits.cache) throw Error('Кэш медиа заполнен: до 64 файлов и 32 МБ. Удалите ненужные файлы.');
  const name = file.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 170) || 'media';
  originalId = /^[a-f\d]{64}$/.test(originalId || '') && originalId !== id ? originalId : undefined;
  const entry = { id, name, type, blob: new Blob([bytes], { type }), originalId, image: typeof mediaImageInfo === 'function' ? mediaImageInfo(bytes,type) : null };
  try { await mediaTransaction('readwrite', store => store.put({id,name,type,originalId,bytes:bytes.buffer})); mediaPersisted.add(id); }
  catch { /* Keep the file for this session; its row makes the limitation explicit. */ }
  mediaCache.set(id, entry);
  return entry;
}

function scanMedia(code) {
  if (mediaScanCache.code === code) return mediaScanCache.result;
  const result = { refs: [], embedded: [], links: [], marker: null, reason: '' };
  if (code.length > 32_000_000) { result.reason = 'Документ слишком большой для подготовки медиа.'; return result; }
  const tokens = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/\1\s*>|$)|<\/?([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  let templateDepth = 0, audioDepth = 0, markers = 0;
  function add(path, kind, from, to, context) {
    path = decodeScriptUrl(path);
    const embedded = /^data:(?:image\/(?:png|jpeg|webp)|audio\/(?:mpeg|ogg|wav));base64,/i.test(path);
    if (!embedded && !mediaPath(path)) return;
    if (result.refs.length + result.embedded.length >= 1000) { result.reason = 'В документе больше 1 000 подключений медиа. Привязки не применены.'; return; }
    (embedded ? result.embedded : result.refs).push({ path, kind, from, to, context });
  }
  function css(text, offset, attribute = false) {
    const urls = /\/\*[\s\S]*?(?:\*\/|$)|url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/gi;
    for (const match of text.matchAll(urls)) {
      const raw = match.slice(1).find(value => value !== undefined);
      if (raw === undefined) continue;
      const path = raw.trim().replace(/\\([\da-f]{1,6}\s?|[^\r\n])/gi, (_, value) => /^[\da-f]/i.test(value)
        ? String.fromCodePoint(Math.min(0x10ffff, parseInt(value.trim(),16)) || 0xfffd) : value);
      add(path, 'image', offset + match.index, offset + match.index + match[0].length, attribute ? 'css-attribute' : 'css');
    }
  }
  for (const token of code.matchAll(tokens)) {
    if (token[0].startsWith('<!--')) {
      if (!templateDepth && token[0].startsWith('<!--onehtml-media:1:')) {
        markers++;
        try {
          if (markers !== 1 || token[0].length > 64000) throw Error();
          const match = /^<!--onehtml-media:1:([A-Za-z\d+/=]+)-->$/.exec(token[0]);
          const links = JSON.parse(moduleDecode(match?.[1] || ''));
          if (!Array.isArray(links) || links.length > mediaLimits.count || links.some(link => !link || !mediaPath(link.path) || mediaPath(link.path) !== link.path || !/^[a-f\d]{64}$/.test(link.id))
            || new Set(links.map(link => link.path)).size !== links.length) throw Error();
          result.links = links.map(({path,id}) => ({path,id}));
          result.marker = { from: token.index, to: token.index + token[0].length };
        } catch { result.reason = 'Повреждена или повторяется метка медиа. Привязки не применены.'; }
      }
      continue;
    }
    const tag = (token[1] || token[4] || '').toLowerCase();
    const closing = token[0].startsWith('</');
    if (tag === 'template') { templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1)); continue; }
    if (templateDepth) continue;
    if (tag === 'audio') audioDepth = Math.max(0, audioDepth + (closing ? -1 : 1));
    if (closing) continue;
    const attrs = token[2] ?? token[5] ?? '';
    const attrOffset = token.index + token[0].indexOf(attrs, tag.length + 1);
    const seen = new Set();
    for (const attr of attrs.matchAll(/(?:^|\s)([^\s"'<>/=]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g)) {
      const key = attr[1].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const quoted = /^["']/.test(attr[2]);
      const value = quoted ? attr[2].slice(1,-1) : attr[2];
      const from = attrOffset + attr.index + attr[0].lastIndexOf(attr[2]);
      if (key === 'src' && ['img','input','audio','source'].includes(tag) && (tag !== 'source' || audioDepth)) {
        add(value, tag === 'audio' || tag === 'source' ? 'audio' : 'image', from, from + attr[2].length, 'attribute');
      }
      if (key === 'style' && quoted) css(value, from + 1, true);
    }
    if (tag === 'style') css(token[3] || '', token.index + tag.length + attrs.length + 2);
  }
  if (result.reason) { result.links = []; result.marker = null; }
  mediaScanCache = { code, result };
  return result;
}

function mediaBindings(code) {
  const scan = scanMedia(code);
  return scan.refs.map(ref => {
    const link = scan.links.find(link => link.path === ref.path);
    const entry = link && mediaCache.get(link.id);
    return { ...ref, id: link?.id, entry: entry?.type.startsWith(ref.kind + '/') ? entry : null };
  });
}

function attachMedia(code, path, entry) {
  const scan = scanMedia(code);
  if (scan.reason) throw Error(scan.reason);
  const refs = scan.refs.filter(ref => ref.path === path);
  if (!mediaPath(path) || !refs.length) throw Error('В текущем HTML или стилях нет такого относительного пути.');
  if (refs.some(ref => !entry.type.startsWith(ref.kind + '/'))) throw Error('Тип файла не подходит к выбранному подключению.');
  const links = [...scan.links.filter(link => link.path !== path && scan.refs.some(ref => ref.path === link.path)), { path, id: entry.id }];
  if (links.length > mediaLimits.count) throw Error('В документе допускается до 64 привязок.');
  const size = [...new Set(links.map(link => link.id))].reduce((sum,id) => sum + (mediaCache.get(id)?.blob.size || 0), 0);
  if (size > mediaLimits.document) throw Error('Медиа одного документа должны занимать не больше 16 МБ.');
  const marker = `<!--onehtml-media:1:${moduleBase64(JSON.stringify(links))}-->`;
  if (scan.marker) return moduleReplace(code, [{ ...scan.marker, text: marker }]);
  // Keep the doctype first, otherwise the exported document would use quirks mode.
  const doctype = /^\uFEFF?\s*<!doctype\s+html[^>]*>/i.exec(code);
  const index = doctype ? doctype[0].length : 0;
  return code.slice(0,index) + '\n' + marker + '\n' + code.slice(index);
}

async function mediaDataUrl(entry) {
  if (!entry.dataUrl) {
    const bytes = new Uint8Array(await entry.blob.arrayBuffer()); let binary = '';
    for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    entry.dataUrl = `data:${entry.type};base64,${btoa(binary)}`;
  }
  return entry.dataUrl;
}

async function prepareMediaHtml(code, enabled = true) {
  if (!enabled || !code.includes('<!--onehtml-media:1:')) return { html: code, media: [], missingMedia: [], mediaReason: '' };
  const scan = scanMedia(code), refs = mediaBindings(code), changes = [], media = [], missingMedia = [];
  const ids = new Set(refs.filter(ref => ref.entry).map(ref => ref.id));
  if ([...ids].reduce((sum,id) => sum + mediaCache.get(id).blob.size,0) > mediaLimits.document) return {html:code,media:[],missingMedia:[],mediaReason:'Медиа документа превышают 16 МБ.'};
  for (const ref of refs.filter(ref => ref.id)) {
    if (!ref.entry) { if (!missingMedia.includes(ref.path)) missingMedia.push(ref.path); continue; }
    const url = await mediaDataUrl(ref.entry);
    changes.push({from:ref.from,to:ref.to,text:ref.context === 'attribute' ? `"${url}"` : ref.context === 'css-attribute' ? `url(&quot;${url}&quot;)` : `url("${url}")`});
    if (!media.some(item => item.id === ref.id)) media.push({id:ref.id,name:ref.entry.name,bytes:ref.entry.blob.size});
  }
  if (scan.marker && !missingMedia.length) changes.push({...scan.marker,text:''});
  return {html:moduleReplace(code,changes),media,missingMedia,mediaReason:scan.reason};
}

async function prepareApplicationHtml(code, libraries = true, media = true) {
  const prepared = await prepareGameHtml(code, libraries);
  const resources = await prepareMediaHtml(prepared.html, media);
  return {...prepared,html:resources.html,media:resources.media,missingMedia:resources.missingMedia,mediaReason:resources.mediaReason};
}

async function prepareApplicationFiles(code, filename, media = true) {
  const prepared = await prepareGameFiles(code, filename);
  const resources = await prepareMediaHtml(prepared.html, media);
  return {...prepared,html:resources.html,files:prepared.files.map((file,i)=>i ? file : {...file,content:resources.html}),media:resources.media,missingMedia:resources.missingMedia,mediaReason:resources.mediaReason};
}

function mediaPreparationWarning(prepared) {
  const message = [prepared.mediaReason, prepared.missingMedia?.length ? `Нет выбранных файлов: ${prepared.missingMedia.join(', ')}. Выберите их в «Ресурсах».` : ''].filter(Boolean).join(' ');
  if (message) inform(message, true, true);
}

function releaseMediaPreviews() {
  for (const url of mediaObjectUrls) URL.revokeObjectURL(url);
  mediaObjectUrls.clear();
  for (const audio of document.querySelectorAll('#media-list audio')) audio.pause();
  mediaRendered = null;
}

function mediaUsage(id) {
  const codes = [codeField.value, ...historyState.entries.map(entry => entry.code)];
  return codes.reduce((count,code) => count + Number(scanMedia(code).links.some(link => link.id === id)),0);
}

function mediaCanEdit() { return expertMode && !modeBusy && !mediaBusy && !running && !codeField.readOnly; }

function mediaChangeCode(before, next, selection) {
  if (!mediaCanEdit() || before !== codeField.value) return;
  let caret = selection;
  if (!caret && mediaSelection?.code === before) {
    const patch = editPatch(before,next);
    const map = value => value <= patch.start ? value : value >= patch.start + patch.removed.length
      ? value + patch.added.length - patch.removed.length : patch.start + patch.added.length;
    caret = {start:map(mediaSelection.start),end:map(mediaSelection.end)};
  }
  replaceCode(next, true);
  if (selection) revealCodeRange(selection.start,selection.end);
  else { if(caret)revealCodeRange(caret.start,caret.end,'none',false); openDiagnostics('resources'); }
}

function renderMediaAssets() {
  if (diagnosticTab !== 'resources' || currentPanel() !== activityPanel || !expertMode) { releaseMediaPreviews(); return; }
  const source = codeField.value, entries = [...mediaCache.values()];
  const blocked = !mediaCanEdit();
  const selection = editorPosition?.value === source ? editorPosition : { start: codeField.selectionStart, end: codeField.selectionEnd };
  if (!mediaSelection || mediaSelection.code !== source) mediaSelection = { code:source,start:selection.start,end:selection.end };
  const key = JSON.stringify([source, entries.map(entry => [entry.id,mediaPersisted.has(entry.id)]), blocked, mediaFeedback]);
  if (key === mediaRendered) return;
  releaseMediaPreviews(); mediaRendered = key;
  document.querySelector('#media-add').disabled = mediaBusy || modeBusy;
  document.querySelector('#media-feedback').textContent = mediaFeedback;
  const scan = scanMedia(source), refs = mediaBindings(source);
  const total = entries.reduce((sum,entry) => sum + entry.blob.size,0);
  document.querySelector('#media-summary').textContent = `${formatUIInteger(entries.length)} файлов · ${diagnosticSize(total)} в кэше`;
  document.querySelector('#media-bindings').textContent = scan.reason || [...new Map(refs.filter(ref => ref.id).map(ref => [ref.path,ref])).values()]
    .map(ref => `${ref.path} → ${ref.entry ? ref.entry.name + ' · ' + diagnosticSize(ref.entry.blob.size) : 'Файл отсутствует'}`).join('\n') || 'Выберите файл и вставьте фрагмент или привяжите его к относительному пути в коде.';
  const list = document.querySelector('#media-list');
  list.replaceChildren(...entries.map(entry => {
    const li = document.createElement('li'); li.className = 'media-row';
    const row = document.createElement('div'); row.className = 'media-details';
    const name = document.createElement('strong'); name.textContent = entry.name;
    const note = document.createElement('p'); note.className = 'diagnostic-note';
    note.textContent = `${diagnosticSize(entry.blob.size)} · ${mediaPersisted.has(entry.id) ? 'В браузере' : 'Только этот сеанс'}${scan.links.some(link => link.id === entry.id) ? ' · Привязан к коду' : ''}`;
    row.append(name,note); li.append(row);
    const url = URL.createObjectURL(entry.blob); mediaObjectUrls.add(url);
    if (entry.type.startsWith('image/')) {
      const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.src=url;img.alt=entry.name;img.className='media-thumbnail';
      img.addEventListener('error',()=>{if(!note.textContent.includes('Изображение не прочитано'))note.textContent+=' · Изображение не прочитано браузером.';});
      li.prepend(img);
    }
    else {
      const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;audio.setAttribute('aria-label',`Прослушать ${entry.name}`);
      const unsupported=' · Прослушивание недоступно в этом браузере. Файл можно встроить.';
      if(!audio.canPlayType(entry.type))note.textContent+=unsupported;
      audio.addEventListener('error',()=>{if(!note.textContent.includes('Прослушивание недоступно'))note.textContent+=unsupported;});
      li.append(audio);
    }
    const actions = document.createElement('div'); actions.className = 'media-actions';
    const insert = diagnosticButton('Вставить', () => {
      const before=codeField.value, at=mediaSelection;
      if (!mediaCanEdit() || at?.code !== before) return;
      try {
        const ext = Object.keys(mediaTypes).find(key => mediaTypes[key] === entry.type);
        const path=`./media-${entry.id.slice(0,12)}.${ext}`;
        const fragment=entry.type.startsWith('image/') ? `<img src="${path}" alt="Описание изображения">` : `<audio controls src="${path}"></audio>`;
        const raw=before.slice(0,at.start)+fragment+before.slice(at.end);
        const next=attachMedia(raw,path,entry), shift=next.length-raw.length;
        // The marker is inserted before the fragment or replaced in the head.
        const start=at.start+(scanMedia(raw).marker?.from > at.start ? 0 : shift);
        mediaChangeCode(before,next,{start,end:start+fragment.length});
      } catch(error) { mediaFeedback=error.message;mediaRendered=null;renderMediaAssets(); }
    });
    insert.disabled=blocked;actions.append(insert);
    const path=document.createElement('input');path.className='media-path';path.type='text';path.placeholder='images/photo.jpg';
    path.setAttribute('aria-label',`Путь для ${entry.name}`);path.autocomplete='off';path.autocapitalize='off';path.inputMode='url';path.spellcheck=false;path.disabled=blocked;
    const choices=[...new Set(refs.filter(ref=>entry.type.startsWith(ref.kind+'/')).map(ref=>ref.path))];
    path.value=choices.length===1?choices[0]:'';
    const options=document.createElement('datalist');options.id=`media-path-${entry.id}`;path.setAttribute('list',options.id);
    for(const value of choices){const option=document.createElement('option');option.value=value;options.append(option);}
    const bind=diagnosticButton('Привязать',()=>{
      try { const before=codeField.value;mediaChangeCode(before,attachMedia(before,path.value.trim(),entry)); }
      catch(error){mediaFeedback=error.message;mediaRendered=null;renderMediaAssets();}
    });bind.disabled=blocked;actions.append(path,options,bind);
    const remove=diagnosticButton('Удалить',()=>{
      if(mediaBusy)return;mediaDelete=entry;
      const uses=mediaUsage(entry.id);
      document.querySelector('#media-delete-text').textContent=`Удалить ${entry.name} из браузера?${uses ? ` Файл нужен ${formatUIInteger(uses)} версиям кода. Для их запуска потребуется выбрать его снова.` : ''} Уже сохранённые автономные HTML сохранят файл.`;
      document.querySelector('#media-delete-confirm').hidden=false;
      document.querySelector('#media-delete-no').focus({preventScroll:true});
    });remove.disabled=mediaBusy;actions.append(remove);li.append(actions);return li;
  }));
}

function initMediaAssets() {
  document.querySelector('#media-add').addEventListener('click',()=>{if(expertMode && !mediaBusy && !modeBusy)document.querySelector('#media-input').click();});
  document.querySelector('#media-input').addEventListener('change',async event=>{
    const files=[...(event.target.files || [])];event.target.value='';
    if(!expertMode || mediaBusy || !files.length)return;
    mediaBusy=true;mediaFeedback='Добавляю файлы…';renderMediaAssets();renderPromptMedia();
    let added=0;const errors=[];
    for(const file of files.slice(0,mediaLimits.count)) {
      try {const entry=await addMediaFile(file);selectUploadedPromptMedia(file,entry);added++;}catch(error){errors.push(`${file.name}: ${error.message}`);}
    }
    mediaBusy=false;mediaFeedback=`Добавлено: ${formatUIInteger(added)}.${errors.length?' '+errors.join(' '):''}`;
    if(files.length>mediaLimits.count)mediaFeedback+=' Остальные файлы не добавлены: выберите до 64 файлов.';
    promptMediaVersion++;mediaRendered=null;promptMediaRendered=null;diagnosticSnapshot=null;updateDiagnostics();updateAiControls();
  });
  document.querySelector('#media-delete-no').addEventListener('click',()=>{mediaDelete=null;document.querySelector('#media-delete-confirm').hidden=true;});
  document.querySelector('#media-delete-yes').addEventListener('click',async()=>{
    const entry=mediaDelete;if(!entry || mediaBusy || !expertMode)return;
    mediaBusy=true;document.querySelector('#media-delete-yes').disabled=true;document.querySelector('#media-delete-no').disabled=true;renderMediaAssets();
    try {
      if(mediaPersisted.has(entry.id))await mediaTransaction('readwrite',store=>store.delete(entry.id));
      mediaCache.delete(entry.id);mediaPersisted.delete(entry.id);mediaFeedback='Файл удалён. Код и история сохранены.';
    } catch {mediaFeedback='Не удалось удалить файл из браузера. Он остался в списке.';}
    finally {mediaBusy=false;promptMediaVersion++;mediaDelete=null;document.querySelector('#media-delete-confirm').hidden=true;document.querySelector('#media-delete-yes').disabled=false;document.querySelector('#media-delete-no').disabled=false;mediaRendered=null;diagnosticSnapshot=null;updateDiagnostics();updateAiControls();}
  });
}
