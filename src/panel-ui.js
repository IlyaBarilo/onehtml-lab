// Shared presentation for the example catalog and library conversion workspace.
function panelIconButton(button, icon, label) {
  button.classList.add('panel-icon-button');
  button.setAttribute('aria-label', label);
  button.title = label;
  const paths = {
    open: '<path d="M14 3H5v18h14V8M14 3v5h5M9 14h6m-3-3 3 3-3 3"/>',
    lesson: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1v15M6 8h3M6 12h3m6-4h3m-3 4h3"/>'
  };
  if (paths[icon]) button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[icon]}</svg>`;
  else button.replaceChildren(libraryIcon(icon));
}

function initPanelUI() {
  for (const node of document.querySelectorAll('[data-panel-icon]')) {
    if (node.tagName === 'BUTTON') panelIconButton(node, node.dataset.panelIcon, node.getAttribute('aria-label'));
    else node.replaceChildren(libraryIcon(node.dataset.panelIcon));
  }
  for (const button of document.querySelectorAll('[data-panel-help]')) button.addEventListener('click', () => {
    const help = document.getElementById(button.dataset.panelHelp);
    help.hidden = !help.hidden;
    button.setAttribute('aria-expanded', String(!help.hidden));
  });
  for (const button of document.querySelectorAll('[data-panel-theme]')) button.addEventListener('click', () => document.querySelector('#theme-toggle').click());
  document.querySelector('#example-search').addEventListener('input', renderExamples);
}
