const codeField = document.querySelector('#code');
const preview = document.querySelector('#preview');
const pasteButton = document.querySelector('#paste');
const clearButton = document.querySelector('#clear');
const saveButton = document.querySelector('#save');
const shareButton = document.querySelector('#share');
const runButton = document.querySelector('#run');
const status = document.querySelector('#status');
const saveDialog = document.querySelector('#save-dialog');
const clearDialog = document.querySelector('#clear-dialog');
const filenameField = document.querySelector('#filename');
let running = false;
let readingClipboard = false;
let replaceOnNextPaste = false;
let currentFilename = 'game.html';
let statusTimeout;

function inform(text = '', error = false, persistent = false) {
  clearTimeout(statusTimeout);
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('error', error);
  if (text && !error && !persistent) statusTimeout = setTimeout(() => { status.hidden = true; }, 6000);
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
  pasteButton.disabled = running || readingClipboard;
  clearButton.disabled = !codeField.value || running || readingClipboard;
  saveButton.disabled = empty;
  shareButton.disabled = empty;
  runButton.disabled = !running && (empty || readingClipboard);
  const action = running ? 'Стоп' : 'Запустить';
  runButton.setAttribute('aria-label', action);
  runButton.title = action;
  document.querySelector('#play-icon').hidden = running;
  document.querySelector('#stop-icon').hidden = !running;
}

codeField.addEventListener('input', () => { replaceOnNextPaste = false; inform(); updateControls(); });
// Native paste is intentionally left to the textarea and the browser. It
// respects the selection/caret unless the Paste button requested replacement.
codeField.addEventListener('paste', event => {
  if (!replaceOnNextPaste) return;
  replaceOnNextPaste = false;
  const text = event.clipboardData?.getData('text/plain');
  if (typeof text !== 'string') return; // Let the browser insert into the selection.
  event.preventDefault();
  if (!text.trim()) {
    inform('В буфере обмена нет текста. Сначала скопируйте HTML-код.');
    return;
  }
  codeField.value = text;
  codeField.scrollTop = 0;
  codeField.scrollLeft = 0;
  inform('Код вставлен. Можно запускать.');
  updateControls();
});
pasteButton.addEventListener('click', async () => {
  const previous = codeField.value;
  if (!navigator.clipboard?.readText) {
    offerManualPaste();
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
    replaceOnNextPaste = false;
    codeField.value = text;
    codeField.scrollTop = 0;
    codeField.scrollLeft = 0;
    inform('Код вставлен. Можно запускать.');
  } catch {
    if (codeField.value === previous) offerManualPaste();
    else inform('Код изменён, пока браузер запрашивал буфер. Нажмите «Вставить» ещё раз.');
  } finally {
    readingClipboard = false;
    updateControls();
  }
});

runButton.addEventListener('click', () => {
  inform();
  if (running) {
    // Removing the document tears down its timers, media and event handlers.
    preview.replaceChildren();
    preview.hidden = true;
    codeField.hidden = false;
    running = false;
  } else if (codeField.value.trim()) {
    try {
      const frame = makePreview(codeField.value);
      codeField.blur();
      codeField.hidden = true;
      preview.hidden = false;
      preview.replaceChildren(frame);
      running = true;
    } catch {
      preview.replaceChildren();
      preview.hidden = true;
      codeField.hidden = false;
      inform('Не удалось открыть игру. Код остался в поле.', true);
    }
  }
  updateControls();
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
  codeField.value = '';
  codeField.scrollTop = 0;
  codeField.scrollLeft = 0;
  replaceOnNextPaste = false;
  inform('Код очищен.');
  updateControls();
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
