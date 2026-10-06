// Preparing a prompt is read-only: no editor, history, cache or network writes.
const aiTask = document.querySelector('#ai-task');
const aiShorten = document.querySelector('#ai-shorten');
const aiOutput = document.querySelector('#ai-output');
const aiSummary = document.querySelector('#ai-summary');
const aiLibraries = document.querySelector('#ai-libraries');
const aiCopy = document.querySelector('#ai-copy');
const aiView = document.querySelector('#ai-view');
const aiTasks = { create: '', change: '', fix: '' };
let aiMode = 'create';
let aiShowingPreview = false;
let aiReady = false;
let aiRevision = 0;
let aiTimer;
let aiSnapshot = null;
let aiResult = null;
let aiSourcePlan = null;

function aiPromptSnapshot() {
  return { mode: aiMode, platform: selectedPlatform, task: aiTask.value.trim(), shorten: aiShorten.checked,
    project: examples.some(example => example.category === 'media' && gameStorageScope === `example:${example.id}`) ? 'application' : 'game',
    code: aiMode === 'create' ? '' : codeField.value,
    error: aiMode === 'fix' && runtimeErrorCode === codeField.value ? diagnosticAiContext() || runtimeErrorReport : '' };
}

function sameAiSnapshot(a, b) {
  return a && b && Object.keys(b).every(key => a[key] === b[key]);
}

function aiPromptText(snapshot, code, shortened) {
  const mobile = snapshot.platform === 'mobile';
  const screen = mobile ? 'телефона' : 'компьютера';
  const application = snapshot.mode !== 'create' && snapshot.project === 'application';
  const subject = application ? 'Приложение' : 'Игра';
  const device = mobile
    ? `Основное устройство — телефон. В первую очередь продумай расположение элементов, размер текста и кнопок для его экрана. ${subject} ${application ? 'должно использовать доступный экран' : 'должна занимать весь экран'} и удобно управляться касаниями и экранными кнопками. Также обеспечь работу на компьютере: адаптацию к размеру окна, управление мышью и клавиатурой.`
    : `Основное устройство — компьютер. В первую очередь продумай расположение элементов, размер текста и элементов управления для его экрана. ${subject} ${application ? 'должно использовать доступное окно браузера' : 'должна занимать всё окно браузера'} и удобно управляться мышью и клавиатурой. Также обеспечь работу на телефоне: адаптацию к небольшому экрану, читаемый текст, крупные экранные кнопки и управление касаниями.`;
  if (snapshot.mode === 'create') {
    return `Сделай игру про ${snapshot.task || '[тема игры]'} для ${screen}. Сделай одним файлом HTML со встроенными CSS и JavaScript. ${device} Добавь возможность сыграть ещё раз. Верни только полный HTML-код.`;
  }
  const parts = [snapshot.mode === 'fix' ? `Исправь ошибку в ${application ? 'приложении' : 'игре'} ниже.` : `Измени ${application ? 'приложение' : 'игру'} ниже по моему описанию.`,
    `Верни полный HTML-файл, чтобы я мог целиком заменить прежний код. ${device}`];
  if (application) parts.push('Сохрани автономный HTML со встроенными CSS и JavaScript. Не добавляй внешние файлы, шрифты или библиотеки. Сохрани доступное управление и учти предпочтение уменьшенного движения.');
  if (snapshot.task) parts.push(`${snapshot.mode === 'fix' ? 'Что не работает' : 'Что изменить'}:\n${snapshot.task}`);
  else if (snapshot.mode === 'change') parts.push('Если задача изменения ещё не указана, сначала спроси, что именно поменять.');
  if (snapshot.error) parts.push(`Сообщение об ошибке:\n${snapshot.error}`);
  if (shortened.length) parts.push(`Встроенные библиотеки заменены CDN-ссылками: ${shortened.join(', ')}. Сохрани эти ссылки и точные версии, не вставляй код библиотек в ответ.`);
  parts.push('Текущий код:\n' + code);
  return parts.join('\n\n');
}

function setAiPreview(value) {
  aiShowingPreview = value;
  document.querySelector('#ai-compose').hidden = value;
  document.querySelector('#ai-preview-body').hidden = !value;
  document.querySelector('#ai-title').textContent = value ? 'Готовый запрос' : 'ИИ и запросы';
  aiView.textContent = value ? 'К задаче' : 'Просмотр';
  aiView.setAttribute('aria-pressed', String(value));
  if (value) aiOutput.scrollTop = 0;
}

function setAiMode(mode) {
  if (!Object.hasOwn(aiTasks, mode)) return;
  aiTasks[aiMode] = aiTask.value;
  aiMode = mode;
  aiTask.value = aiTasks[mode];
  const labels = { create: 'Тема игры и пожелания', change: 'Что изменить?', fix: 'Что не работает?' };
  const placeholders = { create: 'Например: игра про космос, собирать звёзды и избегать метеоритов',
    change: 'Например: добавить уровни и кнопку паузы', fix: 'Например: после поворота змейка движется не в ту сторону' };
  document.querySelector('#ai-task-label').textContent = labels[mode];
  aiTask.placeholder = placeholders[mode];
  document.querySelector('#ai-source-options').hidden = mode === 'create';
  for (const button of document.querySelectorAll('[data-ai-mode]')) button.setAttribute('aria-pressed', String(button.dataset.aiMode === mode));
  setAiPreview(false);
  updateAiControls();
}

