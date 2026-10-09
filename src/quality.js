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
let qualityShowing = null;
let qualityShowTimer = 0;
const qualityManualKey = 'onehtml-lab-quality-manual';
let qualityManualSave = 0, qualityManualRevision = 0, qualityManualBinding = '';
let qualityManualStorage = '';
const qualityIssueText = {
  name: ['Элемент без понятного названия', 'Добавьте понятное название кнопки или ссылки: видимый текст либо доступную подпись.'],
  label: ['Поле без подписи', 'Добавьте связанную подпись поля. Подсказка внутри поля исчезает при вводе и не заменяет название.'],
  alt: ['Изображение без описания', 'Добавьте alt с описанием смысла картинки. Для декоративного изображения можно явно указать пустой alt.']
};

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
function previewQuality(token, describe) {
  let last = 0, targets = new Map(), selected = null, selectedTarget = 0, overlay = null, border = null, raf = 0;
  const clear = () => { selected = null; overlay?.remove(); overlay = border = null; cancelAnimationFrame(raf); raf = 0; };
  const reply = (id, target, found) => parent.postMessage({ type: 'onehtml-lab:quality-shown', token, id, target, found }, '*');
  const draw = () => {
    if (!selected) return;
    if (!selected.isConnected || !selected.getClientRects().length || getComputedStyle(selected).visibility !== 'visible') { clear(); reply(last, selectedTarget, false); return; }
    const r = selected.getBoundingClientRect();
    border.style.cssText = 'position:fixed;box-sizing:border-box;pointer-events:none;border:3px solid #4285ff;box-shadow:0 0 0 2px #fff;border-radius:3px;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;';
    raf = requestAnimationFrame(draw);
  };
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.token !== token) return;
    if (data.type === 'onehtml-lab:quality-show') {
      clear();
      if (!data.target) return;
      const node = data.id === last && Number.isInteger(data.target) ? targets.get(data.target) : null;
      if (!node?.isConnected || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') { reply(data.id, data.target, false); return; }
      selected = node; selectedTarget = data.target; node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      overlay = document.createElement('div'); overlay.setAttribute('aria-hidden','true');
      overlay.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
      border = document.createElement('div'); overlay.attachShadow({mode:'closed'}).append(border);
      document.documentElement.append(overlay); draw(); reply(data.id, data.target, true); return;
    }
    if (data.type !== 'onehtml-lab:quality-request' || !Number.isSafeInteger(data.id) || data.id <= last) return;
    clear(); targets.clear();
    last = data.id;
    try {
      const width = innerWidth, height = innerHeight;
      const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
      const nodes = document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], img');
      const small = [], issues = []; let visible = 0;
      const name = node => {
        const labelled = (node.getAttribute('aria-labelledby') || '').split(/\s+/).slice(0,10).map(id=>document.getElementById(id)?.textContent || '').join(' ').trim();
        return labelled || node.getAttribute('aria-label')?.trim() || node.getAttribute('alt')?.trim() || [...(node.labels || [])].map(label=>label.textContent).join(' ').trim()
          || node.getAttribute('title')?.trim() || (node.localName === 'input' ? (/^(?:button|submit|reset)$/.test(node.type) ? node.value || (node.type === 'submit' ? 'Отправить' : node.type === 'reset' ? 'Сбросить' : '') : '')
          : node.localName === 'select' || node.localName === 'textarea' ? '' : node.textContent.trim() || node.querySelector('img[alt]')?.getAttribute('alt')?.trim());
      };
      for (let i = 0; i < Math.min(nodes.length, 500); i++) {
        const node = nodes[i], rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= width
          || style.visibility !== 'visible' || (node.checkVisibility && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) continue;
        if (node.disabled || node.closest('[inert],[aria-hidden="true"]')) continue;
        const target = i + 1, element = describe(node);
        targets.set(target,node);
        const issue = kind => { if (issues.length < 20) issues.push({kind,target,element}); };
        if (node.localName === 'img') {
          if (!node.hasAttribute('alt') && !name(node) && !['presentation','none'].includes(node.getAttribute('role')) && node.getAttribute('aria-hidden') !== 'true') issue('alt');
          continue;
        }
        if (!name(node)) issue(['input','textarea','select'].includes(node.localName) && !/^(?:button|submit|reset|image)$/.test(node.type || '') ? 'label' : 'name');
        let targetWidth = rect.width, targetHeight = rect.height;
        if (node.localName === 'input' && /^(?:checkbox|radio)$/.test(node.type)) for (const label of node.labels || []) {
          const box = label.getBoundingClientRect();
          if (getComputedStyle(label).visibility === 'visible') { targetWidth = Math.max(targetWidth, box.width); targetHeight = Math.max(targetHeight, box.height); }
        }
        visible++;
        if ((targetWidth < 44 || targetHeight < 44) && small.length < 20) small.push({
          label: (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || node.getAttribute('placeholder') || node.localName).trim().slice(0, 70),
          width: Math.round(targetWidth), height: Math.round(targetHeight), target, element
        });
      }
      parent.postMessage({ type: 'onehtml-lab:quality-result', token, id: data.id, width, height, scrollWidth,
        visible, limited: nodes.length > 500, small, issues, canvas: Boolean(document.querySelector('canvas')) }, '*');
    } catch { parent.postMessage({ type: 'onehtml-lab:quality-result', token, id: data.id, unavailable: true }, '*'); }
  });
  addEventListener('pagehide',clear,{once:true});
}

