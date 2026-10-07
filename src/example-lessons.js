// Lesson text is separate from the exported example HTML.
const exampleLessons = {
  'sound-panel': {
    basic: { instruction: 'Придумайте свой характер для «Луча»: измените название, частоты, цвет и пояснение. Сохраните четыре кнопки и регулировку громкости.', hint: 'Найдите второй объект массива sounds: notes задаёт начальные частоты, end — конечную, duration — длительность, color — цвет. Имя и пояснение используются в кнопке и отклике.', check: 'Новый звук отличается на слух и по цвету; касание, мышь и клавиша S дают одинаковый результат. Выключение звука и нулевая громкость сохраняют визуальную реакцию.' },
    advanced: { instruction: 'Добавьте переключение между двумя наборами звуков и оформления. Сохраните понятные названия, управление и визуальную работу без звука.', hint: 'Можно хранить два массива параметров и выбирать текущий набор до playSound(). Обновляйте подписи существующих кнопок; не создавайте новый AudioContext при каждом нажатии.', check: 'Оба набора дают отличающиеся звуки и оформление; названия совпадают с откликом. Нет звука до первого действия, выключение работает в обоих наборах, повторные нажатия не зависают.' }
  },
  '3d-showcase': {
    basic: { instruction: 'Измените конструкцию и цвет лампы: сделайте основание шире или уже, измените высоту стойки и выберите свою палитру. Сохраните управление и освещение.', hint: 'Детали создаются в makeLamp(): CylinderGeometry задаёт радиусы и высоту, последние три аргумента mesh — положение. Цвета меню находятся в HTML. Проверьте положение плафона и лампочки после изменения стойки.', check: 'Детали соединены, предмет виден во всех трёх ракурсах, новая палитра работает. Изменение материала и света заметно; сохранённый файл со встроенной Three.js запускается без сети.' },
    advanced: { instruction: 'Добавьте второй вариант плафона и кнопку выбора. Сохраните лампочку, свет, тень, ракурсы и возможность вернуть исходный вариант.', hint: 'Создайте варианты геометрии в makeLamp(), храните ссылки на наружную и внутреннюю части. Меняйте видимость обеих частей одновременно; скрытый плафон не должен оставлять тень.', check: 'Два плафона различимы, видны в каждом ракурсе, переключение не создаёт лишних объектов. Лампа выключается, тень соответствует выбранной форме, сброс возвращает исходный вариант.' }
  },
  'catch-circle': {
    basic: { instruction: 'Придумайте своё название игры и замените розовый цвет цели на свой. Сохраните механику и время игры.', hint: 'Найдите «Поймай круг» и цвет #ef687e. Название есть и в title, и в h1.', check: 'Новое название видно на экране, цель поменяла цвет, счёт растёт после нажатия, игру можно начать повторно.' },
    advanced: { instruction: 'Добавьте выбор сложности перед стартом: обычная цель и маленькая цель. Покажите выбранный режим, сохраните управление и повторную игру.', hint: 'Размер задаёт класс target. Выбранный размер нужно установить до первого вызова move(), чтобы цель не вышла за границы.', check: 'Оба режима запускаются; цель целиком остаётся в поле на телефоне и компьютере; после повторного старта выбранная сложность сохраняется.' }
  },
  'interactive-poster': {
    basic: { instruction: 'Сделайте афишу своего мероприятия: измените название, описание, место, время и три пункта программы. Подберите собственную палитру.', hint: 'Тексты находятся в h1, intro, event-meta и списке program. Цвета заданы переменными в :root и body.dark.', check: 'Название и программа соответствуют одной идее; кнопки работают, текст читается в обеих темах, на телефоне нет горизонтальной прокрутки.' },
    advanced: { instruction: 'Добавьте переключение программы между двумя днями мероприятия. Для каждого дня покажите своё время и пункты, обозначьте выбранный день.', hint: 'Можно хранить две программы в массиве объектов и менять содержимое списка program. Используйте настоящие кнопки с aria-pressed.', check: 'Оба дня доступны касанием, мышью и клавиатурой; переключение не ломает раскрытие программы и обе темы.' }
  },
  'branching-story': {
    basic: { instruction: 'Придумайте свой сюжет и перепишите начало, две сцены и окончания истории. Сохраните работающие переходы, возврат и начало заново.', hint: 'Тексты и переходы собраны в объекте scenes. Второй элемент каждой пары choices — ключ следующей сцены.', check: 'Все варианты ведут к существующим сценам; есть хотя бы два разных окончания; кнопки «Назад» и «Начать сначала» работают.' },
    advanced: { instruction: 'Добавьте новую развилку и отдельное окончание. Дайте выбранным действиям заметное последствие в тексте или оформлении сцены.', hint: 'Добавьте ключ в scenes и переход к нему. Для оформления можно задать класс или data-атрибут в функции show().', check: 'Новая ветка достижима, последствие видно; возврат и повторное прохождение корректны; нет тупиков без окончания или выбора.' }
  },
  'interactive-infographic': {
    basic: { instruction: 'Замените учебные часы и пояснения своими данными для эскиза и прототипа. Обозначьте, что именно измеряется, и сохраняйте одну единицу для всех значений.', hint: 'Числа находятся в stages, названия и пояснения — в topics. Итог и длины полос вычисляются автоматически.', check: 'Итог равен сумме четырёх значений, полосы соответствуют числам, оба этапа переключаются; подписи и источник данных понятны.' },
    advanced: { instruction: 'Добавьте третий этап «Показ» со своим набором данных и кнопкой переключения. Обеспечьте правильный итог и общую шкалу для трёх этапов.', hint: 'Добавьте массив в stages и кнопку с data-stage. Функция render() уже находит максимальное значение среди всех этапов.', check: 'Три кнопки показывают разные данные и правильные суммы; активный этап обозначен; большие значения не выходят за шкалу.' }
  }
};
const expandedExampleLessons = new Set();

