// The textarea remains the source of truth for all application operations.
let alternativeView = null;
let alternativeChoice = 'codemirror';
let editorDark = false;
let alternativeBusy = false;
let alternativeConfig = '';
let alternativeOptions;
let alternativeScan = { source: null, result: null };
const alternativeHost = document.querySelector('#alternative-editor');
const alternativeSelect = document.querySelector('#editor-engine');
const alternativeToggle = document.querySelector('#editor-toggle');
const themeToggle = document.querySelector('#theme-toggle');
const comparisonEditorHost = document.querySelector('#comparison-editor');
let comparisonEditorView = null;
let comparisonDecorationConfig = null;
function alternativeActive() { return alternativeChoice === 'codemirror' && Boolean(alternativeView); }
function alternativeMarks(source) {
  if (alternativeScan.source !== source) alternativeScan = { source, result: scanCodeColors(source) };
  return alternativeScan.result;
}

function alternativeExtensions(readOnly = codeField.readOnly || codeField.disabled) {
  const cm = OneHTMLCodeMirror, tags = cm.tags;
  const palette = editorDark ? ['#c6a3ee', '#a2d4aa', '#e7bd7e', '#97a6ba', '#91baff', '#e3bb87', '#84cbdc'] : ['#7953a0', '#337447', '#98600c', '#687989', '#235ba5', '#875218', '#276785'];
  const extensions = [cm.EditorState.readOnly.of(readOnly), cm.EditorView.editable.of(!readOnly),
    cm.EditorView.theme({ '&': { fontSize: `${editView.size}px`, height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace', lineHeight: '1.65' } }, { dark: editorDark })];
  if (editView.wrap) extensions.push(cm.EditorView.lineWrapping);
  if (editView.numbers) extensions.push(cm.lineNumbers());
  if (editView.colors !== 'off') extensions.push(cm.syntaxHighlighting(cm.HighlightStyle.define([
    { tag: tags.keyword, color: palette[0] }, { tag: tags.string, color: palette[1] }, { tag: tags.number, color: palette[2] },
    { tag: tags.comment, color: palette[3] }, { tag: tags.tagName, color: palette[4] }, { tag: tags.attributeName, color: palette[5] },
    { tag: tags.propertyName, color: palette[5] }, { tag: tags.function(tags.variableName), color: palette[6] }
  ])));
  return extensions;
}

// The comparison owns a read-only view, so folding and selection cannot alter
// the source editor's document, undo chain, cursor or folded ranges.
function clearComparisonEditor() {
  comparisonEditorView?.destroy();
  comparisonEditorView = null;
  comparisonDecorationConfig = null;
  comparisonEditorHost.replaceChildren();
  comparisonEditorHost.hidden = true;
  comparison.classList.remove('uses-codemirror');
}

function renderComparisonEditor(parts) {
  diffContent.style.fontSize = `${editView.size}px`;
  diffContent.style.whiteSpace = editView.wrap ? 'pre-wrap' : 'pre';
  diffContent.style.overflowWrap = editView.wrap ? 'anywhere' : 'normal';
  if (!alternativeActive()) { clearComparisonEditor(); return; }
  const cm = OneHTMLCodeMirror, marks = [];
  const normalizedParts = parts.map(part => ({ type: part.type, text: part.text.replace(/\r\n?/g, '\n') }));
  let source = '';
  for (const part of normalizedParts) {
    const text = part.text, from = source.length;
    source += text;
    if (part.type !== 'same' && text.length) marks.push(cm.Decoration.mark({ class: `diff-${part.type}` }).range(from, source.length));
  }
  class GapWidget extends cm.WidgetType {
    constructor(gap) { super(); this.gap = gap; }
    eq(other) { return this.gap.id === other.gap.id && this.gap.count === other.gap.count; }
    toDOM() {
      const wrapper = document.createElement('div');
      wrapper.className = 'comparison-gap-widget';
      wrapper.append(comparisonGapButton(this.gap));
      return wrapper;
    }
    get estimatedHeight() { return 52; }
  }
  for (const gap of comparisonHiddenGaps(normalizedParts)) {
    marks.push(cm.Decoration.replace({ widget: new GapWidget(gap), block: true }).range(gap.from, gap.to));
  }
  const decorations = cm.EditorView.decorations.of(cm.Decoration.set(marks, true));
  if (comparisonEditorView) {
    comparisonEditorView.dispatch({ effects: comparisonDecorationConfig.reconfigure(decorations) });
    comparisonEditorView.requestMeasure({ write: updateComparisonScrollbar });
    return;
  }
  comparisonDecorationConfig = new cm.Compartment();
  comparisonEditorView = new cm.EditorView({ parent: comparisonEditorHost, state: cm.EditorState.create({ doc: source, extensions: [
    cm.html(), alternativeExtensions(true), cm.drawSelection(), cm.keymap.of(cm.defaultKeymap),
    cm.EditorView.contentAttributes.of({ 'aria-label': 'Сравнение HTML-кода CodeMirror', tabindex: '0' }),
    comparisonDecorationConfig.of(decorations),
    cm.EditorView.updateListener.of(update => { if (update.geometryChanged || update.viewportChanged) requestAnimationFrame(updateComparisonScrollbar); }),
    cm.foldGutter({ markerDOM(open) { const marker = document.createElement('span'); marker.textContent = open ? '−' : '+'; marker.title = open ? 'Свернуть блок' : 'Развернуть блок'; return marker; } }),
    cm.codeFolding()
  ] }) });
  comparisonEditorHost.hidden = false;
  diffContent.hidden = true;
  comparison.classList.add('uses-codemirror');
  comparisonEditorView.scrollDOM.addEventListener('scroll', positionComparisonScrollbar);
  comparisonEditorView.requestMeasure({ write: updateComparisonScrollbar });
}

function alternativeAccents(view) {
  const cm = OneHTMLCodeMirror;
  if (editView.colors !== 'accents') return cm.Decoration.none;
  const source = view.state.doc.toString(), result = alternativeMarks(source);
  if (result.limited || source.split('\n').some(line => line.length > 12000)) return cm.Decoration.none;
  return cm.Decoration.set(result.accents.map(mark => {
    const attributes = { title: mark.label };
    let className = `syntax-accent syntax-accent-${mark.kind}`;
    if (mark.color && CSS.supports('color', mark.color)) {
      className += ' syntax-color'; attributes.style = `--sample-color:${mark.color};--sample-ink:${syntaxColorInk(mark.color)}`;
    }
    return cm.Decoration.mark({ class: className, attributes }).range(mark.start, mark.end);
  }), true);
}

function alternativeCaption() {
  if (!alternativeActive() || alternativeHost.hidden || editView.colors !== 'accents') {
    const visible = !syntaxCaption.hidden; syntaxCaption.hidden = true;
    if (visible) scheduleInlineGeometry();
    return;
  }
  const source = codeField.value, caret = codeField.selectionStart;
  const from = caret ? source.lastIndexOf('\n', caret - 1) + 1 : 0, end = source.indexOf('\n', caret);
  const labels = alternativeMarks(source).accents.filter(a => a.start <= (end < 0 ? source.length : end) && a.end > from).map(a => a.label);
  const wasHidden = syntaxCaption.hidden;
  syntaxCaption.textContent = [...new Set(labels)].slice(0, 2).join(' · ');
  syntaxCaption.hidden = !labels.length;
  if (wasHidden !== syntaxCaption.hidden) scheduleInlineGeometry();
}

function createAlternativeEditor() {
  const cm = OneHTMLCodeMirror;
  alternativeOptions = new cm.Compartment();
  const accents = cm.ViewPlugin.fromClass(class {
    constructor(view) { this.mode = editView.colors; this.decorations = alternativeAccents(view); }
    update(update) { if (update.docChanged || this.mode !== editView.colors) { this.mode = editView.colors; this.decorations = alternativeAccents(update.view); } }
  }, { decorations: plugin => plugin.decorations });
  alternativeView = new cm.EditorView({ parent: alternativeHost, state: cm.EditorState.create({ doc: codeField.value, extensions: [
    cm.html(), alternativeOptions.of(alternativeExtensions()), cm.drawSelection(), cm.highlightActiveLine(), accents,
    cm.EditorView.contentAttributes.of({ 'aria-label': 'HTML-код CodeMirror', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    cm.foldGutter({ markerDOM(open) { const marker = document.createElement('span'); marker.textContent = open ? '−' : '+'; marker.title = open ? 'Свернуть блок' : 'Развернуть блок'; return marker; } }),
    cm.foldService.of((state, from, to) => {
      let found = null;
      for (let node = cm.syntaxTree(state).resolveInner(to, -1); node; node = node.parent) {
        const range = expressionFoldRange(node);
        if (range && range.from >= from && range.from <= to && range.to > range.from) found = range;
      }
      return found;
    }),
    cm.codeFolding({ placeholderDOM(view, onclick, prepared) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cm-foldPlaceholder';
      const count = prepared.lines, last = count % 10, lastTwo = count % 100;
      const unit = lastTwo >= 11 && lastTwo <= 14 ? 'строк' : last === 1 ? 'строка' : last >= 2 && last <= 4 ? 'строки' : 'строк';
      button.textContent = `+ … ${count ? formatUIInteger(count) + ' ' + unit : formatSymbolCount(prepared.characters)}`; button.setAttribute('aria-label', 'Развернуть скрытый код');
      button.onclick = event => {
        cancelSmartFold();
        const position = view.posAtDOM(button); let range = null;
        cm.foldedRanges(view.state).between(position, position, (from, to) => { if (from === position && (!range || to > range.to)) range = { from, to }; });
        if (range) { view.dispatch({ effects: cm.unfoldEffect.of(range) }); event.preventDefault(); }
        else onclick(event);
      };
      return button;
    }, preparePlaceholder(state, range) { const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number; return { lines, characters: lines ? 0 : symbolCount(state.doc.sliceString(range.from, range.to)) }; } }),
    cm.keymap.of([
      { key: 'Mod-Enter', run() { if (!expertMode) return false; if (isSplitWorkspace()) void restartDesktopPreview(); else document.querySelector('#run').click(); return true; } },
      { key: 'Mod-f', run() { if (!expertMode) return false; openInlineSearch(); return true; } },
      { key: 'Mod-h', run() { if (!expertMode) return false; openInlineSearch(true); return true; } },
      { key: 'Mod-g', run() { if (!expertMode) return false; openCodeTools(); document.querySelector('#edit-line').focus(); return true; } },
      cm.indentWithTab, ...cm.defaultKeymap
    ]),
    cm.EditorView.domEventHandlers({
      keydown(event) {
        if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return false;
        event.preventDefault(); undoCodeEdit(key === 'y' || event.shiftKey); return true;
      },
      paste() { codeField.dispatchEvent(new Event('paste')); return false; },
      focus() { if (expertMode) appElement.classList.add('editing-active'); return false; }
    }),
    cm.EditorView.updateListener.of(update => {
      if (alternativeBusy) return;
      const selection = update.state.selection.main;
      if (update.docChanged) {
        const previous = update.startState.selection.main;
        editBefore = { start: previous.from, end: previous.to, direction: previous.anchor > previous.head ? 'backward' : 'forward' };
        alternativeBusy = true;
        codeField.value = update.state.doc.toString();
        codeField.setSelectionRange(selection.from, selection.to, selection.anchor > selection.head ? 'backward' : 'forward');
        const eventType = update.transactions.some(t => t.isUserEvent('input.paste')) ? 'insertFromPaste'
          : update.transactions.some(t => t.isUserEvent('delete.backward')) ? 'deleteContentBackward'
          : update.transactions.some(t => t.isUserEvent('delete.forward')) ? 'deleteContentForward'
          : update.transactions.some(t => t.isUserEvent('input.type.compose')) ? 'insertCompositionText' : 'insertText';
        try { codeField.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: eventType })); }
        finally { alternativeBusy = false; }
        queueMicrotask(() => { updateAlternativeEditor(); updateInlineEditor(); });
      } else if (update.selectionSet) {
        if (update.transactions.some(transaction => transaction.isUserEvent('select'))) cancelSmartFold();
        alternativeBusy = true; codeField.setSelectionRange(selection.from, selection.to, selection.anchor > selection.head ? 'backward' : 'forward'); alternativeBusy = false;
        alternativeCaption();
        document.querySelector('#edit-copy-selection').disabled = selection.empty;
      }
    })
  ] }) });
  alternativeView.scrollDOM.addEventListener('scroll', () => { codeField.scrollTop = alternativeView.scrollDOM.scrollTop; codeField.scrollLeft = alternativeView.scrollDOM.scrollLeft; });
  alternativeHost.addEventListener('pointerdown', cancelSmartFold);
}

function selectAlternativeRange(start, end = start, direction = 'none', scroll = false) {
  if (!alternativeActive() || alternativeBusy) return;
  cancelSmartFold();
  const cm = OneHTMLCodeMirror, effects = [];
  updateAlternativeEditor();
  start = Math.min(start, alternativeView.state.doc.length); end = Math.min(end, alternativeView.state.doc.length);
  cm.foldedRanges(alternativeView.state).between(start, Math.max(start, end), (from, to) => { effects.push(cm.unfoldEffect.of({ from, to })); });
  if (scroll) effects.push(cm.EditorView.scrollIntoView(start, { y: typeof scroll === 'string' ? scroll : 'center' }));
  alternativeBusy = true;
  try { alternativeView.dispatch({ selection: cm.EditorSelection.single(direction === 'backward' ? end : start, direction === 'backward' ? start : end), effects }); }
  finally { alternativeBusy = false; }
  alternativeCaption();
}

function updateAlternativeEditor() {
  if (!alternativeSelect) return;
  alternativeSelect.value = alternativeChoice;
  alternativeSelect.disabled = modeBusy || readingClipboard || Boolean(currentPanel() && currentPanel() !== editPanel) || historyOpen || comparisonOpen || extractionOpen;
  const active = alternativeActive();
  alternativeToggle.disabled = alternativeSelect.disabled;
  alternativeToggle.setAttribute('aria-pressed', String(active));
  document.querySelector('#editor-current').textContent = active ? 'CM' : 'Aa';
  const label = active ? 'Переключить на обычный редактор' : 'Переключить на CodeMirror';
  alternativeToggle.title = `${active ? 'CodeMirror' : 'Обычный редактор'} · ${label}`;
  alternativeToggle.setAttribute('aria-label', label);
  workspaceElement.classList.toggle('alternative-active', active);
  alternativeHost.hidden = !active || codeField.hidden || Boolean(currentPanel());
  alternativeHost.classList.toggle('is-locked', codeField.readOnly);
  for (const id of ['edit-fold-structure', 'edit-unfold-all']) document.querySelector('#' + id).hidden = !active;
  if (!active || alternativeBusy) return;
  const config = JSON.stringify([editView, codeField.readOnly, codeField.disabled, editorDark]);
  alternativeBusy = true;
  try {
    const changes = alternativeView.state.doc.toString() === codeField.value ? null : editPatch(alternativeView.state.doc.toString(), codeField.value);
    if (changes) alternativeView.dispatch({ changes: { from: changes.start, to: changes.start + changes.removed.length, insert: changes.added }, effects: cmUnfoldAll() });
    if (alternativeConfig !== config) { alternativeConfig = config; alternativeView.dispatch({ effects: alternativeOptions.reconfigure(alternativeExtensions()) }); }
    const selection = alternativeView.state.selection.main;
    const anchor = codeField.selectionDirection === 'backward' ? codeField.selectionEnd : codeField.selectionStart;
    const head = codeField.selectionDirection === 'backward' ? codeField.selectionStart : codeField.selectionEnd;
    if (selection.anchor !== anchor || selection.head !== head) alternativeView.dispatch({ selection: OneHTMLCodeMirror.EditorSelection.single(anchor, head) });
  } finally { alternativeBusy = false; }
  alternativeCaption();
  scheduleSmartFold();
}

function cmUnfoldAll() {
  const effects = [];
  OneHTMLCodeMirror.foldedRanges(alternativeView.state).between(0, alternativeView.state.doc.length, (from, to) => effects.push(OneHTMLCodeMirror.unfoldEffect.of({ from, to })));
  return effects;
}

function expressionFoldRange(node) {
  if (node.name === 'ArrowFunction' && node.lastChild?.name !== 'Block') {
    const arrow = node.getChild('Arrow');
    return arrow && node.lastChild && !node.lastChild.type.isError ? { from: arrow.to, to: node.to } : null;
  }
  // JSON data uses a mounted parser without CodeMirror's fold properties.
  if (['Array', 'Object'].includes(node.name)) {
    const first = node.firstChild, last = node.lastChild;
    if ((first?.name === '[' && last?.name === ']') || (first?.name === '{' && last?.name === '}')) return { from: first.to, to: last.from };
  }
  return null;
}

// Keep nested ranges: unfolding a parent reveals the next level of structure.
function structureFoldRanges(doc, tree) {
  const ranges = [], trivia = [], seen = new Set();
  const containers = new Set(['main', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'div', 'form', 'table', 'ul', 'ol', 'svg', 'template', 'dialog', 'canvas']);
  tree.iterate({ enter(ref) {
    const node = ref.node, open = node.firstChild, close = node.lastChild;
    if (['Comment', 'LineComment', 'BlockComment', ';', ','].includes(node.name)) trivia.push({ from: node.from, to: node.to });
    let range = null;
    if (node.name === 'Element' && open?.name === 'OpenTag' && close?.name === 'CloseTag') {
      const name = open.getChild('TagName'), endName = close.getChild('TagName');
      const tag = name ? doc.sliceString(name.from, name.to).toLowerCase() : '';
      const matched = endName && tag === doc.sliceString(endName.from, endName.to).toLowerCase();
      const lines = doc.lineAt(close.from).number - doc.lineAt(open.to).number;
      const size = close.from - open.to, code = tag === 'script' || tag === 'style';
      if (matched && (code ? lines >= 2 || size >= 120 : containers.has(tag) && (lines >= 8 || size >= 600))) {
        range = { from: open.to, to: close.from };
      }
    } else if (node.name === 'ArrowFunction') range = expressionFoldRange(node);
    else if (['Block', 'ClassBody', 'SwitchBody', 'EnumBody', 'ArrayExpression', 'ObjectExpression', 'ObjectType', 'KeyframeList', 'Array', 'Object'].includes(node.name)) {
      const candidate = node.type.prop(OneHTMLCodeMirror.foldNodeProp)?.(node) || expressionFoldRange(node);
      const matched = (open?.name === '{' && close?.name === '}') || (open?.name === '[' && close?.name === ']');
      if (candidate && matched) {
        const lines = doc.lineAt(candidate.to).number - doc.lineAt(candidate.from).number;
        const functionBody = node.name === 'Block' && (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration'].includes(node.parent?.name) || (node.parent?.name === 'Property' && node.parent.getChild('ParamList')));
        if (functionBody || node.name === 'ClassBody' || lines >= 2 || candidate.to - candidate.from >= 120) range = candidate;
      }
    }
    if (range && range.to > range.from) {
      const key = `${range.from}:${range.to}`;
      if (!seen.has(key)) { ranges.push({ ...range, node, children: [] }); seen.add(key); }
    }
  } });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  trivia.sort((a, b) => a.from - b.from);
  const empty = (from, to) => {
    let low = 0, high = trivia.length;
    while (low < high) { const mid = (low + high) >> 1; if (trivia[mid].from < from) low = mid + 1; else high = mid; }
    for (let i = low; i < trivia.length && trivia[i].from < to; i++) {
      const part = trivia[i];
      if (part.to > to || /\S/.test(doc.sliceString(from, part.from))) return false;
      from = part.to;
    }
    return !/\S/.test(doc.sliceString(from, to));
  };
  const stack = [], redundant = new Set();
  for (const range of ranges) {
    while (stack.length && !(range.from >= stack.at(-1).from && range.to <= stack.at(-1).to)) stack.pop();
    stack.at(-1)?.children.push(range);
    stack.push(range);
  }
  // Skip a sole inner wrapper, not a useful block with other content beside it.
  // Keep the original hierarchy so consecutive wrappers are skipped together.
  for (const parent of ranges) {
    if (parent.children.length !== 1) continue;
    const child = parent.children[0];
    let unit = child.node;
    while (unit.parent && unit.parent.from >= parent.from && unit.parent.to <= parent.to
      && !(unit.parent.from === parent.from && unit.parent.to === parent.to)) unit = unit.parent;
    if (unit.from >= parent.from && unit.to <= parent.to && empty(parent.from, unit.from) && empty(unit.to, parent.to)) redundant.add(child);
  }
  return ranges.filter(range => !redundant.has(range)).map(({ from, to }) => ({ from, to }));
}

let structureFoldRevision = 0;
let smartFoldEnabled = false;
let smartFoldPending = false;
let smartFoldFrame = 0;
function cancelSmartFold() {
  structureFoldRevision++;
  smartFoldPending = false;
  cancelAnimationFrame(smartFoldFrame); smartFoldFrame = 0;
  document.querySelector('#edit-fold-structure').removeAttribute('aria-busy');
}
function requestSmartFold() {
  cancelSmartFold();
  smartFoldPending = smartFoldEnabled;
  scheduleSmartFold();
}
function scheduleSmartFold() {
  if (!smartFoldPending || smartFoldFrame || !smartFoldEnabled || !alternativeActive() || alternativeBusy || modeBusy || readingClipboard || currentPanel() || historyOpen || comparisonOpen) return;
  smartFoldFrame = requestAnimationFrame(() => { smartFoldFrame = 0; if (smartFoldPending) void foldEditorStructure(); });
}
async function foldEditorStructure() {
  if (!smartFoldEnabled || !alternativeActive() || modeBusy || readingClipboard || currentPanel() || historyOpen || comparisonOpen) return;
  smartFoldPending = false;
  const view = alternativeView, doc = view.state.doc, revision = ++structureFoldRevision;
  const button = document.querySelector('#edit-fold-structure');
  button.setAttribute('aria-busy', 'true');
  try {
    const parse = OneHTMLCodeMirror.html().language.parser.startParse(doc.toString());
    let tree;
    do {
      const until = performance.now() + 25;
      do { tree = parse.advance(); } while (!tree && performance.now() < until);
      if (!tree) await new Promise(resolve => requestAnimationFrame(resolve));
      if (revision !== structureFoldRevision || !smartFoldEnabled || !alternativeActive() || view.state.doc !== doc || modeBusy || currentPanel() || historyOpen || comparisonOpen) return;
    } while (!tree);
    const ranges = structureFoldRanges(doc, tree);
    if (!ranges.length) return;
    view.dispatch({ effects: [...cmUnfoldAll(), ...ranges.map(range => OneHTMLCodeMirror.foldEffect.of(range))] });
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
    view.requestMeasure();
  } catch { inform('Не удалось свернуть структуру. Код сохранён без изменений.', true); }
  finally { if (revision === structureFoldRevision) button.removeAttribute('aria-busy'); }
}

function initAlternativeEditor() {
  const nativeFocus = codeField.focus.bind(codeField), nativeSelect = codeField.select.bind(codeField), nativeRange = codeField.setSelectionRange.bind(codeField);
  codeField.focus = options => alternativeActive() && !alternativeHost.hidden ? alternativeView.focus() : nativeFocus(options);
  codeField.select = () => { nativeSelect(); selectAlternativeRange(0, codeField.value.length); };
  codeField.setSelectionRange = (start, end, direction) => { nativeRange(start, end, direction); selectAlternativeRange(start, end, direction); };
  try {
    const saved = localStorage.getItem('onehtml-lab-editor-engine');
    if (['native', 'codemirror'].includes(saved)) alternativeChoice = saved;
    editorDark = localStorage.getItem('onehtml-lab-theme') === 'dark';
    smartFoldEnabled = localStorage.getItem('onehtml-lab-smart-fold') === 'true';
  } catch {}
  const applyTheme = () => {
    document.documentElement.classList.toggle('theme-dark', editorDark);
    themeToggle.setAttribute('aria-pressed', String(editorDark));
    themeToggle.title = editorDark ? 'Включить светлую тему' : 'Включить тёмную тему';
    themeToggle.setAttribute('aria-label', themeToggle.title);
    updateAlternativeEditor(); scheduleCodeLayout();
  };
  const prepare = () => {
    if (alternativeChoice !== 'codemirror' || alternativeView) return;
    try { createAlternativeEditor(); }
    catch { alternativeChoice = 'native'; alternativeHost.replaceChildren(); inform('Не удалось открыть CodeMirror. Используется обычный редактор.', true); }
  };
  prepare();
  const choose = choice => {
    rememberEditorPosition();
    const changedForCM = choice === 'codemirror' && (!alternativeView || alternativeView.state.doc.toString() !== codeField.value);
    cancelSmartFold();
    alternativeChoice = choice;
    prepare();
    try { localStorage.setItem('onehtml-lab-editor-engine', alternativeChoice); } catch { inform('Выбор редактора действует в этом сеансе.'); }
    closeWorkspacePanels(false);
    updateAlternativeEditor(); updateInlineEditor(); scheduleCodeLayout();
    restoreEditorPosition();
    codeField.focus({ preventScroll: true });
    if (alternativeActive()) selectAlternativeRange(codeField.selectionStart, codeField.selectionEnd, codeField.selectionDirection, 'nearest');
    else { editRevealCaret = true; scheduleCodeLayout(); }
    if (changedForCM) requestSmartFold();
  };
  alternativeSelect.addEventListener('change', () => choose(alternativeSelect.value));
  alternativeToggle.addEventListener('click', () => choose(alternativeActive() ? 'native' : 'codemirror'));
  themeToggle.addEventListener('click', () => {
    editorDark = !editorDark;
    try { localStorage.setItem('onehtml-lab-theme', editorDark ? 'dark' : 'light'); } catch {}
    applyTheme();
  });
  applyTheme();
  const smartButton = document.querySelector('#edit-fold-structure');
  const updateSmartButton = () => {
    smartButton.setAttribute('aria-pressed', String(smartFoldEnabled));
    smartButton.title = smartFoldEnabled ? 'Умное сворачивание включено — выключить и раскрыть код' : 'Включить умное сворачивание';
  };
  updateSmartButton();
  smartButton.addEventListener('click', () => {
    smartFoldEnabled = !smartFoldEnabled;
    cancelSmartFold(); updateSmartButton();
    try { localStorage.setItem('onehtml-lab-smart-fold', String(smartFoldEnabled)); }
    catch { inform('Умное сворачивание запомнится только в этом сеансе.'); }
    if (smartFoldEnabled) requestSmartFold();
    else if (alternativeActive()) OneHTMLCodeMirror.unfoldAll(alternativeView);
  });
  document.querySelector('#edit-unfold-all').addEventListener('click', () => {
    cancelSmartFold();
    if (alternativeActive()) OneHTMLCodeMirror.unfoldAll(alternativeView);
  });
  new MutationObserver(() => { updateAlternativeEditor(); scheduleCodeLayout(); }).observe(codeField, { attributes: true, attributeFilter: ['readonly', 'disabled', 'hidden'] });
}
