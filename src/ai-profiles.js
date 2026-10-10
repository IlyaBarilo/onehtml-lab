// Requirements describe new games; existing code determines subsequent changes.
const aiGameOptions = {
  dimension: { '2d': '2D', '3d': '3D' },
  basis: { auto: 'Рекомендовать', canvas: 'Без библиотек', phaser3: 'Phaser 3.90.0', phaser4: 'Phaser 4.2.1', matter: 'Matter.js 0.20.0', three: 'Three.js r160', babylon: 'Babylon.js 9.30.0' },
  genre: { '': 'Своя идея', platformer: 'Платформер', arcade: 'Аркада сверху', puzzle: 'Головоломка', runner: 'Раннер', racing: 'Гонки' },
  physics: { '': 'По задаче', simple: 'Простые столкновения', gravity: 'Прыжки и гравитация', bodies: 'Вращение и равновесие' },
  camera: { '': 'По задаче', side: 'Сбоку', top: 'Сверху', iso: 'Изометрия', behind: 'Позади героя', first: 'От первого лица' },
  orientation: { '': 'Любая', portrait: 'Основная — вертикальная', landscape: 'Основная — горизонтальная' },
  controls: { '': 'По задаче', tap: 'Касания', drag: 'Перетаскивание', buttons: 'Экранные кнопки', stick: 'Виртуальный джойстик' },
  style: { '': 'По описанию', paper: 'Бумажная аппликация', neon: 'Неоновый мир', drawn: 'Рисованная сказка', minimal: 'Чёткая геометрия' },
  sound: { '': 'По задаче', none: 'Без звука', effects: 'Простые эффекты', rhythm: 'Музыка и ритм' },
  load: { '': 'Сбалансированно', light: 'Легче для телефона', effects: 'Больше эффектов' }
};
const aiGameLabels = { dimension: 'Пространство', basis: 'Основа игры', genre: 'Жанр', physics: 'Физика', camera: 'Камера', orientation: 'Экран', controls: 'Управление на телефоне', style: 'Оформление', sound: 'Звук', load: 'Нагрузка' };
const aiGameCatalog = {
  canvas: { title: 'Без библиотек', key: '' },
  phaser3: { title: 'Phaser 3.90.0', key: 'phaser@3.90.0', url: 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js' },
  phaser4: { title: 'Phaser 4.2.1', key: 'phaser@4.2.1', url: 'https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js' },
  matter: { title: 'Matter.js 0.20.0', key: 'matter-js@0.20.0', url: 'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js' },
  three: { title: 'Three.js r160', key: 'three@0.160.0', url: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js' },
  babylon: { title: 'Babylon.js 9.30.0', key: 'babylonjs@9.30.0', url: 'https://cdn.jsdelivr.net/npm/babylonjs@9.30.0/babylon.js' }
};
let aiGame = normalizeAiGame();

function normalizeAiGame(value) {
  const result = {};
  for (const [key, options] of Object.entries(aiGameOptions)) result[key] = typeof value?.[key] === 'string' && Object.hasOwn(options, value[key]) ? value[key] : Object.keys(options)[0];
  return result;
}
function aiGameChoice(value) {
  const game = normalizeAiGame(value);
  if (game.basis !== 'auto') return { id: game.basis, reason: 'Выбрано вручную.' };
  if (game.dimension === '3d') return { id: 'three', reason: 'Для трёхмерной сцены, камеры и света.' };
  if (game.physics === 'bodies') return { id: 'matter', reason: 'Для вращения, равновесия и соединённых тел с отрисовкой Canvas.' };
  if (game.physics === 'gravity' || ['platformer', 'arcade', 'runner', 'racing'].includes(game.genre)) return { id: 'phaser3', reason: 'Для 2D-сцен, управления и встроенной игровой физики.' };
  return { id: 'canvas', reason: 'Для небольшой игры достаточно возможностей браузера.' };
}
function aiGameWarnings(value) {
  const game = normalizeAiGame(value), { id } = aiGameChoice(game), notes = [];
  if ((game.dimension === '3d') !== ['three', 'babylon'].includes(id)) notes.push('Основа не соответствует 2D/3D. Уточните пространство или основу.');
  if (game.dimension === '3d' && game.physics === 'bodies') notes.push('Полноценная 3D-физика пока не входит в профиль. Упростите физику или опишите её отдельно.');
  if (id === 'canvas' && game.physics === 'bodies') notes.push('Для равновесия и вращения рекомендуем Matter.js; ваш выбор сохранён.');
  if (game.dimension === '2d' && ['behind', 'first'].includes(game.camera)) notes.push('Камера позади героя или от первого лица рассчитана на 3D.');
  return notes;
}
function aiGameInstructions(value, models = false) {
  const game = normalizeAiGame(value), { id } = aiGameChoice(game), profile = aiGameCatalog[id];
  const parts = ['Сделай небольшую законченную игру с одной основной механикой, понятной целью, началом, завершением и повторным запуском.'];
  for (const [key, label] of Object.entries(aiGameLabels)) if (key !== 'basis' && game[key]) parts.push(`${label}: ${aiGameOptions[key][game[key]]}.`);
  parts.push(models && id === 'three' ? 'Используй Three.js r160 как ES-модуль с GLTFLoader. Точные подключения и работа с GLB указаны в конце запроса. Не вставляй исходники библиотек в ответ.' : profile.url ? `Используй ${profile.title}. Подключи до кода игры обычным скриптом <script src="${profile.url}"></script>. Не используй import, latest или другие версии. Не вставляй исходники библиотеки в ответ: OneHTML Lab подготовит их при сохранении.` : 'Используй HTML, Canvas 2D или SVG и обычный JavaScript без внешних библиотек.');
  if (id.startsWith('phaser')) parts.push(`Используй встроенную ${game.physics === 'bodies' ? 'Matter Physics' : 'Arcade Physics при необходимости столкновений'}. Не подключай отдельный Matter.js. Создавай графику через Graphics/текстуры Phaser; не добавляй плагины. При повторном старте не дублируй обработчики и таймеры.`);
  if (id === 'matter') parts.push('Используй Matter.js для физических тел, а Canvas 2D для своей отрисовки. Связывай координаты и поворот рисунка с телом. При сбросе очищай тела и обработчики, не создавай второй цикл обновления.');
  if (id === 'three') parts.push((models ? 'Загрузи выбранные GLB-модели через GLTFLoader той же версии. ' : 'Используй ядро Three.js через THREE, без addons, внешних моделей и загрузчиков. Строй сцену из геометрии, света и материалов; ')+'Простые столкновения проверяй самостоятельно. Ограничь плотность пикселей и число теней на телефоне.');
  if (id === 'babylon') parts.push('Используй ядро Babylon.js через BABYLON и Engine с WebGL. Не подключай WebGPU, Havok, GUI или инспектор. '+(models ? 'Подключи GLB-загрузчик 9.30.0 по инструкции в конце запроса. ' : 'Не подключай загрузчики моделей. Строй сцену из MeshBuilder, материалов, камеры и света; ')+'Простые столкновения проверяй самостоятельно. Ограничь плотность пикселей и размер теней на телефоне. При сбросе освобождай прежнюю Scene и обработчики, не создавай второй цикл кадров.');
  const genres = { platformer: 'Прыжок должен быть предсказуемым; предусмотрено небольшое прощение раннего/позднего нажатия. Цель и опасные поверхности должны быть понятны.', arcade: 'Сделай заметную реакцию на попадание, понятное получение урона и короткую защиту от повторного урона.', puzzle: 'Покажи цель и текущее состояние головоломки. Сделай удобный сброс; начальное состояние должно позволять решение.', runner: 'Дай время увидеть препятствия, постепенно повышай сложность и не создавай непроходимые сочетания.', racing: 'Сделай понятные границы трассы, плавное управление и заметную реакцию на столкновение.' };
  if (genres[game.genre]) parts.push(genres[game.genre]);
  const styles = { paper: 'Используй слои бумажных форм, тёплую ограниченную палитру и мягкие тени.', neon: 'Используй тёмный игровой мир, два-три ярких акцента и умеренное свечение; сохраняй читаемость.', drawn: 'Используй мягкие рисованные силуэты, согласованную палитру и выразительные движения персонажей.', minimal: 'Используй чёткие силуэты, контраст фигуры и фона и различимые формы объектов.' };
  if (styles[game.style]) parts.push(styles[game.style]);
  parts.push('Оформляй сам игровой мир: персонажей, препятствия, фон, движение и реакции. Не заменяй это декоративным меню вокруг простого поля. Не добавляй внешние зависимости и ресурсы кроме выбранной основы и перечисленных медиа.');
  if (game.load === 'light') parts.push('Ограничь частицы и эффекты, переиспользуй объекты, учитывай время кадра и небольшой экран.');
  if (game.sound !== 'none') parts.push('Запускай звук только после действия пользователя, обрабатывай отказ и дай возможность выключить звук. Для простых синтезируемых эффектов используй Web Audio без дополнительной библиотеки.');
  return parts.join(' ');
}
function aiGameMediaRecipe(id) {
  const recipes = {
    canvas: 'После загрузки img используй его в drawImage; не начинай отрисовку до готовности изображения.',
    phaser3: 'До создания Phaser.Game дождись загрузки img. В create() передай HTMLImageElement в this.textures.addImage("hero", imageElement), затем используй ключ "hero" для игрового объекта. При повторном старте проверь this.textures.exists("hero"). Не передавай имя файла в this.load.image.',
    matter: 'После загрузки img рисуй его через Canvas drawImage в позиции и с поворотом физического тела Matter. Не задавай путь в render.sprite.texture.',
    three: 'После загрузки img создай new THREE.Texture(imageElement), задай texture.needsUpdate = true и texture.colorSpace = THREE.SRGBColorSpace, передай текстуру материалу. Не используй TextureLoader с именем файла.',
    babylon: 'После загрузки img нарисуй его в BABYLON.DynamicTexture с исходными размерами: texture.getContext().drawImage(imageElement, 0, 0), затем texture.update(). Передай текстуру материалу. Не создавай BABYLON.Texture с именем файла.'
  };
  return (recipes[id === 'phaser4' ? 'phaser3' : id] || '') + ' Изображение может быть скрытым img с id, но с обычным src; дождись decode() или load и обработай ошибку. Для звука используй audio по id: play() после действия пользователя с обработкой отказа; не создавай URL звука в JavaScript.';
}
// Static observations only. Unknown scripts and dynamic imports are not guessed.
function aiGameConnections(code) {
  const found = new Map(), unknown = new Set();
  let depth = 0;
  const tokens = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)(?:<\/\1\s*>|$)|<\/?(template)\b[^>]*>/gi;
  for (const token of code.matchAll(tokens)) {
    if (token[4]) { depth = Math.max(0, depth + (token[0].startsWith('</') ? -1 : 1)); continue; }
    if (depth || token[1]?.toLowerCase() !== 'script') continue;
    const attrs = scriptAttributes(token[2]), type = attrs.get('type')?.value.toLowerCase().trim() || '';
    if (type && !['module', 'importmap', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const url = decodeScriptUrl(attrs.get('src')?.value || '');
    if (url) {
      const ref = libraryReference((url.startsWith('//') ? 'https:' + url : url).split(/[?#]/)[0]) || localLibraryReference(url);
      if (ref?.key) found.set(ref.key, { key: ref.key, title: ref.title }); else unknown.add(url);
    } else if (attrs.has('data-onehtml-library')) {
      const key = decodeScriptUrl(attrs.get('data-onehtml-catalog')?.value || attrs.get('data-onehtml-library').value), ref = libraryCatalogReference(key);
      if (ref) found.set(ref.key, { key: ref.key, title: ref.title }); else unknown.add('Встроенный скрипт с непроверенной версией');
    } else if (type === 'module' || type === 'importmap') unknown.add('Модульные подключения: см. диагностику библиотек');
  }
  if (typeof scanModules === 'function') for (const ref of scanModules(code).references) {
    const key = /^three-esm@(0\.\d{3}\.0):/.exec(ref.key)?.[1];
    found.set(key ? 'three@'+key : ref.key,{key:key ? 'three@'+key : ref.key,title:ref.title});
  }
  return { found: [...found.values()], unknown: [...unknown] };
}
function aiGameConnectionText(code, profileId = '') {
  const actual = aiGameConnections(code), parts = [];
  if (profileId && Object.hasOwn(aiGameCatalog, profileId)) {
    const expected = aiGameCatalog[profileId]; parts.push('В запросе: ' + expected.title + '.');
    if (expected.key && !actual.found.some(ref => ref.key === expected.key)) parts.push('Ожидаемое подключение не найдено; ответ может использовать другую основу или способ подключения.');
    if (actual.found.some(ref => ref.key !== expected.key)) parts.push('Есть отличающиеся версии или дополнительные библиотеки.');
  }
  parts.push(actual.found.length ? 'В HTML распознано: ' + actual.found.map(ref => ref.title).join(', ') + '.' : 'Известные библиотеки в HTML не распознаны.');
  if (actual.unknown.length) parts.push('Другие подключения: ' + actual.unknown.slice(0, 6).map(url => url.slice(0, 160)).join(', ') + '.');
  if (typeof inspectResources === 'function') {
    const resources = inspectResources(code).rows.filter(row => row.kind !== 'Скрипт' && row.kind !== 'Импорт модуля' && row.state === 'Внешний адрес');
    if (resources.length) parts.push('Внешние медиа, стили или шрифты: ' + resources.slice(0, 4).map(row => row.path.slice(0, 160)).join(', ') + (resources.length > 4 ? '…' : '.') + ' Для автономного файла их нужно подготовить отдельно.');
  }
  parts.push('Это проверка подключений, не запуска. Динамические загрузки и содержимое произвольных скриптов не проверены.');
  return parts.join(' ');
}
function renderAiGameControls() {
  const create = aiProject === 'game' && aiMode === 'create';
  document.querySelector('#ai-game-options').hidden = !create;
  document.querySelector('#ai-game-improve-option').hidden = aiProject !== 'game' || aiMode !== 'change';
  if (!create) return;
  const choice = aiGameChoice(aiGame);
  for (const key of Object.keys(aiGameOptions)) document.querySelector('#ai-game-' + key).value = aiGame[key];
  document.querySelector('#ai-game-recommendation').textContent = `${aiGameCatalog[choice.id].title}. ${choice.reason}` + (choice.id === 'phaser4' ? ' Новая ветка рендеринга, света и фильтров; не все примеры Phaser 3 совместимы.' : choice.id === 'babylon' ? ' Для 3D-сцен с готовыми камерами, материалами и инструментами движка.' : '');
  document.querySelector('#ai-game-warning').textContent = aiGameWarnings(aiGame).join(' ');
}
function initAiGameProfiles() {
  for (const [key, values] of Object.entries(aiGameOptions)) {
    const field = document.querySelector('#ai-game-' + key);
    for (const [value, text] of Object.entries(values)) { const option = document.createElement('option'); option.value = value; option.textContent = text; field.append(option); }
    field.addEventListener('change', () => { aiGame[key] = field.value; saveAiPromptSettings(); renderAiGameControls(); updateAiControls(); });
  }
  document.querySelector('#ai-game-improve').addEventListener('change', event => {
    if (aiMode !== 'change' || aiProject !== 'game') return;
    const text = event.target.selectedOptions[0]?.dataset.task; event.target.value = ''; if (!text) return;
    aiTask.value = [aiTask.value.trim(), text].filter(Boolean).join('\n'); aiTasks.change = aiTask.value; saveAiPromptSettings(); updateAiControls();
  });
}
