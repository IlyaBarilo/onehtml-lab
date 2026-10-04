const codeField = document.querySelector('#code');
const preview = document.querySelector('#preview');
const pasteButton = document.querySelector('#paste');
const clearButton = document.querySelector('#clear');
const saveButton = document.querySelector('#save');
const shareButton = document.querySelector('#share');
const runButton = document.querySelector('#run');
const expertButton = document.querySelector('#expert-toggle');
const networkButton = document.querySelector('#network-toggle');
const storageButton = document.querySelector('#storage-toggle');
const libraryRequest = document.querySelector('#library-request');
const libraryRequestText = document.querySelector('#library-request-text');
const libraryDownloadButton = document.querySelector('#library-download');
const librarySkipButton = document.querySelector('#library-skip');
const libraryFilesButton = document.querySelector('#library-files-button');
const libraryFiles = document.querySelector('#library-files');
const expertTools = document.querySelector('#expert-tools');
const importButton = document.querySelector('#import');
const compareButton = document.querySelector('#compare');
const historyButton = document.querySelector('#history-open');
const extractionButton = document.querySelector('#library-extract-open');
const extractionPanel = document.querySelector('#library-extraction');
const extractionList = document.querySelector('#library-extraction-list');
const extractionSummary = document.querySelector('#library-extraction-summary');
const extractionApply = document.querySelector('#library-extract-apply');
const historyView = document.querySelector('#history-view');
const historyList = document.querySelector('#history-list');
const currentHistory = document.querySelector('#history-current');
const comparison = document.querySelector('#comparison');
const comparisonSource = document.querySelector('#comparison-source');
const comparisonAdded = document.querySelector('#comparison-added');
const comparisonRemoved = document.querySelector('#comparison-removed');
const comparisonScrollbar = document.querySelector('#comparison-scrollbar');
const comparisonScrollbarThumb = document.querySelector('#comparison-scrollbar-thumb');
const diffContent = document.querySelector('#diff-content');
const importFile = document.querySelector('#import-file');
const draftStatus = document.querySelector('#draft-status');
const status = document.querySelector('#status');
const networkStatus = document.querySelector('#network-status');
const networkCountField = document.querySelector('#network-count');
const networkKbField = document.querySelector('#network-kb');
const runtimeError = document.querySelector('#runtime-error');
const runtimeErrorMessage = document.querySelector('#runtime-error-message');
const localAccessStatus = document.querySelector('#local-access-status');
const aiButton = document.querySelector('#ai-open');
const examplesButton = document.querySelector('#examples-open');
const aiDialog = document.querySelector('#ai-dialog');
const examplesDialog = document.querySelector('#examples-dialog');
const exampleList = document.querySelector('#example-list');
const copyDialog = document.querySelector('#copy-dialog');
const copyTextField = document.querySelector('#copy-text');
const saveDialog = document.querySelector('#save-dialog');
const saveOptions = document.querySelector('#save-options');
const saveFilesPanel = document.querySelector('#save-files');
const saveFileList = document.querySelector('#save-file-list');
const saveTitle = document.querySelector('#save-title');
const confirmSaveButton = document.querySelector('#confirm-save');
const cancelSaveButton = document.querySelector('#cancel-save');
const clearDialog = document.querySelector('#clear-dialog');
const replaceDialog = document.querySelector('#replace-dialog');
const filenameField = document.querySelector('#filename');
const saveLibrariesField = document.querySelector('#save-libraries');
const saveLibrariesHint = document.querySelector('#save-libraries-hint');
const saveLibrariesOption = document.querySelector('#save-libraries-option');
const saveLibrariesLabel = document.querySelector('#save-libraries-label');
const saveLibrariesMode = document.querySelector('#save-libraries-mode');
let saveLibrariesDescription = null;
let running = false;
let readingClipboard = false;
let replaceOnNextPaste = false;
let currentFilename = 'game.html';
let statusTimeout;
const settingsKey = 'onehtml-lab-settings';
const storedSettings = readSettings();
let expertMode = storedSettings.expertMode;
let networkAllowed = storedSettings.networkAllowed;
let gameStorageAllowed = storedSettings.gameStorageAllowed;
let pendingLibraryAction = null;
let pendingLocalLibrarySource = null;
let previewRequest = 0;
let modeBusy = false;
let draftAvailable = false;
let draftSaveTimer;
let draftRevision = 0;
let draftQueue = Promise.resolve();
let historyState = { entries: [], verifiedCode: null };
let historyQueue = Promise.resolve();
let pendingNativePaste = null;
let comparisonOpen = false;
let historyOpen = false;
let extractionOpen = false;
let extractionBusy = false;
let extractionRequest = 0;
let extractionMode = 'cdn';
let extractionPlan = null;
let extractionCode = '';
let activeFrame = null;
let activeBundledLibraries = [];
let networkCount = 0;
let networkBytes = 0;
let runtimeErrorReport = '';
let runtimeErrorReportBase = '';
let runtimeErrorMessageBase = '';
let runtimeErrorCount = 0;
const localApisUsed = new Set();
const localApiNames = ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'document.cookie'];
let selectedPlatform = 'mobile';
let selectedExampleCategory = 'games';

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey));
    return {
      expertMode: value?.mode === 'expert',
      networkAllowed: value?.networkAllowed !== false,
      gameStorageAllowed: value?.gameStorageAllowed !== false
    };
  } catch {
    return { expertMode: false, networkAllowed: true, gameStorageAllowed: true };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({
      mode: expertMode ? 'expert' : 'simple',
      networkAllowed,
      gameStorageAllowed
    }));
    return true;
  } catch {
    inform('Не удалось сохранить настройки режима, интернета и хранилища в браузере.', true, true);
    return false;
  }
}

function previewNetworkAllowed() {
  return networkAllowed;
}

function resetNetworkStatus() {
  networkCount = 0;
  networkBytes = 0;
  networkCountField.textContent = '0';
  networkKbField.textContent = '(нет данных)';
  networkStatus.hidden = true;
}

