// Local prompt history and explicit acceptance of an AI response.
const aiPromptsPanel = document.querySelector('#ai-prompts-panel');
const aiAnswerPanel = document.querySelector('#ai-answer-panel');
const aiAnswerText = document.querySelector('#ai-answer-text');
const aiAnswerClean = document.querySelector('#ai-answer-clean');
const aiAnswerBlock = document.querySelector('#ai-answer-block');
const aiTaskNames = { create: 'Создать', change: 'Изменить', fix: 'Исправить', explain: 'Объяснить', check: 'Проверить' };
let aiPromptEntries = [];
let aiPromptSelected = null;
let aiPromptPersistent = true;
let aiPromptDatabasePromise;
let aiPromptLoadPromise;
let aiPromptQueue = Promise.resolve();
let aiSourceRevision = 0;
let aiAnswerRevision = 0;
let aiAnswerReview = null;
let aiAnswerReading = false;
let aiAnswerPlan = { blocks: [], fenced: false };
let aiPromptSequence = 0;

function aiPromptId() { return `${Date.now()}-${String(++aiPromptSequence).padStart(8, '0')}-${Math.random().toString(36).slice(2)}`; }

async function aiCodeHash(code) {
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

function validAiPromptEntry(entry) {
  return entry && typeof entry.id === 'string' && typeof entry.text === 'string'
    && Number.isFinite(entry.createdAt) && Object.hasOwn(aiTaskNames, entry.mode)
    && typeof entry.task === 'string' && ['game', 'application'].includes(entry.project)
    && ['mobile', 'desktop'].includes(entry.platform) && Array.isArray(entry.mediaFiles)
    && (entry.source === null || (entry.source && typeof entry.source.scope === 'string'
      && Number.isSafeInteger(entry.source.symbols) && entry.source.symbols >= 0
      && (entry.source.hash === null || /^[a-f0-9]{64}$/.test(entry.source.hash))));
}

function mergeAiPromptEntries(...lists) {
  const seen = new Set();
  return lists.flat().filter(validAiPromptEntry).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .filter(entry => { if (seen.has(entry.id)) return false; seen.add(entry.id); return true; }).slice(0, 20);
}

function aiPromptDatabase() {
  if (!aiPromptDatabasePromise) aiPromptDatabasePromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open('onehtml-lab-ai', 1);
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('Prompt storage timeout')); }, 2500);
    const fail = error => { clearTimeout(timer); settled = true; reject(error); };
    request.onupgradeneeded = () => request.result.createObjectStore('prompts', { keyPath: 'id' });
    request.onblocked = () => fail(new Error('Prompt storage blocked'));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true;
      const database = request.result;
      database.onversionchange = () => { database.close(); aiPromptDatabasePromise = null; };
      resolve(database);
    };
  });
  return aiPromptDatabasePromise;
}