function openAiPrompts(mode, nested = false) {
  if (!expertMode || modeBusy) return;
  if (mode) setAiMode(mode);
  setAiPreview(false);
  aiSourcePlan = null;
  aiSnapshot = null;
  showWorkspacePanel(aiDialog, nested || (mode === 'fix' && currentPanel() === activityPanel));
}

function updateAiControls() {
  if (!aiReady) return;
  const empty = !codeField.value.trim();
  document.querySelector('#prompt-change').disabled = empty;
  document.querySelector('#prompt-fix').disabled = empty;
  const errorAction = document.querySelector('#error-ai');
  errorAction.hidden = !expertMode;
  errorAction.disabled = empty || modeBusy || runtimeErrorCode !== codeField.value;
  if (currentPanel() !== aiDialog) {
    clearTimeout(aiTimer);
    aiRevision++;
    aiSnapshot = null;
    return;
  }
  const snapshot = aiPromptSnapshot();
  if (sameAiSnapshot(aiSnapshot, snapshot)) return;
  aiSnapshot = snapshot;
  aiResult = null;
  aiCopy.disabled = true;
  aiView.disabled = !aiShowingPreview;
  aiOutput.value = '';
  aiLibraries.textContent = '';
  aiLibraries.hidden = true;
  const error = document.querySelector('#ai-error');
  error.textContent = snapshot.error;
  document.querySelector('#ai-error-context').hidden = !snapshot.error;
  const revision = ++aiRevision;
  clearTimeout(aiTimer);
  if (snapshot.mode !== 'create' && !snapshot.code.trim()) {
    aiSummary.textContent = 'Сначала вставьте или откройте HTML-код.';
    return;
  }
  if (snapshot.mode === 'fix' && !snapshot.task && !snapshot.error) {
    aiSummary.textContent = 'Опишите, что не работает.';
    return;
  }
  aiSummary.textContent = 'Подготовка запроса…';
  aiTimer = setTimeout(() => void prepareAiPrompt(snapshot, revision), 120);
}

async function prepareAiPrompt(snapshot, revision) {
  let code = snapshot.code;
  const shortened = [];
  let notes = [];
  if (snapshot.mode !== 'create' && snapshot.shorten && /data-onehtml-library\s*=/i.test(code)) {
    try {
      if (aiSourcePlan?.code !== code) aiSourcePlan = { code, promise: planLibraryExtraction(code, 'cdn') };
      const plan = await aiSourcePlan.promise;
      code = plan.html;
      for (const row of plan.rows) {
        if (row.removable) { if (!shortened.includes(row.title)) shortened.push(row.title); }
        else notes.push(`${row.title}: ${row.cdn ? row.note : row.reason || 'нет точной CDN-ссылки'} Оставлена в коде.`);
      }
      if (shortened.length) notes.unshift('В копии для ИИ заменены ссылками: ' + shortened.join(', ') + '.');
    } catch {
      code = snapshot.code;
      shortened.length = 0;
      notes = ['Не удалось проверить библиотеки. Код включён без сокращения.'];
    }
  }
  if (revision !== aiRevision || currentPanel() !== aiDialog || !sameAiSnapshot(snapshot, aiPromptSnapshot())) return;
  const text = aiPromptText(snapshot, code, shortened);
  const saved = Math.max(0, symbolCount(snapshot.code) - symbolCount(code));
  aiOutput.value = text;
  aiSummary.textContent = `В запросе: ${formatSymbolCount(symbolCount(text))}` + (saved ? ` · убрано из кода: ${formatSymbolCount(saved)}` : '');
  aiLibraries.textContent = notes.join('\n');
  aiLibraries.hidden = !notes.length;
  aiResult = { snapshot, text };
  aiCopy.disabled = false;
  aiView.disabled = false;
}

function initAiPrompts() {
  aiReady = true;
  setAiMode('create');
  for (const button of document.querySelectorAll('[data-ai-mode]')) button.addEventListener('click', () => setAiMode(button.dataset.aiMode));
  aiTask.addEventListener('input', () => { aiTasks[aiMode] = aiTask.value; updateAiControls(); });
  aiShorten.addEventListener('change', updateAiControls);
  aiView.addEventListener('click', () => setAiPreview(!aiShowingPreview));
  aiCopy.addEventListener('click', () => {
    if (!aiResult || !sameAiSnapshot(aiResult.snapshot, aiPromptSnapshot())) { updateAiControls(); return; }
    // Compilation finished before this click, preserving clipboard user activation.
    void copyOrSelect(aiResult.text, 'Запрос скопирован. Вставьте его в выбранного ИИ-бота.');
  });
  document.querySelector('#error-ai').addEventListener('click', () => openAiPrompts('fix'));
}
