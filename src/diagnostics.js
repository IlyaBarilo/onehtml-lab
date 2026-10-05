// Diagnostics read source as text; they never execute it in the editor.
const diagnosticEntries = [];
let diagnosticRun = null;
let diagnosticTab = 'errors';
let diagnosticReady = false;
let diagnosticTimer = 0;
let diagnosticRevision = 0;
let diagnosticSnapshot = null;
let diagnosticLibraries = [];
let diagnosticSelected = null;
let diagnosticDelete = null;
let diagnosticCacheBusy = false;
let diagnosticReportReady = false;

function diagnosticCounts() {
  let errors = 0, warnings = 0;
  for (const entry of diagnosticEntries) {
    if (entry.kind === 'warning') warnings += entry.count;
    else errors += entry.count;
  }
  return { errors, warnings };
}

function beginDiagnosticRun(code, origin) {
  diagnosticEntries.length = 0;
  diagnosticSelected = null;
  diagnosticRun = { code, origin, network: previewNetworkAllowed(), storage: gameStorageAllowed, time: Date.now() };
  updateDiagnostics();
}

function addDiagnosticEntry(detail, report) {
  if (!diagnosticRun) return;
  const filename = typeof detail.filename === 'string' ? detail.filename.slice(0, 500) : '';
  const message = detail.message.slice(0, 500);
  const key = JSON.stringify([detail.kind, message, filename, Number.isInteger(detail.line) ? detail.line : 0, Number.isInteger(detail.column) ? detail.column : 0]);
  let entry = diagnosticEntries.find(item => item.key === key);
  if (entry) diagnosticEntries.splice(diagnosticEntries.indexOf(entry), 1);
  else entry = { key, kind: detail.kind, message, filename, report, count: 0, target: null };
  const origin = diagnosticRun.origin;
  if (origin && Number.isInteger(detail.line) && ['about:srcdoc', 'about:blank'].includes(filename)) {
    const line = detail.line - origin.lines;
    const column = Math.max(1, (Number.isInteger(detail.column) ? detail.column : 1) - (line === 1 ? origin.column : 0));
    if (line > 0 && line <= diagnosticRun.code.split('\n').length) entry.target = { line, column };
  }
  entry.count = Math.min(Number.MAX_SAFE_INTEGER, entry.count + 1);
  entry.time = Date.now();
  diagnosticEntries.unshift(entry);
  diagnosticEntries.length = Math.min(50, diagnosticEntries.length);
  if (detail.kind !== 'warning') diagnosticSelected = entry;
  scheduleDiagnosticRender();
}

function selectDiagnosticEntry(entry) {
  if (!diagnosticEntries.includes(entry) || !diagnosticRun) return;
  diagnosticSelected = entry;
  runtimeErrorCode = diagnosticRun.code;
  errorSource = diagnosticRun.origin;
  errorTarget = diagnosticRun.code === codeField.value ? entry.target : null;
  runtimeErrorReportBase = entry.report;
  runtimeErrorMessageBase = entry.report;
  runtimeError.hidden = false;
  runtimeError.classList.toggle('is-warning', entry.kind === 'warning');
  updateLocalAccessHint();
  scheduleDiagnosticRender();
}

function scheduleDiagnosticRender() {
  if (!diagnosticReady || diagnosticTimer) return;
  diagnosticTimer = setTimeout(() => { diagnosticTimer = 0; renderDiagnosticErrors(); updateActivitySummary(); }, 100);
}

function renderDiagnosticErrors() {
  const stale = diagnosticRun && diagnosticRun.code !== codeField.value;
  document.querySelector('#diagnostic-run-note').textContent = diagnosticRun
    ? `${running ? 'Текущий' : 'Последний'} запуск · ${new Date(diagnosticRun.time).toLocaleTimeString('ru-RU')}. `
      + (stale ? 'Код уже изменён: сообщения относятся к прежней версии. ' : '')
      + (diagnosticEntries.length ? 'Последние 50 сообщений; повторы объединены.' : 'Ошибок и предупреждений пока нет.')
    : 'Игра ещё не запускалась.';
  document.querySelector('#diagnostic-clear').disabled = !diagnosticEntries.length;
  const list = document.querySelector('#diagnostic-error-list');
  const nodes = diagnosticEntries.map(entry => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'diagnostic-error-row';
    button.setAttribute('aria-pressed', String(diagnosticSelected === entry));
    const heading = document.createElement('span'); heading.className = 'diagnostic-error-meta';
    heading.textContent = `${new Date(entry.time).toLocaleTimeString('ru-RU')} · ${entry.kind === 'warning' ? 'Предупреждение' : 'Ошибка'}${entry.count > 1 ? ` ×${entry.count}` : ''}`;
    const text = document.createElement('span'); text.textContent = entry.message;
    button.classList.toggle('is-warning', entry.kind === 'warning');
    button.append(heading, text);
    button.addEventListener('click', () => selectDiagnosticEntry(entry));
    li.append(button); return li;
  });
  list.replaceChildren(...nodes);
}

