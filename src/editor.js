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
let editView = { size: 16, wrap: true, numbers: true, colors: 'accents' };
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
const editInline = document.querySelector('#edit-inline');
const editQuick = document.querySelector('#edit-quick');
let editFindOpen = false;
let editGeometryFrame = 0;
let editRevealCaret = false;

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
  for (const id of ['edit-prev', 'edit-next', 'edit-replace', 'edit-replace-all']) document.getElementById(id).disabled = !count || (id.startsWith('edit-replace') && codeField.readOnly);
  scheduleCodeLayout();
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
  updateInlineEditor();
  scheduleCodeLayout();
}

function inlineEditorAvailable() {
  return expertMode && editorWorkspaceAvailable();
}

function editorWorkspaceAvailable() {
  return editReady && !modeBusy && !readingClipboard && !codeField.disabled && !codeField.hidden && !currentPanel() && !historyOpen && !comparisonOpen && !extractionOpen;
}

function updateInlineGeometry() {
  const captionHeight = syntaxCaption.hidden ? 0 : syntaxCaption.offsetHeight;
  workspaceElement.style.setProperty('--syntax-caption-height', `${captionHeight}px`);
  for (const [name, element] of [['--edit-top', editInline], ['--edit-bottom', editQuick]]) {
    const size = `${(element.hidden ? 0 : element.offsetHeight) + (name === '--edit-bottom' ? captionHeight : 0)}px`;
    if (workspaceElement.style.getPropertyValue(name) !== size) {
      workspaceElement.style.setProperty(name, size);
      if (document.activeElement === codeField) editRevealCaret = true;
    }
  }
  scheduleCodeLayout();
}

function scheduleInlineGeometry() {
  if (!editGeometryFrame) editGeometryFrame = requestAnimationFrame(() => { editGeometryFrame = 0; updateInlineGeometry(); });
}

function updateInlineEditor() {
  if (!editReady) return;
  const available = inlineEditorAvailable();
  if (!available) appElement.classList.remove('editing-active');
  if (!expertMode) { editFindOpen = false; appElement.classList.remove('editing-active'); }
  editInline.hidden = !available || !editFindOpen;
  editQuick.hidden = !editorWorkspaceAvailable();
  document.querySelector('#edit-quick-tools').hidden = !available || codeField.readOnly;
  document.querySelector('#edit-find').setAttribute('aria-pressed', String(editFindOpen));
  document.querySelector('#edit-quick-undo').disabled = !editUndo.length;
  document.querySelector('#edit-quick-redo').disabled = !editRedo.length;
  document.querySelector('#edit-copy-selection').disabled = codeField.selectionStart === codeField.selectionEnd;
  if (!editInline.hidden) refreshEditSearch();
  updateInlineGeometry();
}

function showInlineMatch() {
  if (editSearch.range) revealCodeRange(...editSearch.range, 'none', false);
}

function openInlineSearch(replace = false) {
  if (!expertMode || modeBusy || (running && !isSplitWorkspace())) return;
  closeWorkspacePanels(false);
  editFindOpen = true;
  document.querySelector('#edit-replace-box').hidden = !replace;
  document.querySelector('#edit-replace-toggle').setAttribute('aria-expanded', String(replace));
  updateInlineEditor(); refreshEditSearch();
  editQuery.focus({ preventScroll: true }); showInlineMatch();
}

function closeInlineSearch() {
  editFindOpen = false; updateInlineEditor();
  codeField.focus({ preventScroll: true });
}

// Two-space indentation changes only the touched lines; an endpoint at the next
// line's beginning does not include that line. Tabs are removed as one indent.
function indentCodeSelection(code, start, end, outdent) {
  const first = start ? code.lastIndexOf('\n', start - 1) + 1 : 0;
  const last = end > start && code[end - 1] === '\n' ? end - 1 : end;
  const changes = [];
  for (let at = first; at <= last;) {
    const length = outdent ? /^(?:\t| {1,2})/.exec(code.slice(at, at + 2))?.[0].length || 0 : 0;
    if (!outdent || length) changes.push({ at, length, insert: outdent ? '' : '  ' });
    const newline = code.indexOf('\n', at);
    if (newline < 0) break;
    at = newline + 1;
  }
  const parts = [];
  let cursor = 0;
  for (const change of changes) {
    parts.push(code.slice(cursor, change.at), change.insert);
    cursor = change.at + change.length;
  }
  parts.push(code.slice(cursor));
  const map = position => position + changes.reduce((delta, change) => delta + (change.at <= position ? change.insert.length - Math.min(change.length, position - change.at) : 0), 0);
  return { code: parts.join(''), start: map(start), end: map(end) };
}

