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
function alternativeActive() { return alternativeChoice === 'codemirror' && Boolean(alternativeView); }
function alternativeMarks(source) {
  if (alternativeScan.source !== source) alternativeScan = { source, result: scanCodeColors(source) };
  return alternativeScan.result;
}

function alternativeExtensions() {
  const cm = OneHTMLCodeMirror, tags = cm.tags;
  const palette = editorDark ? ['#c6a3ee', '#a2d4aa', '#e7bd7e', '#97a6ba', '#91baff', '#e3bb87', '#84cbdc'] : ['#7953a0', '#337447', '#98600c', '#687989', '#235ba5', '#875218', '#276785'];
  const extensions = [cm.EditorState.readOnly.of(codeField.readOnly || codeField.disabled), cm.EditorView.editable.of(!codeField.readOnly && !codeField.disabled),
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
    cm.codeFolding({ placeholderDOM(view, onclick, prepared) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cm-foldPlaceholder';
      button.textContent = `+ … ${prepared} строк`; button.setAttribute('aria-label', 'Развернуть скрытый код'); button.onclick = onclick; return button;
    }, preparePlaceholder(state, range) { return state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number; } }),
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
        alternativeBusy = true; codeField.setSelectionRange(selection.from, selection.to, selection.anchor > selection.head ? 'backward' : 'forward'); alternativeBusy = false;
        alternativeCaption();
        document.querySelector('#edit-copy-selection').disabled = selection.empty;
      }
    })
  ] }) });
  alternativeView.scrollDOM.addEventListener('scroll', () => { codeField.scrollTop = alternativeView.scrollDOM.scrollTop; codeField.scrollLeft = alternativeView.scrollDOM.scrollLeft; });
}

function selectAlternativeRange(start, end = start, direction = 'none', scroll = false) {
  if (!alternativeActive() || alternativeBusy) return;
  const cm = OneHTMLCodeMirror, effects = [];
  updateAlternativeEditor();
  start = Math.min(start, alternativeView.state.doc.length); end = Math.min(end, alternativeView.state.doc.length);
  cm.foldedRanges(alternativeView.state).between(start, Math.max(start, end), (from, to) => { effects.push(cm.unfoldEffect.of({ from, to })); });
  if (scroll) effects.push(cm.EditorView.scrollIntoView(start, { y: 'center' }));
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
  for (const id of ['edit-fold', 'edit-unfold-all']) document.querySelector('#' + id).hidden = !active;
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
}

function cmUnfoldAll() {
  const effects = [];
  OneHTMLCodeMirror.foldedRanges(alternativeView.state).between(0, alternativeView.state.doc.length, (from, to) => effects.push(OneHTMLCodeMirror.unfoldEffect.of({ from, to })));
  return effects;
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
    alternativeChoice = choice;
    prepare();
    try { localStorage.setItem('onehtml-lab-editor-engine', alternativeChoice); } catch { inform('Выбор редактора действует в этом сеансе.'); }
    closeWorkspacePanels(false);
    updateAlternativeEditor(); updateInlineEditor(); scheduleCodeLayout();
    restoreEditorPosition();
    codeField.focus({ preventScroll: true });
    if (alternativeActive()) selectAlternativeRange(codeField.selectionStart, codeField.selectionEnd, codeField.selectionDirection, true);
  };
  alternativeSelect.addEventListener('change', () => choose(alternativeSelect.value));
  alternativeToggle.addEventListener('click', () => choose(alternativeActive() ? 'native' : 'codemirror'));
  themeToggle.addEventListener('click', () => {
    editorDark = !editorDark;
    try { localStorage.setItem('onehtml-lab-theme', editorDark ? 'dark' : 'light'); } catch {}
    applyTheme();
  });
  applyTheme();
  document.querySelector('#edit-fold').addEventListener('click', () => { if (alternativeActive()) { OneHTMLCodeMirror.foldCode(alternativeView); alternativeView.focus(); } });
  document.querySelector('#edit-unfold-all').addEventListener('click', () => { if (alternativeActive()) OneHTMLCodeMirror.unfoldAll(alternativeView); });
  new MutationObserver(() => { updateAlternativeEditor(); scheduleCodeLayout(); }).observe(codeField, { attributes: true, attributeFilter: ['readonly', 'disabled', 'hidden'] });
}
