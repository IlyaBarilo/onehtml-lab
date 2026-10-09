// Media names in a prompt refer to chosen bytes, never to executable markup.
let promptMediaSelection = new Map();
let promptMediaSent = [];
let promptMediaRendered = null;
let promptMediaFeedback = '';
let promptMediaDelete = null;
let promptMediaVersion = 0;
const promptMediaUrls = new Set();
const promptMediaKey = 'onehtml-lab-prompt-media';

function promptMediaName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 170 && name === name.trim()
    && !/[\\/\u0000-\u001f\u007f]/.test(name) && Boolean(mediaTypes[name.split('.').at(-1).toLowerCase()]);
}

function promptMediaFiles() { return [...promptMediaSelection].map(([name,id])=>({name,id})); }
function promptMediaAutoName(type,extra=[]) {
  const names=[...mediaCache.values()].map(entry=>entry.name).concat([...promptMediaSelection.keys()],promptMediaSent.map(file=>file.name),extra);
  const used=new Set(names.map(name=>/^0*(\d+)\./.exec(name)?.[1]));
  let serial=1;while(used.has(String(serial)))serial++;
  const ext=type==='image/jpeg'?'jpg':Object.keys(mediaTypes).find(ext=>mediaTypes[ext]===type);
  return `${serial}.${ext}`;
}
function promptMediaUrl(name) { return encodeURIComponent(name).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase()); }
function promptMediaPath(path) {
  try { const name=decodeURIComponent(path); return promptMediaName(name) ? name : ''; } catch { return ''; }
}
function promptMediaReadFiles(value) {
  if (!Array.isArray(value) || value.length > mediaLimits.count) return [];
  const names=new Set();
  return value.filter(file=>file && promptMediaName(file.name) && /^[a-f\d]{64}$/.test(file.id) && !names.has(file.name) && names.add(file.name))
    .map(({name,id})=>({name,id}));
}
function savePromptMediaState() {
  try { localStorage.setItem(promptMediaKey,JSON.stringify({selected:promptMediaFiles(),sent:promptMediaSent})); }
  catch { promptMediaFeedback='Выбор файлов сохранится только в этом сеансе.'; }
}
function loadPromptMediaState() {
  try {
    const value=JSON.parse(localStorage.getItem(promptMediaKey));
    promptMediaSelection=new Map(promptMediaReadFiles(value?.selected).map(file=>[file.name,file.id]));
    promptMediaSent=promptMediaReadFiles(value?.sent);
  } catch { /* The working HTML and its versioned bindings remain independent. */ }
}
function selectUploadedPromptMedia(file,entry) {
  const name=file.name;
  if (!promptMediaName(name)) { promptMediaFeedback='Имя файла не подходит для ссылки в запросе. Используйте имя без пути и управляющих символов.'; return; }
  const previous=promptMediaSelection.get(name);
  if (previous && previous!==entry.id) {
    promptMediaFeedback=`У файлов одинаковое имя: ${name}. Отметьте нужную копию в списке.`;
    return;
  }
  promptMediaSelection.set(name,entry.id);savePromptMediaState();promptMediaRendered=null;
}
function rememberPromptMedia(files) {
  promptMediaSent=promptMediaReadFiles(files);savePromptMediaState();
}

function bindPromptMedia(code) {
  const files=promptMediaSent.length ? promptMediaSent : promptMediaFiles();
  if (!files.length) return code;
  const scan=scanMedia(code);
  if (scan.reason) { promptMediaFeedback=scan.reason; return code; }
  let result=code;const missing=[];
  try {
    for (const ref of new Map(scan.refs.map(ref=>[ref.path,ref])).values()) {
      if (scan.links.some(link=>link.path===ref.path)) continue;
      const name=promptMediaPath(ref.path),file=files.find(file=>file.name===name);
      if (!file) { if(name)missing.push(name);continue; }
      const entry=mediaCache.get(file.id) || {id:file.id,name:file.name,type:mediaTypes[file.name.split('.').at(-1).toLowerCase()]};
      result=attachMedia(result,ref.path,entry);
      if (!mediaCache.has(file.id)) missing.push(file.name);
    }
    promptMediaFeedback=missing.length ? 'Нет выбранных файлов: '+[...new Set(missing)].join(', ')+'. Проверьте имена или выберите файлы снова.' : '';
  } catch(error) { promptMediaFeedback=error.message;result=code; }
  promptMediaRendered=null;
  return result;
}
function promptMediaNotice() { if(promptMediaFeedback)inform(promptMediaFeedback,true,true); }

