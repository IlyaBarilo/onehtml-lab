const codeField = document.querySelector('#code');
const preview = document.querySelector('#preview');
const pasteButton = document.querySelector('#paste');
const clearButton = document.querySelector('#clear');
const saveButton = document.querySelector('#save');
const shareButton = document.querySelector('#share');
const runButton = document.querySelector('#run');
const expertButton = document.querySelector('#expert-toggle');
const networkButton = document.querySelector('#network-toggle');
const expertTools = document.querySelector('#expert-tools');
const importButton = document.querySelector('#import');
const compareButton = document.querySelector('#compare');
const restorePreviousButton = document.querySelector('#restore-previous');
const comparison = document.querySelector('#comparison');
const diffContent = document.querySelector('#diff-content');
const importFile = document.querySelector('#import-file');
const draftStatus = document.querySelector('#draft-status');
const status = document.querySelector('#status');
const networkStatus = document.querySelector('#network-status');
const networkCountField = document.querySelector('#network-count');
const networkKbField = document.querySelector('#network-kb');
const saveDialog = document.querySelector('#save-dialog');
const clearDialog = document.querySelector('#clear-dialog');
const replaceDialog = document.querySelector('#replace-dialog');
const filenameField = document.querySelector('#filename');
let running = false;
let readingClipboard = false;
let replaceOnNextPaste = false;
let currentFilename = 'game.html';
let statusTimeout;
const settingsKey = 'onehtml-lab-settings';
const storedSettings = readSettings();
let expertMode = storedSettings.expertMode;
let networkAllowed = storedSettings.networkAllowed;
let modeBusy = false;
let draftAvailable = false;
let draftSaveTimer;
let draftRevision = 0;
let draftQueue = Promise.resolve();
let previousPaste = null;
let previousPasteQueue = Promise.resolve();
let pendingNativePaste = null;
let comparisonOpen = false;
let activeFrame = null;
let networkCount = 0;
let networkBytes = 0;

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey));
    return {
      expertMode: value?.mode === 'expert',
      networkAllowed: value?.networkAllowed !== false
    };
  } catch {
    return { expertMode: false, networkAllowed: true };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({
      mode: expertMode ? 'expert' : 'simple',
      networkAllowed
    }));
    return true;
  } catch {
    inform('Не удалось сохранить настройки режима и интернета в браузере.', true, true);
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
  if (!running || !previewNetworkAllowed() || !activeFrame || event.source !== activeFrame.contentWindow) return;
  if (event.data?.type !== 'onehtml-lab:network-resource') return;
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

function inform(text = '', error = false, persistent = false) {
  clearTimeout(statusTimeout);
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('error', error);
  if (text && !error && !persistent) statusTimeout = setTimeout(() => { status.hidden = true; }, 6000);
}

function setDraftStatus(text, error = false) {
  draftStatus.textContent = text;
  draftStatus.classList.toggle('error', error);
}

function rememberPreviousPaste(before, after) {
  if (before === after) return;
  previousPaste = before;
  previousPasteQueue = previousPasteQueue.catch(() => {}).then(() => writePreviousPaste(before));
  void previousPasteQueue.catch(() => {
    inform('Прошлый код доступен сейчас, но не сохранён в браузере.', true, true);
  });
  updateControls();
}

function clearPreviousPaste() {
  previousPaste = null;
  previousPasteQueue = previousPasteQueue.catch(() => {}).then(() => writePreviousPaste(null));
  void previousPasteQueue.catch(() => {});
  updateControls();
}

function closeComparison() {
  if (!comparisonOpen) return;
  comparisonOpen = false;
  comparison.hidden = true;
  diffContent.replaceChildren();
  if (!running) codeField.hidden = false;
  updateControls();
}

function openComparison() {
  if (previousPaste === null || running) return;
  const nodes = codeDiff(previousPaste, codeField.value).map(part => {
    if (part.type === 'same') return document.createTextNode(part.text);
    const mark = document.createElement('span');
    mark.className = part.type === 'added' ? 'diff-added' : 'diff-removed';
    mark.textContent = part.text;
    return mark;
  });
  diffContent.replaceChildren(...nodes);
  comparison.scrollTop = 0;
  comparison.hidden = false;
  codeField.hidden = true;
  comparisonOpen = true;
  updateControls();
}

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

function replaceCode(code, fromPaste = false) {
  if (fromPaste) rememberPreviousPaste(codeField.value, code);
  closeComparison();
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
  pasteButton.disabled = running || readingClipboard || modeBusy;
  clearButton.disabled = !codeField.value || running || readingClipboard || modeBusy;
  saveButton.disabled = empty;
  shareButton.disabled = empty;
  runButton.disabled = modeBusy || (!running && (empty || readingClipboard));
  expertButton.disabled = modeBusy;
  expertTools.hidden = !expertMode;
  importButton.disabled = modeBusy;
  const canRestore = expertMode && !running && !modeBusy && previousPaste !== null && previousPaste !== codeField.value;
  compareButton.disabled = !canRestore;
  restorePreviousButton.disabled = !canRestore;
  compareButton.setAttribute('aria-pressed', String(comparisonOpen));
  compareButton.setAttribute('aria-label', comparisonOpen ? 'Закрыть сравнение' : 'Сравнить с прошлым кодом');
  compareButton.title = comparisonOpen ? 'Закрыть сравнение' : 'Сравнить с прошлым кодом';
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
}

codeField.addEventListener('input', () => {
  if (pendingNativePaste !== null) {
    rememberPreviousPaste(pendingNativePaste, codeField.value);
    pendingNativePaste = null;
  }
  replaceOnNextPaste = false;
  inform();
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
  // Removing the document tears down its timers, media and event handlers.
  activeFrame = null;
  preview.replaceChildren();
  preview.hidden = true;
  codeField.hidden = false;
  running = false;
  resetNetworkStatus();
}

function startPreview() {
  try {
    closeComparison();
    const frame = makePreview(codeField.value, previewNetworkAllowed());
    resetNetworkStatus();
    codeField.blur();
    codeField.hidden = true;
    preview.hidden = false;
    activeFrame = null;
    preview.replaceChildren(frame);
    activeFrame = frame;
    running = true;
  } catch {
    stopPreview();
    inform('Не удалось открыть игру. Код остался в поле.', true);
  }
}

runButton.addEventListener('click', () => {
  inform();
  if (running) stopPreview();
  else if (codeField.value.trim()) startPreview();
  updateControls();
});

expertButton.addEventListener('click', () => {
  if (modeBusy) return;
  const wasRunning = running;
  if (wasRunning) stopPreview();
  closeComparison();
  expertMode = !expertMode;
  const settingsSaved = saveSettings();
  if (wasRunning && settingsSaved) inform('Игра остановлена при смене режима.');
  updateControls();
});

networkButton.addEventListener('click', () => {
  networkAllowed = !networkAllowed;
  const settingsSaved = saveSettings();
  if (running) {
    startPreview();
    if (running && settingsSaved) inform('Настройка интернета изменена. Игра перезапущена.');
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
    const [saved, previous] = await Promise.race([
      Promise.all([readWorkingDraft(), readPreviousPaste()]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('draft-timeout')), 4000); })
    ]);
    draftAvailable = true;
    if (saved !== null) codeField.value = saved;
    previousPaste = previous;
    setDraftStatus('Сохранено');
  } catch {
    draftAvailable = false;
    setDraftStatus('Не сохраняется', true);
    inform('Автосохранение недоступно. Сохраните код HTML-файлом.', true, true);
  } finally {
    clearTimeout(timer);
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
  if (comparisonOpen) closeComparison();
  else openComparison();
});

