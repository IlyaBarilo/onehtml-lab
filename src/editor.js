// Native textarea editing, with a separate in-memory undo chain of text patches.
const editPanel = document.querySelector('#edit-panel');
const editButton = document.querySelector('#edit-open');
const editQuery = document.querySelector('#edit-query');
const editReplacement = document.querySelector('#edit-replacement');
const editCase = document.querySelector('#edit-case');
const editResult = document.querySelector('#edit-result');
const editGutter = document.querySelector('#code-lines');
const editMirror = document.querySelector('#code-measure');
let editReady = false;
let editView = { size: 16, wrap: true, numbers: true };
let editBaseline = '';
let editBefore = null;
let editUndo = [];
let editRedo = [];
let editApplying = false;
let editGroup = null;
let editSearch = { code: null, query: null, sensitive: false, count: 0, index: -1, range: null };
let editLayoutFrame = 0;
let editMeasured = null;
let errorSource = null;
let errorTarget = null;

function editSelection() {
  return { start: codeField.selectionStart, end: codeField.selectionEnd, direction: codeField.selectionDirection };
}

function editPatch(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  return { start, removed: before.slice(start, endBefore), added: after.slice(start, endAfter) };
}

function trimEditUndo() {
  let size = 0;
  for (let i = editUndo.length - 1; i >= 0; i--) {
    size += editUndo[i].removed.length + editUndo[i].added.length;
    if ((size > 8_000_000 || editUndo.length - i > 100) && i < editUndo.length - 1) {
      editUndo.splice(0, i + 1);
      break;
    }
  }
}

function resetCodeEdits() {
  editBaseline = codeField.value;
  editUndo = [];
  editRedo = [];
  editBefore = null;
  editGroup = null;
  editSearch.code = null;
  scheduleCodeLayout();
}

function recordCodeEdit(event) {
  if (!editReady || editApplying) return;
  const after = codeField.value;
  if (after === editBaseline) return;
  const beforeSelection = editBefore || { start: 0, end: 0, direction: 'none' };
  const type = event?.inputType || '';
  const now = performance.now();
  const groupable = ['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertCompositionText'].includes(type);
  const last = editUndo.at(-1);
  const merge = groupable && editGroup?.type === type && now - editGroup.time < 800 && last
    && beforeSelection.start === last.after.start && beforeSelection.end === last.after.end;
  if (merge) {
    // Reconstruct only the previous edit's starting text, not a chain of full copies.
    const original = editBaseline.slice(0, last.start) + last.removed + editBaseline.slice(last.start + last.added.length);
    Object.assign(last, editPatch(original, after), { after: editSelection() });
  } else {
    editUndo.push({ ...editPatch(editBaseline, after), before: beforeSelection, after: editSelection() });
  }
  editBaseline = after;
  editBefore = null;
  editRedo = [];
  editGroup = groupable ? { type, time: now } : null;
  trimEditUndo();
  editSearch.code = null;
  scheduleCodeLayout();
}

function changeCodeFromEditor(next, selection) {
  if (next === codeField.value) return;
  editBefore = editSelection();
  codeField.value = next;
  codeField.setSelectionRange(selection.start, selection.end);
  codeField.dispatchEvent(new Event('input', { bubbles: true }));
}

function undoCodeEdit(redo = false) {
  if ((running && !isSplitWorkspace()) || modeBusy || codeField.readOnly) return;
  const source = redo ? editRedo : editUndo;
  const target = redo ? editUndo : editRedo;
  const patch = source.pop();
  if (!patch) return;
  const remove = redo ? patch.removed : patch.added;
  const insert = redo ? patch.added : patch.removed;
  const selection = redo ? patch.after : patch.before;
  editApplying = true;
  codeField.value = codeField.value.slice(0, patch.start) + insert + codeField.value.slice(patch.start + remove.length);
  codeField.setSelectionRange(selection.start, selection.end, selection.direction);
  editBaseline = codeField.value;
  target.push(patch);
  editBefore = null;
  editGroup = null;
  editSearch.code = null;
  try { codeField.dispatchEvent(new Event('input', { bubbles: true })); }
  finally { editApplying = false; }
  revealCodeRange(selection.start, selection.end, selection.direction);
}