function quickCodeEdit(pair, outdent) {
  if (!inlineEditorAvailable() || codeField.readOnly || codeField.disabled) return;
  const { start, end } = editSelection(), code = codeField.value;
  const next = pair ? { code: code.slice(0, start) + pair[0] + code.slice(start, end) + pair[1] + code.slice(end), start: start + 1, end: end + 1 }
    : indentCodeSelection(code, start, end, outdent);
  changeCodeFromEditor(next.code, next);
  revealCodeRange(next.start, next.end);
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
  // Textarea line boxes and separate painted blocks round fractional heights
  // differently. Whole CSS pixels keep caret, hit testing and text aligned.
  codeField.style.lineHeight = `${Math.ceil(editView.size * 1.65)}px`;
  codeField.wrap = editView.wrap ? 'soft' : 'off';
  workspaceElement.classList.toggle('code-numbered', editView.numbers);
  document.querySelector('#edit-font').value = String(editView.size);
  document.querySelector('#edit-wrap').checked = editView.wrap;
  document.querySelector('#edit-numbers').checked = editView.numbers;
  document.querySelector('#edit-colors').value = editView.colors;
  editMeasured = null;
  scheduleCodeLayout();
}

function measureCode() {
  const style = getComputedStyle(codeField);
  const code = codeField.value;
  // clientWidth is rounded to an integer. At a wrapping boundary even half a
  // pixel changes the number of visual lines, so retain the fractional width.
  const width = codeField.getBoundingClientRect().width - (codeField.offsetWidth - codeField.clientWidth);
  const signature = [code, width, style.fontSize, editView.wrap, style.paddingTop, style.paddingLeft, style.lineHeight];
  if (editMeasured && signature.every((value, i) => value === editMeasured.signature[i])) return editMeasured;
  for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) editMirror.style[key] = style[key];
  editMirror.style.width = `${width}px`;
  editMirror.style.whiteSpace = editView.wrap ? 'pre-wrap' : 'pre';
  editMirror.style.overflowWrap = editView.wrap ? 'break-word' : 'normal';
  const starts = [0];
  let at = -1;
  while ((at = code.indexOf('\n', at + 1)) >= 0) starts.push(at + 1);
  // Separate formatting blocks avoid laying out an entire large document as
  // one wrapped paragraph. Text stays inert and source offsets stay unchanged.
  if (alternativeActive()) { editMeasured = { signature, starts, width, lineHeight: parseFloat(style.lineHeight) }; return editMeasured; }
  const lines = starts.map((start, index) => {
    const line = document.createElement('div');
    const end = index + 1 < starts.length ? starts[index + 1] - 1 : code.length;
    // A sentinel after trailing spaces makes them wrap instead of hang like
    // native textarea text. Only empty lines need it to create a line box.
    line.textContent = code.slice(start, end) || '\u200b';
    return line;
  });
  editMirror.replaceChildren(...lines);
  editMeasured = { signature, starts, width, lineHeight: parseFloat(style.lineHeight) };
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
  range.setEnd(node, Math.min(position + 1, node.length));
  const rect = range.getBoundingClientRect(), origin = editMirror.getBoundingClientRect();
  return { top: rect.top - origin.top, left: rect.left - origin.left, height: rect.height };
}

