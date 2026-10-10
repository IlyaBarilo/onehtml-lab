// Image copies keep immutable content IDs; current bindings change only on Apply.
function mediaImageInfo(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, count) => String.fromCharCode(...bytes.subarray(at, at + count));
  let width = 0, height = 0, animated = false, orientation = 1;
  try {
    if (type === 'image/png') {
      width = view.getUint32(16); height = view.getUint32(20);
      for (let at = 8; at + 12 <= bytes.length;) {
        const size = view.getUint32(at), chunk = text(at + 4, 4);
        if (chunk === 'acTL') animated = true;
        if (chunk === 'IDAT' || chunk === 'IEND') break;
        at += size + 12;
      }
    } else if (type === 'image/webp') {
      const u24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
      for (let at = 12; at + 8 <= bytes.length;) {
        const chunk = text(at, 4), size = view.getUint32(at + 4, true), p = at + 8;
        if (p + size > bytes.length) break;
        if (chunk === 'VP8X' && size >= 10) { animated = Boolean(bytes[p] & 2); width = u24(p + 4) + 1; height = u24(p + 7) + 1; }
        if (!width && chunk === 'VP8 ' && size >= 10) { width = view.getUint16(p + 6, true) & 16383; height = view.getUint16(p + 8, true) & 16383; }
        if (!width && chunk === 'VP8L' && size >= 5) { const bits = view.getUint32(p + 1, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
        if (chunk === 'ANIM' || chunk === 'ANMF') animated = true;
        at = p + size + (size % 2);
      }
    } else if (type === 'image/jpeg') {
      for (let at = 2; at + 4 <= bytes.length;) {
        if (bytes[at++] !== 255) break;
        while (bytes[at] === 255) at++;
        const marker = bytes[at++];
        if (marker === 218 || marker === 217) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const size = view.getUint16(at), end = at + size;
        if (size < 2 || end > bytes.length) break;
        if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 7) { height = view.getUint16(at + 3); width = view.getUint16(at + 5); }
        if (marker === 225 && text(at + 2, 6) === 'Exif\0\0') {
          const base = at + 8, little = text(base, 2) === 'II';
          if (base + 8 <= end && ['II', 'MM'].includes(text(base, 2)) && view.getUint16(base + 2, little) === 42) {
            const start = base + view.getUint32(base + 4, little);
            if (start >= base && start + 2 <= end) {
              const count = Math.min(view.getUint16(start, little), 256);
              for (let n = 0; n < count && start + 2 + (n + 1) * 12 <= end; n++) {
                const p = start + 2 + n * 12;
                if (view.getUint16(p, little) === 274 && view.getUint16(p + 2, little) === 3 && view.getUint32(p + 4, little) === 1) orientation = view.getUint16(p + 8, little);
              }
            }
          }
        }
        at = end;
      }
    }
  } catch { return null; }
  if (!width || !height) return null;
  if (orientation >= 5 && orientation <= 8) [width, height] = [height, width];
  return { width, height, animated };
}

function mediaDimensions(entry) {
  return entry?.image ? `${formatUIInteger(entry.image.width)} × ${formatUIInteger(entry.image.height)} пикселей` : '';
}

function imageFileSize(bytes) { return (bytes / (bytes >= 1048576 ? 1048576 : 1024)).toLocaleString('ru-RU', {maximumFractionDigits:1}) + (bytes >= 1048576 ? ' МБ' : ' КБ'); }

let imageEdit = null;
let imageEditRevision = 0;
const imageEditUrls = new Set();
let mediaStripKey = null;
let mediaStripCollapsed = false;
const mediaStripUrls = new Set();

function mediaPromptRows() {
  const rows = [...mediaCache.values()].map(entry => ({ entry, name: entry.name }));
  for (const file of promptMediaFiles()) if (!rows.some(row => row.name === file.name && row.entry.id === file.id)) rows.push({ entry: mediaCache.get(file.id) || { id: file.id }, name: file.name });
  return rows;
}

function mediaImageUrl(blob) {
  const url = URL.createObjectURL(blob); imageEditUrls.add(url); return url;
}

function closeImageEdit() {
  imageEditRevision++; imageEdit = null;
  for (const url of imageEditUrls) URL.revokeObjectURL(url);
  imageEditUrls.clear();
  document.querySelector('#media-image-edit').hidden = true;
  document.querySelector('#media-image-before').removeAttribute('src');
  document.querySelector('#media-image-after').removeAttribute('src');
}

function imageEditMessage(text) { document.querySelector('#media-image-feedback').textContent = text; }

function canPrepareImage(entry) { return Boolean(entry?.image && !entry.image.animated && Number.isFinite(entry.image.width) && Number.isFinite(entry.image.height) && entry.image.width > 0 && entry.image.height > 0); }