function qualityManualCurrent() {
  return qualityManual && qualityManual.code === codeField.value && qualityManual.scope === gameStorageScope;
}

function loadQualityManual() {
  try {
    const value = JSON.parse(localStorage.getItem(qualityManualKey));
    if (!value || value.version !== 1 || !/^[a-f\d]{64}$/.test(value.hash) || typeof value.scope !== 'string' || value.scope.length > 160
      || !Number.isSafeInteger(value.time) || value.time < 1 || !value.answers || !value.notes) return;
    const answers = {}, notes = {};
    for (const [id] of qualityChecks) {
      const answer = value.answers[id] ?? '', note = value.notes[id] ?? '';
      if (typeof answer !== 'string' || !Object.hasOwn(qualityStates,answer) || typeof note !== 'string' || note.length > 1000) return;
      answers[id] = answer; notes[id] = note;
    }
    qualityManual = {code:null,hash:value.hash,scope:value.scope,time:value.time,answers,notes};
    qualityManualStorage = 'Отметки восстановлены.';
  } catch { qualityManualStorage = 'Хранилище недоступно: отметки останутся в этом сеансе.'; }
}

async function saveQualityManual() {
  clearTimeout(qualityManualSave);
  const record = qualityManual, revision = ++qualityManualRevision;
  if (!record) return;
  const value = {version:1,scope:record.scope,time:record.time,answers:{...record.answers},notes:{...record.notes}};
  const hash = record.hash || await record.hashPromise;
  if (revision !== qualityManualRevision || record !== qualityManual) return;
  try {
    if (!hash) throw Error('hash');
    record.hash = hash; value.hash = hash;
    localStorage.setItem(qualityManualKey,JSON.stringify(value)); qualityManualStorage = 'Отметки и заметки сохранены.';
  } catch { qualityManualStorage = 'Не удалось сохранить: отметки и заметки останутся в этом сеансе.'; }
  renderQuality();
}

function scheduleQualityManualSave() {
  qualityManualRevision++; clearTimeout(qualityManualSave);
  qualityManualStorage = 'Сохраняю отметки…';
  qualityManualSave = setTimeout(() => void saveQualityManual(),200);
}

function updateQualityState() {
  if (!qualityReady) return;
  if (qualityShowing && (!expertMode || !running || !activeFrame || currentPanel() || qualityShowing.run !== diagnosticRun || qualityShowing.code !== codeField.value || qualityShowing.scope !== gameStorageScope)) cancelQualityShow();
  const record = qualityManual;
  if (!record || record.code !== null || codeField.disabled) return;
  const code = codeField.value, scope = gameStorageScope, key = scope + '\n' + code;
  if (qualityManualBinding === key) return;
  qualityManualBinding = key;
  record.checking = true;
  void aiCodeHash(code).then(hash => {
    if (qualityManual !== record || codeField.value !== code || gameStorageScope !== scope) return;
    record.checking = false;
    if (hash && hash === record.hash && scope === record.scope) record.code = code;
    if (!hash) qualityManualStorage = 'Не удалось сверить сохранённую версию. Начните проверку заново.';
    renderQuality();
  });
}