function promptMediaReplacement(ref,url) {
  return {from:ref.from,to:ref.to,text:ref.context==='attribute' ? '"'+url+'"' : ref.context==='css-attribute' ? 'url(&quot;'+url+'&quot;)' : 'url("'+url+'")'};
}

async function planPromptMedia(code,selected,shorten) {
  const scan=scanMedia(code),files=new Map(selected.map(file=>[file.name,file.id])),changes=[],notes=[];
  if (scan.reason) throw Error(scan.reason);
  const add=(name,id)=>{
    // An explicit selection of another copy with the same name is intentional.
    if (!files.has(name))files.set(name,id);
    if(files.size>mediaLimits.count)throw Error('В запросе допускается до 64 медиафайлов.');
  };
  let missing=false;
  for(const ref of mediaBindings(code).filter(ref=>ref.id)) {
    if(!ref.entry){missing=true;notes.push('Файл отсутствует: '+ref.path);continue;}
    const name=selected.find(file=>file.id===ref.id)?.name || ref.entry.name;
    if(!promptMediaName(name))continue;
    const collision=files.get(name);
    const another=mediaBindings(code).find(other=>other.id && other.id!==ref.id && other.entry?.name===name);
    if(another && !selected.some(file=>file.name===name))throw Error('В коде разные файлы с одинаковым именем: '+name+'. Выберите нужную копию в «Медиа».');
    add(name,collision || ref.id);changes.push(promptMediaReplacement(ref,promptMediaUrl(name)));
  }
  if(scan.marker && !missing)changes.push({...scan.marker,text:''});
  if(shorten) {
    let total=0;const seen=new Set();
    for(const ref of scan.embedded) {
      try {
        const match=/^data:(image\/(?:png|jpeg|webp)|audio\/(?:mpeg|ogg|wav));base64,([A-Za-z\d+/=\s]+)$/i.exec(ref.path);
        if(!match)continue;
        const base64=match[2].replace(/\s/g,'');
        if(base64.length>Math.ceil(mediaLimits.file/3)*4)throw Error('Медиа больше 8 МБ.');
        const binary=atob(base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0)),type=match[1].toLowerCase();
        if(!type.startsWith(ref.kind+'/'))throw Error('Тип data URL не подходит к подключению.');
        if(!bytes.length || bytes.length>mediaLimits.file || !mediaSignature(bytes,type))throw Error('Не удалось проверить формат медиа.');
        const id=await mediaHash(bytes);
        if(!seen.has(id)){seen.add(id);total+=bytes.length;}
        if(total>mediaLimits.document)throw Error('Для сокращения медиа допускается до 16 МБ.');
        let entry=mediaCache.get(id),name=selected.find(file=>file.id===id)?.name || entry?.name;
        if(!promptMediaName(name)) {
          name=promptMediaAutoName(type,[...files.keys()]);
        }
        if(!entry)entry=await addMediaFile({name,size:bytes.length,arrayBuffer:async()=>bytes.buffer});
        add(name,id);changes.push(promptMediaReplacement(ref,promptMediaUrl(name)));
      } catch(error) {notes.push(error.message+' Часть data URL оставлена в коде.');}
    }
  }
  const result=[...files].map(([name,id])=>({name,id}));
  const unavailable=result.filter(file=>!mediaCache.has(file.id));
  if(unavailable.length)throw Object.assign(Error('Файл отсутствует: '+unavailable.map(file=>file.name).join(', ')+'. В «Медиа» добавьте его снова или снимите отметку включения в запрос.'),{missingMedia:true});
  if([...new Set(result.map(file=>file.id))].reduce((sum,id)=>sum+mediaCache.get(id).blob.size,0)>mediaLimits.document)throw Error('Медиа запроса должны занимать не больше 16 МБ.');
  return {html:moduleReplace(code,changes),files:result,notes:[...new Set(notes)]};
}