function openImageEdit(entry, name = entry.name) {
  if (!expertMode || mediaBusy || modeBusy || !mediaCache.has(entry.id)) return;
  closeImageEdit();
  const original = mediaCache.get(entry.originalId);
  imageEdit = { entry, name, before: codeField.value, selection: JSON.stringify(promptMediaFiles()), scope: gameStorageScope, result: null };
  const panel = document.querySelector('#media-image-edit'); panel.hidden = false;
  document.querySelector('#media-image-title').textContent = name;
  document.querySelector('#media-image-before').src = mediaImageUrl(entry.blob);
  document.querySelector('#media-image-before-info').textContent = [mediaDimensions(entry), imageFileSize(entry.blob.size), mediaSizeWarning(entry)].filter(Boolean).join(' · ');
  document.querySelector('#media-image-after-info').textContent = 'Подготовьте уменьшенную копию';
  document.querySelector('#media-image-size').value = '2048';
  document.querySelector('#media-image-format').value = 'image/webp';
  document.querySelector('#media-image-quality').value = '82';
  document.querySelector('#media-image-quality-value').textContent = '82%';
  document.querySelector('#media-image-quality-row').hidden = false;
  const bound = mediaBindings(codeField.value).some(ref => ref.id === entry.id);
  document.querySelector('#media-image-code-row').hidden = !bound;
  document.querySelector('#media-image-code').checked = bound;
  document.querySelector('#media-image-apply').disabled = true;
  document.querySelector('#media-image-restore').hidden = !entry.originalId;
  document.querySelector('#media-image-restore').disabled = !original;
  const unsupported = !canPrepareImage(entry);
  document.querySelector('#media-image-preview').disabled = unsupported;
  imageEditMessage(entry.image?.animated ? 'Анимированное изображение сохраняется целиком. Уменьшение анимации пока недоступно.' : unsupported ? 'Изображение не подходит для уменьшения в браузере. Исходный файл доступен для встраивания.' : entry.originalId && !original ? 'Оригинал удалён из браузера. Для возврата добавьте его снова.' : 'Изменения применятся после подтверждения. Оригинал останется в браузере.');
  panel.scrollIntoView({ block: 'start' });
  document.querySelector('#media-image-cancel').focus({ preventScroll: true });
}

function imageCopyName(name, type, id) {
  const existing = mediaCache.get(id);
  if (existing) return existing.name;
  if (/^\d+\./.test(name)) return promptMediaAutoName(type);
  const ext = type === 'image/jpeg' ? 'jpg' : Object.keys(mediaTypes).find(ext => mediaTypes[ext] === type);
  const stem = name.replace(/\.[^.]+$/, '').slice(0, 140);
  const names = new Set(mediaPromptRows().map(row => row.name).concat(promptMediaSent.map(file => file.name)));
  let candidate = `${stem}.${ext}`, n = 2;
  while (names.has(candidate)) candidate = `${stem}-${n++}.${ext}`;
  return candidate;
}

async function decodeMediaImage(blob) {
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { image.src = ''; reject(Error('Браузер не успел прочитать изображение.')); }, 15000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(Error('Браузер не смог прочитать изображение.')); };
      image.src = url;
    });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function previewImageCopy() {
  const edit = imageEdit, revision = ++imageEditRevision;
  if (!edit || mediaBusy || !canPrepareImage(edit.entry)) return;
  edit.result = null; document.querySelector('#media-image-apply').disabled = true;
  const type = document.querySelector('#media-image-format').value === 'original' ? edit.entry.type : 'image/webp';
  const limit = Number(document.querySelector('#media-image-size').value);
  const quality = Number(document.querySelector('#media-image-quality').value) / 100;
  document.querySelector('#media-image-preview').disabled = true;
  imageEditMessage('Подготавливаю копию…');
  let canvas;
  try {
    const image = await decodeMediaImage(edit.entry.blob);
    if (revision !== imageEditRevision || imageEdit !== edit) return;
    if (!image.naturalWidth || !image.naturalHeight) throw Error('Не удалось определить размеры изображения.');
    const scale = limit ? Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight)) : 1;
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw Error('Обработка изображений недоступна.');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.type !== type) throw Error('Браузер не поддерживает этот формат. Выберите «Исходный формат».');
    if (!blob.size) throw Error('Браузер создал пустое изображение.');
    const bytes = new Uint8Array(await blob.arrayBuffer()), id = await mediaHash(bytes);
    if (revision !== imageEditRevision || imageEdit !== edit) return;
    const previousUrl = document.querySelector('#media-image-after').getAttribute('src');
    if (previousUrl) { URL.revokeObjectURL(previousUrl); imageEditUrls.delete(previousUrl); }
    const name = imageCopyName(edit.name, type, id), info = mediaImageInfo(bytes, type);
    edit.result = { id, name, blob, type, image: info };
    document.querySelector('#media-image-after').src = mediaImageUrl(blob);
    const delta = edit.entry.blob.size - blob.size;
    document.querySelector('#media-image-after-info').textContent = `${name} · ${mediaDimensions(edit.result)} · ${imageFileSize(blob.size)}`;
    const percent = (Math.floor(delta / edit.entry.blob.size * 1000) / 10).toLocaleString('ru-RU');
    imageEditMessage(delta > 0 ? `Меньше на ${imageFileSize(delta)} (${percent}%).` : delta < 0 ? `Копия больше исходника на ${imageFileSize(-delta)}. Можно изменить параметры или оставить оригинал.` : 'Размер файла не изменился.');
    document.querySelector('#media-image-apply').disabled = id === edit.entry.id;
  } catch (error) { if (imageEdit === edit && revision === imageEditRevision) imageEditMessage(error.message); }
  finally { if (canvas) { canvas.width = 1; canvas.height = 1; } if (imageEdit === edit && revision === imageEditRevision) document.querySelector('#media-image-preview').disabled = false; }
}

