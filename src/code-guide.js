// Prepared maps use syntax nodes in the current document, never stored line numbers.
// Parsing is inert: no HTML is inserted and no user script is executed.
const codeGuides = {
  'sound-panel': [
    ['Характеры звука', 'Массив sounds: названия, клавиши, частоты, длительность и цвета четырёх звуков.', 'VariableDeclaration', /const\s+sounds\s*=/g],
    ['Визуальный отклик', 'Функция showSound связывает выбранный звук с формой, цветом и подписью.', 'FunctionDeclaration', /function\s+showSound\s*\(/g],
    ['Создание звука', 'playSound создаёт аудиоконтекст после действия, затем осцилляторы и огибающую громкости.', 'FunctionDeclaration', /async\s+function\s+playSound\s*\(/g],
    ['Громкость', 'Обработчик ползунка меняет общий уровень; нулевой уровень останавливает текущие звуки.', 'ExpressionStatement', /volume\.oninput\s*=/g],
    ['Палитра панели', 'Переменные светлой темы. Ночная палитра находится в body.dark ниже.', 'RuleSet', /:root\s*\{/g]
  ],
  '3d-showcase': [
    ['Геометрия предмета', 'makeLamp собирает основание, стойку, плафон и лампочку из геометрических деталей.', 'FunctionDeclaration', /function\s+makeLamp\s*\(/g],
    ['Материалы и свет', 'updateScene применяет выбранный цвет, материал, яркость и состояние лампы.', 'FunctionDeclaration', /function\s+updateScene\s*\(/g],
    ['Ракурсы', 'Положения камеры для трёх видов; lookAt задаёт точку, на которую она смотрит.', 'FunctionDeclaration', /function\s+setCamera\s*\(/g],
    ['Сцена и тени', 'setupScene создаёт рендерер, пол и источники света; здесь включаются и настраиваются тени.', 'FunctionDeclaration', /function\s+setupScene\s*\(/g],
    ['Автоповорот', 'tick меняет угол с учётом времени; вращение приостанавливается в фоне и при уменьшении движения.', 'FunctionDeclaration', /function\s+tick\s*\(/g]
  ],
  'catch-circle': [
    ['Название', 'Надпись на экране. Название вкладки отдельно находится в title.', 'Element', /<h1\b[^>]*>/g],
    ['Вид цели', 'Цвет, размер и форма круга. После изменения размера проверьте края поля.', 'RuleSet', /\.target\s*\{/g],
    ['Счёт и время', 'Начальные значения счёта, секунд и переменная таймера.', 'VariableDeclaration', /(?:let|const|var)\s+score\s*=/g],
    ['Положение цели', 'Функция move выбирает случайную точку с учётом размера поля и цели.', 'FunctionDeclaration', /function\s+move\s*\(/g],
    ['Начало игры', 'Кнопка сбрасывает счёт, запускает отсчёт и показывает цель.', 'ExpressionStatement', /start\.onclick\s*=/g]
  ],
  'interactive-poster': [
    ['Название', 'Главный заголовок афиши. Остальные тексты находятся рядом в HTML.', 'Element', /<h1\b[^>]*\bid\s*=\s*["']title["'][^>]*>/g],
    ['Место и время', 'Информация о мероприятии. Согласуйте её с текстами программы.', 'Element', /<[^>]+\bclass\s*=\s*["']event-meta["'][^>]*>/g],
    ['Программа', 'Пункты, которые раскрываются кнопкой. Здесь можно менять время и описание.', 'Element', /<ul\b[^>]*\bid\s*=\s*["']program["'][^>]*>/g],
    ['Цвета', 'Переменные светлой темы. Для ночной палитры отдельно найдите body.dark.', 'RuleSet', /:root\s*\{/g],
    ['Раскрытие программы', 'Обработчик кнопки показывает список и обновляет доступное состояние.', 'ExpressionStatement', /toggle\.onclick\s*=/g]
  ],
  'branching-story': [
    ['Сцены и выборы', 'Объект scenes хранит сюжет, подписи вариантов и ключи переходов.', 'VariableDeclaration', /(?:const|let|var)\s+scenes\s*=/g],
    ['Пройденный путь', 'Массив route хранит выбранные сцены; нужен для возврата назад.', 'VariableDeclaration', /(?:const|let|var)\s+route\s*=/g],
    ['Показ сцены', 'Функция show обновляет текст, варианты, окончание и состояние возврата.', 'FunctionDeclaration', /function\s+show\s*\(/g],
    ['Возврат и повтор', 'Кнопки в нижней части истории. Их обработчики находятся в script.', 'Element', /<footer\b[^>]*>/g],
    ['Цвета', 'Базовая палитра истории. Ночная тема и иллюстрация описаны ниже.', 'RuleSet', /:root\s*\{/g]
  ],
  'interactive-infographic': [
    ['Данные этапов', 'Массивы stages задают часы для каждого направления. Итог вычисляется автоматически.', 'VariableDeclaration', /(?:const|let|var)\s+stages\s*=/g],
    ['Названия и пояснения', 'В topics находятся названия направлений, цвета полос и поясняющие тексты.', 'VariableDeclaration', /(?:const|let|var)\s+topics\s*=/g],
    ['Диаграмма и итог', 'Функция render строит полосы, вычисляет сумму и общую шкалу.', 'FunctionDeclaration', /function\s+render\s*\(/g],
    ['Выбор этапа', 'Функция updateSelection отмечает активную кнопку; обработчики выбора находятся ниже.', 'FunctionDeclaration', /function\s+updateSelection\s*\(/g],
    ['Цвета', 'Базовая палитра. Цвет каждой полосы задан отдельно в topics.', 'RuleSet', /:root\s*\{/g]
  ]
};
let codeGuideCache = { source: null, id: null, rows: [] };
let codeGuideRendered = null;

function currentCodeGuideId() {
  const id = gameStorageScope.startsWith('example:') ? gameStorageScope.slice(8) : '';
  return Object.hasOwn(codeGuides, id) ? id : null;
}

function locateGuideNode(source, tree, entry) {
  const [, , kind, pattern] = entry, ranges = [];
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    let node = tree.resolveInner(match.index + 1, 1);
    while (node && node.name !== kind) node = node.parent;
    if (!node || node.from !== match.index) continue;
    let broken = false;
    node.toTree().iterate({ enter(node) { if (node.type.isError) broken = true; } });
    if (!broken) ranges.push({ start: node.from, end: node.to });
  }
  return ranges.length === 1 ? ranges[0] : null;
}

function currentGuideRows() {
  const id = currentCodeGuideId(), source = codeField.value;
  if (codeGuideCache.id === id && codeGuideCache.source === source) return codeGuideCache.rows;
  let tree = null;
  if (id && source.length <= 500000) {
    try { tree = OneHTMLCodeMirror.html().language.parser.parse(source); } catch {}
  }
  const rows = id ? codeGuides[id].map(entry => ({ label: entry[0], description: entry[1], range: tree ? locateGuideNode(source, tree, entry) : null })) : [];
  codeGuideCache = { source, id, rows };
  return rows;
}

function updateCodeGuide() {
  if (currentPanel() !== editPanel) return;
  const section = document.querySelector('#code-guide'), list = document.querySelector('#code-guide-list');
  const empty = !codeField.value.trim();
  for (const id of ['edit-explain', 'edit-check']) document.querySelector('#' + id).disabled = empty || modeBusy || readingClipboard;
  const id = currentCodeGuideId();
  section.hidden = !id;
  document.querySelector('#code-guide-note').hidden = Boolean(id);
  if (!id) { list.replaceChildren(); codeGuideRendered = null; return; }
  const key = { source: codeField.value, id, blocked: modeBusy || readingClipboard };
  if (codeGuideRendered && Object.keys(key).every(k => codeGuideRendered[k] === key[k])) return;
  codeGuideRendered = key;
  const title = examples.find(example => example.id === id)?.title || '';
  document.querySelector('#code-guide-title').textContent = 'Разбор примера: ' + title;
  list.replaceChildren();
  currentGuideRows().forEach((row, index) => {
    const item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.dataset.guidePart = String(index); button.textContent = row.label;
    button.disabled = !row.range || key.blocked;
    const description = document.createElement('p'); description.textContent = row.description;
    item.append(button, description);
    if (!row.range) {
      const note = document.createElement('p'); note.className = 'edit-note';
      note.textContent = codeField.value.length > 500000 ? 'Файл слишком большой для разбора. Используйте поиск.' : 'Участок удалён, переименован, неоднозначен или содержит ошибку. Используйте поиск.';
      item.append(note);
    }
    button.addEventListener('click', () => {
      if (modeBusy || readingClipboard) return;
      const current = currentGuideRows()[index];
      if (!current?.range || currentCodeGuideId() !== id) { codeGuideRendered = null; updateCodeGuide(); return; }
      revealCodeRange(current.range.start, current.range.end);
    });
    list.append(item);
  });
}
