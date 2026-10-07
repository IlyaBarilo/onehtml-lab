// Quality observations never rewrite source and are not a certification.
const qualityChecks = [
  ['touch', 'Касания', 'На телефоне доступны все действия, кнопки удобно нажимать.'],
  ['desktop', 'Мышь и клавиатура', 'Основные действия доступны, фокус виден, ввод работает.'],
  ['reading', 'Экран и текст', 'Текст читается, ничего важного не обрезано; проверены узкий экран и поворот.'],
  ['restart', 'Повторное начало', 'Можно вернуться к началу и повторить основной сценарий.'],
  ['offline', 'Скачанный файл без сети', 'Открыта отдельная сохранённая копия без интернета и проверены разные действия.'],
  ['audio', 'Звук', 'После нажатия звук слышен, громкость и выключение работают; без звука понятен отклик.']
];
const qualityStates = { '': 'Не проверено', ok: 'Проверено', issue: 'Нужна правка', na: 'Не применимо' };
let qualityManual = null;
let qualityRequest = null;
let qualityRequestId = 0;
let qualityTimer = 0;
let qualityReady = false;
let qualitySourceCache = null;
let qualityFeedback = '';
let qualityFindingKey = '';

function inspectQualitySource(code) {
  if (qualitySourceCache?.code === code) return qualitySourceCache.result;
  let viewport = null, scanned = false;
  if (code.length <= 500000) {
    try {
      const cursor = OneHTMLCodeMirror.html().language.parser.parse(code).cursor();
      do {
        if (!['OpenTag', 'SelfClosingTag'].includes(cursor.name)) continue;
        const tag = code.slice(cursor.from, cursor.to);
        if (!/^<meta\b/i.test(tag)) continue;
        let inert = false;
        for (let parent = cursor.node.parent; parent; parent = parent.parent) {
          if (parent.name === 'Element' && /^<(?:template|noscript|iframe|object)\b/i.test(code.slice(parent.from, parent.from + 80))) { inert = true; break; }
        }
        if (inert) continue;
        const attrs = scriptAttributes(tag.replace(/^<meta\b/i, '').replace(/\/?\s*>$/, ''));
        if (decodeScriptUrl(attrs.get('name')?.value || '').toLowerCase() === 'viewport') {
          viewport = decodeScriptUrl(attrs.get('content')?.value || ''); break;
        }
      } while (cursor.next());
      scanned = true;
    } catch {}
  }
  const result = { scanned, viewport };
  qualitySourceCache = { code, result }; return result;
}

// This function executes only inside the sandbox, on an explicit request.
function previewQuality() {
  let last = 0;
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.type !== 'onehtml-lab:quality-request' || !Number.isSafeInteger(data.id) || data.id <= last) return;
    last = data.id;
    try {
      const width = innerWidth, height = innerHeight;
      const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
      const nodes = document.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="button"]');
      const small = []; let visible = 0;
      for (let i = 0; i < Math.min(nodes.length, 500); i++) {
        const node = nodes[i], rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= width
          || style.visibility !== 'visible' || (node.checkVisibility && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
        if (node.disabled) continue;
        let targetWidth = rect.width, targetHeight = rect.height;
        if (node.localName === 'input' && /^(?:checkbox|radio)$/.test(node.type)) for (const label of node.labels || []) {
          const box = label.getBoundingClientRect();
          if (getComputedStyle(label).visibility === 'visible') { targetWidth = Math.max(targetWidth, box.width); targetHeight = Math.max(targetHeight, box.height); }
        }
        visible++;
        if ((targetWidth < 44 || targetHeight < 44) && small.length < 20) small.push({
          label: (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || node.getAttribute('placeholder') || node.localName).trim().slice(0, 70),
          width: Math.round(targetWidth), height: Math.round(targetHeight)
        });
      }
      parent.postMessage({ type: 'onehtml-lab:quality-result', id: data.id, width, height, scrollWidth,
        visible, limited: nodes.length > 500, small, canvas: Boolean(document.querySelector('canvas')) }, '*');
    } catch { parent.postMessage({ type: 'onehtml-lab:quality-result', id: data.id, unavailable: true }, '*'); }
  });
}

function qualityManualCurrent() {
  return qualityManual && qualityManual.code === codeField.value && qualityManual.scope === gameStorageScope;
}

