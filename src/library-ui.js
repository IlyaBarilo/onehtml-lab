// Presentation only: downloads, integrity, cache and file transfer stay in their existing modules.
let libraryBrowserTab = 'catalog', libraryBrowserCategory = 'all';
const libraryBrowserActive = new Map();
let libraryBrowserExpanded = null, libraryBrowserMenu = null;
const libraryIconPaths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  import: '<path d="M3 9V5h7l2 3h9v12H3V9m9 2v7m-3-3 3 3 3-3"/>',
  export: '<path d="M4 12v8h16v-8M12 16V3m-5 5 5-5 5 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  theme: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>'
};
function libraryIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = libraryIconPaths[name] || libraryIconPaths.code;
  return svg;
}
function libraryElement(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text != null) node.textContent = text; return node;
}
function libraryUIAction(name, label, action, iconOnly = false) {
  const button = diagnosticButton('', action); button.className = iconOnly ? 'library-icon-button' : 'library-secondary';
  button.setAttribute('aria-label', label); button.title = label; button.dataset.libraryMutation = '';
  button.append(libraryIcon(name)); if (!iconOnly) button.append(document.createTextNode(label));
  button.disabled = diagnosticCacheBusy || Boolean(pendingLibraryAction); return button;
}
function libraryUICategory(key = '') {
  if (/matter|cannon|rapier|havok/.test(key)) return 'physics';
  if (/tone/.test(key)) return 'sound';
  if (/phaser|pixi|p5/.test(key)) return '2d';
  if (/three|babylon|model-viewer|aframe/.test(key)) return '3d';
  return 'other';
}
const libraryCategoryNames = { '2d': '2D-графика', '3d': '3D-графика', physics: 'Физика', sound: 'Звук', other: 'Библиотека' };
function libraryUISize(bytes) {
  return Number.isFinite(bytes) ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(bytes / 1024)} КБ` : 'Размер неизвестен';
}
function libraryUIState(entry) {
  return entry?.cacheError ? 'Требует проверки' : entry ? persistedLibraries.get(entry.key) === entry ? 'В браузере' : 'Только этот сеанс' : 'Не скачана';
}
function libraryUIModels() {
  const catalog = [...preparationCatalog, ...experimentalPreparationCatalog];
  const experimental = new Set(experimentalPreparationCatalog.map(([key]) => key));
  const model = (key, note) => {
    const ref = libraryCatalogReference(key), entry = libraryCache.get(key);
    return { key, ref, entry, note, title: ref?.title || entry?.title || key, category: libraryUICategory(key), experimental: experimental.has(key), bytes: entry ? diagnosticCacheBytes(entry) : ref?.downloadBytes };
  };
  return {
    catalog: catalog.map(([key, note]) => model(key, note)),
    saved: [...libraryCache.values()].map(entry => model(entry.key, catalog.find(([key]) => key === entry.key)?.[1] || 'Сохранённая копия библиотеки.')),
    code: diagnosticLibraries.map((item, index) => ({ ...item, key: `code-${index}`, ref: item.reference, entry: libraryCache.get(item.usedKey), category: libraryUICategory(item.reference?.key || item.usedKey), codeItem: item }))
  };
}
function libraryUIMatches(item) {
  const query = document.querySelector('#library-search').value.trim().toLocaleLowerCase();
  return (libraryBrowserCategory === 'all' || item.category === libraryBrowserCategory)
    && (!query || `${item.title} ${item.key} ${item.path || ''} ${item.note || ''}`.toLocaleLowerCase().includes(query));
}
function libraryRawImport(ref) {
  if (diagnosticCacheBusy || pendingLibraryAction) return;
  preparationRawKey = ref.key;
  preparationMessage(`Выберите файлы именно для «${ref.title}»: JS и полный LICENSE${libraryNeedsNotice(ref) ? ' и NOTICE' : ''}. Для модулей — все зависимости с исходными именами.`);
  document.querySelector('#library-preparation-raw').click();
}
async function libraryP5Sources() {
  try {
    const copy = await readCachedLibrary({ key: 'p5@2.3.4' }), bytes = p5SourceArchive(copy);
    if (!bytes) throw Error();
    downloadBlob(new Blob([bytes], { type: 'application/gzip' }), 'p5-source-2.3.4.tar.gz');
  } catch { preparationMessage('Не удалось прочитать исходники p5.js. Загрузите копию библиотеки заново.'); }
}
function libraryUICodeDownload(item, inspectedCode) {
  if (diagnosticCacheBusy || pendingLibraryAction) return;
  if (!diagnosticReportReady || inspectedCode !== codeField.value) { diagnosticSnapshot = null; updateDiagnostics(); return; }
  requestLibraries({ missingLibraries: [item.ref] }, 'inspect');
}
function libraryUIDetails(item) {
  const box = libraryElement('div', 'library-detail-content');
  box.append(libraryElement('p', 'library-detail-category', libraryCategoryNames[item.category]), libraryElement('h3', '', item.title));
  const description = item.codeItem ? diagnosticLibraryDescription(item.codeItem) : item.note;
  box.append(libraryElement('p', 'library-detail-description', description));
  const properties = libraryElement('dl', 'library-properties');
  for (const [label, value] of [
    ['Размер', libraryUISize(item.bytes)],
    ['Лицензия', item.ref?.licenseType || item.entry?.licenseType || 'См. уведомления копии'],
    ['На устройстве', libraryUIState(item.entry)]
  ]) properties.append(libraryElement('dt', '', label), libraryElement('dd', '', value));
  box.append(properties);
  if (!item.codeItem && item.entry) {
    box.append(libraryUIAction('export', 'Сохранить копию', () => { void preparationExport(false, [item.key]); }));
    if (item.key === 'p5@2.3.4') box.append(libraryUIAction('code', 'Исходники p5', () => void libraryP5Sources()));
  }
  if (!item.codeItem && item.ref) {
    box.append(libraryUIAction('import', 'Установить из файлов…', () => libraryRawImport(item.ref)));
    if (!item.entry || item.entry.cacheError) box.append(libraryUIAction('download', 'Скачать эту версию', () => void preparationDownload([item.key])));
  }
  if (item.entry?.cacheError) box.append(libraryElement('p', 'library-detail-warning', item.entry.cacheError));
  const warning = resourceSizeWarning(item.bytes, 'library');
  if (warning) box.append(libraryElement('p', 'library-detail-warning', warning));
  if (!item.codeItem) {
    const source = item.entry?.sourceUrl || item.ref?.url || item.entry?.localPath || item.entry?.filename;
    if (source) box.append(libraryElement('p', 'library-detail-path', source));
    box.append(libraryElement('p', 'library-detail-footnote', item.experimental
      ? 'Экспериментальная: в общую загрузку входит только при включённой галочке в меню «Ещё».'
      : 'Код игры не меняется при подготовке копии. Встроить библиотеку или заменить её ссылкой можно инструментом «Библиотеки в коде».'));
  }
  return box;
}
function libraryUIRow(item, tab) {
  const row = libraryElement('li', 'library-browser-row'); row.dataset.browserKey = item.key;
  row.hidden = !libraryUIMatches(item);
  row.classList.toggle('is-active', libraryBrowserActive.get(tab) === item.key);
  const main = libraryElement('div', 'library-row-main');
  if (tab !== 'code') {
    const label = libraryElement('label', 'library-row-select'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.dataset.librarySelectKey = item.key;
    if (tab === 'catalog') checkbox.dataset.libraryKey = item.key;
    checkbox.checked = preparationSelection.has(item.key); checkbox.setAttribute('aria-label', `Выбрать ${item.title}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? preparationSelection.add(item.key) : preparationSelection.delete(item.key); preparationControls(); });
    label.append(checkbox); main.append(label);
  }
  const mark = { '2d': '2D', '3d': '3D', physics: 'Φ', sound: '♪', other: '{}' }[item.category];
  main.append(libraryElement('span', 'library-row-mark', mark));
  const details = diagnosticButton('', () => {
    libraryBrowserActive.set(tab, item.key);
    const id = `${tab}:${item.key}`; libraryBrowserExpanded = libraryBrowserExpanded === id ? null : id;
    renderLibraryPreparation();
  });
  details.className = 'library-row-details'; details.dataset.libraryFocus = `${tab}:${item.key}:details`;
  details.setAttribute('aria-label', `Сведения: ${item.title}`); details.setAttribute('aria-expanded', String(libraryBrowserExpanded === `${tab}:${item.key}`));
  details.append(libraryElement('strong', '', item.title));
  const meta = libraryElement('span', 'library-row-meta', `${libraryUISize(item.bytes)} · ${item.experimental ? 'Экспериментальная' : libraryCategoryNames[item.category]}`);
  if (item.codeItem?.filename) meta.textContent = `Файл: ${item.filename} · ${item.bytes != null ? diagnosticSize(item.bytes) : '(нет данных)'}`;
  details.append(meta);
  appendResourceWarning(details, resourceSizeWarning(item.bytes, 'library'));
  const stateText = item.codeItem ? item.state : libraryUIState(item.entry) + (tab === 'saved' && diagnosticLibraries.some(row => row.usedKey === item.key) ? ' · Нужна текущему коду' : '');
  const state = libraryElement('span', 'library-row-state');
  state.title = stateText; state.append(libraryElement('span', '', stateText));
  if (item.entry && !item.entry.cacheError) { state.classList.add('is-ready'); state.prepend(libraryIcon('check')); }
  main.append(details, state);
  let action;
  if (tab === 'saved') {
    action = libraryUIAction('trash', 'Удалить', () => confirmDiagnosticDelete([item.entry]), true);
    action.disabled ||= !diagnosticReportReady; action.dataset.libraryReady = '';
  } else if (tab === 'catalog') {
    action = libraryUIAction('download', `Скачать ${item.title}`, () => void preparationDownload([item.key]), true);
    if (item.entry && !item.entry.cacheError) {
      action.dataset.libraryDownloaded = ''; action.disabled = true; action.title = 'Библиотека уже скачана';
    }
  } else if (item.ref && !item.usedKey) {
    const inspectedCode = diagnosticSnapshot?.code;
    action = libraryUIAction(item.ref.url ? 'download' : 'import', item.ref.url ? 'Загрузить…' : 'Выбрать файл…', () => libraryUICodeDownload(item, inspectedCode), true);
    action.disabled ||= !diagnosticReportReady;
  }
  if (action) { action.dataset.libraryFocus = `${tab}:${item.key}:action`; main.append(action); }
  row.append(main);
  if (libraryBrowserExpanded === `${tab}:${item.key}`) {
    const expanded = libraryElement('div', 'library-inline-detail'); expanded.append(libraryUIDetails(item)); row.append(expanded);
  }
  return row;
}
function renderLibraryBrowser() {
  if (!document.querySelector('#library-preparation-list')) return;
  const focused = document.activeElement?.dataset.libraryFocus;
  const models = libraryUIModels();
  for (const [tab, items] of Object.entries(models)) {
    const visible = items.filter(libraryUIMatches);
    if (!visible.some(item => item.key === libraryBrowserActive.get(tab))) libraryBrowserActive.set(tab, visible[0]?.key);
    document.querySelector(`#library-count-${tab}`).textContent = formatUIInteger(items.length);
    const nodes = items.map(item => libraryUIRow(item, tab));
    if (tab === 'catalog') {
      document.querySelector('#library-preparation-list').replaceChildren(...nodes.filter((node, i) => !items[i].experimental));
      document.querySelector('#library-experimental-list').replaceChildren(...nodes.filter((node, i) => items[i].experimental));
      document.querySelector('#library-experimental-heading').hidden = !visible.some(item => item.experimental);
    } else document.querySelector(tab === 'code' ? '#diagnostic-library-list' : '#diagnostic-cache-list').replaceChildren(...nodes);
  }
  const current = models[libraryBrowserTab], visible = current.filter(libraryUIMatches);
  const active = visible.find(item => item.key === libraryBrowserActive.get(libraryBrowserTab));
  const inspector = document.querySelector('#library-browser-inspector');
  inspector.replaceChildren(active ? libraryUIDetails(active) : libraryElement('p', 'library-detail-footnote', 'Выберите библиотеку для просмотра сведений.'));
  document.querySelector('#library-browser-empty').hidden = Boolean(visible.length);
  document.querySelector('#library-visible-count').textContent = `Показано ${formatUIInteger(models.catalog.filter(libraryUIMatches).length)}`;
  if (focused) [...document.querySelectorAll('[data-library-focus]')].find(node => node.dataset.libraryFocus === focused)?.focus({ preventScroll: true });
  updateLibraryBrowserSelection();
}
function updateLibraryBrowserSelection() {
  const root = document.querySelector('#library-preparation'); if (!root) return;
  // Discard only entries no longer in the catalog or cache, retaining selections hidden by a filter.
  const keys = new Set([...preparationCatalog, ...experimentalPreparationCatalog].map(([key]) => key).concat([...libraryCache.keys()]));
  for (const key of preparationSelection) if (!keys.has(key)) preparationSelection.delete(key);
  for (const checkbox of root.querySelectorAll('[data-library-select-key]')) checkbox.checked = preparationSelection.has(checkbox.dataset.librarySelectKey);
  const visible = libraryUIModels().catalog.filter(libraryUIMatches);
  const select = document.querySelector('#library-select-visible');
  select.checked = visible.length > 0 && visible.every(item => preparationSelection.has(item.key));
  select.indeterminate = !select.checked && visible.some(item => preparationSelection.has(item.key));
  document.querySelector('#library-selection-count').textContent = preparationSelection.size ? `Выбрано ${formatUIInteger(preparationSelection.size)}` : 'Выберите библиотеки';
  document.querySelector('#library-download-label').textContent = preparationSelection.size ? `Скачать · ${formatUIInteger(preparationSelection.size)}` : 'Скачать';
}
function closeLibraryMenu(restoreFocus = false) {
  if (!libraryBrowserMenu) return;
  const { button, panel } = libraryBrowserMenu; panel.hidden = true; button.setAttribute('aria-expanded', 'false'); libraryBrowserMenu = null;
  if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
}
function openLibraryMenu(button, panel) {
  const same = libraryBrowserMenu?.button === button; closeLibraryMenu(); if (same) return;
  panel.hidden = false; button.setAttribute('aria-expanded', 'true'); libraryBrowserMenu = { button, panel };
  const rect = button.getBoundingClientRect(), bounds = document.querySelector('#activity-panel').getBoundingClientRect();
  panel.style.maxHeight = `${Math.max(120, bounds.height - 24)}px`;
  const width = panel.offsetWidth, height = panel.offsetHeight;
  panel.style.left = `${Math.max(bounds.left + 8, Math.min(bounds.right - width - 8, rect.left))}px`;
  panel.style.top = `${Math.max(bounds.top + 8, Math.min(bounds.bottom - height - 8, rect.bottom + 6))}px`;
  panel.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus();
}
function setLibraryBrowserTab(tab) {
  libraryBrowserTab = tab; closeLibraryMenu();
  for (const button of document.querySelectorAll('[data-library-tab]')) {
    const active = button.dataset.libraryTab === tab;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    document.querySelector(`#library-view-${button.dataset.libraryTab}`).hidden = !active;
  }
  renderLibraryPreparation();
}
function initLibraryBrowser() {
  for (const node of document.querySelectorAll('[data-library-icon]')) node.append(libraryIcon(node.dataset.libraryIcon));
  for (const button of document.querySelectorAll('[data-library-tab]')) {
    button.addEventListener('click', () => setLibraryBrowserTab(button.dataset.libraryTab));
    button.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[data-library-tab]')]; let index = tabs.indexOf(button);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1; else return;
      event.preventDefault(); tabs[index].click(); tabs[index].focus();
    });
  }
  for (const button of document.querySelectorAll('[data-library-category]')) button.addEventListener('click', () => {
    libraryBrowserCategory = button.dataset.libraryCategory;
    for (const node of document.querySelectorAll('[data-library-category]')) node.setAttribute('aria-pressed', String(node === button));
    renderLibraryPreparation();
  });
  document.querySelector('#library-search').addEventListener('input', renderLibraryPreparation);
  document.querySelector('#library-select-visible').addEventListener('change', event => {
    for (const item of libraryUIModels().catalog.filter(libraryUIMatches)) event.target.checked ? preparationSelection.add(item.key) : preparationSelection.delete(item.key);
    preparationControls();
  });
  document.querySelector('#library-selection-clear').addEventListener('click', () => { preparationSelection.clear(); closeLibraryMenu(true); preparationControls(); });
  for (const name of ['more', 'import', 'export']) {
    const button = document.querySelector(`#library-${name}-open`), panel = document.querySelector(`#library-${name}-menu`);
    button.addEventListener('click', () => openLibraryMenu(button, panel));
  }
  document.querySelector('#library-help-open').addEventListener('click', event => {
    const help = document.querySelector('#library-browser-help'); help.hidden = !help.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
  });
  document.querySelector('#library-theme').addEventListener('click', () => document.querySelector('#theme-toggle').click());
  document.querySelector('#library-files-close').addEventListener('click', () => { document.querySelector('#library-export-files').hidden = true; document.querySelector('#library-export-open').focus(); });
  document.querySelector('#library-report-copy').addEventListener('click', () => { closeLibraryMenu(); document.querySelector('#diagnostic-copy').click(); });
  document.addEventListener('pointerdown', event => { if (libraryBrowserMenu && !libraryBrowserMenu.panel.contains(event.target) && !libraryBrowserMenu.button.contains(event.target)) closeLibraryMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && libraryBrowserMenu) { event.preventDefault(); event.stopImmediatePropagation(); closeLibraryMenu(true); } }, true);
  window.addEventListener('resize', () => closeLibraryMenu());
  new MutationObserver(() => { if (document.querySelector('#activity-panel').hidden) closeLibraryMenu(); }).observe(document.querySelector('#activity-panel'), { attributes: true, attributeFilter: ['hidden'] });
}