function editSearchPattern(query, sensitive) {
  // Both search text and replacement text are literal.
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), sensitive ? 'gu' : 'giu');
}

function selectEditMatch(index) {
  const regex = editSearchPattern(editSearch.query, editSearch.sensitive);
  let match, current = 0;
  while ((match = regex.exec(editSearch.code))) {
    if (current++ !== index) continue;
    editSearch.index = index;
    editSearch.range = [match.index, match.index + match[0].length];
    break;
  }
}

function refreshEditSearch(reset = false) {
  const code = codeField.value, query = editQuery.value, sensitive = editCase.checked;
  if (reset || editSearch.code !== code || editSearch.query !== query || editSearch.sensitive !== sensitive) {
    let count = 0, index = -1, range = null;
    if (query) {
      const regex = editSearchPattern(query, sensitive);
      let match;
      // Keep only the active range: common characters in large libraries can
      // have millions of matches and must not allocate millions of arrays.
      while ((match = regex.exec(code))) {
        const start = match.index, end = start + match[0].length;
        if (!count || (start === codeField.selectionStart && end === codeField.selectionEnd)) {
          range = [start, end]; index = count;
        }
        count++;
      }
    }
    editSearch = { code, query, sensitive, count, index, range };
  }
  const count = editSearch.count;
  editResult.textContent = !query ? 'Введите текст для поиска.' : count ? `${editSearch.index + 1} из ${count}` : 'Совпадений нет.';
  for (const id of ['edit-prev', 'edit-next', 'edit-show', 'edit-replace', 'edit-replace-all']) document.getElementById(id).disabled = !count;
  const range = editSearch.range;
  const snippet = document.querySelector('#edit-snippet');
  snippet.replaceChildren();
  if (range) {
    const [start, end] = range;
    const mark = document.createElement('mark');
    mark.textContent = code.slice(start, Math.min(end, start + 200)) + (end - start > 200 ? '…' : '');
    snippet.append(code.slice(Math.max(0, start - 65), start), mark, code.slice(end, end + 100));
    document.querySelector('#edit-location').textContent = `Строка ${code.slice(0, start).split('\n').length}`;
  } else document.querySelector('#edit-location').textContent = '';
  snippet.hidden = !range;
}

function replaceEditMatch(all = false) {
  if (modeBusy || codeField.readOnly || (running && !isSplitWorkspace())) return;
  refreshEditSearch();
  if (!editSearch.count) return;
  const count = all ? editSearch.count : 1;
  const source = codeField.value, replacement = editReplacement.value;
  if (all) selectEditMatch(0);
  const [start, end] = editSearch.range;
  const next = all ? source.replace(editSearchPattern(editSearch.query, editSearch.sensitive), () => replacement)
    : source.slice(0, start) + replacement + source.slice(end);
  changeCodeFromEditor(next, { start, end: start + replacement.length });
  refreshEditSearch(true);
  document.querySelector('#edit-feedback').textContent = next === source ? 'Текст не изменился.' : `Заменено: ${count}. Можно отменить.`;
}

function updateCodeTools() {
  const blocked = (running && !isSplitWorkspace()) || modeBusy;
  editButton.disabled = !expertMode || blocked || readingClipboard || extractionOpen;
  editButton.setAttribute('aria-pressed', String(currentPanel() === editPanel));
  document.querySelector('#edit-undo').disabled = !editUndo.length || blocked || codeField.readOnly;
  document.querySelector('#edit-redo').disabled = !editRedo.length || blocked || codeField.readOnly;
  scheduleCodeLayout();
}

function openCodeTools() {
  if (editButton.disabled) return;
  editGroup = null;
  document.querySelector('#edit-feedback').textContent = '';
  document.querySelector('#edit-line-feedback').textContent = '';
  refreshEditSearch();
  showWorkspacePanel(editPanel);
}

function applyCodeView() {
  codeField.style.fontSize = `${editView.size}px`;
  codeField.wrap = editView.wrap ? 'soft' : 'off';
  workspaceElement.classList.toggle('code-numbered', editView.numbers);
  document.querySelector('#edit-font').value = String(editView.size);
  document.querySelector('#edit-wrap').checked = editView.wrap;
  document.querySelector('#edit-numbers').checked = editView.numbers;
  editMeasured = null;
  scheduleCodeLayout();
}