function diagnosticBytes(source) { return new TextEncoder().encode(source || '').length; }
function diagnosticSize(bytes) { return `${bytes.toLocaleString('ru-RU')} байт`; }

async function inspectDiagnosticLibraries(code) {
  const references = await resolvedLibraryMatches(code);
  const supported = new Map(references.map(ref => [ref.index, ref]));
  const embedded = await embeddedLibraryRows(code);
  const rows = embedded.map(row => ({ title: row.title, path: row.originalUrl || row.filename,
    state: 'Встроена в HTML', note: row.reason, bytes: diagnosticBytes(row.source),
    usedKey: libraryCache.has(row.key) ? row.key : row.assetKey && libraryCache.has(row.assetKey) ? row.assetKey : null }));
  for (const match of code.matchAll(libraryScriptTag)) {
    if (match[2] === undefined) continue;
    const attributes = scriptAttributes(match[2]);
    const path = decodeScriptUrl(attributes.get('src')?.value || '');
    if (!path) {
      if (attributes.get('type')?.value === 'module') rows.push({ title: 'Модуль JavaScript', path: '', state: 'Подмена не поддерживается', note: 'Импорты внутри модулей не разбираются.' });
      continue;
    }
    const ref = supported.get(match.index);
    const cached = ref && cachedLibrary(ref);
    rows.push({ title: ref?.title || path.split('/').pop() || 'Внешний скрипт', path,
      state: cached ? 'Есть сохранённая копия' : ref ? (ref.url ? 'Нужно скачать' : 'Нужно выбрать файл') : 'Подмена не поддерживается',
      bytes: cached ? diagnosticBytes(cached.source) : null, usedKey: cached?.key, reference: ref,
      note: ref ? '' : 'Подключение остаётся как в коде. Версия автоматически не заменяется.' });
  }
  return rows;
}

function diagnosticRow(title, description) {
  const row = document.createElement('li'); row.className = 'diagnostic-library-row';
  const content = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = title;
  const note = document.createElement('p'); note.textContent = description;
  content.append(name, note); row.append(content); return row;
}

function diagnosticButton(text, action) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
  button.addEventListener('click', action); return button;
}

function renderDiagnosticLibraries(rows) {
  const inspectedCode = diagnosticSnapshot?.code;
  const list = document.querySelector('#diagnostic-library-list');
  document.querySelector('#diagnostic-library-note').textContent = rows.length
    ? 'Подключения в текущем тексте редактора. Динамические загрузки из JavaScript не разбираются.'
    : 'Подключений библиотек в HTML не найдено. Динамические загрузки из JavaScript не разбираются.';
  list.replaceChildren(...rows.map(item => {
    const row = diagnosticRow(item.title, `${item.state}${item.bytes != null ? ` · ${diagnosticSize(item.bytes)}` : ''}${item.path ? `\n${item.path}` : ''}${item.note ? `\n${item.note}` : ''}`);
    if (item.reference && !item.usedKey) {
      const ref = item.reference;
      row.append(diagnosticButton(ref.url ? 'Загрузить…' : 'Выбрать файл…', () => {
        if (diagnosticCacheBusy) return;
        if (!diagnosticReportReady || inspectedCode !== codeField.value) { diagnosticSnapshot = null; updateDiagnostics(); return; }
        requestLibraries({ missingLibraries: [ref] }, 'inspect');
      }));
    }
    return row;
  }));
  renderDiagnosticCache();
}