window.addEventListener('message', event => {
  if (handleGameStorageMessage(event)) {
    updateLocalAccessHint();
    return;
  }
  if (!running || !activeFrame || event.source !== activeFrame.contentWindow) return;
  if (event.data?.type === 'onehtml-lab:local-access') {
    if (!localApiNames.includes(event.data.api)) return;
    localApisUsed.add(event.data.api);
    updateLocalAccessHint();
    return;
  }
  if (event.data?.type === 'onehtml-lab:runtime-error') {
    const detail = event.data;
    if (!['error', 'rejection'].includes(detail.kind) || typeof detail.message !== 'string') return;
    const message = detail.message === 'Script error.'
      ? 'Ошибка JavaScript (браузер не сообщил подробности)'
      : detail.message.slice(0, 500);
    const place = Number.isInteger(detail.line) && detail.line > 0
      ? ` (строка документа ${detail.line}${Number.isInteger(detail.column) && detail.column > 0 ? `, столбец ${detail.column}` : ''})`
      : '';
    runtimeErrorCount += 1;
    runtimeErrorReportBase = `${detail.kind === 'rejection' ? 'Необработанный Promise' : 'Ошибка JavaScript'}: ${message}${place}`;
    runtimeErrorMessageBase = `Ошибка игры${runtimeErrorCount > 1 ? ` (${runtimeErrorCount})` : ''}: ${message}${place}`;
    runtimeError.hidden = false;
    updateLocalAccessHint();
    return;
  }
  if (!previewNetworkAllowed() || event.data?.type !== 'onehtml-lab:network-resource') return;
  const bytes = event.data.bytes;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return;
  networkCount += 1;
  networkBytes = Math.min(Number.MAX_SAFE_INTEGER, networkBytes + Math.floor(bytes));
  networkCountField.textContent = String(networkCount);
  const kb = networkBytes / 1024;
  networkKbField.textContent = networkBytes === 0 ? '(нет данных)' : kb < 0.1
    ? '<0,1 КБ' : `${kb.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  if (networkCount === 1) networkStatus.hidden = false;
});

function updateLocalAccessHint() {
  const hints = [];
  if (gameStorageAllowed && localApisUsed.has('localStorage')) {
    hints.push(gameStoragePersistent
      ? 'Игра использует виртуальный localStorage.'
      : 'Игра использует виртуальный localStorage, но браузер не сохранил данные. Они доступны только до закрытия страницы.');
  }
  const blockedApis = [...localApisUsed].filter(api => api !== 'localStorage' || !gameStorageAllowed);
  if (blockedApis.length) hints.push(`Игра обратилась к ${blockedApis.join(', ')}. В изолированном предпросмотре доступ к этим данным браузера ограничен; попросите ИИ обработать отсутствие доступа.`);
  const hint = hints.join(' ');
  const libraryHint = activeBundledLibraries.length ? `Встроено: ${activeBundledLibraries.join(', ')}.` : '';
  const statusHint = [runtimeError.hidden ? hint : '', libraryHint].filter(Boolean).join(' ');
  localAccessStatus.textContent = statusHint;
  localAccessStatus.hidden = !statusHint;
  if (!runtimeError.hidden) {
    runtimeErrorMessage.textContent = `${runtimeErrorMessageBase}${hint ? ` ${hint}` : ''}`;
    runtimeErrorReport = `${runtimeErrorReportBase}${hint ? `\n${hint}` : ''}`;
  }
}

function clearRuntimeError() {
  runtimeErrorReport = '';
  runtimeErrorReportBase = '';
  runtimeErrorMessageBase = '';
  runtimeErrorCount = 0;
  activeBundledLibraries = [];
  localApisUsed.clear();
  runtimeErrorMessage.textContent = '';
  runtimeError.hidden = true;
  localAccessStatus.textContent = '';
  localAccessStatus.hidden = true;
}

function inform(text = '', error = false, persistent = false) {
  clearTimeout(statusTimeout);
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('error', error);
  if (text && !error && !persistent) statusTimeout = setTimeout(() => { status.hidden = true; }, 6000);
}

function hideLibraryRequest() {
  pendingLibraryAction = null;
  pendingLocalLibrarySource = null;
  libraryRequest.hidden = true;
  libraryDownloadButton.disabled = false;
  librarySkipButton.disabled = false;
  libraryFilesButton.disabled = false;
}

function requestLibraries(prepared, action) {
  if (!prepared.missingLibraries?.length) return false;
  pendingLibraryAction = { action, code: codeField.value, references: prepared.missingLibraries };
  const titles = prepared.missingLibraries.map(item => item.title).join(', ');
  const downloadable = prepared.missingLibraries.filter(item => item.url && item.licenseUrl);
  const local = prepared.missingLibraries.filter(item => item.localPath);
  const hosts = [...new Set(downloadable.flatMap(item => [item.url.split('/')[2], item.licenseUrl.split('/')[2]]))].join(', ');
  libraryRequestText.textContent = `Для автономной игры нужны: ${titles}.`
    + (downloadable.length ? ` Скачать с ${hosts}; до 4 МБ на библиотеку.` : '')
    + (local.length ? ` Локальный файл: ${local[0].localPath}. Можно выбрать JS и полный текст MIT-лицензии.` : '')
    + ' Код и лицензия войдут в сохраняемый HTML.';
  libraryDownloadButton.hidden = !downloadable.length;
  libraryFilesButton.hidden = !local.length;
  libraryFilesButton.textContent = 'Выбрать JS и лицензию';
  libraryRequest.hidden = false;
  return true;
}

libraryDownloadButton.addEventListener('click', async () => {
  const pending = pendingLibraryAction;
  if (!pending) return;
  libraryDownloadButton.disabled = true;
  librarySkipButton.disabled = true;
  libraryFilesButton.disabled = true;
  try {
    let persisted = true;
    for (const reference of pending.references.filter(item => item.url && item.licenseUrl)) {
      if (cachedLibrary(reference)) continue;
      libraryRequestText.textContent = `Загружается ${reference.title} и её лицензия…`;
      persisted = await downloadLibrary(reference) && persisted;
    }
    const prepared = await prepareGameHtml(pending.code);
    if (pending !== pendingLibraryAction || pending.code !== codeField.value) return;
    hideLibraryRequest();
    if (pending.code === codeField.value) requestLibraries(prepared, pending.action);
    inform(persisted
      ? 'Библиотеки сохранены в браузере. Повторите запуск, сохранение или отправку.'
      : 'Библиотеки загружены для этого сеанса, но браузер не сохранил их. Повторите действие.', !persisted, !persisted);
  } catch {
    if (pending !== pendingLibraryAction) return;
    libraryRequestText.textContent = 'Не удалось скачать библиотеку и её лицензию. Проверьте сеть или доступ CDN к загрузке из локального файла.';
    libraryDownloadButton.disabled = false;
    librarySkipButton.disabled = false;
    libraryFilesButton.disabled = false;
  }
});

libraryFilesButton.addEventListener('click', () => {
  if (!pendingLibraryAction) return;
  libraryFiles.value = '';
  libraryFiles.click();
});

libraryFiles.addEventListener('change', async () => {
  const pending = pendingLibraryAction;
  const reference = pending?.references.find(item => item.localPath && !cachedLibrary(item));
  const files = Array.from(libraryFiles.files || []);
  libraryFiles.value = '';
  if (!pending || !reference || !files.length) return;
  libraryDownloadButton.disabled = true;
  librarySkipButton.disabled = true;
  libraryFilesButton.disabled = true;
  try {
    if (pending.code !== codeField.value) throw new Error('Код изменился. Повторите действие.');
    const scripts = files.filter(file => /\.js$/i.test(file.name));
    const licenses = files.filter(file => !/\.js$/i.test(file.name));
    if (scripts.length > 1 || licenses.length > 1) throw new Error('Выберите один JS-файл и один файл его MIT-лицензии.');
    if (scripts.length) {
      const file = scripts[0];
      if (file.name.toLowerCase() !== reference.filename.toLowerCase()) throw new Error(`Нужен файл ${reference.filename}.`);
      if (!file.size || file.size > maxLibraryBytes) throw new Error('JS-файл должен быть не больше 4 МБ.');
      const source = await file.text();
      pendingLocalLibrarySource = { key: reference.key, source };
    }
    const source = pendingLocalLibrarySource?.key === reference.key ? pendingLocalLibrarySource.source : '';
    if (!source) throw new Error(`Сначала выберите ${reference.filename}.`);
    let license = localLibraryLicense(source);
    if (licenses.length) {
      if (licenses[0].size > maxLicenseBytes) throw new Error('Файл лицензии должен быть не больше 64 КБ.');
      license = await licenses[0].text();
    }
    if (!license) {
      libraryRequestText.textContent = `${reference.filename} прочитан. Теперь выберите файл с полным текстом его MIT-лицензии (LICENSE, .txt или .md).`;
      libraryFilesButton.textContent = 'Выбрать лицензию';
      return;
    }
    if (!validLibraryAsset(source, license)) throw new Error('Нужны безопасный для встраивания JS-файл и полный текст MIT-лицензии с авторскими правами.');
    if (pending !== pendingLibraryAction || pending.code !== codeField.value) return;
    const persisted = await importLocalLibrary(reference, source, license);
    const prepared = await prepareGameHtml(pending.code);
    if (pending !== pendingLibraryAction || pending.code !== codeField.value) return;
    hideLibraryRequest();
    requestLibraries(prepared, pending.action);
    inform(persisted ? 'Библиотека и лицензия сохранены. Повторите запуск, сохранение или отправку.'
      : 'Библиотека доступна для этого сеанса. Повторите действие.', !persisted, !persisted);
  } catch (error) {
    if (pending === pendingLibraryAction) libraryRequestText.textContent = error.message || 'Не удалось прочитать библиотеку.';
  } finally {
    libraryDownloadButton.disabled = false;
    librarySkipButton.disabled = false;
    libraryFilesButton.disabled = false;
  }
});

librarySkipButton.addEventListener('click', async () => {
  const pending = pendingLibraryAction;
  if (!pending) return;
  hideLibraryRequest();
  if (pending.code !== codeField.value) {
    inform('Код изменился. Повторите действие с актуальным кодом.', true);
    return;
  }
  try {
    if (pending.action === 'run') await startPreview(false);
    else if (pending.action === 'share') {
      const result = await shareHtml(pending.code, currentFilename);
      if (result === 'unsupported') inform('Передача HTML-файла здесь недоступна. Сохраните его и отправьте через приложение «Файлы».');
    }
  } catch {
    inform('Не удалось выполнить действие. Код остался в поле.', true);
  }
  updateControls();
});

async function copyOrSelect(text, successMessage) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable');
    await navigator.clipboard.writeText(text);
    inform(successMessage);
  } catch {
    copyTextField.value = text;
    copyDialog.showModal();
    copyTextField.focus();
    copyTextField.select();
  }
}

const gamePrompts = {
  mobile: {
    create: 'Сделай игру про [тема игры] для телефона. Сделай одним файлом HTML со встроенными CSS и JavaScript. Игра должна занимать весь экран, управляться касанием и позволять сыграть ещё раз. Верни только полный HTML-код.',
    change: 'Измени игру ниже по моему описанию. Верни полный HTML-файл, чтобы я мог целиком заменить прежний код. Сохрани полноэкранный вид на телефоне и управление касанием. Если задача изменения ещё не указана, сначала спроси, что именно поменять.\n\nТекущий код:\n'
  },
  desktop: {
    create: 'Сделай игру про [тема игры] для компьютера. Сделай одним файлом HTML со встроенными CSS и JavaScript. Игра должна занимать всё окно браузера, управляться мышью или клавиатурой и позволять сыграть ещё раз. Верни только полный HTML-код.',
    change: 'Измени игру ниже по моему описанию. Верни полный HTML-файл, чтобы я мог целиком заменить прежний код. Сохрани полноэкранный вид в браузере компьютера и управление мышью или клавиатурой. Если задача изменения ещё не указана, сначала спроси, что именно поменять.\n\nТекущий код:\n'
  }
};

function renderExamples() {
  exampleList.replaceChildren();
  for (const example of examples.filter(item => (item.category || 'games') === selectedExampleCategory &&
    (selectedExampleCategory === 'fix' || item.platform === selectedPlatform))) {
    const card = document.createElement('div');
    card.className = 'example-card';
    const title = document.createElement('strong');
    title.textContent = example.title;
    const description = document.createElement('span');
    description.textContent = example.description;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Открыть копию';
    button.addEventListener('click', async () => {
      examplesDialog.close();
      if (!await confirmReplacement(example.code)) return;
      if (running) stopPreview();
      selectGameStorage(`example:${example.id}`);
      replaceOnNextPaste = false;
      replaceCode(example.code, true);
      inform(example.category === 'fix'
        ? `Игра «${example.title}» открыта. Запустите её и попробуйте исправить ошибки.`
        : `Пример «${example.title}» открыт. Измените код и сохраните свою версию.`);
    });
    card.append(title, description, button);
    exampleList.append(card);
  }
}

function setExampleCategory(category) {
  if (!['games', 'fix'].includes(category)) return;
  selectedExampleCategory = category;
  for (const tab of document.querySelectorAll('.example-category')) {
    tab.setAttribute('aria-selected', String(tab.dataset.exampleCategory === category));
  }
  document.querySelector('#example-platform-tabs').hidden = category === 'fix';
  document.querySelector('#example-guide').textContent = category === 'fix'
    ? 'Это исходные игры ИИ с ошибками. Откройте копию, запустите и попробуйте исправить её. При первом запуске загрузите Three.js; сохранённая копия работает без интернета игры.'
    : 'Откройте копию примера, измените код и сохраните свою версию.';
  renderExamples();
}

function setPlatform(platform) {
  if (!['mobile', 'desktop'].includes(platform)) return;
  selectedPlatform = platform;
  for (const tab of document.querySelectorAll('.platform-tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.platform === platform));
  }
  renderExamples();
}

for (const tab of document.querySelectorAll('.platform-tab')) {
  tab.addEventListener('click', () => setPlatform(tab.dataset.platform));
}
for (const tab of document.querySelectorAll('.example-category')) {
  tab.addEventListener('click', () => setExampleCategory(tab.dataset.exampleCategory));
}
renderExamples();
aiButton.addEventListener('click', () => { if (expertMode && !modeBusy) aiDialog.showModal(); });
examplesButton.addEventListener('click', () => { if (expertMode && !modeBusy) examplesDialog.showModal(); });
document.querySelector('#ai-close').addEventListener('click', () => aiDialog.close());
document.querySelector('#examples-close').addEventListener('click', () => examplesDialog.close());
document.querySelector('#copy-close').addEventListener('click', () => copyDialog.close());
document.querySelector('#prompt-create').addEventListener('click', () => void copyOrSelect(gamePrompts[selectedPlatform].create, 'Запрос для новой игры скопирован.'));
document.querySelector('#prompt-change').addEventListener('click', () => {
  if (codeField.value.trim()) void copyOrSelect(gamePrompts[selectedPlatform].change + codeField.value, 'Запрос с текущим кодом скопирован.');
});
document.querySelector('#copy-error').addEventListener('click', () => {
  if (runtimeErrorReport) void copyOrSelect(runtimeErrorReport, 'Ошибка игры скопирована.');
});

function setDraftStatus(text, error = false) {
  draftStatus.textContent = text;
  draftStatus.classList.toggle('error', error);
}

function latestHistory() {
  return historyState.entries[0] ?? null;
}

function persistHistory() {
  const snapshot = JSON.parse(JSON.stringify(historyState));
  historyQueue = historyQueue.catch(() => {}).then(() => writeHistoryState(snapshot));
  void historyQueue.catch(() => inform('История доступна сейчас, но не сохранена в браузере.', true, true));
}

function archiveCode(before, after) {
  if (before === after) return;
  if (before) {
    historyState.entries.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      code: before,
      createdAt: Date.now(),
      verified: historyState.verifiedCode === before
    });
    historyState.entries.length = Math.min(historyState.entries.length, 20);
  }
  historyState.verifiedCode = null;
  persistHistory();
  updateControls();
}

function symbolCount(code) {
  let count = 0;
  for (const symbol of code) count++;
  return count;
}

function formatSymbolCount(count) {
  const lastTwo = count % 100;
  const last = count % 10;
  const unit = lastTwo >= 11 && lastTwo <= 14 ? 'символов' : last === 1 ? 'символ' : last >= 2 && last <= 4 ? 'символа' : 'символов';
  return `${count} ${unit}`;
}

function changedSymbols(before, after) {
  let added = 0;
  let removed = 0;
  for (const part of codeDiff(before, after)) {
    if (part.type === 'added') added += symbolCount(part.text);
    if (part.type === 'removed') removed += symbolCount(part.text);
  }
  return { added, removed };
}

function formatVersionDate(timestamp) {
  const value = new Date(timestamp);
  const twoDigits = number => String(number).padStart(2, '0');
  return {
    date: `${twoDigits(value.getDate())}.${twoDigits(value.getMonth() + 1)}.${value.getFullYear()}`,
    time: `${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}:${twoDigits(value.getSeconds())}`
  };
}

function historyIcon(kind) {
  const paths = {
    delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7',
    restore: 'M4 8V4m0 4h4M4 8a8 8 0 1 1-1 6M12 7v5l3 2',
    check: 'M4 12l5 5L20 6'
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[kind]);
  svg.append(path);
  return svg;
}

function historyAction(kind, label, click) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'history-action';
  button.setAttribute('aria-label', label);
  button.title = label;
  if (kind) button.append(historyIcon(kind));
  button.addEventListener('click', click);
  return button;
}

function historyMetrics(before, after) {
  const metrics = document.createElement('div');
  metrics.className = 'history-metrics';
  const changes = changedSymbols(before, after);
  for (const [kind, amount, label] of [['added', changes.added, 'Добавлено'], ['removed', changes.removed, 'Удалено']]) {
    if (amount === 0) continue;
    const metric = document.createElement('span');
    metric.className = `history-metric history-${kind}`;
    metric.setAttribute('aria-label', `${label} ${formatSymbolCount(amount)}`);
    const icon = document.createElement('span');
    icon.className = 'history-metric-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'added' ? '+' : '−';
    const value = document.createElement('span');
    value.className = 'history-metric-value';
    value.setAttribute('aria-hidden', 'true');
    value.textContent = String(amount);
    metric.append(icon, value);
    metrics.append(metric);
  }
  return metrics;
}

function historyTime(timestamp, current = false, migrated = false) {
  const time = document.createElement('span');
  time.className = 'history-time';
  if (current) {
    time.textContent = 'Сейчас';
    return time;
  }
  const formatted = formatVersionDate(timestamp);
  const date = document.createElement('span');
  date.className = 'history-date';
  date.textContent = formatted.date;
  const clock = document.createElement('span');
  clock.className = 'history-clock';
  clock.textContent = formatted.time;
  time.append(date, clock);
  time.setAttribute('aria-label', `${formatted.date} ${formatted.time}`);
  time.title = `${formatted.date} ${formatted.time}` + (migrated ? ' · время переноса старой версии' : '');
  return time;
}

function formatLibrarySize(bytes) {
  return bytes < 1024 ? `${bytes} Б` : `${(bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
}

function closeLibraryExtraction() {
  if (!extractionOpen) return;
  extractionOpen = false;
  extractionBusy = false;
  extractionRequest += 1;
  extractionPlan = null;
  extractionCode = '';
  extractionPanel.hidden = true;
  extractionList.replaceChildren();
  if (!running && !comparisonOpen && !historyOpen) codeField.hidden = false;
  updateControls();
}

async function refreshLibraryExtraction() {
  const request = ++extractionRequest;
  const code = codeField.value;
  extractionBusy = true;
  extractionPlan = null;
  extractionApply.disabled = true;
  extractionSummary.textContent = 'Проверяю библиотеки…';
  try {
    const plan = await planLibraryExtraction(code, extractionMode);
    if (!extractionOpen || request !== extractionRequest) return;
    if (code !== codeField.value) { closeLibraryExtraction(); return; }
    extractionPlan = plan;
    extractionCode = code;
    extractionList.replaceChildren();
    for (const row of plan.rows) {
      const item = document.createElement('li');
      item.className = 'library-extraction-row';
      item.classList.toggle('is-blocked', !row.removable);
      const title = document.createElement('strong');
      title.textContent = row.title;
      item.append(title);
      if (row.removable) {
        const size = document.createElement('span');
        size.className = 'extraction-size';
        size.textContent = (row.removedBytes < 0 ? '+' : '−') + formatLibrarySize(Math.abs(row.removedBytes));
        item.append(size);
      } else {
        const note = document.createElement('span');
        note.className = 'extraction-note';
        note.textContent = row.note;
        item.append(note);
      }
      extractionList.append(item);
    }
    extractionSummary.textContent = plan.count ? `${plan.removedBytes < 0 ? 'Увеличение' : 'Уменьшение'}: ${formatLibrarySize(Math.abs(plan.removedBytes))}`
      : plan.rows.length ? 'Нет библиотек для выбранного варианта.' : 'Встроенные копии OneHTML Lab не найдены.';
    extractionApply.disabled = !plan.count;
  } catch {
    if (request === extractionRequest && extractionOpen) extractionSummary.textContent = 'Не удалось проверить библиотеки. Код сохранён.';
  } finally {
    if (request === extractionRequest) extractionBusy = false;
  }
}

function openLibraryExtraction() {
  if (!expertMode || running || modeBusy || readingClipboard) return;
  if (extractionOpen) { closeLibraryExtraction(); return; }
  closeHistory();
  closeComparison();
  hideLibraryRequest();
  inform();
  extractionOpen = true;
  extractionMode = 'cdn';
  extractionPlan = null;
  extractionPanel.hidden = false;
  codeField.hidden = true;
  extractionPanel.querySelector('.library-extraction-body').scrollTop = 0;
  for (const button of document.querySelectorAll('.library-extraction-mode')) button.setAttribute('aria-pressed', String(button.dataset.libraryMode === extractionMode));
  updateControls();
  void refreshLibraryExtraction();
}

extractionButton.addEventListener('click', openLibraryExtraction);
document.querySelector('#library-extract-close').addEventListener('click', () => { closeLibraryExtraction(); extractionButton.focus(); });
for (const button of document.querySelectorAll('.library-extraction-mode')) button.addEventListener('click', () => {
  if (!extractionOpen || extractionMode === button.dataset.libraryMode) return;
  extractionMode = button.dataset.libraryMode;
  for (const tab of document.querySelectorAll('.library-extraction-mode')) tab.setAttribute('aria-pressed', String(tab.dataset.libraryMode === extractionMode));
  void refreshLibraryExtraction();
});
extractionApply.addEventListener('click', async () => {
  if (!extractionOpen || extractionBusy || !extractionPlan?.count || extractionCode !== codeField.value) return;
  const plan = extractionPlan;
  const code = extractionCode;
  const request = extractionRequest;
  extractionBusy = true;
  extractionApply.disabled = true;
  try {
    const persisted = await retainExtractionAssets(plan);
    if (!extractionOpen || request !== extractionRequest || code !== codeField.value) return;
    closeLibraryExtraction();
    replaceCode(plan.html, true);
    extractionButton.focus();
    inform(persisted ? 'Библиотеки заменены ссылками. Предыдущий вариант доступен в истории.'
      : 'Библиотеки заменены ссылками и доступны сейчас. Сохраните HTML и JS до закрытия редактора.', !persisted, !persisted);
  } catch {
    if (request === extractionRequest && extractionOpen) {
      extractionBusy = false;
      extractionApply.disabled = false;
      inform('Не удалось вынести библиотеки. Код остался в поле.', true);
    }
  }
});

function closeHistory() {
  if (!historyOpen) return;
  historyOpen = false;
  historyView.hidden = true;
  if (!running && !comparisonOpen && !extractionOpen) codeField.hidden = false;
  updateControls();
}

function openHistory() {
  if (historyOpen || running || modeBusy || !expertMode) return;
  closeLibraryExtraction();
  closeComparison();
  renderHistory();
  codeField.hidden = true;
  historyView.hidden = false;
  historyOpen = true;
  historyView.scrollTop = 0;
  updateControls();
}

function renderHistory() {
  const latest = latestHistory();
  const currentVerified = historyState.verifiedCode === codeField.value;
  currentHistory.classList.toggle('is-verified', currentVerified);
  currentHistory.replaceChildren();
  const currentTime = historyTime(null, true);
  currentHistory.append(currentTime, historyMetrics(latest?.code ?? '', codeField.value));
  const currentActions = document.createElement('div');
  currentActions.className = 'history-entry-actions';
  const compare = historyAction(null, 'Сравнить с последней прошлой версией', () => {
    closeHistory();
    openComparison();
  });
  compare.append(compareButton.querySelector('svg').cloneNode(true));
  compare.disabled = !latest || latest.code === codeField.value;
  const verified = historyAction('check', currentVerified ? 'Снять отметку верной версии' : 'Отметить текущую версию как верную', () => {
    historyState.verifiedCode = currentVerified ? null : codeField.value;
    persistHistory();
    renderHistory();
  });
  verified.setAttribute('aria-pressed', String(currentVerified));
  currentActions.append(compare, verified);
  currentHistory.append(currentActions);
  historyList.replaceChildren();
  historyState.entries.forEach((entry, index) => {
    const row = document.createElement('li');
    row.className = 'history-row history-entry';
    row.classList.toggle('is-verified', entry.verified);
    const time = historyTime(entry.createdAt, false, entry.migrated);
    if (entry.verified) {
      time.querySelector('.history-clock').append(' ✓');
      time.setAttribute('aria-label', `${time.getAttribute('aria-label')}, верная версия`);
    }
    const older = historyState.entries[index + 1];
    row.append(time, historyMetrics(older?.code ?? '', entry.code));
    const actions = document.createElement('div');
    actions.className = 'history-entry-actions';
    const compareEntry = historyAction(null, 'Сравнить эту версию с текущей', () => {
      if (running || modeBusy) return;
      closeHistory();
      openComparison(entry);
    });
    compareEntry.append(compareButton.querySelector('svg').cloneNode(true));
    compareEntry.disabled = entry.code === codeField.value;
    const remove = historyAction('delete', 'Удалить версию', () => {
      historyState.entries.splice(index, 1);
      persistHistory();
      renderHistory();
      updateControls();
    });
    const restore = historyAction('restore', 'Вернуть версию', async () => {
      if (running || modeBusy) return;
      const current = codeField.value;
      closeHistory();
      if (!await confirmReplacement(entry.code) || codeField.value !== current) return;
      replaceCode(entry.code, true);
      historyState.verifiedCode = entry.verified ? entry.code : null;
      persistHistory();
      inform('Версия восстановлена. Предыдущий текущий код сохранён в истории.');
    });
    restore.disabled = entry.code === codeField.value;
    actions.append(compareEntry, remove, restore);
    row.append(actions);
    historyList.append(row);
  });
  document.querySelector('#history-empty').hidden = historyState.entries.length > 0;
}

function closeComparison() {
  if (!comparisonOpen) return;
  comparisonOpen = false;
  comparison.hidden = true;
  comparison.classList.remove('has-custom-scrollbar');
  comparisonScrollbar.hidden = true;
  comparisonSource.textContent = '';
  comparisonAdded.textContent = formatSymbolCount(0);
  comparisonRemoved.textContent = formatSymbolCount(0);
  diffContent.replaceChildren();
  if (!running && !historyOpen && !extractionOpen) codeField.hidden = false;
  updateControls();
}

function openComparison(baseline = latestHistory()) {
  if (!baseline || running) return;
  closeLibraryExtraction();
  const versionDate = formatVersionDate(baseline.createdAt);
  comparisonSource.textContent = `Текущий код и версия ${versionDate.date} ${versionDate.time}`;
  const parts = codeDiff(baseline.code, codeField.value);
  let added = 0;
  let removed = 0;
  const nodes = parts.map(part => {
    if (part.type === 'same') return document.createTextNode(part.text);
    if (part.type === 'added') added += symbolCount(part.text);
    else removed += symbolCount(part.text);
    const mark = document.createElement('span');
    mark.className = part.type === 'added' ? 'diff-added' : 'diff-removed';
    mark.textContent = part.text;
    return mark;
  });
  comparisonAdded.textContent = formatSymbolCount(added);
  comparisonRemoved.textContent = formatSymbolCount(removed);
  diffContent.replaceChildren(...nodes);
  comparison.scrollTop = 0;
  comparison.hidden = false;
  codeField.hidden = true;
  comparisonOpen = true;
  updateComparisonScrollbar();
  updateControls();
}

function positionComparisonScrollbar() {
  if (comparisonScrollbar.hidden) return;
  const scrollRange = comparison.scrollHeight - comparison.clientHeight;
  const travel = comparisonScrollbar.clientHeight - comparisonScrollbarThumb.offsetHeight;
  const progress = scrollRange > 0 ? comparison.scrollTop / scrollRange : 0;
  comparisonScrollbarThumb.style.transform = `translateY(${Math.round(travel * progress)}px)`;
  comparisonScrollbar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
}

function updateComparisonScrollbar() {
  if (!comparisonOpen) return;
  const needed = comparison.scrollHeight > comparison.clientHeight + 1;
  comparison.classList.toggle('has-custom-scrollbar', needed);
  comparisonScrollbar.hidden = !needed;
  if (!needed) return;
  const trackHeight = comparisonScrollbar.clientHeight;
  comparisonScrollbarThumb.style.height = `${Math.min(trackHeight, Math.max(48, Math.round(trackHeight * comparison.clientHeight / comparison.scrollHeight)))}px`;
  positionComparisonScrollbar();
}

comparison.addEventListener('scroll', positionComparisonScrollbar);
window.addEventListener('resize', updateComparisonScrollbar);
comparisonScrollbar.addEventListener('pointerdown', event => {
  if (comparisonScrollbar.hidden || event.button !== 0) return;
  event.preventDefault();
  const thumbTop = comparisonScrollbarThumb.getBoundingClientRect().top;
  const offset = event.target === comparisonScrollbarThumb ? event.clientY - thumbTop : comparisonScrollbarThumb.offsetHeight / 2;
  comparisonScrollbar.setPointerCapture(event.pointerId);
  function move(pointer) {
    const track = comparisonScrollbar.getBoundingClientRect();
    const travel = track.height - comparisonScrollbarThumb.offsetHeight;
    if (travel <= 0) return;
    const position = Math.max(0, Math.min(travel, pointer.clientY - track.top - offset));
    comparison.scrollTop = position / travel * (comparison.scrollHeight - comparison.clientHeight);
  }
  move(event);
  function stop() {
    comparisonScrollbar.removeEventListener('pointermove', move);
    comparisonScrollbar.removeEventListener('pointerup', stop);
    comparisonScrollbar.removeEventListener('pointercancel', stop);
  }
  comparisonScrollbar.addEventListener('pointermove', move);
  comparisonScrollbar.addEventListener('pointerup', stop);
  comparisonScrollbar.addEventListener('pointercancel', stop);
});
comparisonScrollbar.addEventListener('keydown', event => {
  const step = Math.max(40, Math.round(comparison.clientHeight * .1));
  const movements = { ArrowUp: -step, ArrowDown: step, PageUp: -comparison.clientHeight, PageDown: comparison.clientHeight };
  if (event.key in movements) comparison.scrollTop += movements[event.key];
  else if (event.key === 'Home') comparison.scrollTop = 0;
  else if (event.key === 'End') comparison.scrollTop = comparison.scrollHeight;
  else return;
  event.preventDefault();
});

function saveDraftNow() {
  if (!draftAvailable) return Promise.resolve();
  clearTimeout(draftSaveTimer);
  draftSaveTimer = undefined;
  const code = codeField.value;
  const revision = ++draftRevision;
  setDraftStatus('Сохранение…');
  const operation = draftQueue.catch(() => {}).then(() => writeWorkingDraft(code));
  draftQueue = operation;
  operation.then(
    () => { if (revision === draftRevision) setDraftStatus('Сохранено'); },
    () => {
      if (revision === draftRevision) {
        setDraftStatus('Не сохранено', true);
        inform('Черновик не сохранён. Сохраните код HTML-файлом.', true, true);
      }
    }
  );
  return operation;
}

function scheduleDraftSave() {
  if (!draftAvailable) return;
  clearTimeout(draftSaveTimer);
  draftRevision += 1;
  setDraftStatus('Сохранение…');
  draftSaveTimer = setTimeout(saveDraftNow, 700);
}

window.addEventListener('pagehide', () => {
  if (draftSaveTimer) void saveDraftNow();
});

function chooseDialog(dialog) {
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue || 'cancel'), { once: true });
    dialog.showModal();
  });
}