function qualityStartManual() {
  if (!expertMode || !codeField.value.trim() || modeBusy) return;
  qualityManual = { code: codeField.value, scope: gameStorageScope, time: Date.now(), answers: {} };
  renderQuality();
}

function qualityLayoutState() {
  const run = diagnosticRun, layout = run?.qualityLayout;
  if (!run) return 'Приложение ещё не запускалось.';
  if (!layout) return qualityFeedback || 'Размеры ещё не сняты. Запустите приложение и нажмите «Снять размеры».';
  let note = layout.unavailable ? 'Не удалось получить размеры последнего запуска. Попробуйте измерить снова.'
    : `Снимок ${new Date(layout.time).toLocaleTimeString('ru-RU')} · ${formatUIInteger(layout.width)} × ${formatUIInteger(layout.height)}.`;
  if (run.code !== codeField.value) note += ' Код изменён: снимок относится к прежней версии.';
  if (running && activeFrame && (layout.windowWidth !== innerWidth || layout.windowHeight !== innerHeight || layout.desktop !== JSON.stringify(desktopView)
    || (!currentPanel() && (Math.abs(activeFrame.clientWidth - layout.width) > 2 || Math.abs(activeFrame.clientHeight - layout.height) > 2)))) note += ' Размер области изменён: снимите размеры снова.';
  if (!running) note += ' Последний запуск остановлен.';
  return qualityFeedback ? qualityFeedback + ' ' + note : note;
}

function qualityFindings() {
  const rows = [], code = codeField.value;
  if (!code.trim()) return [{ title: 'Сначала откройте HTML', text: 'Вставьте код или откройте копию примера.' }];
  const source = inspectQualitySource(code);
  if (!source.scanned) rows.push({ title: 'Настройка экрана не проверена', text: 'Исходник слишком большой или не удалось его разобрать. Проверьте meta viewport вручную.' });
  else if (!/\bwidth\s*=\s*device-width\b/i.test(source.viewport || '')) rows.push({ title: 'Проверьте мобильный экран', text: 'В текущем HTML не найден viewport с width=device-width. На телефоне отдельный файл может отображаться мелко. Предпросмотр не заменяет проверку скачанного файла.' });
  const resources = resourceRows.filter(row => row.state !== 'Встроена в HTML');
  if (!diagnosticReportReady || diagnosticSnapshot?.code !== code) rows.push({ title: 'Ресурсы ещё не проверены', text: 'Дождитесь просмотра подключений текущего кода или откройте диагностику ещё раз.' });
  else if (resources.length) rows.push({ title: 'Автономность требует проверки', text: `В HTML и стилях есть ссылки на ресурсы: ${formatUIInteger(resources.length)}. Доступная копия библиотеки ещё не означает её встраивание в скачанный файл. Проверьте раздел «Ресурсы» и сохранённую копию без сети.` });
  else rows.push({ title: 'Внешних ссылок при просмотре HTML не найдено', text: 'Адреса в JavaScript и внешнем CSS могут остаться незамеченными. Автономность подтверждается ручным запуском скачанного файла.' });
  const run = diagnosticRun;
  if (run) {
    const counts = diagnosticCounts();
    if (counts.errors || counts.warnings) rows.push({ title: `Последний запуск: ошибок ${formatUIInteger(counts.errors)}, предупреждений ${formatUIInteger(counts.warnings)}`, text: `${run.code !== code ? 'Код изменён: сообщения относятся к прежней версии. ' : ''}Подробности — в разделе «Ошибки». Отсутствие новых сообщений не подтверждает работоспособность всех действий.` });
    const failures = [...(run.resources?.values() || [])].filter(row => row.blocked || row.error).length;
    if (failures) rows.push({ title: `Проблемы с ресурсами: ${formatUIInteger(failures)}`, text: `${run.code !== code ? 'Данные прежней версии. ' : ''}Есть ошибки загрузки или блокировки. Проверьте «Ресурсы» и нужность этих обращений.` });
    const layout = run.qualityLayout;
    if (layout) {
      if (layout.unavailable) rows.push({ title: 'Размеры не удалось получить', text: 'Попробуйте повторить измерение или проверьте экран вручную.' });
      else {
        if (layout.scrollWidth > layout.width + 2) rows.push({ title: 'Содержимое шире экрана', text: `Ширина содержимого ${formatUIInteger(layout.scrollWidth)}, область ${formatUIInteger(layout.width)}. Проверьте горизонтальную прокрутку и обрезанные элементы. Это наблюдение указанного снимка.` });
        if (layout.small.length) rows.push({ title: `Небольшие элементы управления: ${formatUIInteger(layout.small.length)}${layout.small.length === 20 ? ' и, возможно, больше' : ''}`, text: 'Одна из сторон меньше 44 пикселей: ' + layout.small.map(row => `${row.label || 'Элемент'} (${formatUIInteger(row.width)} × ${formatUIInteger(row.height)})`).join('; ') + '. Проверьте удобство касания, включая окружающие отступы.' });
        if (!layout.small.length && layout.scrollWidth <= layout.width + 2) rows.push({ title: 'В снимке выход за ширину и малые кнопки не замечены', text: 'Проверены только видимые обычные элементы управления. Другие экраны, текст, фокус и поведение требуют ручной проверки.' });
        if (layout.canvas) rows.push({ title: 'Есть Canvas или 3D', text: 'Кнопки и текст, нарисованные внутри Canvas, автоматически не оцениваются. Проверьте их касанием, мышью и клавиатурой.' });
        if (layout.limited) rows.push({ title: 'Просмотр элементов ограничен', text: 'Проверены первые 500 элементов управления; малые элементы показаны до 20.' });
      }
    }
  }
  return rows;
}

