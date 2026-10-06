// Comparison owns its frame and temporary data; it never registers persistent storage.
let comparisonSession = null;
let comparisonGameMode = false;
let comparisonSide = 'current';
let comparisonFrame = null;
let comparisonRequest = 0;
let comparisonMetrics = null;
const comparisonStage = document.querySelector('#comparison-stage');
const comparisonGameStatus = document.querySelector('#comparison-game-status');
const comparisonGameError = document.querySelector('#comparison-game-error');
const comparisonGameWarning = document.querySelector('#comparison-game-warning');

function comparisonLabel() {
  return comparisonSide === 'current' ? 'Текущая версия' : `Выбранная версия · ${comparisonSession.date}`;
}

function stopComparisonGame() {
  comparisonRequest++;
  comparisonFrame = null;
  comparisonStage.replaceChildren();
  if (pendingLibraryAction?.action === 'compare') hideLibraryRequest();
}

function resetComparisonGame(baseline = null) {
  stopComparisonGame();
  comparisonSession = baseline ? {
    current: codeField.value, past: baseline.code,
    date: Object.values(formatVersionDate(baseline.createdAt)).join(' '),
    stores: { current: new Map(), past: new Map() }
  } : null;
  comparisonGameMode = false;
  comparisonSide = 'current';
  updateComparisonGameUI();
}

function updateComparisonGameUI() {
  comparison.classList.toggle('is-game', comparisonGameMode);
  appElement.classList.toggle('comparison-game-open', comparisonGameMode && comparisonOpen);
  document.querySelector('#comparison-game').hidden = !comparisonGameMode;
  document.querySelector('#comparison-versions').hidden = !comparisonGameMode;
  document.querySelector('.comparison-legend').hidden = comparisonGameMode;
  comparisonCompactButton.hidden = comparisonGameMode;
  diffContent.hidden = comparisonGameMode || Boolean(comparisonEditorView);
  comparisonEditorHost.hidden = comparisonGameMode || !comparisonEditorView;
  document.querySelector('#comparison-code-tab').setAttribute('aria-pressed', String(!comparisonGameMode));
  document.querySelector('#comparison-game-tab').setAttribute('aria-pressed', String(comparisonGameMode));
  document.querySelector('#comparison-current').setAttribute('aria-pressed', String(comparisonSide === 'current'));
  document.querySelector('#comparison-past').setAttribute('aria-pressed', String(comparisonSide === 'past'));
  document.querySelector('#comparison-date').textContent = comparisonSession?.date || '';
  if (comparisonSession) comparisonSource.textContent = comparisonGameMode ? 'Сравнение игр' : `Текущий код и версия ${comparisonSession.date}`;
  if (comparisonGameMode) {
    comparison.scrollTop = 0;
    comparison.classList.remove('has-custom-scrollbar');
    comparisonScrollbar.hidden = true;
  } else if (comparisonOpen) requestAnimationFrame(updateComparisonScrollbar);
}

function updateComparisonGameStatus() {
  const state = comparisonMetrics;
  if (!state) return;
  const parts = [comparisonLabel()];
  if (state.libraries.length) parts.push(`Встроено: ${state.libraries.join(', ')}`);
  if (state.local) parts.push('localStorage · временно');
  if (state.blocked.size) parts.push(`Недоступно: ${[...state.blocked].join(', ')}`);
  if (state.files) parts.push(`Сеть: ${formatUIInteger(state.files)} файл. · ${state.bytes ? (state.bytes / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' КБ' : '(нет данных)'}`);
  comparisonGameStatus.textContent = parts.join(' · ');
}

async function startComparisonGame(replaceLibraries = true) {
  if (!comparisonOpen || !comparisonGameMode || !comparisonSession) return;
  stopComparisonGame();
  const request = comparisonRequest, session = comparisonSession, side = comparisonSide;
  const code = session[side];
  comparisonMetrics = { libraries: [], local: false, blocked: new Set(), files: 0, bytes: 0, errors: 0, warnings: 0 };
  comparisonGameError.hidden = true;
  comparisonGameError.textContent = '';
  comparisonGameWarning.hidden = true;
  comparisonGameWarning.textContent = '';
  comparisonGameStatus.textContent = `${comparisonLabel()} · Подготовка…`;
  try {
    const prepared = await prepareGameHtml(code, replaceLibraries);
    if (request !== comparisonRequest || !comparisonOpen || !comparisonGameMode || comparisonSession !== session) return;
    if (requestLibraries(prepared, 'compare', code)) {
      comparisonGameStatus.textContent = `${comparisonLabel()} · Нужны библиотеки.`;
      return;
    }
    const frame = makePreview(prepared.html, previewNetworkAllowed(), gameStorageAllowed ? [...session.stores[side]] : null);
    frame.title = comparisonLabel();
    frame.comparisonStorage = gameStorageAllowed;
    frame.comparisonUnchanged = prepared.html === code;
    comparisonFrame = frame;
    comparisonMetrics.libraries = bundledLibraryLabels(prepared);
    comparisonStage.replaceChildren(frame);
    updateComparisonGameStatus();
  } catch {
    if (request !== comparisonRequest) return;
    comparisonGameStatus.textContent = comparisonLabel();
    comparisonGameError.textContent = 'Не удалось запустить эту версию. Код редактора сохранён.';
    comparisonGameError.hidden = false;
  }
}

