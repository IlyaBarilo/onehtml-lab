// Layout changes resize the existing frame; only an explicit run replaces it.
const splitButton = document.querySelector('#split-toggle');
const splitDivider = document.querySelector('#split-divider');
const previewTools = document.querySelector('#preview-tools');
const previewDevice = document.querySelector('#preview-device');
const previewRotate = document.querySelector('#preview-rotate');
const previewRestart = document.querySelector('#preview-restart');
const previewChanges = document.querySelector('#preview-changes');
const previewEmpty = document.querySelector('#preview-empty');
const desktopKey = 'onehtml-lab-desktop-view';
let desktopView = { split: false, ratio: .5, device: 'free', landscape: false };
let desktopReady = false;
let desktopStarting = false;
let desktopFrame = 0;

function wideWorkspace() { return document.documentElement.clientWidth >= 1000; }
function isSplitWorkspace() { return desktopReady && desktopView.split && wideWorkspace() && !previewExpanded; }

function saveDesktopView() {
  try { localStorage.setItem(desktopKey, JSON.stringify(desktopView)); }
  catch { inform('Расположение действует сейчас, но браузер не сохранил его.', true); }
}

function schedulePreviewSize() {
  if (!desktopReady || desktopFrame) return;
  desktopFrame = requestAnimationFrame(() => {
    desktopFrame = 0;
    if (!previewTools.hidden) {
      const height = `${previewTools.offsetHeight}px`;
      if (workspaceElement.style.getPropertyValue('--preview-tools-height') !== height) {
        workspaceElement.style.setProperty('--preview-tools-height', height);
      }
    }
    sizeDesktopPreview();
  });
}

function sizeDesktopPreview() {
  if (!activeFrame) return;
  const phone = isSplitWorkspace() && desktopView.device === 'phone';
  preview.classList.toggle('phone-preview', phone);
  if (!phone) {
    for (const name of ['width', 'height', 'transform', 'transform-origin', 'position', 'left', 'top']) activeFrame.style.removeProperty(name);
    return;
  }
  const width = desktopView.landscape ? 844 : 390;
  const height = desktopView.landscape ? 390 : 844;
  const availableWidth = Math.max(1, preview.clientWidth - 24);
  const availableHeight = Math.max(1, preview.clientHeight - 24);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  Object.assign(activeFrame.style, { width: `${width}px`, height: `${height}px`, position: 'absolute',
    transformOrigin: '0 0', transform: `scale(${scale})`,
    left: `${(preview.clientWidth - width * scale) / 2}px`, top: `${(preview.clientHeight - height * scale) / 2}px` });
}

function updateDesktopUI() {
  if (!desktopReady) return;
  const split = isSplitWorkspace();
  const overlay = Boolean(currentPanel()) || historyOpen || comparisonOpen || extractionOpen;
  workspaceElement.classList.toggle('split-workspace', split);
  workspaceElement.classList.toggle('desktop-overlay', overlay);
  workspaceElement.style.setProperty('--code-ratio', String(desktopView.ratio));
  splitButton.hidden = !wideWorkspace();
  splitButton.disabled = modeBusy;
  splitButton.setAttribute('aria-pressed', String(desktopView.split));
  splitButton.title = desktopView.split ? 'Вернуть одну область' : 'Код и игра рядом';
  splitDivider.hidden = !split || overlay;
  splitDivider.setAttribute('aria-valuenow', String(Math.round(desktopView.ratio * 100)));
  previewTools.hidden = !split || overlay;
  previewEmpty.hidden = !split || running || overlay;
  codeField.hidden = (running && !split) || historyOpen || comparisonOpen || extractionOpen;
  preview.hidden = !running;
  previewRestart.disabled = modeBusy || desktopStarting || readingClipboard || !codeField.value.trim();
  previewRestart.textContent = running ? 'Перезапустить' : 'Запустить';
  previewChanges.hidden = !running || previewCode === codeField.value;
  document.querySelector('#preview-settings').hidden = !expertMode;
  previewDevice.value = desktopView.device;
  previewDevice.querySelector('[value="phone"]').textContent = desktopView.landscape ? 'Телефон · 844 × 390' : 'Телефон · 390 × 844';
  previewRotate.hidden = desktopView.device !== 'phone';
  previewRotate.setAttribute('aria-pressed', String(desktopView.landscape));
  previewRotate.title = desktopView.landscape ? 'Повернуть вертикально' : 'Повернуть горизонтально';
  schedulePreviewSize();
  scheduleCodeLayout();
}