restorePreviousButton.addEventListener('click', async () => {
  if (!expertMode || running || modeBusy || previousPaste === null || previousPaste === codeField.value) return;
  const previous = previousPaste;
  if (!await confirmReplacement(previous) || previousPaste !== previous) return;
  replaceCode(previous);
  clearPreviousPaste();
  inform('Прошлый код восстановлен.');
});

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
    replaceOnNextPaste = false;
    replaceCode(code);
    inform('HTML-файл открыт в редакторе.');
  } catch {
    inform('Не удалось прочитать HTML-файл. Текущий код сохранён.', true);
  }
});

saveButton.addEventListener('click', () => {
  filenameField.value = 'game.html';
  saveDialog.showModal();
  filenameField.focus();
  filenameField.select();
});
clearButton.addEventListener('click', () => {
  if (!codeField.value || running) return;
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
    const result = await shareHtml(codeField.value, currentFilename);
    if (result === 'unsupported') {
      inform('Передача HTML-файла здесь недоступна. Сохраните его и отправьте через приложение «Файлы».');
    }
  } catch {
    inform('Не удалось отправить HTML-файл. Сохраните его и отправьте через приложение «Файлы».', true);
  }
});
document.querySelector('#cancel-save').addEventListener('click', () => saveDialog.close());
document.querySelector('#save-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const filename = htmlFilename(filenameField.value);
    downloadHtml(codeField.value, filename);
    currentFilename = filename;
    saveDialog.close();
    inform('Файл передан браузеру для сохранения.');
  } catch {
    saveDialog.close();
    inform('Не удалось передать файл браузеру. Код остался в поле.', true);
  }
});
updateControls();
void restoreStartupDraft();