function exampleLessonAvailable(id) {
  return expertMode && !modeBusy && !readingClipboard && Boolean(codeField.value.trim()) && gameStorageScope === `example:${id}`;
}

function updateExampleLessonControls() {
  for (const button of document.querySelectorAll('[data-lesson-prompt]')) button.disabled = !exampleLessonAvailable(button.dataset.lessonPrompt);
  for (const note of document.querySelectorAll('[data-lesson-source]')) note.hidden = exampleLessonAvailable(note.dataset.lessonSource);
}

function appendExampleLesson(card, actions, example) {
  const lesson = exampleLessons[example.id];
  if (!lesson) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'Задание';
  toggle.className = 'example-task-toggle';
  const body = document.createElement('section');
  body.className = 'example-task';
  body.id = `lesson-${example.id}`;
  body.setAttribute('aria-label', `Задание к примеру «${example.title}»`);
  body.hidden = !expandedExampleLessons.has(example.id);
  toggle.setAttribute('aria-expanded', String(!body.hidden));
  toggle.setAttribute('aria-controls', body.id);
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden) expandedExampleLessons.delete(example.id);
    else expandedExampleLessons.add(example.id);
  });
  for (const [key, label] of [['basic', 'Базовое задание'], ['advanced', 'Усложнение']]) {
    const task = lesson[key];
    const section = document.createElement('div');
    section.className = 'example-task-level';
    const heading = document.createElement('h3');
    heading.textContent = label;
    const instruction = document.createElement('p');
    instruction.textContent = task.instruction;
    const hint = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Подсказка';
    const hintText = document.createElement('p');
    hintText.textContent = task.hint;
    hint.append(summary, hintText);
    const check = document.createElement('p');
    check.className = 'example-task-check';
    const checkLabel = document.createElement('strong');
    checkLabel.textContent = 'Проверьте: ';
    check.append(checkLabel, task.check);
    const prompt = document.createElement('button');
    prompt.type = 'button';
    prompt.textContent = 'Запрос для ИИ';
    prompt.dataset.lessonPrompt = example.id;
    prompt.setAttribute('aria-label', `Запрос для ИИ: ${label.toLowerCase()}`);
    prompt.addEventListener('click', () => {
      if (!exampleLessonAvailable(example.id)) return;
      openAiPrompts('change', true);
      aiTask.value = `${label} к примеру «${example.title}»:\n${task.instruction}\n\nРезультат для проверки:\n${task.check}`;
      aiTasks.change = aiTask.value;
      updateAiControls();
    });
    section.append(heading, instruction, hint, check, prompt);
    body.append(section);
  }
  const note = document.createElement('p');
  note.className = 'example-task-source';
  note.dataset.lessonSource = example.id;
  note.textContent = 'Для запроса с текущим кодом сначала откройте копию этого примера. Задание можно выполнить и вручную.';
  body.append(note);
  actions.append(toggle);
  card.append(body);
}