function requestQualityLayout() {
  if (!expertMode || !running || !activeFrame || modeBusy || qualityRequest || diagnosticRun?.code !== codeField.value) return;
  clearTimeout(qualityTimer);
  qualityFeedback = '';
  const request = { id: ++qualityRequestId, run: diagnosticRun, scroll: activityPanel.querySelector('.panel-body').scrollTop };
  qualityRequest = request;
  closeWorkspacePanel(false);
  // Wait until normal toolbar/preview layout has settled, without restarting.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (qualityRequest !== request || !running || !activeFrame || diagnosticRun !== request.run) return;
    request.windowWidth = innerWidth; request.windowHeight = innerHeight; request.desktop = JSON.stringify(desktopView);
    activeFrame.contentWindow.postMessage({ type: 'onehtml-lab:quality-request', id: request.id }, '*');
  }));
  qualityTimer = setTimeout(() => {
    if (qualityRequest !== request) return;
    qualityRequest = null;
    qualityFeedback = 'Нет ответа. Дождитесь загрузки приложения и повторите измерение.';
    returnQualityPanel(request);
  }, 1800);
}

function returnQualityPanel(request) {
  if (expertMode && running && diagnosticRun === request.run && !currentPanel()) {
    openDiagnostics('quality'); activityPanel.querySelector('.panel-body').scrollTop = request.scroll;
    document.querySelector('#quality-measure').focus({ preventScroll: true });
  }
  renderQuality();
}

function renderQuality() {
  if (!qualityReady || currentPanel() !== activityPanel || diagnosticTab !== 'quality') return;
  const empty = !codeField.value.trim();
  document.querySelector('#quality-ai').disabled = empty || modeBusy || !diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value;
  document.querySelector('#quality-measure').disabled = !running || !activeFrame || modeBusy || Boolean(qualityRequest) || diagnosticRun?.code !== codeField.value;
  document.querySelector('#quality-manual-start').disabled = empty || modeBusy;
  if (!qualityRequest) document.querySelector('#quality-layout-note').textContent = qualityLayoutState();
  const findings = document.querySelector('#quality-findings');
  const rows = qualityFindings(), key = JSON.stringify(rows);
  const expanded = new Set([...findings.querySelectorAll('details[open]')].map(node => node.querySelector('summary').textContent));
  if (key !== qualityFindingKey) findings.replaceChildren(...rows.map(row => {
    const item = document.createElement('li'); item.className = 'quality-finding';
    const detail = document.createElement('details'), title = document.createElement('summary'), text = document.createElement('p');
    title.textContent = row.title; text.textContent = row.text; detail.open = expanded.has(row.title);
    detail.append(title, text); item.append(detail); return item;
  }));
  qualityFindingKey = key;
  const current = qualityManualCurrent();
  const count = current ? Object.values(qualityManual.answers).filter(value => value).length : 0;
  document.querySelector('#quality-manual-note').textContent = !qualityManual
    ? 'Отметьте выполненные проверки. Отметки действуют в этом сеансе для проверенного кода.'
    : `${new Date(qualityManual.time).toLocaleString('ru-RU')} · ` + (current
      ? `Отмечено ${formatUIInteger(count)} из ${qualityChecks.length}. «Проверено» — ваша отметка, а не вывод автоматики.`
      : 'Код или открытая работа изменены. Отметки прежней версии; для новой начните проверку заново.');
  for (const [id] of qualityChecks) {
    const select = document.querySelector('#quality-' + id);
    select.value = qualityManual?.answers[id] || '';
    select.disabled = empty || modeBusy || Boolean(qualityManual && !current);
    select.closest('label').classList.toggle('is-stale', Boolean(qualityManual && !current));
  }
}