function qualityStartManual() {
  if (!expertMode || !codeField.value.trim() || modeBusy) return;
  qualityManual = { code: codeField.value, scope: gameStorageScope, time: Date.now(), answers: {}, notes: {}, hashPromise:aiCodeHash(codeField.value) };
  scheduleQualityManualSave();
  renderQuality();
}

function cancelQualityShow() {
  if (qualityShowing) activeFrame?.contentWindow.postMessage({type:'onehtml-lab:quality-show',token:activeFrame.pickerToken,id:qualityShowing.id,target:0},'*');
  qualityShowing = null; clearTimeout(qualityShowTimer); document.querySelector('#quality-show-bar').hidden = true;
}

function qualityTargetCurrent(row) {
  return row.layout && diagnosticRun?.qualityLayout === row.layout && diagnosticRun.code === codeField.value && row.layout.scope === gameStorageScope;
}

function showQualityTarget(row) {
  if (!expertMode || modeBusy || !running || !activeFrame || !qualityTargetCurrent(row)) return;
  const scroll = activityPanel.querySelector('.panel-body').scrollTop;
  cancelPreviewPicker(); closeWorkspacePanels(false);
  qualityShowing = {run:diagnosticRun,code:codeField.value,scope:gameStorageScope,id:row.layout.id,target:row.target,scroll};
  document.querySelector('#quality-show-description').textContent = row.kind ? row.title : row.title + ' · ' + pickedElementTitle(row.element);
  document.querySelector('#quality-show-bar').hidden = false;
  activeFrame.contentWindow.postMessage({type:'onehtml-lab:quality-show',token:activeFrame.pickerToken,id:row.layout.id,target:row.target},'*');
  qualityShowTimer = setTimeout(() => returnQualityShow('Нет ответа от предпросмотра. Проверьте экран снова.'),1800);
}

function returnQualityShow(note = '') {
  const state = qualityShowing;
  if (!state) return;
  cancelQualityShow(); qualityFeedback = note;
  if (expertMode && running && diagnosticRun === state.run && !currentPanel()) {
    openDiagnostics('quality'); activityPanel.querySelector('.panel-body').scrollTop = state.scroll;
  }
}

function fixQualityFinding(row) {
  if (!expertMode || modeBusy || !codeField.value.trim() || (row.layout && !qualityTargetCurrent(row))) return;
  const code = codeField.value, scope = gameStorageScope;
  openAiPrompts('change',true);
  aiElementContext = row.element ? {code,scope,element:row.element} : null;
  aiTask.value = 'Исправь замечание проверки: ' + row.title + '.\n' + row.text
    + (row.layout ? `\nНаблюдение снимка ${new Date(row.layout.time).toLocaleString('ru-RU')} в области ${row.layout.width} × ${row.layout.height}; проверь, что проблема ещё воспроизводится.` : '')
    + '\nСохрани остальные действия и оформление.';
  aiTasks.change = aiTask.value; saveAiPromptSettings(); updateAiControls(); aiTask.focus({preventScroll:true});
}

