import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'src/app.js'), 'utf8');

async function createApp(clipboard) {
  const elements = new Map();
  const timers = [];
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', hidden: false, disabled: false, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      setAttribute() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      replaceChildren() {},
      focus() { this.focused = true; },
      blur() {},
      select() { this.selected = true; }
    });
    return elements.get(selector);
  }
  const sandbox = {
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} },
    navigator: { clipboard },
    // Clipboard unit tests isolate layout; workspace transitions have browser coverage.
    initWorkspaceUI() {}, updateWorkspaceUI() {}, rememberEditorPosition() {}, restoreEditorPosition() {},
    initAlternativeEditor() {}, updateAlternativeEditor() {}, initCodeEditor() {}, updateCodeTools() {}, resetCodeEdits() {}, recordCodeEdit() {},
    initAiPrompts() {}, updateAiControls() {}, openAiPrompts() {},
    setAiProject() {}, saveAiPromptSettings() {}, loadAiPromptSettings() {},
    updateExampleLessonControls() {},
    updateCodeGuide() {},
    initDesktopWorkspace() {}, sizeDesktopPreview() {}, isSplitWorkspace: () => false,
    initDiagnostics() {}, updateDiagnostics() {}, beginDiagnosticRun() {},
    initComparisonGame() {},
    errorTarget: null, errorSource: null,
    closeWorkspacePanels() {}, setPreviewExpanded() {}, currentPanel: () => null, activityPanel: {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    makePreview: () => ({}),
    prepareGameHtml: code => ({ html: code, bundledLibraries: [], missingLibraries: [] }),
    prepareApplicationHtml: code => ({ html: code, bundledLibraries: [], missingLibraries: [], media: [], missingMedia: [] }),
    mediaPreparationWarning() {},
    bundledLibraryLabels: () => [],
    loadLibraryCache: async () => {},
    loadMediaCache: async () => {},
    loadPromptMediaState() {}, bindPromptMedia: code => code, promptMediaNotice() {},
    gameStorageSnapshot: () => [],
    registerGameStorageFrame: () => {},
    handleGameStorageMessage: () => false,
    examples: [],
    readDraftSnapshot: async () => [null, null, null],
    writeDraftSnapshot: async (_, history) => history
  };
  runInNewContext(source, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  return {
    code: element('#code'), paste: element('#paste'), clear: element('#clear'),
    clearDialog: element('#clear-dialog'), cancelClear: element('#cancel-clear'),
    clearForm: element('#clear-form'), run: element('#run'),
    status: element('#status'), timers
  };
}

const missing = await createApp(undefined);
missing.code.value = 'старый код';
await missing.paste.listeners.click();
assert(missing.code.focused && missing.code.selected);
assert.match(missing.status.textContent, /меню поля/);
let prevented = false;
missing.code.listeners.paste({
  clipboardData: { getData: () => '<html>новая игра</html>' },
  preventDefault() { prevented = true; }
});
assert(prevented);
assert.equal(missing.code.value, '<html>новая игра</html>');

const denied = await createApp({ readText: () => Promise.reject(new Error('denied')) });
denied.code.value = 'сохранить код';
await denied.paste.listeners.click();
assert(denied.code.focused && denied.code.selected);
assert.equal(denied.code.value, 'сохранить код');

const allowed = await createApp({ readText: () => Promise.resolve('<html>из буфера</html>') });
allowed.code.value = 'заменить целиком';
await allowed.paste.listeners.click();
assert.equal(allowed.code.value, '<html>из буфера</html>');

const hanging = await createApp({ readText: () => new Promise(() => {}) });
hanging.code.value = 'прежний код';
const pending = hanging.paste.listeners.click();
assert.match(hanging.status.textContent, /Читаю буфер/);
assert(hanging.paste.disabled);
const timeout = hanging.timers.find(timer => timer.ms === 12_000);
assert(timeout);
timeout.fn();
await pending;
assert(hanging.code.focused && hanging.code.selected);
assert.equal(hanging.paste.disabled, false);

const clear = await createApp(undefined);
assert(clear.clear.disabled);
clear.code.value = '<html>сохранить</html>';
clear.code.listeners.input();
assert.equal(clear.clear.disabled, false);
clear.clear.listeners.click();
assert(clear.clearDialog.open);
assert.equal(clear.code.value, '<html>сохранить</html>');
clear.cancelClear.listeners.click();
assert.equal(clear.code.value, '<html>сохранить</html>');
clear.clear.listeners.click();
clear.clearForm.listeners.submit({ preventDefault() {} });
assert.equal(clear.code.value, '');
assert(clear.clear.disabled);
assert.equal(clear.clearDialog.open, false);

clear.code.value = '<html>игра</html>';
clear.code.listeners.input();
await clear.run.listeners.click();
assert(clear.clear.disabled);
clear.clear.listeners.click();
assert.equal(clear.clearDialog.open, false);

console.log('Clipboard and confirmed clear behavior passed.');
