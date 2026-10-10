const preparationCatalog = [
  ['three@0.128.0','Для прежних игр на Three.js r128.'],
  ['three@0.160.0','Обычный script; подходит для встроенного теста.'],
  ['three-esm@0.160.0:three.module.js','Модуль Three.js для import и 3D-физики.'],
  ['three-gltf@0.160.0','GLB/glTF: загрузчик, ядро и зависимости одной версии.'],
  ['matter-js@0.20.0','2D-физика.'],
  ['phaser@3.90.0','Игровой движок Phaser 3.'],
  ['phaser@4.2.1','Игровой движок Phaser 4.'],
  ['cannon-es@0.20.0','3D-физика; графика подключается отдельно.'],
  ['babylonjs@9.30.0','3D-движок Babylon.js.'],
  ['babylonjs-loaders@9.30.0:glTF2','GLB/glTF для Babylon.js; также нужно ядро.'],
  ['babylonjs-loaders@9.30.0:all','Все загрузчики Babylon.js; альтернатива glTF2.']
];
const preparationSelection = new Set();
let preparationController = null, preparationDownloads = [], preparationRawKey = null;
function preparationDependencies(keys) {
  const result = new Set(keys);
  for (const key of keys) {
    if (key.startsWith('babylonjs-loaders@9.30.0:')) result.add('babylonjs@9.30.0');
    if (key === 'three-gltf@0.160.0') result.add('three-esm@0.160.0:three.module.js');
  }
  return [...result];
}
function preparationMessage(text) { document.querySelector('#library-preparation-status').textContent = text; }
function preparationControls() {
  const blocked = diagnosticCacheBusy || Boolean(pendingLibraryAction);
  for (const element of document.querySelectorAll('#library-preparation button, #library-preparation input, #library-preparation select')) element.disabled = blocked;
  document.querySelector('#library-download-selected').disabled = blocked || !preparationSelection.size;
  document.querySelector('#library-export-selected').disabled = blocked || ![...preparationSelection].some(key=>libraryCache.has(key));
  document.querySelector('#library-export-all').disabled = blocked || !libraryCache.size;
  const cancel = document.querySelector('#library-preparation-cancel');
  cancel.hidden = !preparationController; cancel.disabled = !preparationController;
}
function renderLibraryPreparation() {
  const list = document.querySelector('#library-preparation-list'); if (!list) return;
  const catalog = [...preparationCatalog];
  for (const entry of libraryCache.values()) if (!catalog.some(([key])=>key===entry.key)) catalog.push([entry.key,'Сохранённая копия.']);
  list.replaceChildren(...catalog.map(([key,note]) => {
    const ref = libraryCatalogReference(key), entry = libraryCache.get(key);
    const row = document.createElement('li'); row.className = 'library-preparation-row';
    const label = document.createElement('label'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.dataset.libraryKey = key; checkbox.checked = preparationSelection.has(key);
    checkbox.addEventListener('change', () => { if(checkbox.checked) preparationSelection.add(key); else preparationSelection.delete(key); preparationControls(); });
    const text = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('span');
    name.textContent = ref?.title || entry?.title || key;
    const bytes = entry ? diagnosticCacheBytes(entry) : ref?.downloadBytes;
    const state = entry ? persistedLibraries.get(key)===entry ? 'В браузере' : 'Только этот сеанс' : 'Не загружена';
    detail.textContent = `${bytes ? diagnosticSize(bytes) : 'Размер неизвестен'} · ${state}\n${note}`;
    text.append(name, detail); label.append(checkbox,text); row.append(label);
    if (ref) {
      const button = diagnosticButton('Из файлов…', () => {
        if(diagnosticCacheBusy || pendingLibraryAction) return;
        preparationRawKey = key;
        preparationMessage(`Выберите файлы именно для «${ref.title}»: JS и полный LICENSE${libraryNeedsNotice(ref) ? ' и NOTICE' : ''}. Для модулей — все зависимости с исходными именами.`);
        document.querySelector('#library-preparation-raw').click();
      });
      row.append(button);
    }
    return row;
  }));
  preparationControls();
}
async function preparationOperation(action) {
  if (!expertMode || diagnosticCacheBusy || pendingLibraryAction) return;
  diagnosticCacheBusy = true; renderDiagnosticCache();
  try { await action(); }
  catch(error) { preparationMessage(error?.message || 'Не удалось подготовить библиотеки.'); }
  finally { diagnosticCacheBusy = false; preparationController = null; diagnosticSnapshot = null; updateDiagnostics(); renderLibraryPreparation(); }
}
async function preparationDownload(keys) {
  await preparationOperation(async () => {
    preparationController = new AbortController(); preparationControls();
    const chosen = preparationDependencies(keys), failures = []; let done=0;
    for (const key of chosen) {
      if(preparationController.signal.aborted) break;
      const ref = libraryCatalogReference(key); if(!ref) continue;
      preparationMessage(`Подготовка ${formatUIInteger(done+1)} из ${formatUIInteger(chosen.length)}: ${ref.title}${ref.downloadBytes ? ' · ' + diagnosticSize(ref.downloadBytes) : ''}`);
      try { if(!libraryCache.has(key)) await downloadLibrary(ref,{signal:preparationController.signal}); done++; }
      catch(error) { if(preparationController.signal.aborted) break; failures.push(ref.title + ': ' + error.message); }
      renderLibraryPreparation();
    }
    const temporary = chosen.filter(key=>libraryCache.has(key) && persistedLibraries.get(key)!==libraryCache.get(key)).length;
    preparationMessage(`${preparationController.signal.aborted ? 'Загрузка остановлена. ' : ''}Готово: ${formatUIInteger(done)} из ${formatUIInteger(chosen.length)}.${temporary ? ` Только этот сеанс: ${formatUIInteger(temporary)}; сохраните набор в файлы.` : ''}${failures.length ? '\nНе загружены: ' + failures.join('\n') : ''}`);
  });
}
async function preparationImport(input, key) {
  const selected = [...input.files]; if(!selected.length) return;
  try { await preparationOperation(async () => {
    preparationMessage('Проверяю файлы, лицензии и зависимости…');
    let files;
    if (selected.length===1 && /\.zip$/i.test(selected[0].name)) files = await readLibraryZip(new Uint8Array(await selected[0].arrayBuffer()));
    else files = await Promise.all(selected.map(async file=>({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())})));
    const entries = key ? await readRawLibraryFiles(libraryCatalogReference(key),files) : await readLibraryPack(files);
    const persistent = await installLibraryPack(entries);
    preparationMessage(`Установлено: ${formatUIInteger(entries.length)}. ${persistent ? 'Копии сохранены в браузере.' : 'Только этот сеанс: браузер не сохранил копии. Сохраните набор в файлы.'}`);
    for (const entry of entries) preparationSelection.add(entry.key);
  }); } finally { input.value = ''; }
}
function preparationFileDownload(file) {
  const type = /\.js$/i.test(file.name) ? 'text/javascript' : /\.json$/i.test(file.name) ? 'application/json' : 'text/plain';
  downloadBlob(new Blob([file.bytes],{type}),file.name);
}
async function preparationExport(all) {
  await preparationOperation(async () => {
    const keys = all ? [...libraryCache.keys()] : preparationDependencies([...preparationSelection]);
    if(!keys.length) throw Error('Выберите сохранённые библиотеки.');
    const entries = keys.map(key=> { const entry=libraryCache.get(key); if(!entry) throw Error('Сначала загрузите библиотеку: ' + (libraryCatalogReference(key)?.title || key)); return entry; });
    const files = await makeLibraryPack(entries), size = files.reduce((sum,file)=>sum+file.bytes.length,0);
    const warning = resourceSizeWarning(size,'cache');
    if(document.querySelector('#library-export-format').value==='zip') {
      preparationDownloads = []; document.querySelector('#library-export-files').hidden = true;
      downloadBlob(makeLibraryZip(files),'onehtml-libraries.zip');
      preparationMessage(`Сохраняю архив: ${diagnosticSize(size)} · ${formatUIInteger(entries.length)} библиотек. Внутри — манифест, JS, зависимости и лицензии.${warning ? ' ' + warning : ''}`);
    } else {
      preparationDownloads = files;
      const list = document.querySelector('#library-export-file-list');
      list.replaceChildren(...files.map(file => { const row=document.createElement('li');
        row.append(diagnosticButton(`${file.name} · ${diagnosticSize(file.bytes.length)}`,()=>preparationFileDownload(file))); return row; }));
      document.querySelector('#library-export-files').hidden = false;
      preparationMessage(`${formatUIInteger(files.length)} файлов · ${diagnosticSize(size)}. Скачайте их в одну папку. Для установки выберите манифест вместе со всеми файлами.${warning ? ' ' + warning : ''}`);
    }
  });
}
function initLibraryPreparation() {
  document.querySelector('#library-download-selected').addEventListener('click',()=>void preparationDownload([...preparationSelection]));
  document.querySelector('#library-download-all').addEventListener('click',()=>void preparationDownload(preparationCatalog.map(([key])=>key)));
  document.querySelector('#library-preparation-cancel').addEventListener('click',()=>preparationController?.abort());
  const input = document.querySelector('#library-preparation-input'), raw = document.querySelector('#library-preparation-raw'), archive = document.querySelector('#library-preparation-archive');
  document.querySelector('#library-import-archive').addEventListener('click',()=>archive.click());
  document.querySelector('#library-import-pack').addEventListener('click',()=>input.click());
  archive.addEventListener('change',()=>void preparationImport(archive));
  input.addEventListener('change',()=>void preparationImport(input));
  raw.addEventListener('change',()=>void preparationImport(raw,preparationRawKey));
  document.querySelector('#library-export-selected').addEventListener('click',()=>void preparationExport(false));
  document.querySelector('#library-export-all').addEventListener('click',()=>void preparationExport(true));
  document.querySelector('#library-export-files-all').addEventListener('click',()=> {
    for(const file of preparationDownloads) preparationFileDownload(file);
    preparationMessage('Разрешите браузеру скачивание нескольких файлов. Если скачались не все, используйте кнопки файлов ниже.');
  });
  renderLibraryPreparation();
}