async function applyImageCopy(restore = false) {
  const edit = imageEdit;
  const target = restore ? mediaCache.get(edit?.entry.originalId) : edit?.result;
  if (!edit || !target || !expertMode || mediaBusy || modeBusy) return;
  const applyCode = document.querySelector('#media-image-code').checked;
  const revision = imageEditRevision;
  const current = () => imageEdit === edit && revision === imageEditRevision && document.querySelector('#media-image-code').checked === applyCode && gameStorageScope === edit.scope && codeField.value === edit.before && JSON.stringify(promptMediaFiles()) === edit.selection && !running && !draftConflict;
  if (!current()) { imageEditMessage('Код или выбор медиа изменились. Откройте подготовку изображения снова после остановки игры.'); return; }
  mediaBusy = true;
  document.querySelector('#media-image-apply').disabled = true; document.querySelector('#media-image-restore').disabled = true;
  try {
    // Plan and validate all bindings before storing bytes or changing the document.
    const planned = { ...target, originalId: restore ? target.originalId : edit.entry.originalId || edit.entry.id };
    let next = edit.before;
    if (applyCode) for (const path of new Set(mediaBindings(next).filter(ref => ref.id === edit.entry.id).map(ref => ref.path))) next = attachMedia(next, path, planned);
    const entry = restore ? target : await addMediaFile({ name: target.name, size: target.blob.size, arrayBuffer: () => target.blob.arrayBuffer() }, planned.originalId);
    if (!current()) throw Error('Код или выбор медиа изменились. Подготовленная копия сохранена в списке; откройте её для применения.');
    const selected = [...promptMediaSelection].filter(([, id]) => id === edit.entry.id);
    if (selected.length) {
      const collision = promptMediaSelection.get(entry.name);
      if (collision && collision !== entry.id && collision !== edit.entry.id) throw Error('В запросе уже выбран другой файл с таким именем. Измените выбор в списке медиа.');
      for (const [name] of selected) promptMediaSelection.delete(name);
      promptMediaSelection.set(entry.name, entry.id); savePromptMediaState();
    }
    closeImageEdit();
    if (next !== codeField.value) replaceCode(next, true);
    promptMediaFeedback = restore ? 'Оригинал выбран. Предыдущая версия кода сохранена при замене привязок.' : 'Копия применена. Оригинал сохранён в списке медиа.';
    openPromptMediaIfNeeded();
  } catch (error) { imageEditMessage(error.message); }
  finally {
    mediaBusy = false;
    if (imageEdit === edit) { document.querySelector('#media-image-apply').disabled = !edit.result; document.querySelector('#media-image-restore').disabled = !mediaCache.has(edit.entry.originalId); }
    promptMediaVersion++; promptMediaRendered = null; mediaRendered = null; diagnosticSnapshot = null; updateDiagnostics(); updateAiControls();
  }
}

function openPromptMediaIfNeeded() {
  if (currentPanel()?.id !== 'media-panel') openPromptMedia();
}

function revealPromptMedia(entry, name) {
  openPromptMediaIfNeeded();
  renderPromptMedia();
  const row = [...document.querySelectorAll('#media-prompt-list > li')].find(row => row.dataset.mediaId === entry.id && row.dataset.mediaName === name);
  if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('button')?.focus({ preventScroll: true }); }
}