function qualityReport() {
  const lines = ['Проверка перед показом и сдачей', 'Наблюдения не подтверждают качество всего приложения.', ...qualityFindings().map(row => `${row.title}: ${row.text}`), qualityLayoutState(), 'Ручные проверки:'];
  if (qualityManual) lines.push(`${new Date(qualityManual.time).toLocaleString('ru-RU')} · ${qualityManualCurrent() ? 'Текущий код' : 'Прежняя версия: эти отметки не подтверждают текущий код'}.`);
  for (const [id, title] of qualityChecks) lines.push(`${title}: ${qualityStates[qualityManual?.answers[id] || '']}`);
  return lines.join('\n');
}

function initQuality() {
  qualityReady = true;
  const list = document.querySelector('#quality-manual-list');
  for (const [id, title, description] of qualityChecks) {
    const label = document.createElement('label'); label.className = 'quality-check';
    const text = document.createElement('span'), heading = document.createElement('strong'), detail = document.createElement('span');
    heading.textContent = title; detail.textContent = description; text.append(heading, detail);
    const select = document.createElement('select'); select.id = 'quality-' + id; select.setAttribute('aria-label', title);
    for (const [value, caption] of Object.entries(qualityStates)) { const option = document.createElement('option'); option.value = value; option.textContent = caption; select.append(option); }
    select.addEventListener('change', () => {
      const value = select.value;
      if (!expertMode || modeBusy || !codeField.value.trim() || (qualityManual && !qualityManualCurrent())) { renderQuality(); return; }
      if (!qualityManual) qualityStartManual();
      qualityManual.answers[id] = value; qualityManual.time = Date.now(); renderQuality();
    });
    label.append(text, select); list.append(label);
  }
  document.querySelector('#quality-manual-start').addEventListener('click', qualityStartManual);
  document.querySelector('#quality-measure').addEventListener('click', requestQualityLayout);
  document.querySelector('#quality-ai').addEventListener('click', () => {
    if (!expertMode || modeBusy || !codeField.value.trim() || !diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value) return;
    const context = { code: codeField.value, scope: gameStorageScope, text: qualityReport() };
    openAiPrompts('check', true); aiQualityContext = context; updateAiControls();
  });
  window.addEventListener('message', event => {
    const data = event.data, request = qualityRequest;
    if (!request || !running || !activeFrame || event.source !== activeFrame.contentWindow || data?.type !== 'onehtml-lab:quality-result' || data.id !== request.id || diagnosticRun !== request.run) return;
    if (data.unavailable !== true && (![data.width, data.height, data.scrollWidth, data.visible].every(value => Number.isFinite(value) && value >= 0 && value <= 1e7)
      || !Array.isArray(data.small) || data.small.length > 20 || data.small.some(row => !row || typeof row.label !== 'string' || row.label.length > 70 || ![row.width, row.height].every(value => Number.isFinite(value) && value >= 0 && value <= 1e7)))) return;
    const measurement = data.unavailable === true ? { unavailable: true } : { width: data.width, height: data.height, scrollWidth: data.scrollWidth,
      visible: data.visible, limited: data.limited === true, canvas: data.canvas === true,
      small: data.small.map(row => ({ label: row.label, width: row.width, height: row.height })) };
    diagnosticRun.qualityLayout = { ...measurement, time: Date.now(), windowWidth: request.windowWidth, windowHeight: request.windowHeight, desktop: request.desktop };
    qualityRequest = null; qualityFeedback = ''; clearTimeout(qualityTimer); returnQualityPanel(request);
  });
}