function qualityLayoutState() {
  const run = diagnosticRun, layout = run?.qualityLayout;
  if (!run) return 'Приложение ещё не запускалось.';
  if (!layout) return qualityFeedback || 'Экран ещё не проверен. Запустите приложение и нажмите «Проверить экран».';
  let note = layout.unavailable ? 'Не удалось получить размеры последнего запуска. Попробуйте измерить снова.'
    : `Снимок ${new Date(layout.time).toLocaleTimeString('ru-RU')} · ${formatUIInteger(layout.width)} × ${formatUIInteger(layout.height)}.`;
  if (run.code !== codeField.value) note += ' Код изменён: снимок относится к прежней версии.';
  if (layout.scope !== gameStorageScope) note += ' Открыта другая работа: проверьте экран снова.';
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
  else if (!/\bwidth\s*=\s*device-width\b/i.test(source.viewport || '')) rows.push({ title: 'Проверьте мобильный экран', text: 'В текущем HTML не найден viewport с width=device-width. На телефоне отдельный файл может отображаться мелко. Предпросмотр не заменяет проверку скачанного файла.', fix:true });
  const maxScale = /\bmaximum-scale\s*=\s*([\d.]+)/i.exec(source.viewport || '');
  if (/\buser-scalable\s*=\s*(?:no|0)\b/i.test(source.viewport || '') || (maxScale && Number(maxScale[1]) <= 1)) rows.push({title:'Масштабирование страницы ограничено',text:'В meta viewport задано ограничение увеличения. Разрешите масштабирование, чтобы пользователь мог увеличить текст и элементы.',fix:true});
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
        if (layout.small.length) rows.push({ title: `Небольшие элементы управления: ${formatUIInteger(layout.small.length)}${layout.small.length === 20 ? ' и, возможно, больше' : ''}`, text: 'Одна из сторон меньше 44 пикселей: ' + layout.small.map(row => `${row.label || 'Элемент'} (${formatUIInteger(row.width)} × ${formatUIInteger(row.height)})`).join('; ') + '. Проверьте удобство касания, включая окружающие отступы.', targets:layout.small.map(row=>({title:row.label || 'Элемент',text:`Увеличь удобную область касания элемента (${row.width} × ${row.height}), одна из сторон меньше 44 пикселей.`,...row,layout})) });
        for (const issue of layout.issues || []) rows.push({title:qualityIssueText[issue.kind][0] + ' · ' + pickedElementTitle(issue.element),text:qualityIssueText[issue.kind][1],...issue,layout});
        if (!layout.small.length && layout.scrollWidth <= layout.width + 2) rows.push({ title: 'В снимке выход за ширину и малые кнопки не замечены', text: 'Проверены только видимые обычные элементы управления. Другие экраны, текст, фокус и поведение требуют ручной проверки.' });
        if (layout.canvas) rows.push({ title: 'Есть Canvas или 3D', text: 'Кнопки и текст, нарисованные внутри Canvas, автоматически не оцениваются. Проверьте их касанием, мышью и клавиатурой.' });
        if (layout.limited || layout.issues?.length === 20) rows.push({ title: 'Просмотр элементов ограничен', text: 'Проверены первые 500 HTML-элементов; небольшие элементы и замечания о подписях показаны до 20 в каждом списке.' });
      }
    }
  }
  return rows;
}