function drawCodeLines() {
  editLayoutFrame = 0;
  updateAlternativeEditor();
  if (alternativeActive()) {
    editRevealCaret = false;
    editGutter.hidden = true;
    document.querySelector('#edit-highlight').hidden = true;
    codeField.classList.remove('has-colors'); syntaxLayer.hidden = true;
    alternativeCaption();
    return;
  }
  editGutter.hidden = !editView.numbers || codeField.hidden || Boolean(currentPanel());
  if (codeField.hidden || currentPanel()) { document.querySelector('#edit-highlight').hidden = true; clearCodeColors(); return; }
  if (editGutter.hidden && editInline.hidden && editView.colors === 'off' && !editRevealCaret) { document.querySelector('#edit-highlight').hidden = true; clearCodeColors(); return; }
  let { starts, lineHeight } = measureCode();
  if (!editGutter.hidden) {
    const digits = String(starts.length).length;
    const width = `${Math.max(3, digits + 1)}ch`;
    if (workspaceElement.style.getPropertyValue('--line-width') !== width) {
      workspaceElement.style.setProperty('--line-width', width);
      ({ starts, lineHeight } = measureCode());
    }
  }
  if (editRevealCaret) {
    editRevealCaret = false;
    if (document.activeElement === codeField && codeField.selectionStart === codeField.selectionEnd) {
      const caret = codePointRect(codeField.selectionStart), margin = Math.min(8, codeField.clientHeight / 4);
      if (caret.top < codeField.scrollTop + margin) codeField.scrollTop = Math.max(0, caret.top - margin);
      else if (caret.top + caret.height > codeField.scrollTop + codeField.clientHeight - margin) codeField.scrollTop = caret.top + caret.height - codeField.clientHeight + margin;
    }
  }
  drawCodeColors();
  drawSearchHighlight();
  if (editGutter.hidden) return;
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

function drawSearchHighlight() {
  const highlight = document.querySelector('#edit-highlight');
  const range = editSearch.range;
  highlight.hidden = editInline.hidden || !range || editSearch.code !== codeField.value;
  if (highlight.hidden) return;
  const rect = codeField.getBoundingClientRect(), origin = workspaceElement.getBoundingClientRect();
  Object.assign(highlight.style, { top: `${rect.top - origin.top}px`, left: `${rect.left - origin.left}px`, width: `${codeField.clientWidth}px`, height: `${codeField.clientHeight}px` });
  const mirror = editMirror.getBoundingClientRect(), starts = editMeasured.starts;
  let low = 0, high = starts.length;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (codePointRect(starts[mid]).top < codeField.scrollTop) low = mid; else high = mid; }
  const nodes = [];
  for (let i = low; i < starts.length; i++) {
    if (starts[i] >= range[1] || codePointRect(starts[i]).top - codeField.scrollTop > codeField.clientHeight) break;
    const from = Math.max(range[0], starts[i]), to = Math.min(range[1], i + 1 < starts.length ? starts[i + 1] - 1 : codeField.value.length);
    if (to <= from) continue;
    const selection = document.createRange(), node = editMirror.children[i].firstChild;
    selection.setStart(node, from - starts[i]); selection.setEnd(node, to - starts[i]);
    for (const part of selection.getClientRects()) {
      const top = part.top - mirror.top - codeField.scrollTop, left = part.left - mirror.left - codeField.scrollLeft;
      if (top + part.height < 0 || top > codeField.clientHeight) continue;
      const marker = document.createElement('span');
      Object.assign(marker.style, { top: `${top}px`, left: `${left}px`, width: `${part.width}px`, height: `${part.height}px` });
      nodes.push(marker);
      if (nodes.length >= 200) break;
    }
    if (nodes.length >= 200) break;
  }
  highlight.replaceChildren(...nodes);
}

function scheduleCodeLayout() {
  if (editReady && !editLayoutFrame) editLayoutFrame = requestAnimationFrame(drawCodeLines);
}