async function confirmReplacement(nextCode) {
  if (!expertMode || !codeField.value || codeField.value === nextCode) return true;
  return await chooseDialog(replaceDialog) === 'replace';
}

function replaceCode(code, archive = false) {
  closeLibraryExtraction();
  closeHistory();
  if (archive) archiveCode(codeField.value, code);
  else if (codeField.value !== code && historyState.verifiedCode !== null) {
    historyState.verifiedCode = null;
    persistHistory();
  }
  closeComparison();
  clearRuntimeError();
  codeField.value = code;
  codeField.scrollTop = 0;
  codeField.scrollLeft = 0;
  scheduleDraftSave();
  updateControls();
}

function offerManualPaste() {
  replaceOnNextPaste = true;
  codeField.focus();
  codeField.select();
  inform('Буфер недоступен. Код выделен — выберите «Вставить» в меню поля.', false, true);
}

async function readClipboardWithTimeout() {
  let timer;
  try {
    return await Promise.race([
      navigator.clipboard.readText(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('clipboard-timeout')), 12_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function updateControls() {
  const empty = !codeField.value.trim();
  pasteButton.disabled = running || readingClipboard || modeBusy || extractionOpen;
  clearButton.disabled = !codeField.value || running || readingClipboard || modeBusy || extractionOpen;
  saveButton.disabled = empty || extractionOpen;
  shareButton.disabled = empty || extractionOpen;
  runButton.disabled = modeBusy || extractionOpen || (!running && (empty || readingClipboard));
  expertButton.disabled = modeBusy;
  expertTools.hidden = !expertMode;
  importButton.disabled = modeBusy || extractionOpen;
  aiButton.disabled = modeBusy || extractionOpen;
  examplesButton.disabled = modeBusy || extractionOpen;
  extractionButton.disabled = !expertMode || running || modeBusy || readingClipboard || (!extractionOpen && !/data-onehtml-library\s*=/i.test(codeField.value));
  extractionButton.setAttribute('aria-pressed', String(extractionOpen));
  extractionButton.title = extractionOpen ? 'Вернуться к редактору' : 'Вынести встроенные библиотеки в ссылки';
  document.querySelector('#prompt-change').disabled = empty;
  const baseline = latestHistory();
  compareButton.disabled = !expertMode || running || modeBusy || (!comparisonOpen && (!baseline || baseline.code === codeField.value));
  historyButton.disabled = !expertMode || running || modeBusy;
  historyButton.setAttribute('aria-pressed', String(historyOpen));
  historyButton.title = historyOpen ? 'Закрыть историю версий' : 'История версий';
  compareButton.setAttribute('aria-pressed', String(comparisonOpen));
  compareButton.setAttribute('aria-label', comparisonOpen ? 'Закрыть сравнение' : 'Сравнить с последней прошлой версией');
  compareButton.title = comparisonOpen ? 'Закрыть сравнение' : 'Сравнить с последней прошлой версией';
  const action = running ? 'Стоп' : 'Запустить';
  runButton.setAttribute('aria-label', action);
  runButton.title = action;
  document.querySelector('#play-icon').hidden = running;
  document.querySelector('#stop-icon').hidden = !running;
  expertButton.setAttribute('aria-pressed', String(expertMode));
  expertButton.title = expertMode ? 'Вернуться в простой режим' : 'Включить экспертный режим';
  networkButton.disabled = modeBusy;
  networkButton.setAttribute('aria-pressed', String(networkAllowed));
  networkButton.title = networkAllowed
    ? 'Интернет включён — нажмите, чтобы выключить'
    : 'Интернет выключен — нажмите, чтобы включить';
  document.querySelector('#network-on-icon').hidden = !networkAllowed;
  document.querySelector('#network-off-icon').hidden = networkAllowed;
  networkButton.classList.toggle('is-off', !networkAllowed);
  storageButton.disabled = modeBusy;
  storageButton.setAttribute('aria-pressed', String(gameStorageAllowed));
  storageButton.title = gameStorageAllowed
    ? 'Хранилище игры включено — нажмите, чтобы выключить'
    : 'Хранилище игры выключено — нажмите, чтобы включить';
  document.querySelector('#storage-on-icon').hidden = !gameStorageAllowed;
  document.querySelector('#storage-off-icon').hidden = gameStorageAllowed;
  storageButton.classList.toggle('is-off', !gameStorageAllowed);
}

codeField.addEventListener('input', () => {
  closeLibraryExtraction();
  hideLibraryRequest();
  if (pendingNativePaste !== null) {
    archiveCode(pendingNativePaste, codeField.value);
    pendingNativePaste = null;
  } else if (historyState.verifiedCode !== null && historyState.verifiedCode !== codeField.value) {
    historyState.verifiedCode = null;
    persistHistory();
  }
  replaceOnNextPaste = false;
  inform();
  clearRuntimeError();
  scheduleDraftSave();
  updateControls();
});
// Native paste is intentionally left to the textarea and the browser. It
// respects the selection/caret unless the Paste button requested replacement.
codeField.addEventListener('paste', event => {
  if (!replaceOnNextPaste) {
    pendingNativePaste = codeField.value;
    setTimeout(() => { pendingNativePaste = null; }, 0);
    return;
  }
  replaceOnNextPaste = false;
  const text = event.clipboardData?.getData('text/plain');
  if (typeof text !== 'string') return; // Let the browser insert into the selection.
  event.preventDefault();
  if (!text.trim()) {
    inform('В буфере обмена нет текста. Сначала скопируйте HTML-код.');
    return;
  }
  replaceCode(text, true);
  inform('Код вставлен. Можно запускать.');
});
pasteButton.addEventListener('click', async () => {
  const previous = codeField.value;
  if (!navigator.clipboard?.readText) {
    if (await confirmReplacement(null)) offerManualPaste();
    return;
  }
  readingClipboard = true;
  updateControls();
  inform('Читаю буфер… Подтвердите вставку в запросе браузера.', false, true);
  try {
    const text = await readClipboardWithTimeout();
    if (codeField.value !== previous) {
      inform('Код уже изменён. Нажмите «Вставить» ещё раз, чтобы заменить его.');
      return;
    }
    if (!text.trim()) {
      inform('В буфере обмена нет текста. Сначала скопируйте HTML-код.');
      return;
    }
    if (!await confirmReplacement(text)) {
      inform();
      return;
    }
    if (codeField.value !== previous) {
      inform('Код изменён. Нажмите «Вставить» ещё раз, чтобы заменить его.');
      return;
    }
    replaceOnNextPaste = false;
    replaceCode(text, true);
    inform('Код вставлен. Можно запускать.');
  } catch {
    if (codeField.value === previous) {
      if (await confirmReplacement(null)) offerManualPaste();
    }
    else inform('Код изменён, пока браузер запрашивал буфер. Нажмите «Вставить» ещё раз.');
  } finally {
    readingClipboard = false;
    updateControls();
  }
});

function stopPreview() {
  previewRequest += 1;
  // Removing the document tears down its timers, media and event handlers.
  activeFrame = null;
  preview.replaceChildren();
  preview.hidden = true;
  codeField.hidden = false;
  running = false;
  resetNetworkStatus();
  activeBundledLibraries = [];
  updateLocalAccessHint();
}

async function startPreview(replaceLibraries = true) {
  const request = ++previewRequest;
  const code = codeField.value;
  try {
    const prepared = await prepareGameHtml(code, replaceLibraries);
    if (request !== previewRequest || code !== codeField.value) return;
    if (requestLibraries(prepared, 'run')) return;
    hideLibraryRequest();
    closeHistory();
    closeComparison();
    clearRuntimeError();
    const frame = makePreview(prepared.html, previewNetworkAllowed(), gameStorageAllowed ? gameStorageSnapshot() : null);
    resetNetworkStatus();
    codeField.blur();
    codeField.hidden = true;
    preview.hidden = false;
    activeFrame = null;
    preview.replaceChildren(frame);
    activeFrame = frame;
    if (gameStorageAllowed) registerGameStorageFrame(frame);
    running = true;
    activeBundledLibraries = [...new Set(prepared.bundledLibraries || [])];
    updateLocalAccessHint();
  } catch {
    if (request !== previewRequest) return;
    stopPreview();
    inform('Не удалось открыть игру. Код остался в поле.', true);
  } finally {
    if (request === previewRequest) updateControls();
  }
}

runButton.addEventListener('click', async () => {
  inform();
  if (running) stopPreview();
  else if (codeField.value.trim()) await startPreview();
  updateControls();
});

expertButton.addEventListener('click', () => {
  if (modeBusy) return;
  closeLibraryExtraction();
  previewRequest += 1;
  const wasRunning = running;
  if (wasRunning) stopPreview();
  closeHistory();
  closeComparison();
  expertMode = !expertMode;
  const settingsSaved = saveSettings();
  if (wasRunning && settingsSaved) inform('Игра остановлена при смене режима.');
  updateControls();
});

networkButton.addEventListener('click', async () => {
  networkAllowed = !networkAllowed;
  const settingsSaved = saveSettings();
  if (running) {
    stopPreview();
    await startPreview();
    if (running && settingsSaved) inform('Настройка интернета изменена. Игра перезапущена.');
  }
  updateControls();
});

storageButton.addEventListener('click', async () => {
  if (!expertMode || modeBusy) return;
  gameStorageAllowed = !gameStorageAllowed;
  const settingsSaved = saveSettings();
  if (running) {
    stopPreview();
    await startPreview();
    if (running && settingsSaved) inform('Настройка хранилища изменена. Игра перезапущена.');
  }
  updateControls();
});

async function restoreStartupDraft() {
  modeBusy = true;
  codeField.disabled = true;
  setDraftStatus('Открываю черновик…');
  updateControls();
  let timer;
  try {
    const [saved, state, previous] = await Promise.race([
      Promise.all([readWorkingDraft(), readHistoryState(), readPreviousPaste()]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('draft-timeout')), 4000); })
    ]);
    draftAvailable = true;
    if (saved !== null) codeField.value = saved;
    if (state && Array.isArray(state.entries)) {
      const migratedAt = Date.now();
      const hasMissingTime = state.entries.some(entry => entry && !Number.isFinite(entry.createdAt));
      historyState = {
        entries: state.entries.filter(entry => entry && typeof entry.code === 'string' && typeof entry.id === 'string').slice(0, 20).map(entry => ({
          id: entry.id,
          code: entry.code,
          createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : migratedAt,
          migrated: entry.migrated === true || !Number.isFinite(entry.createdAt),
          verified: entry.verified === true
        })),
        verifiedCode: typeof state.verifiedCode === 'string' && state.verifiedCode === codeField.value ? state.verifiedCode : null
      };
      if (hasMissingTime) persistHistory();
    } else if (previous !== null) {
      historyState.entries = [{ id: 'legacy-previous', code: previous, createdAt: Date.now(), migrated: true, verified: false }];
      persistHistory();
    }
    setDraftStatus('Сохранено');
  } catch {
    draftAvailable = false;
    setDraftStatus('Не сохраняется', true);
    inform('Автосохранение недоступно. Сохраните код HTML-файлом.', true, true);
  } finally {
    clearTimeout(timer);
    await loadLibraryCache();
    modeBusy = false;
    codeField.disabled = false;
    updateControls();
  }
}

importButton.addEventListener('click', () => {
  if (expertMode && !modeBusy) importFile.click();
});

compareButton.addEventListener('click', () => {
  if (!expertMode || running || modeBusy) return;
  closeHistory();
  if (comparisonOpen) closeComparison();
  else openComparison();
});

historyButton.addEventListener('click', () => {
  if (!expertMode || running || modeBusy) return;
  if (historyOpen) closeHistory();
  else openHistory();
});
document.querySelector('#history-close').addEventListener('click', closeHistory);
document.querySelector('#comparison-close').addEventListener('click', closeComparison);

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = '';
  if (!expertMode || !file) return;
  if (!/\.html?$/i.test(file.name)) {
    inform('Выберите файл с расширением .html или .htm.', true);
    return;
  }
  try {
    const code = await file.text();
    if (!expertMode) return;
    if (!await confirmReplacement(code)) return;
    if (running) stopPreview();
    selectGameStorage(`file:${file.name.slice(0, 170)}`);
    replaceOnNextPaste = false;
    replaceCode(code, true);
    inform('HTML-файл открыт в редакторе.');
  } catch {
    inform('Не удалось прочитать HTML-файл. Текущий код сохранён.', true);
  }
});