function renderDiagnosticCache() {
  const entries = [...libraryCache.values()];
  const total = entries.reduce((sum, entry) => sum + diagnosticBytes(entry.source) + diagnosticBytes(entry.license), 0);
  document.querySelector('#diagnostic-cache-size').textContent = entries.length
    ? `${entries.length} копий · JS и лицензии: ${diagnosticSize(total)}` : 'Сохранённых копий нет.';
  const blocked = diagnosticCacheBusy || Boolean(pendingLibraryAction) || !diagnosticReportReady;
  document.querySelector('#diagnostic-cache-clear').disabled = !entries.length || blocked;
  document.querySelector('#diagnostic-cache-list').replaceChildren(...entries.map(entry => {
    const used = diagnosticLibraries.some(row => row.usedKey === entry.key);
    const persisted = persistedLibraries.get(entry.key) === entry;
    const row = diagnosticRow(entry.title || entry.filename || 'Библиотека',
      `${diagnosticSize(diagnosticBytes(entry.source) + diagnosticBytes(entry.license))} · ${persisted ? 'В браузере' : 'Только этот сеанс'}${used ? ' · Нужна текущему коду' : ''}\n${entry.sourceUrl || entry.localPath || entry.originalUrl || entry.filename || ''}`);
    const button = diagnosticButton('Удалить', () => confirmDiagnosticDelete([entry]));
    button.disabled = blocked; row.append(button); return row;
  }));
}

function confirmDiagnosticDelete(entries) {
  if (diagnosticCacheBusy || pendingLibraryAction || !diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value) return;
  diagnosticDelete = entries;
  const used = entries.some(entry => diagnosticLibraries.some(row => row.usedKey === entry.key));
  document.querySelector('#diagnostic-confirm-text').textContent = `Удалить ${entries.length === 1 ? entries[0].title || 'копию' : `все копии (${entries.length})`}? `
    + (used ? 'Есть копии для текущего кода. ' : '')
    + 'Для следующих запусков и встраивания может понадобиться повторная загрузка или выбор JS и лицензии. Код, история и данные игры сохранятся.';
  const box = document.querySelector('#diagnostic-confirm'); box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
  document.querySelector('#diagnostic-delete-no').focus({ preventScroll: true });
}

async function deleteDiagnosticCache() {
  const entries = diagnosticDelete;
  if (!entries || diagnosticCacheBusy || pendingLibraryAction || !diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value) return;
  diagnosticCacheBusy = true;
  document.querySelector('#diagnostic-delete-yes').disabled = true;
  document.querySelector('#diagnostic-delete-no').disabled = true;
  renderDiagnosticCache();
  try {
    await removeLibraryCopies(entries);
    document.querySelector('#diagnostic-cache-feedback').textContent = 'Копии удалены. Уже запущенная игра продолжает работать.';
  } catch {
    document.querySelector('#diagnostic-cache-feedback').textContent = 'Не удалось удалить копии из браузера. Список сохранён; попробуйте ещё раз.';
  } finally {
    diagnosticCacheBusy = false; diagnosticDelete = null; diagnosticSnapshot = null;
    document.querySelector('#diagnostic-confirm').hidden = true;
    document.querySelector('#diagnostic-delete-yes').disabled = false;
    document.querySelector('#diagnostic-delete-no').disabled = false;
    updateDiagnostics();
  }
}

function setDiagnosticTab(tab) {
  diagnosticTab = tab === 'libraries' && expertMode ? 'libraries' : 'errors';
  document.querySelector('#diagnostic-errors').hidden = diagnosticTab !== 'errors';
  document.querySelector('#diagnostic-libraries').hidden = diagnosticTab !== 'libraries';
  for (const button of document.querySelectorAll('[data-diagnostic-tab]')) button.setAttribute('aria-pressed', String(button.dataset.diagnosticTab === diagnosticTab));
}

function openDiagnostics(tab = 'errors') {
  if (!diagnosticCacheBusy) { diagnosticDelete = null; document.querySelector('#diagnostic-confirm').hidden = true; }
  setDiagnosticTab(tab);
  if (currentPanel() !== activityPanel) showWorkspacePanel(activityPanel);
  diagnosticSnapshot = null;
  updateDiagnostics();
  renderDiagnosticErrors();
}