function promptMediaIntro(files) {
  if(!files.length)return '';
  return 'Доступные медиафайлы:\n'+files.map(file=>'- '+file.name+(mediaDimensions(mediaCache.get(file.id)) ? ' — '+mediaDimensions(mediaCache.get(file.id)) : '')).join('\n')
    +'\n\nВ ответе используй ссылки с исходными именами файлов, без подкаталогов. При сохранении файлы будут встроены в HTML в формате data URL. Не кодируй содержимое файлов самостоятельно. Для имён с пробелами или специальными символами используй URL-кодирование.'
    +'\nПодключай изображения через img src или url(...) во встроенном CSS, звук — через audio src либо source внутри audio. Для Canvas используй изображение из img; для звука обращайся к audio по id. Не создавай пути к этим файлам в JavaScript, srcset или внешнем CSS.\n\n';
}

async function promptClipboardImage(blob) {
  if (!blob.size || blob.size > mediaLimits.file) throw Error('Изображение должно быть не больше 8 МБ.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = ['image/png','image/jpeg','image/webp'].find(type=>mediaSignature(bytes,type));
  if (!type || (blob.type && blob.type !== 'application/octet-stream' && blob.type !== type)) throw Error('Вставьте изображение PNG, JPEG или WebP. Формат должен соответствовать содержимому.');
  const id = await mediaHash(bytes), existing = mediaCache.get(id);
  let name = promptMediaFiles().find(file=>file.id===id && /^\d+\./.test(file.name))?.name || existing?.name;
  if (!/^\d+\./.test(name || '') || !promptMediaName(name) || (promptMediaSelection.has(name) && promptMediaSelection.get(name)!==id)) name=promptMediaAutoName(type);
  return {name,size:bytes.length,arrayBuffer:async()=>bytes.buffer};
}

function promptImagePasteFallback(message) {
  promptMediaFeedback=message;
  document.querySelector('#media-paste-fallback').hidden=false;
  document.querySelector('#media-paste-field').focus({preventScroll:true});
}

async function pastePromptImages(read) {
  if (!expertMode || mediaBusy || modeBusy) return;
  mediaBusy=true;promptMediaFeedback='Вставляю изображение…';renderPromptMedia();renderMediaAssets();
  try {
    const blobs=await read();
    if (!blobs.length) throw Error('В буфере нет изображения PNG, JPEG или WebP. Скопируйте саму картинку или выберите файл.');
    let added=0;const errors=[];
    for (const blob of blobs.slice(0,mediaLimits.count)) {
      try {const file=await promptClipboardImage(blob),entry=await addMediaFile(file);selectUploadedPromptMedia(file,entry);added++;}
      catch(error){errors.push(error.message);}
    }
    promptMediaFeedback=`Добавлено изображений: ${formatUIInteger(added)}.${errors.length?' '+[...new Set(errors)].join(' '):''}`;
    if (blobs.length>mediaLimits.count) promptMediaFeedback+=' Остальные не добавлены: вставляйте до 64 изображений.';
    if (added) {document.querySelector('#media-paste-fallback').hidden=true;document.querySelector('#media-paste-field').value='';}
  } catch(error) {
    const denied=['NotAllowedError','SecurityError','NotFoundError'].includes(error.name);
    promptImagePasteFallback(denied ? 'Браузер не разрешил чтение буфера. Попробуйте обычную вставку в поле ниже или «Добавить файлы».' : error.message);
  } finally {
    mediaBusy=false;promptMediaVersion++;mediaRendered=null;promptMediaRendered=null;diagnosticSnapshot=null;updateDiagnostics();updateAiControls();
  }
}

function releasePromptMediaPreviews() {
  for(const audio of document.querySelectorAll('#media-prompt-list audio'))audio.pause();
  for(const url of promptMediaUrls)URL.revokeObjectURL(url);
  promptMediaUrls.clear();promptMediaRendered=null;
}
function renderPromptMedia() {
  renderMediaStrip();
  const panel=document.querySelector('#media-panel');
  if(currentPanel()!==panel || !expertMode){if(promptMediaRendered!==null)releasePromptMediaPreviews();return;}
  const key=JSON.stringify([promptMediaFiles(),[...mediaCache.keys()],mediaBusy,promptMediaFeedback]);
  if(key===promptMediaRendered)return;
  releasePromptMediaPreviews();promptMediaRendered=key;
  document.querySelector('#media-prompt-add').disabled=mediaBusy || modeBusy;
  document.querySelector('#media-prompt-paste').disabled=mediaBusy || modeBusy;
  document.querySelector('#media-prompt-feedback').textContent=promptMediaFeedback || mediaFeedback;
  const names=promptMediaFiles().map(file=>file.name).join('\n');
  const field=document.querySelector('#media-prompt-names');field.value=names;field.rows=Math.min(5,Math.max(1,promptMediaSelection.size));
  document.querySelector('#media-prompt-copy').disabled=!names || mediaBusy;
  document.querySelector('#media-prompt-ai').disabled=mediaBusy;
  const rows=mediaPromptRows();
  document.querySelector('#media-prompt-list').replaceChildren(...rows.map(({entry,name})=>{
    const li=document.createElement('li');li.className='prompt-media-row';li.dataset.mediaId=entry.id;li.dataset.mediaName=name;
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=promptMediaSelection.get(name)===entry.id;check.disabled=mediaBusy || !promptMediaName(name);check.setAttribute('aria-label',`Включить ${name} в запрос`);
    check.addEventListener('change',()=>{if(check.checked)promptMediaSelection.set(name,entry.id);else promptMediaSelection.delete(name);promptMediaFeedback='';savePromptMediaState();promptMediaRendered=null;renderPromptMedia();});
    const text=document.createElement('span'),title=document.createElement('strong');title.textContent=name;
    const note=document.createElement('span');note.className='diagnostic-note';note.textContent=entry.blob ? [mediaDimensions(entry),diagnosticSize(entry.blob.size)].filter(Boolean).join(' · ')+(mediaPersisted.has(entry.id)?'':' · Только этот сеанс') : 'Файл отсутствует — выберите снова';text.append(title,note);label.append(check,text);li.append(label);
    if(!entry.blob)return li;
    const actions=document.createElement('div');actions.className='media-prompt-item-actions diagnostic-actions';
    const copy=diagnosticButton('Копировать имя',()=>void copyOrSelect(name,'Имя файла скопировано.'));actions.append(copy);
    if(entry.type.startsWith('image/')) {const resize=diagnosticButton('Уменьшить',()=>openImageEdit(entry,name));resize.disabled=mediaBusy;actions.append(resize);}
    const remove=diagnosticButton('',()=>{
      if(mediaBusy)return;promptMediaDelete=entry;
      document.querySelector('#media-prompt-delete-text').textContent=`Удалить ${name} из браузера?${mediaUsage(entry.id)?' Файл используется в коде или истории. Для запуска этих версий потребуется выбрать его снова.':''} Уже сохранённые автономные HTML сохранят файл.`;
      document.querySelector('#media-prompt-delete').hidden=false;document.querySelector('#media-prompt-delete-no').focus({preventScroll:true});
    });remove.className='expert-icon-button';remove.disabled=mediaBusy;remove.title=`Удалить ${name}`;remove.setAttribute('aria-label',`Удалить ${name}`);remove.append(document.querySelector('#clear svg').cloneNode(true));li.append(remove);
    const url=URL.createObjectURL(entry.blob);promptMediaUrls.add(url);
    if(entry.type.startsWith('image/')){const image=document.createElement('img');image.src=url;image.alt=name;image.loading='lazy';image.className='media-thumbnail';li.append(image);}
    else{const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;audio.setAttribute('aria-label',`Прослушать ${name}`);audio.addEventListener('error',()=>{note.textContent+=' · Прослушивание недоступно в этом браузере.';},{once:true});li.append(audio);}
    li.append(actions);return li;
  }));
}
function openPromptMedia(nested=false) {
  if(!expertMode || modeBusy || extractionOpen)return;
  promptMediaDelete=null;document.querySelector('#media-prompt-delete').hidden=true;
  showWorkspacePanel(document.querySelector('#media-panel'),nested);
}
function initPromptMedia() {
  initMediaImages();
  document.querySelector('#media-open').addEventListener('click',()=>openPromptMedia());
  document.querySelector('#ai-media-open').addEventListener('click',()=>openPromptMedia(true));
  document.querySelector('#media-prompt-close').addEventListener('click',()=>closeWorkspacePanel());
  document.querySelector('#media-prompt-add').addEventListener('click',()=>{if(!mediaBusy)document.querySelector('#media-input').click();});
  document.querySelector('#media-prompt-paste').addEventListener('click',()=>void pastePromptImages(async()=>{
    if (!navigator.clipboard?.read) throw Error('В этом браузере кнопка не может прочитать изображение. Попробуйте обычную вставку в поле ниже или «Добавить файлы».');
    const items=await navigator.clipboard.read(),blobs=[];
    for (const item of items.slice(0,mediaLimits.count)) {
      const type=['image/png','image/jpeg','image/webp'].find(type=>item.types.includes(type));
      if(type)blobs.push(await item.getType(type));
    }
    return blobs;
  }));
  document.querySelector('#media-panel').addEventListener('paste',event=>{
    const files=[...(event.clipboardData?.files || [])].filter(file=>file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name));
    if(!files.length)return;
    event.preventDefault();void pastePromptImages(async()=>files);
  });
  document.querySelector('#media-paste-field').addEventListener('input',event=>{
    event.target.value='';promptMediaFeedback='Вставлен текст, а не изображение. Скопируйте саму картинку или используйте «Добавить файлы».';promptMediaRendered=null;renderPromptMedia();
  });
  document.querySelector('#media-prompt-copy').addEventListener('click',()=>{rememberPromptMedia(promptMediaFiles());void copyOrSelect(document.querySelector('#media-prompt-names').value,'Имена файлов скопированы.');});
  document.querySelector('#media-prompt-ai').addEventListener('click',()=>{
    if(workspacePanels.at(-2)?.panel===aiDialog)closeWorkspacePanel();
    else openAiPrompts(codeField.value.trim()?'change':'create');
  });
  document.querySelector('#media-prompt-delete-no').addEventListener('click',()=>{promptMediaDelete=null;document.querySelector('#media-prompt-delete').hidden=true;});
  document.querySelector('#media-prompt-delete-yes').addEventListener('click',async()=>{
    const entry=promptMediaDelete;if(!entry || mediaBusy || !expertMode)return;
    mediaBusy=true;document.querySelector('#media-prompt-delete-yes').disabled=true;document.querySelector('#media-prompt-delete-no').disabled=true;renderPromptMedia();
    try{if(mediaPersisted.has(entry.id))await mediaTransaction('readwrite',store=>store.delete(entry.id));mediaCache.delete(entry.id);mediaPersisted.delete(entry.id);promptMediaFeedback='Файл удалён. Код и история сохранены.';}
    catch{promptMediaFeedback='Не удалось удалить файл из браузера. Он остался в списке.';}
    finally{mediaBusy=false;promptMediaVersion++;promptMediaDelete=null;document.querySelector('#media-prompt-delete').hidden=true;document.querySelector('#media-prompt-delete-yes').disabled=false;document.querySelector('#media-prompt-delete-no').disabled=false;promptMediaRendered=null;diagnosticSnapshot=null;updateDiagnostics();updateAiControls();}
  });
}
