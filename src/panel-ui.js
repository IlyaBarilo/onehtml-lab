// Shared presentation for the example catalog and library conversion workspace.
function panelIcon(icon) {
  const paths = {
    open: '<path d="M14 3H5v18h14V8M14 3v5h5M9 14h6m-3-3 3 3-3 3"/>',
    lesson: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15M6 8h3M6 12h3m6-4h3m-3 4h3"/>',
    games: '<path d="M7 7h10c2 0 3 1 3.5 3l1 6c.5 3-2 4-4 2l-2-2h-7l-2 2c-2 2-4.5 1-4-2l1-6C4 8 5 7 7 7ZM7 10v5m-2.5-2.5h5M16 11h.01M18 14h.01"/>',
    media: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 16 5-4 4 3 4-5 5 6"/>',
    fix: '<path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>',
    tests: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M6 12h3l2-4 3 8 2-4h2"/>',
    mobile: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 5h4m-2 14h.01"/>',
    desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    application: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01m3 0h.01"/>',
    create: '<path d="M12 4v16M4 12h16"/>',
    change: '<path d="m15 4 5 5-11 11-6 1 1-6L15 4ZM12 7l5 5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    paste: '<path d="M8 4H5v17h14V4h-3M9 12h6m-3-3v7m-3-3 3 3 3-3"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-5v6l4 2"/>',
    compare: '<path d="M4 5h16M4 19h16M8 9l-3 3 3 3m8-6 3 3-3 3"/>',
    back: '<path d="m10 5-7 7 7 7M3 12h18"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v4"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    replace: '<path d="M4 7h13m-4-4 4 4-4 4M20 17H7m4-4-4 4 4 4"/>',
    replaceAll: '<path d="M4 5h16M4 19h16M4 9h13m-3-3 3 3-3 3M20 15H7m3-3-3 3 3 3"/>',
    fold: '<path d="M4 4h16M4 20h16m-12-12 4 4 4-4m-8 8 4-4 4 4"/>',
    speed: '<path d="M3 18a9 9 0 1 1 18 0M12 13l4-5M5 14h2m10 0h2M12 4v2"/>',
    share: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-3m-6 7 6 3"/>',
    audio: '<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>'
  };
  if (!paths[icon]) return libraryIcon(icon);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = paths[icon];
  return svg;
}

function aiLabelButton(button, icon, label, short = label) {
  button.dataset.aiIcon = icon;
  button.setAttribute('aria-label', label); button.title = label;
  const full = document.createElement('span'); full.className = 'ai-label-full'; full.textContent = label;
  const small = document.createElement('span'); small.className = 'ai-label-short'; small.textContent = short; small.setAttribute('aria-hidden', 'true');
  button.replaceChildren(panelIcon(icon), full, small);
}

function initAiUI() {
  for (const button of document.querySelectorAll('[data-ai-icon]')) aiLabelButton(button, button.dataset.aiIcon, button.textContent.trim(), button.dataset.short);
  const icons = { create: 'create', change: 'change', fix: 'fix', explain: 'lesson', check: 'check' };
  const shortLabels = { create: 'Создать', change: 'Правка', fix: 'Ошибка', explain: 'Разбор', check: 'Проверка' };
  for (const button of document.querySelectorAll('[data-ai-mode]')) aiLabelButton(button, icons[button.dataset.aiMode], button.textContent.trim(), shortLabels[button.dataset.aiMode]);
  for (const button of document.querySelectorAll('[data-ai-project]')) aiLabelButton(button, button.dataset.aiProject === 'game' ? 'games' : 'application', button.textContent.trim());
  for (const button of document.querySelectorAll('#ai-dialog [data-platform]')) aiLabelButton(button, button.dataset.platform, button.textContent.trim());
  for (const [id, icon, label] of [
    ['ai-view', 'code', 'Просмотр запроса'], ['ai-element-repick', 'target', 'Выбрать другой элемент'], ['ai-element-remove', 'close', 'Убрать выбор элемента'],
    ['ai-prompts-back', 'back', 'К списку запросов'], ['ai-answer-back', 'back', 'К ответу']
  ]) panelIconButton(document.getElementById(id), icon, label);
  aiLabelButton(document.querySelector('#ai-answer-paste'), 'paste', 'Вставить из буфера');
  const cancel = document.querySelector('#picker-cancel'); cancel.replaceChildren(panelIcon('close'));
  document.querySelector('#ai-dialog .ai-services').open = matchMedia('(min-width:1000px)').matches;
  for (const group of document.querySelectorAll('#ai-dialog [role=tablist], #ai-dialog .ai-modes')) group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...group.querySelectorAll('button:not(:disabled)')]; const index = buttons.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
}
function panelIconButton(button, icon, label) {
  button.classList.add('panel-icon-button');
  button.setAttribute('aria-label', label);
  button.title = label;
  button.replaceChildren(panelIcon(icon));
}

function initPanelUI() {
  for (const node of document.querySelectorAll('[data-panel-icon]')) {
    if (node.tagName === 'BUTTON') panelIconButton(node, node.dataset.panelIcon, node.getAttribute('aria-label'));
    else node.replaceChildren(panelIcon(node.dataset.panelIcon));
  }
  for (const button of document.querySelectorAll('#examples-dialog [data-tab-icon]')) {
    button.prepend(panelIcon(button.dataset.tabIcon));
    button.title = button.getAttribute('aria-label');
  }
  for (const group of document.querySelectorAll('#examples-dialog [role=tablist], #diagnostic-tabs')) group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...group.querySelectorAll('[role=tab], [data-diagnostic-tab]')];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
  for (const button of document.querySelectorAll('[data-panel-help]')) button.addEventListener('click', () => {
    const help = document.getElementById(button.dataset.panelHelp);
    help.hidden = !help.hidden;
    button.setAttribute('aria-expanded', String(!help.hidden));
  });
  for (const button of document.querySelectorAll('[data-panel-theme]')) button.addEventListener('click', () => document.querySelector('#theme-toggle').click());
  const icons = {errors:'fix',libraries:'code',resources:'media',speed:'speed',quality:'check'};
  for (const button of document.querySelectorAll('[data-diagnostic-tab]')) {
    const label=button.textContent;button.setAttribute('aria-label',label);button.title=label;
    const text=document.createElement('span');text.textContent=label;button.replaceChildren(panelIcon(icons[button.dataset.diagnosticTab]),text);
  }
  document.querySelector('#example-search').addEventListener('input', renderExamples);
}