function updateSaveLibrariesDescription() {
  if (!saveLibrariesDescription) return;
  const { available, addedBytes, missing } = saveLibrariesDescription;
  const checked = available && saveLibrariesField.checked;
  const separate = saveLibrariesMode.value === 'files';
  saveLibrariesMode.hidden = !checked;
  saveLibrariesMode.disabled = !checked;
  saveLibrariesLabel.textContent = separate ? 'Сохранить библиотеки рядом с HTML' : 'Встроить библиотеки в файл';
  if (checked && separate) {
    saveLibrariesHint.textContent = 'HTML и JS скачаются отдельными файлами. Сохраните их в одну папку. Лицензии включены в JS.'
      + (missing ? ' Неподготовленные библиотеки останутся по исходным ссылкам.' : '');
  } else if (checked) {
    const size = (addedBytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    saveLibrariesHint.textContent = `С библиотеками размер увеличится примерно на ${size} КБ; редактировать файл будет сложнее.`
      + (missing ? ' Остальные библиотеки останутся по внешним ссылкам.' : '');
  } else {
    saveLibrariesHint.textContent = available ? 'Сохранится код из поля как есть, без изменений.'
      : missing ? 'Библиотек ещё нет в редакторе. Запустите игру, чтобы скачать их или выбрать локальные файлы.'
        : 'В этом коде нет библиотек для встраивания.';
  }
}

saveLibrariesField.addEventListener('change', updateSaveLibrariesDescription);
saveLibrariesMode.addEventListener('change', updateSaveLibrariesDescription);

function updateSaveViewport() {
  const viewport = window.visualViewport;
  saveDialog.style.setProperty('--save-viewport-height', `${viewport?.height || window.innerHeight}px`);
  saveDialog.style.setProperty('--save-viewport-top', `${viewport?.offsetTop || 0}px`);
}
window.visualViewport?.addEventListener('resize', updateSaveViewport);
window.visualViewport?.addEventListener('scroll', updateSaveViewport);
window.addEventListener('resize', updateSaveViewport);

saveButton.addEventListener('click', async () => {
  const code = codeField.value;
  const prepared = await prepareGameHtml(code);
  if (code !== codeField.value) return;
  saveOptions.hidden = false;
  saveFilesPanel.hidden = true;
  saveFileList.replaceChildren();
  saveTitle.textContent = 'Сохранить HTML';
  confirmSaveButton.hidden = false;
  cancelSaveButton.textContent = 'Отмена';
  const available = Boolean(prepared.bundledLibraries?.length);
  saveLibrariesField.disabled = !available;
  const preference = extractedSavePreference(code);
  saveLibrariesField.checked = available && preference !== 'cdn';
  saveLibrariesMode.value = preference === 'files' ? 'files' : 'inline';
  saveLibrariesOption.classList.toggle('is-disabled', !available);
  saveLibrariesDescription = { available, missing: Boolean(prepared.missingLibraries?.length),
    addedBytes: Math.max(0, new Blob([prepared.html]).size - new Blob([code]).size) };
  updateSaveLibrariesDescription();
  filenameField.value = 'game.html';
  updateSaveViewport();
  saveDialog.showModal();
  filenameField.focus();
  filenameField.select();
});
clearButton.addEventListener('click', () => {
  if (!codeField.value || running) return;
  closeHistory();
  inform();
  clearDialog.showModal();
});
document.querySelector('#cancel-clear').addEventListener('click', () => clearDialog.close());
document.querySelector('#clear-form').addEventListener('submit', event => {
  event.preventDefault();
  if (running) return;
  clearDialog.close();
  replaceCode('');
  replaceOnNextPaste = false;
  inform('Код очищен.');
});
shareButton.addEventListener('click', async () => {
  if (!codeField.value.trim()) return;
  inform();
  try {
    const code = codeField.value;
    const prepared = await prepareGameHtml(code);
    if (code !== codeField.value) return;
    if (requestLibraries(prepared, 'share')) return;
    hideLibraryRequest();
    const result = await shareHtml(prepared.html, currentFilename);
    if (result === 'unsupported') {
      inform('Передача HTML-файла здесь недоступна. Сохраните его и отправьте через приложение «Файлы».');
    }
  } catch {
    inform('Не удалось отправить HTML-файл. Сохраните его и отправьте через приложение «Файлы».', true);
  }
});
cancelSaveButton.addEventListener('click', () => saveDialog.close());
saveDialog.addEventListener('close', () => saveFileList.replaceChildren());
function showSaveFiles(files) {
  saveOptions.hidden = true;
  saveFilesPanel.hidden = false;
  saveTitle.textContent = 'Скачать файлы';
  confirmSaveButton.hidden = true;
  cancelSaveButton.textContent = 'Закрыть';
  saveFileList.replaceChildren();
  for (const file of files) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = file.name;
    button.setAttribute('aria-label', `Скачать ${file.name}`);
    button.addEventListener('click', () => {
      try { downloadGameFile(file); }
      catch { inform('Не удалось передать файл браузеру. Попробуйте скачать его ещё раз.', true); }
    });
    item.append(button);
    saveFileList.append(item);
  }
  cancelSaveButton.focus();
}
document.querySelector('#save-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!saveFilesPanel.hidden || confirmSaveButton.disabled) return;
  confirmSaveButton.disabled = true;
  try {
    const filename = htmlFilename(filenameField.value);
    const code = codeField.value;
    const withLibraries = !saveLibrariesField.disabled && saveLibrariesField.checked;
    const separate = withLibraries && saveLibrariesMode.value === 'files';
    const prepared = separate ? await prepareGameFiles(code, filename) : await prepareGameHtml(code, withLibraries);
    if (code !== codeField.value || !saveDialog.open) return;
    hideLibraryRequest();
    if (separate) {
      showSaveFiles(prepared.files);
      downloadGameFiles(prepared.files);
      currentFilename = prepared.files[0].name;
    } else {
      downloadHtml(prepared.html, filename);
      currentFilename = filename;
      saveDialog.close();
      inform('Файл передан браузеру для сохранения.');
    }
  } catch {
    if (saveFilesPanel.hidden) saveDialog.close();
    inform('Не удалось передать все файлы браузеру. Код остался в поле.', true);
  } finally {
    confirmSaveButton.disabled = false;
  }
});
updateControls();
void restoreStartupDraft();