function renderMediaStrip() {
  const strip = document.querySelector('#media-strip'); if (!strip) return;
  const panel = currentPanel();
  const visible = expertMode && mediaCache.size && !previewExpanded && !comparisonOpen && !historyOpen && !extractionOpen && (panel === aiDialog || (!panel && !codeField.hidden));
  strip.hidden = !visible;
  workspaceElement.classList.toggle('has-media-strip', Boolean(visible));
  if (!visible) {
    if (mediaStripKey !== null) { for (const url of mediaStripUrls) URL.revokeObjectURL(url); mediaStripUrls.clear(); document.querySelector('#media-strip-list').replaceChildren(); mediaStripKey = null; }
    scheduleInlineGeometry(); return;
  }
  const rows = mediaPromptRows().filter(row => row.entry.blob);
  const key = JSON.stringify([rows.map(row => [row.name, row.entry.id]), promptMediaFiles(), mediaStripCollapsed]);
  if (key !== mediaStripKey) {
    const list = document.querySelector('#media-strip-list'), scroll = list.scrollLeft;
    for (const url of mediaStripUrls) URL.revokeObjectURL(url); mediaStripUrls.clear(); mediaStripKey = key;
    list.hidden = mediaStripCollapsed;
    const toggle = document.querySelector('#media-strip-toggle');
    toggle.setAttribute('aria-expanded', String(!mediaStripCollapsed)); toggle.setAttribute('aria-label', mediaStripCollapsed ? 'Показать медиа' : 'Свернуть медиа'); toggle.title = toggle.getAttribute('aria-label');
    document.querySelector('#media-strip-count').textContent = `Медиа · ${formatUIInteger(rows.length)}`;
    list.replaceChildren(...rows.map(({entry, name}) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'media-card'; button.title = name; button.setAttribute('aria-label', `Открыть медиа ${name}`);
      button.dataset.mediaId = entry.id;
      const selected = promptMediaSelection.get(name) === entry.id;
      button.classList.toggle('is-selected', selected);
      if (selected) button.setAttribute('aria-description', 'Включён в запрос ИИ');
      if (entry.type.startsWith('image/')) { const image = document.createElement('img'); const url = URL.createObjectURL(entry.blob); mediaStripUrls.add(url); image.src = url; image.loading = 'lazy'; image.alt = ''; button.append(image); }
      else { const icon = document.createElement('span'); icon.className = 'media-audio-icon'; icon.textContent = entry.type === 'model/gltf-binary' ? '3D' : '♫'; icon.setAttribute('aria-hidden', 'true'); button.append(icon); }
      const label = document.createElement('span'); label.textContent = name; button.append(label);
      if (selected) { const mark = document.createElement('span'); mark.className = 'media-card-check'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true'); button.append(mark); }
      button.addEventListener('click', () => revealPromptMedia(entry, name)); return button;
    }));
    list.scrollLeft = scroll;
  }
  scheduleInlineGeometry();
}

function initMediaImages() {
  try { mediaStripCollapsed = localStorage.getItem('onehtml-lab-media-collapsed') === 'true'; } catch { /* Session preference works without storage. */ }
  document.querySelector('#media-strip-toggle').addEventListener('click', () => { mediaStripCollapsed = !mediaStripCollapsed; try { localStorage.setItem('onehtml-lab-media-collapsed', String(mediaStripCollapsed)); } catch { /* Session only. */ } renderMediaStrip(); });
  document.querySelector('#media-image-cancel').addEventListener('click', closeImageEdit);
  document.querySelector('#media-image-preview').addEventListener('click', () => void previewImageCopy());
  document.querySelector('#media-image-apply').addEventListener('click', () => void applyImageCopy());
  document.querySelector('#media-image-restore').addEventListener('click', () => void applyImageCopy(true));
  for (const id of ['media-image-size', 'media-image-format', 'media-image-quality']) document.getElementById(id).addEventListener('input', () => {
    imageEditRevision++; if (imageEdit) imageEdit.result = null;
    document.querySelector('#media-image-apply').disabled = true;
    document.querySelector('#media-image-preview').disabled = !canPrepareImage(imageEdit?.entry);
    const after = document.querySelector('#media-image-after'), url = after.getAttribute('src');
    if (url) { URL.revokeObjectURL(url); imageEditUrls.delete(url); after.removeAttribute('src'); }
    document.querySelector('#media-image-after-info').textContent = 'Подготовьте новый предпросмотр';
    document.querySelector('#media-image-quality-value').textContent = document.querySelector('#media-image-quality').value + '%';
    document.querySelector('#media-image-quality-row').hidden = document.querySelector('#media-image-format').value === 'original' && imageEdit?.entry.type === 'image/png';
    imageEditMessage('Параметры изменены. Подготовьте новый предпросмотр.');
  });
  new ResizeObserver(scheduleInlineGeometry).observe(document.querySelector('#media-strip'));
}