function measureCode() {
  const style = getComputedStyle(codeField);
  const code = codeField.value;
  const signature = [code, codeField.clientWidth, style.fontSize, editView.wrap, style.paddingTop, style.paddingLeft];
  if (editMeasured && signature.every((value, i) => value === editMeasured.signature[i])) return editMeasured;
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) editMirror.style[key] = style[key];
  editMirror.style.width = `${codeField.clientWidth}px`;
  editMirror.style.whiteSpace = editView.wrap ? 'pre-wrap' : 'pre';
  editMirror.style.overflowWrap = editView.wrap ? 'break-word' : 'normal';
  const starts = [0];
  let at = -1;
  while ((at = code.indexOf('\n', at + 1)) >= 0) starts.push(at + 1);
  // Separate formatting blocks avoid laying out an entire large document as
  // one wrapped paragraph. Text stays inert and source offsets stay unchanged.
  const lines = starts.map((start, index) => {
    const line = document.createElement('div');
    const end = index + 1 < starts.length ? starts[index + 1] - 1 : code.length;
    line.textContent = code.slice(start, end) + '\u200b';
    return line;
  });
  editMirror.replaceChildren(...lines);
  editMeasured = { signature, starts, lineHeight: parseFloat(style.lineHeight) };
  return editMeasured;
}

function codePointRect(offset) {
  const range = document.createRange();
  const { starts, signature } = editMeasured;
  const absolute = Math.max(0, Math.min(offset, signature[0].length));
  let low = 0, high = starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= absolute) low = mid;
    else high = mid;
  }
  const node = editMirror.children[low].firstChild;
  const position = absolute - starts[low];
  range.setStart(node, position);
  range.setEnd(node, position + 1);
  const rect = range.getBoundingClientRect(), origin = editMirror.getBoundingClientRect();
  return { top: rect.top - origin.top, left: rect.left - origin.left, height: rect.height };
}

function drawCodeLines() {
  editLayoutFrame = 0;
  editGutter.hidden = !editView.numbers || codeField.hidden || Boolean(currentPanel());
  if (editGutter.hidden) return;
  const { starts, lineHeight } = measureCode();
  const digits = String(starts.length).length;
  const width = `${Math.max(3, digits + 1)}ch`;
  if (workspaceElement.style.getPropertyValue('--line-width') !== width) {
    workspaceElement.style.setProperty('--line-width', width);
    measureCode();
  }
  let low = 0, high = starts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (codePointRect(starts[mid]).top < codeField.scrollTop) low = mid + 1;
    else high = mid;
  }
  const nodes = [];
  for (let i = Math.max(0, low - 1); i < starts.length; i++) {
    const top = codePointRect(starts[i]).top - codeField.scrollTop;
    if (top > codeField.clientHeight) break;
    const number = document.createElement('span');
    number.textContent = String(i + 1);
    number.style.top = `${top}px`;
    number.style.height = `${lineHeight}px`;
    nodes.push(number);
  }
  editGutter.style.fontSize = `${editView.size}px`;
  editGutter.replaceChildren(...nodes);
}

function scheduleCodeLayout() {
  if (editReady && !editLayoutFrame) editLayoutFrame = requestAnimationFrame(drawCodeLines);
}

function revealCodeRange(start, end = start, direction = 'none') {
  if (running && !isSplitWorkspace()) stopPreview();
  closeWorkspacePanels(false);
  closeHistory();
  closeComparison();
  closeLibraryExtraction();
  updateControls();
  codeField.focus({ preventScroll: true });
  codeField.setSelectionRange(start, end, direction);
  const position = () => {
    measureCode();
    const rect = codePointRect(start);
    codeField.scrollTop = Math.max(0, rect.top - codeField.clientHeight / 3);
    codeField.scrollLeft = editView.wrap ? 0 : Math.max(0, rect.left - codeField.clientWidth / 3);
    rememberEditorPosition();
    scheduleCodeLayout();
  };
  position();
  requestAnimationFrame(position);
}

