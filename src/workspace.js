// Workspace screens keep the editor and game mounted, preserving their state.
const appElement = document.querySelector('.app');
const workspaceElement = document.querySelector('.workspace');
const expandButton = document.querySelector('#preview-expand');
const activityToggle = document.querySelector('#activity-toggle');
const activitySummary = document.querySelector('#activity-summary');
const activityPanel = document.querySelector('#activity-panel');
const helpButton = document.querySelector('#help-open');
const helpPanel = document.querySelector('#help-panel');
const workspacePanels = [];
let previewExpanded = false;
let editorPosition = null;

function rememberEditorPosition() {
  if (codeField.hidden || workspacePanels.length) return;
  editorPosition = { value: codeField.value, start: codeField.selectionStart, end: codeField.selectionEnd,
    direction: codeField.selectionDirection, top: codeField.scrollTop, left: codeField.scrollLeft };
}

function restoreEditorPosition() {
  const position = editorPosition;
  if (!position || position.value !== codeField.value || codeField.hidden || workspacePanels.length) return;
  codeField.setSelectionRange(position.start, position.end, position.direction);
  codeField.scrollTop = position.top;
  codeField.scrollLeft = position.left;
}

function currentPanel() { return workspacePanels.at(-1)?.panel; }

function showWorkspacePanel(panel, nested = false, preserveComparison = false) {
  if (currentPanel() === panel) { closeWorkspacePanel(); return; }
  rememberEditorPosition();
  if (panel !== helpPanel) {
    closeLibraryExtraction();
    closeHistory();
    if (!preserveComparison) closeComparison();
  }
  const trigger = document.activeElement;
  if (!nested) closeWorkspacePanels(false);
  else if (currentPanel()) currentPanel().hidden = true;
  workspacePanels.push({ panel, trigger });
  panel.hidden = false;
  workspaceElement.classList.add('has-panel');
  codeField.inert = true;
  preview.inert = true;
  appElement.classList.add('panel-open');
  updateWorkspaceUI();
  updateControls();
  panel.querySelector('.panel-heading button')?.focus({ preventScroll: true });
}

function closeWorkspacePanel(restoreFocus = true) {
  const entry = workspacePanels.pop();
  if (!entry) return;
  entry.panel.hidden = true;
  if (entry.panel === saveDialog) saveFileList.replaceChildren();
  if (currentPanel()) currentPanel().hidden = false;
  else {
    workspaceElement.classList.remove('has-panel');
    appElement.classList.remove('panel-open');
    codeField.inert = false;
    preview.inert = false;
    restoreEditorPosition();
  }
  updateWorkspaceUI();
  updateControls();
  if (restoreFocus && entry.trigger?.isConnected && entry.trigger.getClientRects().length && !entry.trigger.disabled) {
    entry.trigger.focus({ preventScroll: true });
  }
}

function closeWorkspacePanels(restoreFocus = true) {
  while (workspacePanels.length) closeWorkspacePanel(restoreFocus && workspacePanels.length === 1);
}

function setPreviewExpanded(value) {
  previewExpanded = Boolean(value && running);
  appElement.classList.toggle('preview-expanded', previewExpanded);
  expandButton.setAttribute('aria-pressed', String(previewExpanded));
  const label = previewExpanded ? 'Вернуть панели редактора' : 'Развернуть игру';
  expandButton.setAttribute('aria-label', label);
  expandButton.title = label;
  expandButton.querySelector('path').setAttribute('d', previewExpanded
    ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5'
    : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
  updateWorkspaceUI();
}

function updateWorkspaceUI() {
  appElement.classList.toggle('panel-open', Boolean(currentPanel()) || extractionOpen);
  helpButton.disabled = modeBusy || readingClipboard || extractionOpen;
  helpButton.setAttribute('aria-expanded', String(currentPanel() === helpPanel));
  expertTools.hidden = !expertMode;
  expandButton.hidden = !running;
  pasteButton.hidden = running;
  clearButton.hidden = running;
  activityToggle.setAttribute('aria-expanded', String(currentPanel() === activityPanel));
  updateWorkspaceViewport();
  updateDesktopUI();
}

function updateActivitySummary() {
  const parts = [];
  const diagnostics = diagnosticCounts();
  if (diagnostics.errors) parts.push(`Ошибка игры (${diagnostics.errors})`);
  else if (!runtimeError.hidden && !runtimeError.classList.contains('is-warning')) parts.push(`Ошибка игры${runtimeErrorCount > 1 ? ` (${runtimeErrorCount})` : ''}`);
  if (diagnostics.warnings) parts.push(`Предупреждения (${diagnostics.warnings})`);
  if (!libraryRequest.hidden) parts.push('Нужны библиотеки');
  if (!networkStatus.hidden) parts.push(`Сеть: ${networkCountField.textContent} файл. · ${networkKbField.textContent}`);
  if (activeBundledLibraries.length) parts.push(`Встроено: ${activeBundledLibraries.join(', ')}`);
  if (!localAccessStatus.hidden && localApisUsed.size) parts.push([...localApisUsed].join(', '));
  if (!status.hidden && status.textContent) parts.push(status.textContent);
  const message = parts.join(' · ');
  activityToggle.hidden = !message;
  activitySummary.textContent = message;
  activityToggle.classList.toggle('has-error', diagnostics.errors > 0 || (!status.hidden && status.classList.contains('error')));
  activityToggle.setAttribute('aria-label', message ? `${message}. Открыть сообщения` : 'Открыть сообщения');
}

function updateWorkspaceViewport() {
  const viewport = window.visualViewport;
  appElement.style.height = viewport && viewport.height < document.documentElement.clientHeight - 1 ? `${viewport.height}px` : '';
  appElement.style.top = `${viewport?.offsetTop || 0}px`;
  appElement.classList.toggle('compact-viewport', (viewport?.height || window.innerHeight) < 480);
}

function initWorkspaceUI() {
  helpButton.addEventListener('click', () => showWorkspacePanel(helpPanel, Boolean(currentPanel())));
  document.querySelector('#help-close').addEventListener('click', () => closeWorkspacePanel());
  expandButton.addEventListener('click', () => setPreviewExpanded(!previewExpanded));
  activityToggle.addEventListener('click', () => { if (currentPanel() === activityPanel) closeWorkspacePanel(); else openDiagnostics(); });
  document.querySelector('#activity-close').addEventListener('click', () => closeWorkspacePanel());
  document.querySelector('#save-close').addEventListener('click', () => closeWorkspacePanel());
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || clearDialog.open || replaceDialog.open) return;
    if (workspacePanels.length) closeWorkspacePanel();
    else if (previewExpanded) setPreviewExpanded(false);
    else if (historyOpen) closeHistory();
    else if (comparisonOpen) closeComparison();
    else if (extractionOpen) closeLibraryExtraction();
    else return;
    event.preventDefault();
  });
  new MutationObserver(updateActivitySummary).observe(activityPanel.querySelector('.panel-body'), {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class']
  });
  window.visualViewport?.addEventListener('resize', updateWorkspaceViewport);
  window.visualViewport?.addEventListener('scroll', updateWorkspaceViewport);
  window.addEventListener('resize', updateWorkspaceViewport);
  updateWorkspaceUI();
}