async function restartDesktopPreview() {
  if (!isSplitWorkspace() || modeBusy || desktopStarting || readingClipboard || !codeField.value.trim()) return;
  desktopStarting = true;
  inform();
  updateDesktopUI();
  try { await startPreview(); }
  finally { desktopStarting = false; updateControls(); }
}

function setSplitRatio(ratio) {
  desktopView.ratio = Math.max(.3, Math.min(.7, ratio));
  updateDesktopUI();
}

function initDesktopWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(desktopKey));
    desktopView.split = saved?.split === true;
    if (Number.isFinite(saved?.ratio)) desktopView.ratio = Math.max(.3, Math.min(.7, saved.ratio));
    desktopView.device = saved?.device === 'phone' ? 'phone' : 'free';
    desktopView.landscape = saved?.landscape === true;
  } catch {}
  desktopReady = true;
  splitButton.addEventListener('click', () => {
    if (!expertMode || modeBusy) return;
    rememberEditorPosition();
    desktopView.split = !desktopView.split;
    saveDesktopView();
    updateControls();
    restoreEditorPosition();
  });
  previewDevice.addEventListener('change', () => {
    if (!expertMode) return;
    desktopView.device = previewDevice.value === 'phone' ? 'phone' : 'free';
    saveDesktopView(); updateDesktopUI();
  });
  previewRotate.addEventListener('click', () => {
    if (!expertMode) return;
    desktopView.landscape = !desktopView.landscape;
    saveDesktopView(); updateDesktopUI();
  });
  previewRestart.addEventListener('click', () => void restartDesktopPreview());
  codeField.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter' && isSplitWorkspace()) {
      event.preventDefault(); void restartDesktopPreview();
    }
  });
  splitDivider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitDivider.focus();
    splitDivider.setPointerCapture(event.pointerId);
    workspaceElement.classList.add('resizing-split');
    const move = pointer => {
      const rect = workspaceElement.getBoundingClientRect();
      setSplitRatio((pointer.clientX - rect.left) / Math.max(1, rect.width - 10));
    };
    const stop = () => {
      workspaceElement.classList.remove('resizing-split');
      splitDivider.removeEventListener('pointermove', move);
      splitDivider.removeEventListener('pointerup', stop);
      splitDivider.removeEventListener('pointercancel', stop);
      splitDivider.removeEventListener('lostpointercapture', stop);
      saveDesktopView();
    };
    splitDivider.addEventListener('pointermove', move);
    splitDivider.addEventListener('pointerup', stop);
    splitDivider.addEventListener('pointercancel', stop);
    splitDivider.addEventListener('lostpointercapture', stop);
  });
  splitDivider.addEventListener('keydown', event => {
    const ratios = { ArrowLeft: desktopView.ratio - .02, ArrowRight: desktopView.ratio + .02, Home: .3, End: .7 };
    if (!(event.key in ratios)) return;
    event.preventDefault(); setSplitRatio(ratios[event.key]); saveDesktopView();
  });
  window.addEventListener('resize', () => { rememberEditorPosition(); updateControls(); restoreEditorPosition(); });
  new ResizeObserver(schedulePreviewSize).observe(preview);
  new ResizeObserver(schedulePreviewSize).observe(previewTools);
  updateDesktopUI();
}