function goToCodeLine(line, column = 1) {
  const { starts } = measureCode();
  if (!Number.isInteger(line) || line < 1 || line > starts.length) return false;
  const start = starts[line - 1], end = line < starts.length ? starts[line] - 1 : codeField.value.length;
  const at = Math.min(end, start + Math.max(0, column - 1));
  revealCodeRange(at, column > 1 ? Math.min(end, at + 1) : end);
  return true;
}

function locateRuntimeError(detail) {
  errorTarget = null;
  if (!errorSource || errorSource.code !== codeField.value || !Number.isInteger(detail.line) || !['about:srcdoc', 'about:blank'].includes(detail.filename)) return;
  const line = detail.line - errorSource.lines;
  const column = Math.max(1, (Number.isInteger(detail.column) ? detail.column : 1) - (line === 1 ? errorSource.column : 0));
  if (Number.isInteger(line) && line > 0 && line <= codeField.value.split('\n').length) errorTarget = { line, column };
}

function initCodeEditor() {
  try {
    const saved = JSON.parse(localStorage.getItem('onehtml-lab-editor-view'));
    if ([14, 16, 18, 20, 22].includes(saved?.size)) editView.size = saved.size;
    editView.wrap = saved?.wrap !== false;
    editView.numbers = saved?.numbers !== false;
  } catch {}
  editReady = true;
  applyCodeView();
  editButton.addEventListener('click', openCodeTools);
  document.querySelector('#edit-close').addEventListener('click', () => closeWorkspacePanel());
  codeField.addEventListener('beforeinput', event => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
      if (event.cancelable) { event.preventDefault(); undoCodeEdit(event.inputType === 'historyRedo'); }
      return;
    }
    editBefore = editSelection();
  });
  codeField.addEventListener('pointerdown', () => { editGroup = null; });
  codeField.addEventListener('blur', () => { editGroup = null; });
  codeField.addEventListener('scroll', scheduleCodeLayout);
  codeField.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') { event.preventDefault(); undoCodeEdit(key === 'y' || event.shiftKey); }
    else if (expertMode && ['f', 'h', 'g'].includes(key)) {
      event.preventDefault(); openCodeTools();
      document.querySelector(key === 'g' ? '#edit-line' : '#edit-query').focus();
    }
  });
  document.querySelector('#edit-undo').addEventListener('click', () => undoCodeEdit());
  document.querySelector('#edit-redo').addEventListener('click', () => undoCodeEdit(true));
  editQuery.addEventListener('input', () => refreshEditSearch(true));
  editCase.addEventListener('change', () => refreshEditSearch(true));
  for (const [id, step] of [['edit-prev', -1], ['edit-next', 1]]) document.getElementById(id).addEventListener('click', () => {
    refreshEditSearch();
    if (editSearch.count) selectEditMatch((editSearch.index + step + editSearch.count) % editSearch.count);
    refreshEditSearch();
  });
  document.querySelector('#edit-show').addEventListener('click', () => {
    refreshEditSearch();
    const range = editSearch.range;
    if (range) revealCodeRange(...range);
  });
  document.querySelector('#edit-replace').addEventListener('click', () => replaceEditMatch());
  document.querySelector('#edit-replace-all').addEventListener('click', () => replaceEditMatch(true));
  document.querySelector('#edit-line-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!goToCodeLine(Number(document.querySelector('#edit-line').value))) document.querySelector('#edit-line-feedback').textContent = `Введите номер от 1 до ${measureCode().starts.length}.`;
  });
  for (const id of ['edit-font', 'edit-wrap', 'edit-numbers']) document.getElementById(id).addEventListener('change', () => {
    editView = { size: Number(document.querySelector('#edit-font').value), wrap: document.querySelector('#edit-wrap').checked, numbers: document.querySelector('#edit-numbers').checked };
    applyCodeView();
    try { localStorage.setItem('onehtml-lab-editor-view', JSON.stringify(editView)); }
    catch { document.querySelector('#edit-feedback').textContent = 'Настройки действуют сейчас, но браузер не сохранил их.'; }
  });
  document.querySelector('#error-line').addEventListener('click', () => { if (errorTarget && errorSource?.code === codeField.value) goToCodeLine(errorTarget.line, errorTarget.column); });
  new ResizeObserver(scheduleCodeLayout).observe(codeField);
}