function diagnosticReport() {
  const run = diagnosticRun;
  const lines = ['OneHTML Lab — диагностика', run ? `Сеть при запуске: ${run.network ? 'включена' : 'выключена'}. Хранилище игры: ${run.storage ? 'включено' : 'выключено'}.` : 'Игра ещё не запускалась.'];
  if (run && run.code !== codeField.value) lines.push('Код редактора изменён. Сообщения относятся к последнему запуску; библиотеки ниже — к текущему коду.');
  lines.push('Ошибки и предупреждения:');
  for (const entry of diagnosticEntries) lines.push(`${new Date(entry.time).toLocaleTimeString('ru-RU')} · ${entry.report}${entry.count > 1 ? ` (повторов: ${entry.count})` : ''}${entry.filename ? `\nИсточник: ${entry.filename}` : ''}`);
  if (!diagnosticEntries.length) lines.push('Не зарегистрированы.');
  lines.push('Библиотеки текущего кода:');
  for (const row of diagnosticLibraries) lines.push(`${row.title}: ${row.state}${row.bytes != null ? `, ${diagnosticSize(row.bytes)}` : ''}${row.path ? `\n${row.path}` : ''}${row.note ? `\n${row.note}` : ''}`);
  if (!diagnosticLibraries.length) lines.push('Подключения в HTML не найдены.');
  return lines.join('\n');
}

function diagnosticAiContext() {
  if (!diagnosticReportReady || !diagnosticRun || diagnosticRun.code !== codeField.value || diagnosticSnapshot?.code !== codeField.value) return '';
  return diagnosticReport();
}

function updateDiagnostics() {
  if (!diagnosticReady) return;
  document.querySelector('#diagnostic-open').disabled = modeBusy;
  document.querySelector('#diagnostic-open').setAttribute('aria-pressed', String(currentPanel() === activityPanel));
  document.querySelector('#diagnostic-tabs').hidden = !expertMode;
  if (!expertMode && diagnosticTab !== 'errors') setDiagnosticTab('errors');
  scheduleDiagnosticRender();
  if (currentPanel() !== activityPanel) return;
  const code = codeField.value, entries = [...libraryCache.values()];
  const previous = diagnosticSnapshot;
  if (previous?.code === code && previous.entries.length === entries.length && entries.every((entry, i) => entry === previous.entries[i])) {
    if (diagnosticTab === 'libraries') renderDiagnosticCache();
    return;
  }
  diagnosticSnapshot = { code, entries };
  diagnosticReportReady = false;
  document.querySelector('#diagnostic-copy').disabled = true;
  for (const button of document.querySelectorAll('#diagnostic-library-list button, #diagnostic-cache-list button, #diagnostic-cache-clear')) button.disabled = true;
  const revision = ++diagnosticRevision;
  document.querySelector('#diagnostic-library-note').textContent = 'Проверяю подключения…';
  void inspectDiagnosticLibraries(code).then(rows => {
    if (revision !== diagnosticRevision || code !== codeField.value) return;
    diagnosticLibraries = rows; diagnosticReportReady = true;
    renderDiagnosticLibraries(rows);
    document.querySelector('#diagnostic-copy').disabled = false;
  }).catch(() => {
    if (revision !== diagnosticRevision) return;
    diagnosticSnapshot = null;
    document.querySelector('#diagnostic-library-note').textContent = 'Не удалось проверить подключения. Откройте экран ещё раз.';
  });
}

function initDiagnostics() {
  diagnosticReady = true;
  document.querySelector('#diagnostic-open').addEventListener('click', () => {
    if (!expertMode || modeBusy) return;
    if (currentPanel() === activityPanel) closeWorkspacePanel(); else openDiagnostics();
  });
  for (const button of document.querySelectorAll('[data-diagnostic-tab]')) button.addEventListener('click', () => { setDiagnosticTab(button.dataset.diagnosticTab); updateDiagnostics(); });
  document.querySelector('#diagnostic-clear').addEventListener('click', () => {
    diagnosticEntries.length = 0; diagnosticSelected = null;
    runtimeError.hidden = true; runtimeErrorMessage.textContent = ''; runtimeErrorReport = ''; runtimeErrorCode = null;
    runtimeErrorCount = 0; errorTarget = null;
    updateLocalAccessHint(); updateDiagnostics();
  });
  document.querySelector('#diagnostic-copy').addEventListener('click', () => {
    if (!diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value) { updateDiagnostics(); return; }
    void copyOrSelect(diagnosticReport(), 'Отчёт скопирован.');
  });
  document.querySelector('#diagnostic-cache-clear').addEventListener('click', () => confirmDiagnosticDelete([...libraryCache.values()]));
  document.querySelector('#diagnostic-delete-no').addEventListener('click', () => { diagnosticDelete = null; document.querySelector('#diagnostic-confirm').hidden = true; });
  document.querySelector('#diagnostic-delete-yes').addEventListener('click', () => void deleteDiagnosticCache());
  updateDiagnostics();
}