function requestQualityLayout() {
  if (!expertMode || !running || !activeFrame || modeBusy || qualityRequest || diagnosticRun?.code !== codeField.value) return;
  clearTimeout(qualityTimer);
  qualityFeedback = '';
  const request = { id: ++qualityRequestId, run: diagnosticRun, scope:gameStorageScope, scroll: activityPanel.querySelector('.panel-body').scrollTop };
  qualityRequest = request;
  closeWorkspacePanel(false);
  // Wait until normal toolbar/preview layout has settled, without restarting.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (qualityRequest !== request || !running || !activeFrame || diagnosticRun !== request.run) return;
    request.windowWidth = innerWidth; request.windowHeight = innerHeight; request.desktop = JSON.stringify(desktopView);
    activeFrame.contentWindow.postMessage({ type: 'onehtml-lab:quality-request', token:activeFrame.pickerToken, id: request.id }, '*');
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
  const rows = qualityFindings(), key = JSON.stringify([rows,running,modeBusy,gameStorageScope]);
  const expanded = new Set([...findings.querySelectorAll('details[open]')].map(node => node.querySelector('summary').textContent));
  if (key !== qualityFindingKey) findings.replaceChildren(...rows.map(row => {
    const item = document.createElement('li'); item.className = 'quality-finding';
    const detail = document.createElement('details'), title = document.createElement('summary'), text = document.createElement('p');
    title.textContent = row.title; text.textContent = row.text; detail.open = expanded.has(row.title);
    detail.append(title, text);
    const actions = row => {
      const group = document.createElement('div'); group.className = 'diagnostic-actions';
      if (row.element) {
        const show = diagnosticButton('Показать',()=>showQualityTarget(row)); show.disabled = modeBusy || !running || !qualityTargetCurrent(row); group.append(show);
      }
      const fix = diagnosticButton('Исправить с ИИ',()=>fixQualityFinding(row)); fix.disabled = modeBusy || Boolean(row.layout && !qualityTargetCurrent(row)); group.append(fix);
      return group;
    };
    if (row.element || row.fix) detail.append(actions(row));
    if (row.targets) for (const target of row.targets) {
      const caption = document.createElement('p'); caption.textContent = `${target.label || 'Элемент'} (${target.width} × ${target.height})`;
      detail.append(caption,actions(target));
    }
    item.append(detail); return item;
  }));
  qualityFindingKey = key;
  const current = qualityManualCurrent();
  const count = current ? Object.values(qualityManual.answers).filter(value => value).length : 0;
  document.querySelector('#quality-manual-note').textContent = !qualityManual
    ? 'Отметьте выполненные проверки и при необходимости запишите проблему. Они сохранятся для проверенной версии.'
    : `${new Date(qualityManual.time).toLocaleString('ru-RU')} · ` + (current
      ? `Отмечено ${formatUIInteger(count)} из ${qualityChecks.length}. «Проверено» — ваша отметка, а не вывод автоматики.`
      : qualityManual.checking ? 'Сверяю сохранённую версию…' : 'Код или открытая работа изменены. Отметки прежней версии; для новой начните проверку заново.') + (qualityManualStorage ? ' ' + qualityManualStorage : '');
  for (const [id] of qualityChecks) {
    const select = document.querySelector('#quality-' + id);
    select.value = qualityManual?.answers[id] || '';
    select.disabled = empty || modeBusy || Boolean(qualityManual && !current);
    select.closest('.quality-check').classList.toggle('is-stale', Boolean(qualityManual && !current));
    const note = document.querySelector('#quality-note-' + id);
    if (document.activeElement !== note) note.value = qualityManual?.notes[id] || '';
    note.disabled = select.disabled;
    note.closest('label').classList.toggle('is-stale', Boolean(qualityManual && !current));
  }
}

function qualityReport() {
  const lines = ['Проверка перед показом и сдачей', 'Наблюдения не подтверждают качество всего приложения.', ...qualityFindings().map(row => `${row.title}: ${row.text}`), qualityLayoutState(), 'Ручные проверки:'];
  if (qualityManual) lines.push(`${new Date(qualityManual.time).toLocaleString('ru-RU')} · ${qualityManualCurrent() ? 'Текущий код' : 'Прежняя версия: эти отметки не подтверждают текущий код'}.`);
  for (const [id, title] of qualityChecks) lines.push(`${title}: ${qualityStates[qualityManual?.answers[id] || '']}` + (qualityManual?.notes[id] ? '\nЗаметка участника: ' + qualityManual.notes[id] : ''));
  return lines.join('\n');
}