function loadAiPromptHistory(refresh = false) {
  if (refresh) aiPromptLoadPromise = null;
  if (!aiPromptLoadPromise) aiPromptLoadPromise = (async () => {
    try {
      const database = await aiPromptDatabase();
      const entries = await new Promise((resolve, reject) => {
        const transaction = database.transaction('prompts', 'readonly');
        const request = transaction.objectStore('prompts').getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
      aiPromptEntries = mergeAiPromptEntries(aiPromptEntries, entries);
    } catch { aiPromptPersistent = false; }
    renderAiPromptHistory();
  })();
  return aiPromptLoadPromise;
}

async function storeAiPromptEntry(entry) {
  try {
    const database = await aiPromptDatabase();
    const saved = await new Promise((resolve, reject) => {
      const transaction = database.transaction('prompts', 'readwrite');
      const store = transaction.objectStore('prompts');
      const all = store.getAll();
      let entries, failure;
      all.onsuccess = () => {
        try {
          entries = mergeAiPromptEntries([entry], aiPromptEntries, all.result);
          const ids = new Set(entries.map(value => value.id));
          const savedIds = new Set(all.result.map(value => value.id));
          for (const value of entries) if (!savedIds.has(value.id)) store.put(value);
          store.put(entry);
          for (const value of all.result) if (!ids.has(value.id)) store.delete(value.id);
          if (!ids.has(entry.id)) store.delete(entry.id);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(entries);
      transaction.onerror = transaction.onabort = () => reject(failure || transaction.error);
    });
    aiPromptEntries = mergeAiPromptEntries(aiPromptEntries, saved);
    aiPromptPersistent = true;
  } catch { aiPromptPersistent = false; }
  renderAiPromptHistory();
}

function acceptCopiedAiPrompt(result) {
  rememberPromptMedia(result.mediaFiles);
  saveAiPromptSettings();
  const snapshot = result.snapshot;
  const entry = { id: aiPromptId(), createdAt: Date.now(),
    mode: snapshot.mode, project: snapshot.project, platform: snapshot.platform, task: snapshot.task,
    shorten: snapshot.shorten, includePrevious: snapshot.includePrevious, text: result.text,
    mediaFiles: result.mediaFiles.map(file => ({ ...file })),
    source: snapshot.mode === 'create' ? null : { hash: null, scope: result.scope ?? gameStorageScope, symbols: symbolCount(snapshot.code) } };
  aiPromptEntries = mergeAiPromptEntries([entry], aiPromptEntries);
  renderAiPromptHistory();
  // Clipboard activation is already consumed; hashing and storage cannot block copying.
  aiPromptQueue = aiPromptQueue.then(async () => {
    if (entry.source) entry.source.hash = await aiCodeHash(snapshot.code);
    await loadAiPromptHistory();
    await storeAiPromptEntry(entry);
  }).catch(() => { aiPromptPersistent = false; renderAiPromptHistory(); });
}

function aiPromptMeta(entry) {
  const { date, time } = formatVersionDate(entry.createdAt);
  return `${date} ${time} · ${aiTaskNames[entry.mode]} · ${entry.project === 'application' ? 'приложение' : 'игра'} · ${entry.platform === 'mobile' ? 'телефон' : 'компьютер'} · ${formatSymbolCount(symbolCount(entry.text))}`;
}

function renderAiPromptHistory() {
  const note = document.querySelector('#ai-prompts-note');
  note.textContent = aiPromptPersistent ? 'Последние 20 скопированных запросов.' : 'Новые запросы не удалось сохранить в браузере. Они доступны только в этом сеансе.';
  const list = document.querySelector('#ai-prompts-list');
  list.replaceChildren();
  document.querySelector('#ai-prompts-empty').hidden = aiPromptEntries.length > 0;
  for (const entry of aiPromptEntries) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.promptId = entry.id;
    const meta = document.createElement('strong'); meta.textContent = aiPromptMeta(entry);
    const text = document.createElement('span');
    text.textContent = (entry.task || entry.text).slice(0, 180).replace(/\s+/g, ' ');
    button.append(meta, text); button.addEventListener('click', () => showAiPromptEntry(entry));
    row.append(button); list.append(row);
  }
}

async function showAiPromptEntry(entry) {
  aiPromptSelected = entry;
  document.querySelector('#ai-prompts-list-view').hidden = true;
  document.querySelector('#ai-prompts-detail').hidden = false;
  document.querySelector('#ai-prompts-meta').textContent = aiPromptMeta(entry);
  document.querySelector('#ai-prompts-text').value = entry.text;
  document.querySelector('#ai-prompts-text').scrollTop = 0;
  aiPromptsPanel.querySelector('.panel-body').scrollTop = 0;
  const source = document.querySelector('#ai-prompts-source');
  const revision = ++aiSourceRevision;
  if (!entry.source) { source.textContent = 'Запрос новой работы не содержит исходного кода.'; return; }
  source.textContent = 'Проверка исходной версии…';
  const code = codeField.value, scope = gameStorageScope;
  const hash = await aiCodeHash(code);
  if (revision !== aiSourceRevision || aiPromptSelected !== entry) return;
  if (codeField.value !== code || gameStorageScope !== scope) { source.textContent = 'Текущий код изменился во время проверки. Откройте запись снова.'; return; }
  if (!entry.source.hash || !hash) { source.textContent = `Исходник при копировании: ${formatSymbolCount(entry.source.symbols)}. Привязку версии проверить не удалось.`; return; }
  if (entry.source.hash === hash) {
    source.textContent = entry.source.scope === scope ? 'Исходник запроса совпадает с текущей версией.' : 'Текст исходника совпадает, но запрос подготовлен для другой работы.';
    return;
  }
  const past = [];
  for (const version of historyState.entries) if (await aiCodeHash(version.code) === entry.source.hash) { past.push(version); break; }
  if (revision !== aiSourceRevision || aiPromptSelected !== entry) return;
  source.textContent = past.length ? `Исходник запроса есть в истории кода: ${Object.values(formatVersionDate(past[0].createdAt)).join(' ')}.`
    : 'Запрос относится к другой версии. Его исходник не найден в текущем коде и истории.';
}

function reuseAiPromptEntry(entry) {
  if (!entry || !expertMode || modeBusy) return;
  openAiPrompts(entry.mode);
  aiProject = entry.project;
  setPlatform(entry.platform);
  aiTask.value = entry.task; aiTasks[entry.mode] = entry.task;
  aiShorten.checked = Boolean(entry.shorten);
  aiHistory.checked = Boolean(entry.includePrevious);
  saveAiPromptSettings(); updateAiProjectLabels(); updateAiControls();
  aiTask.focus({ preventScroll: true });
}

// Markdown is parsed as inert text. Never create a DOM from the returned code.
function aiResponsePlan(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const opening = /^\s{0,3}(`{3,}|~{3,})\s*([^`~]*)$/.exec(lines[i]);
    if (!opening) continue;
    fenced = true;
    const marker = opening[1][0], length = opening[1].length;
    const label = opening[2].trim().toLowerCase();
    const start = i + 1;
    let end = start;
    while (end < lines.length && !(new RegExp(`^\\s{0,3}${marker}{${length},}\\s*$`)).test(lines[end])) end++;
    const code = lines.slice(start, end).join('\n');
    const html = /^(?:html5?|htm)$/.test(label) || (!label && /^\s*(?:<!doctype\s+html|<[a-z][\w:-]*\b)/i.test(code));
    if (html) blocks.push({ code, completeFence: end < lines.length });
    i = end;
  }
  return { blocks, fenced };
}

function aiResponseWarnings(code) {
  if (!code.trim()) return ['Ответ пока пуст.'];
  const notes = [];
  if (!/^\s*(?:<!doctype\s+html|<html\b)/i.test(code) || !/<\/html\s*>\s*$/i.test(code)) notes.push('Похоже, это фрагмент или неполный HTML. Проверьте, что ответ содержит весь документ.');
  if (/^\s*(?:```|~~~)/m.test(code)) notes.push('В тексте осталась Markdown-разметка. Она попадёт в редактор.');
  return notes;
}

function aiAnswerCandidate() {
  if (!aiAnswerClean.checked || !aiAnswerPlan.fenced) return aiAnswerText.value;
  if (aiAnswerPlan.blocks.length === 1) return aiAnswerPlan.blocks[0].code;
  const index = Number(aiAnswerBlock.value);
  return aiAnswerBlock.value !== '' && aiAnswerPlan.blocks[index] ? aiAnswerPlan.blocks[index].code : null;
}

function updateAiAnswerInput(reparse = true) {
  aiAnswerRevision++;
  aiAnswerReview = null;
  document.querySelector('#ai-answer-compose').hidden = false;
  document.querySelector('#ai-answer-review').hidden = true;
  document.querySelector('#ai-answer-compare').hidden = false;
  if (reparse) {
    aiAnswerPlan = aiResponsePlan(aiAnswerText.value);
    aiAnswerBlock.replaceChildren();
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Выберите блок…'; aiAnswerBlock.append(option);
    aiAnswerPlan.blocks.forEach((block, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `HTML ${index + 1} · ${formatSymbolCount(symbolCount(block.code))}`; aiAnswerBlock.append(option);
    });
  }
  document.querySelector('#ai-answer-block-option').hidden = !aiAnswerClean.checked || aiAnswerPlan.blocks.length < 2;
  document.querySelector('#ai-answer-clean-option').hidden = !aiAnswerPlan.fenced;
  const code = aiAnswerCandidate();
  const notes = code === null ? [aiAnswerPlan.blocks.length ? 'В ответе несколько HTML-блоков. Выберите один: они не объединяются автоматически.' : 'В Markdown-блоках не найден HTML. Вставьте полный HTML или снимите флажок очистки.'] : aiResponseWarnings(code);
  if (aiAnswerClean.checked && aiAnswerPlan.blocks.some(block => !block.completeFence)) notes.push('Markdown-блок не закрыт: ответ мог оборваться.');
  document.querySelector('#ai-answer-note').textContent = notes.join(' ');
  updateAiSessionControls();
}

function updateAiSessionControls() {
  const unavailable = !expertMode || modeBusy || running || codeField.readOnly;
  document.querySelector('#ai-answer-paste').disabled = unavailable || aiAnswerReading;
  const candidate = aiAnswerCandidate();
  document.querySelector('#ai-answer-compare').disabled = unavailable || aiAnswerReading || !candidate?.trim();
  const current = aiAnswerReview && aiAnswerReview.before === codeField.value && aiAnswerReview.scope === gameStorageScope
    && aiAnswerReview.input === aiAnswerText.value && aiAnswerReview.candidate === candidate;
  document.querySelector('#ai-answer-apply').disabled = unavailable || !current || aiAnswerReview.code === codeField.value;
  if (aiAnswerReview && !current) document.querySelector('#ai-answer-note').textContent = 'Код или ответ изменился. Вернитесь к ответу и сравните заново перед заменой.';
  if (currentPanel() === aiAnswerPanel && codeField.readOnly) document.querySelector('#ai-answer-note').textContent = 'Код заблокирован. Разрешите редактирование перед заменой.';
  else if (currentPanel() === aiAnswerPanel && running) document.querySelector('#ai-answer-note').textContent = 'Остановите приложение перед заменой кода.';
}

function reviewAiAnswer() {
  const candidate = aiAnswerCandidate();
  if (!candidate?.trim() || !expertMode || modeBusy || running || codeField.readOnly) return;
  const code = bindPromptMedia(candidate);
  const before = codeField.value;
  aiAnswerReview = { before, scope: gameStorageScope, code, input: aiAnswerText.value, candidate };
  const parts = codeDiff(before, code), changes = changedSymbols(before, code);
  document.querySelector('#ai-answer-metrics').textContent = `Всего: ${formatSymbolCount(symbolCount(code))} · Добавлено: ${formatUIInteger(changes.added)} · Удалено: ${formatUIInteger(changes.removed)}`;
  const diff = document.querySelector('#ai-answer-diff');
  const nodes = comparisonChunks(parts, comparisonLineGaps(parts).gaps).map(part => {
    const node = document.createElement('span');
    node.className = part.type === 'gap' ? 'ai-answer-gap' : `diff-${part.type}`;
    node.textContent = part.type === 'gap' ? `\n… ${formatUIInteger(part.gap.count)} одинаковых строк …\n` : part.text;
    return node;
  });
  diff.replaceChildren(...nodes);
  document.querySelector('#ai-answer-compose').hidden = true;
  document.querySelector('#ai-answer-review').hidden = false;
  document.querySelector('#ai-answer-compare').hidden = true;
  aiAnswerPanel.querySelector('.panel-body').scrollTop = 0;
  document.querySelector('#ai-answer-note').textContent = (before === code ? 'Ответ совпадает с текущим кодом.' : 'Проверьте изменения. «Заменить код» сохранит прежнюю версию в истории.')
    + ' ' + aiResponseWarnings(candidate).join(' ') + (promptMediaFeedback ? ' ' + promptMediaFeedback : '');
  updateAiSessionControls();
}

function initAiSession() {
  document.querySelector('#ai-prompts-open').addEventListener('click', () => {
    aiPromptSelected = null; aiSourceRevision++;
    document.querySelector('#ai-prompts-list-view').hidden = false;
    document.querySelector('#ai-prompts-detail').hidden = true;
    renderAiPromptHistory(); void loadAiPromptHistory(true); showWorkspacePanel(aiPromptsPanel, true);
  });
  document.querySelector('#ai-prompts-close').addEventListener('click', () => closeWorkspacePanel());
  document.querySelector('#ai-prompts-back').addEventListener('click', () => {
    aiPromptSelected = null; aiSourceRevision++;
    document.querySelector('#ai-prompts-list-view').hidden = false; document.querySelector('#ai-prompts-detail').hidden = true; renderAiPromptHistory();
  });
  document.querySelector('#ai-prompts-copy').addEventListener('click', () => {
    const entry = aiPromptSelected;
    if (entry) void copyOrSelect(entry.text, 'Прежний запрос скопирован без изменений.', () => {
      rememberPromptMedia(entry.mediaFiles);
      const repeated = { ...entry, id: aiPromptId(), createdAt: Date.now() };
      aiPromptEntries = mergeAiPromptEntries([repeated], aiPromptEntries); renderAiPromptHistory();
      aiPromptQueue = aiPromptQueue.then(() => storeAiPromptEntry(repeated)).catch(() => { aiPromptPersistent = false; renderAiPromptHistory(); });
    });
  });
  document.querySelector('#ai-prompts-reuse').addEventListener('click', () => reuseAiPromptEntry(aiPromptSelected));
  document.querySelector('#ai-answer-open').addEventListener('click', () => { updateAiAnswerInput(); showWorkspacePanel(aiAnswerPanel, true); });
  document.querySelector('#ai-answer-close').addEventListener('click', () => closeWorkspacePanel());
  aiAnswerText.addEventListener('input', () => updateAiAnswerInput());
  aiAnswerClean.addEventListener('change', () => updateAiAnswerInput(false));
  aiAnswerBlock.addEventListener('change', () => updateAiAnswerInput(false));
  document.querySelector('#ai-answer-back').addEventListener('click', () => updateAiAnswerInput(false));
  document.querySelector('#ai-answer-compare').addEventListener('click', reviewAiAnswer);
  document.querySelector('#ai-answer-apply').addEventListener('click', () => {
    updateAiSessionControls();
    if (document.querySelector('#ai-answer-apply').disabled) return;
    const code = aiAnswerReview.code;
    aiAnswerReview = null;
    replaceCode(code, true);
    inform('Ответ принят. Прежний код сохранён в истории.');
  });
  document.querySelector('#ai-answer-paste').addEventListener('click', async () => {
    if (aiAnswerReading) return;
    aiAnswerReading = true; const revision = aiAnswerRevision, before = aiAnswerText.value;
    updateAiSessionControls();
    try {
      if (!navigator.clipboard?.readText) throw new Error('clipboard-unavailable');
      const text = await readClipboardWithTimeout();
      if (revision !== aiAnswerRevision || before !== aiAnswerText.value || currentPanel() !== aiAnswerPanel) return;
      aiAnswerText.value = text; updateAiAnswerInput();
    } catch {
      if (revision === aiAnswerRevision && currentPanel() === aiAnswerPanel) {
        document.querySelector('#ai-answer-note').textContent = 'Буфер недоступен. Нажмите на поле ответа и выберите «Вставить» в меню.';
        aiAnswerText.focus({ preventScroll: true });
      }
    } finally { aiAnswerReading = false; updateAiSessionControls(); }
  });
}
