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
    desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>'
  };
  if (!paths[icon]) return libraryIcon(icon);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = paths[icon];
  return svg;
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
  for (const group of document.querySelectorAll('#examples-dialog [role=tablist]')) group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...group.querySelectorAll('[role=tab]')];
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
  document.querySelector('#example-search').addEventListener('input', renderExamples);
}