function revealCodeRange(start, end = start, direction = 'none', focus = true) {
  if (running && !isSplitWorkspace()) stopPreview();
  closeWorkspacePanels(false);
  closeHistory();
  closeComparison();
  closeLibraryExtraction();
  updateControls();
  if (focus) codeField.focus({ preventScroll: true });
  codeField.setSelectionRange(start, end, direction);
  if (alternativeActive()) { selectAlternativeRange(start, end, direction, true); rememberEditorPosition(); return; }
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
    if (['off','syntax','accents'].includes(saved?.colors)) editView.colors = saved.colors;
  } catch {}
  editReady = true;
  applyCodeView();
  editButton.addEventListener('click', openCodeTools);
  codeField.addEventListener('compositionstart', () => { syntaxComposing = true; clearCodeColors(); });
  codeField.addEventListener('compositionend', () => { syntaxComposing = false; scheduleCodeLayout(); });
  document.addEventListener('selectionchange', () => { if (document.activeElement === codeField) scheduleCodeLayout(); });
  for (const event of ['focus', 'select', 'keyup', 'click']) codeField.addEventListener(event, scheduleCodeLayout);
  for (const event of ['input', 'keyup']) codeField.addEventListener(event, () => {
    if (document.activeElement === codeField) editRevealCaret = true;
    scheduleCodeLayout();
  });
  document.querySelector('#edit-panel-find').addEventListener('click', () => openInlineSearch());
  document.querySelector('#edit-find').addEventListener('click', () => editFindOpen ? closeInlineSearch() : openInlineSearch());
  document.querySelector('#edit-find-close').addEventListener('click', closeInlineSearch);
  document.querySelector('#edit-quick-settings').addEventListener('click', openCodeTools);
  document.querySelector('#edit-replace-toggle').addEventListener('click', event => {
    const box = document.querySelector('#edit-replace-box'); box.hidden = !box.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!box.hidden)); updateInlineGeometry(); showInlineMatch();
  });
  editInline.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeInlineSearch(); }
    if (event.key === 'Enter' && event.target === editQuery) { event.preventDefault(); document.querySelector(event.shiftKey ? '#edit-prev' : '#edit-next').click(); }
  });
  document.querySelector('#edit-quick-undo').addEventListener('click', () => undoCodeEdit());
  document.querySelector('#edit-quick-redo').addEventListener('click', () => undoCodeEdit(true));
  for (const button of editQuick.querySelectorAll('[data-edit-pair], [data-edit-indent]')) button.addEventListener('click', () => quickCodeEdit(button.dataset.editPair, button.dataset.editIndent === 'out'));
  editQuick.addEventListener('mousedown', event => { if (event.target.closest('button') && document.activeElement === codeField) event.preventDefault(); });
  document.querySelector('#edit-copy-selection').addEventListener('click', () => {
    if (!inlineEditorAvailable()) return;
    const text = codeField.value.slice(codeField.selectionStart, codeField.selectionEnd);
    if (text) { rememberEditorPosition(); void copyOrSelect(text, 'Выделенный фрагмент скопирован.'); }
  });
  document.querySelector('#edit-range-form').addEventListener('submit', event => {
    event.preventDefault();
    const first = Number(document.querySelector('#edit-range-start').value), last = Number(document.querySelector('#edit-range-end').value);
    const { starts } = measureCode();
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > starts.length) {
      document.querySelector('#edit-range-feedback').textContent = `Укажите строки от 1 до ${starts.length}; последняя не меньше первой.`; return;
    }
    revealCodeRange(starts[first - 1], last < starts.length ? starts[last] : codeField.value.length);
  });
  // Keep the compact layout while moving focus to a toolbar button: restoring
  // the header on pointerdown would move the button before its click arrives.
  const updateFocus = () => { if (expertMode && (document.activeElement === codeField || editInline.contains(document.activeElement) || editQuick.contains(document.activeElement))) appElement.classList.add('editing-active'); };
  document.addEventListener('focusin', updateFocus);
  document.addEventListener('focusout', () => queueMicrotask(updateFocus));
  document.addEventListener('selectionchange', () => { if (!editQuick.hidden) document.querySelector('#edit-copy-selection').disabled = codeField.selectionStart === codeField.selectionEnd; });
  new ResizeObserver(scheduleInlineGeometry).observe(editInline);
  new ResizeObserver(scheduleInlineGeometry).observe(editQuick);
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
    if (event.key === 'Escape' && editFindOpen) { event.preventDefault(); closeInlineSearch(); return; }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') { event.preventDefault(); undoCodeEdit(key === 'y' || event.shiftKey); }
    else if (expertMode && ['f', 'h', 'g'].includes(key)) {
      event.preventDefault();
      if (key === 'g') { openCodeTools(); document.querySelector('#edit-line').focus(); }
      else openInlineSearch(key === 'h');
    }
  });
  document.querySelector('#edit-undo').addEventListener('click', () => undoCodeEdit());
  document.querySelector('#edit-redo').addEventListener('click', () => undoCodeEdit(true));
  editQuery.addEventListener('input', () => { refreshEditSearch(true); showInlineMatch(); });
  editCase.addEventListener('change', () => { refreshEditSearch(true); showInlineMatch(); });
  for (const [id, step] of [['edit-prev', -1], ['edit-next', 1]]) document.getElementById(id).addEventListener('click', () => {
    refreshEditSearch();
    if (editSearch.count) selectEditMatch((editSearch.index + step + editSearch.count) % editSearch.count);
    refreshEditSearch();
    showInlineMatch();
  });
  document.querySelector('#edit-replace').addEventListener('click', () => { replaceEditMatch(); showInlineMatch(); });
  document.querySelector('#edit-replace-all').addEventListener('click', () => { replaceEditMatch(true); showInlineMatch(); });
  document.querySelector('#edit-line-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!goToCodeLine(Number(document.querySelector('#edit-line').value))) document.querySelector('#edit-line-feedback').textContent = `Введите номер от 1 до ${measureCode().starts.length}.`;
  });
  for (const id of ['edit-font', 'edit-wrap', 'edit-numbers', 'edit-colors']) document.getElementById(id).addEventListener('change', () => {
    editView = { size: Number(document.querySelector('#edit-font').value), wrap: document.querySelector('#edit-wrap').checked, numbers: document.querySelector('#edit-numbers').checked, colors: document.querySelector('#edit-colors').value };
    applyCodeView();
    try { localStorage.setItem('onehtml-lab-editor-view', JSON.stringify(editView)); }
    catch { document.querySelector('#edit-view-feedback').textContent = 'Настройки действуют сейчас, но браузер не сохранил их.'; }
  });
  document.querySelector('#error-line').addEventListener('click', () => { if (errorTarget && errorSource?.code === codeField.value) goToCodeLine(errorTarget.line, errorTarget.column); });
  new ResizeObserver(scheduleCodeLayout).observe(codeField);
}