function handleComparisonMessage(event) {
  if (!comparisonOpen || !comparisonGameMode || !comparisonFrame || event.source !== comparisonFrame.contentWindow) return;
  const detail = event.data;
  if (detail?.type === 'onehtml-lab:game-storage' && comparisonFrame.comparisonStorage) {
    const next = new Map(comparisonSession.stores[comparisonSide]);
    if (detail.action === 'set' && typeof detail.key === 'string' && typeof detail.value === 'string') next.set(detail.key, detail.value);
    else if (detail.action === 'remove' && typeof detail.key === 'string') next.delete(detail.key);
    else if (detail.action === 'clear') next.clear();
    else return;
    let size = 0;
    for (const [key, value] of next) { size += key.length + value.length; if (size > gameStorageLimit) return; }
    comparisonSession.stores[comparisonSide] = next;
  } else if (detail?.type === 'onehtml-lab:local-access') {
    if (detail.api === 'localStorage' && comparisonFrame.comparisonStorage) comparisonMetrics.local = true;
    else if (localApiNames.includes(detail.api)) comparisonMetrics.blocked.add(detail.api);
  } else if (detail?.type === 'onehtml-lab:network-resource' && networkAllowed) {
    if (!Number.isFinite(detail.bytes) || detail.bytes < 0) return;
    comparisonMetrics.files++;
    comparisonMetrics.bytes = Math.min(Number.MAX_SAFE_INTEGER, comparisonMetrics.bytes + Math.floor(detail.bytes));
  } else if (detail?.type === 'onehtml-lab:runtime-error') {
    if (!['error','rejection','warning','console-error','resource'].includes(detail.kind) || typeof detail.message !== 'string') return;
    const warning = detail.kind === 'warning';
    const count = warning ? ++comparisonMetrics.warnings : ++comparisonMetrics.errors;
    const ownDocument = ['about:srcdoc','about:blank'].includes(detail.filename);
    const line = ownDocument && comparisonFrame.comparisonUnchanged ? detail.line - comparisonFrame.previewOffset.lines : detail.line;
    const place = Number.isInteger(line) && line > 0 ? ` · строка ${ownDocument && comparisonFrame.comparisonUnchanged ? 'кода' : 'предпросмотра/скрипта'} ${line}` : '';
    const original = detail.message.slice(0, 500), message = describeRuntimeMessage(original);
    const target = warning ? comparisonGameWarning : comparisonGameError;
    target.textContent = `${comparisonLabel()} · ${warning ? 'Предупреждение' : 'Ошибка'} (${formatUIInteger(count)})${place}: ${message}`;
    if (message !== original && original !== 'Script error.') {
      const details = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('div');
      summary.textContent = 'Исходное сообщение'; text.textContent = original;
      details.append(summary, text); target.append(details);
    }
    target.hidden = false;
    document.querySelector('#comparison-messages').scrollTop = 0;
  } else return;
  updateComparisonGameStatus();
}

function initComparisonGame() {
  document.querySelector('#comparison-code-tab').addEventListener('click', () => {
    stopComparisonGame(); comparisonGameMode = false; updateComparisonGameUI();
  });
  document.querySelector('#comparison-game-tab').addEventListener('click', () => {
    if (comparisonGameMode) return;
    comparisonGameMode = true; updateComparisonGameUI(); void startComparisonGame();
  });
  for (const side of ['current','past']) document.querySelector(`#comparison-${side}`).addEventListener('click', () => {
    if (comparisonSide === side) return;
    comparisonSide = side; updateComparisonGameUI(); void startComparisonGame();
  });
  document.querySelector('#comparison-restart').addEventListener('click', () => void startComparisonGame());
  window.addEventListener('message', handleComparisonMessage);
}