function initQuality() {
  qualityReady = true;
  loadQualityManual();
  const list = document.querySelector('#quality-manual-list');
  for (const [id, title, description] of qualityChecks) {
    const label = document.createElement('div'); label.className = 'quality-check';
    const text = document.createElement('span'), heading = document.createElement('strong'), detail = document.createElement('span');
    heading.textContent = title; detail.textContent = description; text.append(heading, detail);
    const select = document.createElement('select'); select.id = 'quality-' + id; select.setAttribute('aria-label', title);
    for (const [value, caption] of Object.entries(qualityStates)) { const option = document.createElement('option'); option.value = value; option.textContent = caption; select.append(option); }
    select.addEventListener('change', () => {
      const value = select.value;
      if (!expertMode || modeBusy || !codeField.value.trim() || (qualityManual && !qualityManualCurrent())) { renderQuality(); return; }
      if (!qualityManual) qualityStartManual();
      qualityManual.answers[id] = value; qualityManual.time = Date.now(); renderQuality();
      scheduleQualityManualSave();
      if (value === 'issue') label.querySelector('details').open = true;
    });
    label.append(text, select); list.append(label);
    const notes = document.createElement('details'); notes.className = 'quality-note';
    const summary = document.createElement('summary'); summary.textContent = 'Заметка'; notes.append(summary);
    const noteLabel = document.createElement('label'); noteLabel.className = 'quality-note-label'; noteLabel.textContent = 'Что именно проверить или исправить';
    const note = document.createElement('textarea'); note.id = 'quality-note-' + id; note.rows = 2; note.maxLength = 1000; note.setAttribute('aria-label','Заметка — ' + title); note.placeholder = 'Например: кнопка прыжка не реагирует после поворота экрана';
    note.addEventListener('input',()=>{
      if (!expertMode || modeBusy || !codeField.value.trim() || (qualityManual && !qualityManualCurrent())) return;
      if (!qualityManual) qualityStartManual();
      qualityManual.notes[id] = note.value.slice(0,1000); qualityManual.time = Date.now(); scheduleQualityManualSave(); renderQuality();
    });
    noteLabel.append(note); notes.append(noteLabel); label.append(notes);
  }
  document.querySelector('#quality-show-back').addEventListener('click',()=>returnQualityShow());
  document.addEventListener('keydown',event=>{if(event.key === 'Escape' && qualityShowing){event.preventDefault();returnQualityShow();}},true);
  window.addEventListener('pagehide',()=>void saveQualityManual());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)void saveQualityManual();});
  document.querySelector('#quality-manual-start').addEventListener('click', qualityStartManual);
  document.querySelector('#quality-measure').addEventListener('click', requestQualityLayout);
  document.querySelector('#quality-ai').addEventListener('click', () => {
    if (!expertMode || modeBusy || !codeField.value.trim() || !diagnosticReportReady || diagnosticSnapshot?.code !== codeField.value) return;
    const context = { code: codeField.value, scope: gameStorageScope, text: qualityReport() };
    openAiPrompts('check', true); aiQualityContext = context; updateAiControls();
  });
  window.addEventListener('message', event => {
    const data = event.data, request = qualityRequest;
    if (!running || !activeFrame || event.source !== activeFrame.contentWindow || data?.token !== activeFrame.pickerToken) return;
    if (data.type === 'onehtml-lab:quality-shown' && qualityShowing?.id === data.id && qualityShowing.target === data.target && qualityShowing.run === diagnosticRun) {
      if (data.found === true) clearTimeout(qualityShowTimer);
      else if (data.found === false) returnQualityShow('Элемент больше не доступен. Проверьте экран снова.');
      return;
    }
    if (!request || data.type !== 'onehtml-lab:quality-result' || data.id !== request.id || diagnosticRun !== request.run) return;
    if (data.unavailable !== true && (![data.width, data.height, data.scrollWidth, data.visible].every(value => Number.isFinite(value) && value >= 0 && value <= 1e7)
      || !Array.isArray(data.small) || data.small.length > 20 || data.small.some(row => !row || typeof row.label !== 'string' || row.label.length > 70 || ![row.width, row.height].every(value => Number.isFinite(value) && value >= 0 && value <= 1e7) || !validQualityTarget(row))
      || !Array.isArray(data.issues) || data.issues.length > 20 || data.issues.some(row=>!row || !Object.hasOwn(qualityIssueText,row.kind) || !validQualityTarget(row)))) return;
    const measurement = data.unavailable === true ? { unavailable: true } : { width: data.width, height: data.height, scrollWidth: data.scrollWidth,
      visible: data.visible, limited: data.limited === true, canvas: data.canvas === true,
      small: data.small.map(row => ({ label: row.label, width: row.width, height: row.height, target:row.target,element:normalizePickedElement(row.element) })),
      issues:data.issues.map(row=>({kind:row.kind,target:row.target,element:normalizePickedElement(row.element)})) };
    diagnosticRun.qualityLayout = { ...measurement, id:request.id, scope:request.scope, time: Date.now(), windowWidth: request.windowWidth, windowHeight: request.windowHeight, desktop: request.desktop };
    qualityRequest = null; qualityFeedback = ''; clearTimeout(qualityTimer); returnQualityPanel(request);
  });
}

function validQualityTarget(row) { return Number.isInteger(row.target) && row.target > 0 && row.target <= 500 && Boolean(normalizePickedElement(row.element)); }
