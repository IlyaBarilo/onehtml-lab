const preparationCatalog = [
  ['three@0.128.0','Для прежних игр на Three.js r128.'],
  ['three@0.160.0','Обычный script; подходит для встроенного теста.'],
  ['three-esm@0.160.0:three.module.js','Модуль Three.js для import и 3D-физики.'],
  ['three-gltf@0.160.0','GLB/glTF: загрузчик, ядро и зависимости одной версии.'],
  ['matter-js@0.20.0','2D-физика.'],
  ['phaser@3.90.0','Игровой движок Phaser 3.'],
  ['phaser@4.2.1','Игровой движок Phaser 4.'],
  ['cannon-es@0.20.0','3D-физика; графика подключается отдельно.'],
  ['@dimforge/rapier3d-compat@0.21.0','3D-физика WebAssembly; встроенный WASM, графика отдельно.'],
  ['@babylonjs/havok@1.3.14','3D-физика для Babylon.js. При загрузке и встраивании также сохраняется WASM.'],
  ['@google/model-viewer@4.4.0','Карточка GLB-экспоната: камера, анимация, подписи.'],
  ['aframe@1.8.0','Виртуальная выставка и 3D-сцены через HTML.'],
  ['tone@15.1.22','Музыка, ритм, синтезаторы и эффекты. Для импорта нужна полная лицензия сборки с уведомлениями её компонентов.'],
  ['pixi.js@8.22.0','2D-графика, изображения, маски и фильтры. Для предпросмотра также нужен модуль совместимости CSP. Для импорта нужна полная лицензия сборки с уведомлениями компонентов.'],
  ['pixi.js@8.22.0:unsafe-eval','Официальное дополнение PixiJS для работы без eval в изолированном предпросмотре. Подключается после ядра той же версии.'],
  ['babylonjs@9.30.0','3D-движок Babylon.js.'],
  ['babylonjs-loaders@9.30.0:glTF2','GLB/glTF для Babylon.js; также нужно ядро.'],
  ['babylonjs-loaders@9.30.0:all','Все загрузчики Babylon.js; альтернатива glTF2.']
];
const experimentalPreparationCatalog = [
  ['p5@2.3.4','Экспериментальная. Генеративная графика и интерактивные композиции. LGPL: исходники скачиваются от разработчиков и сохраняются вместе с копией.']
];
const preparationSelection = new Set();
let preparationController = null, preparationDownloads = [], preparationRawKey = null;
function preparationDependencies(keys) {
  const result = new Set(keys);
  for (const key of keys) {
    if (key.startsWith('babylonjs-loaders@9.30.0:')) result.add('babylonjs@9.30.0');
    if (key === '@babylonjs/havok@1.3.14') result.add('babylonjs@9.30.0');
    if (key === 'three-gltf@0.160.0') result.add('three-esm@0.160.0:three.module.js');
  }
  return [...result];
}
function preparationMessage(text) { document.querySelector('#library-preparation-status').textContent = text; }
function preparationControls() {
  const blocked = diagnosticCacheBusy || Boolean(pendingLibraryAction);
  for (const element of document.querySelectorAll('#library-preparation [data-library-mutation], #library-preparation input[type=checkbox], #library-preparation select, #library-download-all, #library-import-archive, #library-import-pack, #library-export-files-all, #library-export-file-list button')) element.disabled = blocked || element.hasAttribute('data-library-downloaded') || (element.hasAttribute('data-library-ready') && !diagnosticReportReady);
  document.querySelector('#library-download-selected').disabled = blocked || !preparationSelection.size;
  document.querySelector('#library-export-selected').disabled = blocked || ![...preparationSelection].some(key=>libraryCache.has(key));
  document.querySelector('#library-export-all').disabled = blocked || !libraryCache.size;
  const cancel = document.querySelector('#library-preparation-cancel');
  cancel.hidden = !preparationController; cancel.disabled = !preparationController;
  document.querySelector('#library-download-selected').hidden = Boolean(preparationController);
  updateLibraryBrowserSelection();
}
function renderLibraryPreparation() { renderLibraryBrowser(); preparationControls(); }
async function preparationOperation(action) {
  if (!expertMode || diagnosticCacheBusy || pendingLibraryAction) return;
  closeLibraryMenu();
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
      try {
        const entry = libraryCache.get(key);
        let ready = false;
        if (entry && !entry.cacheError) {
          try { ready = Boolean(await readCachedLibrary({ key })); }
          catch (error) { if (!error.libraryCacheRead) throw error; }
        }
        if (!ready) await downloadLibrary(ref,{signal:preparationController.signal,onProgress:text=>preparationMessage(`${ref.title} · ${text}`)});
        done++;
      }
      catch(error) { if(preparationController.signal.aborted) break; failures.push(libraryDownloadMessage(error, ref)); }
      renderLibraryPreparation();
    }
    const temporary = chosen.filter(key=>libraryCache.has(key) && persistedLibraries.get(key)!==libraryCache.get(key)).length;
    preparationMessage(`${preparationController.signal.aborted ? 'Загрузка остановлена. ' : ''}Готово: ${formatUIInteger(done)} из ${formatUIInteger(chosen.length)}.${temporary ? ` Только этот сеанс: ${formatUIInteger(temporary)}; сохраните набор в файлы.` : ''}${failures.length ? '\nНе загружены: ' + failures.join('\n') : ''}`);
    if (!failures.length && !preparationController.signal.aborted) libraryCacheProgress('Выбранные библиотеки готовы.');
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
async function preparationExport(all, explicitKeys = null) {
  await preparationOperation(async () => {
    const keys = explicitKeys ? preparationDependencies(explicitKeys) : all ? [...libraryCache.keys()] : preparationDependencies([...preparationSelection]);
    if(!keys.length) throw Error('Выберите сохранённые библиотеки.');
    preparationMessage('Читаю выбранные сохранённые библиотеки…');
    const entries = [];
    for (const key of keys) {
      const entry = await readCachedLibrary({ key });
      if (!entry) throw Error('Сначала загрузите библиотеку: ' + (libraryCatalogReference(key)?.title || key));
      entries.push(entry);
    }
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
      document.querySelector('#library-export-files').scrollIntoView({ block: 'nearest' });
      preparationMessage(`${formatUIInteger(files.length)} файлов · ${diagnosticSize(size)}. Скачайте их в одну папку. Для установки выберите манифест вместе со всеми файлами.${warning ? ' ' + warning : ''}`);
    }
  });
}
function initLibraryPreparation() {
  initLibraryBrowser();
  document.querySelector('#library-download-selected').addEventListener('click',()=>void preparationDownload([...preparationSelection]));
  document.querySelector('#library-download-all').addEventListener('click',()=>void preparationDownload([
    ...preparationCatalog, ...(document.querySelector('#library-include-experimental').checked ? experimentalPreparationCatalog : [])
  ].map(([key])=>key)));
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
