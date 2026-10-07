// Source inspection is a text scan: no user markup is attached or parsed into a DOM.
const resourceLimit = 200;
let speedEnabled = true;
let readinessReady = false;
let readinessTimer = 0;
let speedGeneration = 0;
let speedControl = '';
let resourceRows = [];
let resourceOverflow = false;

function resourceAddress(value) {
  const url = String(value || '').trim();
  return url && !/^(?:#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(url) ? url.slice(0, 1000) : '';
}

function inspectResources(code, libraries = []) {
  const rows = new Map();
  let overflow = false;
  function add(value, kind, index = -1) {
    const path = resourceAddress(value);
    if (!path) return;
    if (kind === 'Ресурс CSS') {
      if (/\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(path)) kind = 'Шрифт';
      else if (/\.css(?:[?#]|$)/i.test(path)) kind = 'CSS';
    }
    const copy = libraries.find(row => row.usedKey && (row.reference?.index === index || (kind === 'Импорт модуля' && row.path === path)));
    const state = copy ? 'Копия доступна для подмены' : /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) ? 'Внешний адрес' : 'Относительный или локальный путь';
    const key = JSON.stringify([kind, path, state]);
    if (rows.has(key)) { rows.get(key).count++; return; }
    if (rows.size >= resourceLimit) { overflow = true; return; }
    rows.set(key, { kind, path, state, count: 1 });
  }
  function css(text) {
    const unescape = text => text.replace(/\\([\da-f]{1,6}\s?|[^\r\n])/gi, (_, value) => /^[\da-f]/i.test(value)
      ? String.fromCodePoint(Math.min(0x10ffff, parseInt(value.trim(), 16)) || 0xfffd) : value);
    const tokens = /\/\*[\s\S]*?\*\/|url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)|@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
    for (const match of text.matchAll(tokens)) {
      const url = match.slice(1).find(value => value !== undefined);
      if (url !== undefined) add(unescape(url.trim()), /^@import/i.test(match[0]) ? 'CSS' : 'Ресурс CSS');
    }
  }
  function srcset(text) {
    // Read URL tokens before optional density/width descriptors; keep data URLs intact.
    let rest = text;
    while (rest) {
      rest = rest.replace(/^[\s,]+/, '');
      const token = /^\S+/.exec(rest)?.[0];
      if (!token) break;
      rest = rest.slice(token.length);
      if (!/^data:/i.test(token)) for (const url of token.replace(/,+$/, '').split(',')) add(url, 'Изображение');
      if (!token.endsWith(',')) rest = rest.replace(/^[^,]*(?:,|$)/, '');
    }
  }
  const tokens = /<!--[\s\S]*?-->|<(script|style|textarea|title|xmp|iframe|noembed|noframes)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/\1\s*>|<([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi;
  for (const match of code.matchAll(tokens)) {
    const tag = (match[1] || match[4] || '').toLowerCase();
    if (!tag) continue;
    const attributes = scriptAttributes(match[2] ?? match[5]);
    const attr = name => decodeScriptUrl(attributes.get(name)?.value || '');
    if (tag === 'script') add(attr('src'), 'Скрипт', match.index);
    if (tag === 'style') css(match[3] || '');
    if (tag === 'link' && /(?:^|\s)(?:stylesheet|preload|modulepreload|icon)(?:\s|$)/i.test(attr('rel'))) {
      add(attr('href'), /stylesheet/i.test(attr('rel')) ? 'CSS' : attr('as') === 'font' ? 'Шрифт' : 'Ресурс link');
    }
    if (['img', 'input'].includes(tag)) add(attr('src'), 'Изображение');
    if (['audio', 'video', 'source', 'track'].includes(tag)) add(attr('src'), 'Медиа');
    if (['img', 'source'].includes(tag)) srcset(attr('srcset'));
    if (tag === 'video') add(attr('poster'), 'Изображение');
    if (tag === 'iframe') add(attr('src'), 'Вложенная страница');
    if (tag === 'object') add(attr('data'), 'Объект');
    if (tag === 'embed') add(attr('src'), 'Объект');
    if (attributes.has('style')) css(attr('style'));
  }
  if (typeof scanModules === 'function') {
    const modules=scanModules(code);
    for (const ref of modules.references) add(ref.moduleLocal ? ref.modulePath : ref.url,'Импорт модуля',ref.index);
    for (const issue of modules.issues) add(issue.path,'Импорт модуля');
    for (const row of libraries.filter(row=>row.reference?.format==='module' && row.filename)) add(row.path,'Файл модуля',row.reference.index);
  }
  for (const row of libraries.filter(item => item.state === 'Встроена в HTML')) {
    if (rows.size >= resourceLimit) { overflow = true; break; }
    rows.set(`embedded:${rows.size}`, { kind: row.title, path: row.path, state: 'Встроена в HTML', count: 1 });
  }
  return { rows: [...rows.values()], overflow };
}

function beginReadinessRun(preparedCode) {
  if (!diagnosticRun) return;
  diagnosticRun.resources = new Map();
  diagnosticRun.resourcesOverflow = false;
  diagnosticRun.speed = null;
  diagnosticRun.bundled = [...preparedCode.matchAll(/data-onehtml-filename="([^"]+)"/g)].map(match => decodeScriptUrl(match[1]));
  speedGeneration++;
  speedControl = '';
}

function readinessRunLabel() {
  if (!diagnosticRun) return 'Игра ещё не запускалась.';
  return `${running ? 'Текущий' : 'Последний'} запуск · ${new Date(diagnosticRun.time).toLocaleTimeString('ru-RU')}.`
    + (diagnosticRun.code !== codeField.value ? ' Код изменён: данные относятся к прежней версии.' : '');
}

function recordResource(data) {
  if (!diagnosticRun?.resources) return;
  const path = resourceAddress(typeof data.url === 'string' ? data.url : '');
  if (!path || !['timing', 'blocked', 'error'].includes(data.status)) return;
  const map = diagnosticRun.resources;
  if (!map.has(path)) {
    if (map.size >= resourceLimit) { diagnosticRun.resourcesOverflow = true; scheduleReadiness(); return; }
    map.set(path, { path, count: 0, bytes: 0, blocked: false, error: false, kind: '' });
  }
  const row = map.get(path);
  if (data.status === 'timing') {
    row.count = Math.min(1e6, row.count + 1);
    row.bytes = Math.min(Number.MAX_SAFE_INTEGER, row.bytes + (Number.isFinite(data.bytes) && data.bytes > 0 ? Math.floor(data.bytes) : 0));
  } else row[data.status] = true;
  if (typeof data.kind === 'string') row.kind = data.kind.slice(0, 50);
  scheduleReadiness();
}

function speedText() {
  const stats = diagnosticRun?.speed;
  return stats?.frames ? `FPS ${formatUIInteger(Math.round(stats.frames * 1000 / stats.elapsed))} · макс. пауза ${formatUIInteger(Math.round(stats.max))} мс · >100 мс: ${formatUIInteger(stats.slow)}` : 'Нет измерений.';
}

function resourceText(row) {
  return `${row.blocked ? 'Заблокировано политикой' : row.error ? 'Ошибка загрузки' : 'Загрузка замечена'}${row.blocked && row.error ? ' · ошибка загрузки' : ''}`
    + `${row.count ? ` · ${formatUIInteger(row.count)} загрузок · ${row.bytes ? diagnosticSize(row.bytes) : '(нет данных)'}` : ''}`;
}

function renderReadiness() {
  if (!readinessReady) return;
  const strip = document.querySelector('#speed-strip');
  strip.hidden = !running || !speedEnabled || Boolean(currentPanel()) || historyOpen || comparisonOpen || extractionOpen;
  strip.textContent = speedText();
  if (currentPanel() !== activityPanel) return;
  document.querySelector('#resources-run-note').textContent = readinessRunLabel();
  document.querySelector('#speed-run-note').textContent = readinessRunLabel();
  document.querySelector('#speed-result').textContent = speedText();
  document.querySelector('#speed-toggle').checked = speedEnabled;
  document.querySelector('#speed-state').textContent = speedEnabled ? (running ? 'Измерение продолжается после возврата к игре.' : 'Измерение начнётся при запуске игры.') : 'Измерение выключено. Последний результат сохранён до нового запуска.';
  document.querySelector('#resource-observed-note').textContent = `${diagnosticRun?.resources?.size ? 'Замеченные обращения; повторные загрузки объединены.' : 'Обращений пока не зарегистрировано.'}${diagnosticRun?.resourcesOverflow ? ' Показаны первые 200 адресов.' : ''}`;
  document.querySelector('#resource-observed-list').replaceChildren(...[...(diagnosticRun?.resources?.values() || [])].map(row => diagnosticRow(row.path, resourceText(row))));
  document.querySelector('#resource-bundled').textContent = diagnosticRun?.bundled?.length ? `Подставлены или уже встроены при запуске: ${[...new Set(diagnosticRun.bundled)].join(', ')}` : '';
  renderQuality();
}

function renderResourceSource(code, libraries) {
  const result = inspectResources(code, libraries);
  resourceRows = result.rows; resourceOverflow = result.overflow;
  const attached = mediaBindings(code);
  for (const row of resourceRows) {
    const ref = attached.find(ref => ref.path === row.path && ref.id);
    if (ref) row.state = ref.entry ? `Выбран файл: ${ref.entry.name} · ${diagnosticSize(ref.entry.blob.size)}` : 'Выбранный файл отсутствует в кэше';
  }
  document.querySelector('#resource-source-note').textContent = `${resourceRows.length ? 'Ссылки в HTML, стилях и статических импортах модулей; наличие ссылки не означает загрузку.' : 'Внешних ссылок не найдено.'} Динамические адреса и внешний CSS не разбираются.${resourceOverflow ? ' Показаны первые 200 записей.' : ''}`;
  document.querySelector('#resource-source-list').replaceChildren(...resourceRows.map(row => diagnosticRow(row.kind, `${row.state}${row.count > 1 ? ` · ${formatUIInteger(row.count)} подключений` : ''}\n${row.path}`)));
}

function scheduleReadiness() {
  if (!readinessReady || readinessTimer) return;
  readinessTimer = setTimeout(() => { readinessTimer = 0; renderReadiness(); }, 1000);
}

function updateReadiness() {
  if (!readinessReady) return;
  const paused = document.hidden || Boolean(currentPanel()) || historyOpen || comparisonOpen || extractionOpen;
  const key = `${speedGeneration}:${speedEnabled}:${paused}`;
  if (running && activeFrame && key !== speedControl) {
    speedControl = key;
    activeFrame.contentWindow.postMessage({ type: 'onehtml-lab:speed-control', enabled: speedEnabled, paused, generation: speedGeneration }, '*');
  }
  renderReadiness();
}

function readinessReport() {
  const lines = ['Ресурсы текущего кода:', ...resourceRows.map(row => `${row.kind}: ${row.state} · ${row.path}`)];
  if (!resourceRows.length) lines.push('Внешних ссылок в HTML и встроенных стилях не найдено.');
  lines.push('Статические импорты модулей учтены. Динамические адреса и внешний CSS не разбираются.');
  if (resourceOverflow) lines.push('Показаны первые 200 записей.');
  lines.push(readinessRunLabel(), 'Обращения при запуске:');
  for (const row of diagnosticRun?.resources?.values() || []) lines.push(`${row.path}: ${resourceText(row)}`);
  if (!diagnosticRun?.resources?.size) lines.push('Не зарегистрированы.');
  if (diagnosticRun?.resourcesOverflow) lines.push('Показаны первые 200 адресов.');
  if (diagnosticRun?.bundled?.length) lines.push(`Подставлены или уже встроены при запуске: ${[...new Set(diagnosticRun.bundled)].join(', ')}`);
  lines.push('Частота кадров браузера:', speedText(), 'Фоновые паузы и вспомогательные экраны исключены. Частота отрисовки самой игры может отличаться.');
  return lines;
}

function initReadiness() {
  try { speedEnabled = localStorage.getItem('onehtml-lab-speed') !== 'false'; } catch {}
  readinessReady = true;
  document.querySelector('#speed-toggle').addEventListener('change', event => {
    if (!expertMode) return;
    speedEnabled = event.target.checked;
    speedGeneration++; speedControl = '';
    if (speedEnabled && diagnosticRun) diagnosticRun.speed = null;
    try { localStorage.setItem('onehtml-lab-speed', String(speedEnabled)); }
    catch { inform('Настройка измерения действует только сейчас.', true); }
    updateReadiness();
  });
  document.addEventListener('visibilitychange', () => { speedControl = ''; updateReadiness(); });
  window.addEventListener('message', event => {
    if (!running || !activeFrame || event.source !== activeFrame.contentWindow) return;
    const data = event.data;
    if (data?.type === 'onehtml-lab:readiness-ready') { speedControl = ''; updateReadiness(); }
    if (data?.type === 'onehtml-lab:network-resource') recordResource({ ...data, status: 'timing' });
    if (data?.type === 'onehtml-lab:resource-result') recordResource(data);
    if (data?.type !== 'onehtml-lab:speed' || !speedEnabled || data.generation !== speedGeneration || !diagnosticRun) return;
    if (![data.frames, data.elapsed, data.max, data.slow].every(n => Number.isFinite(n) && n >= 0) || data.elapsed > 1e12 || data.frames > 1e12 || data.max > data.elapsed || data.slow > data.frames || (data.frames && !data.elapsed)) return;
    diagnosticRun.speed = { frames: data.frames, elapsed: data.elapsed, max: data.max, slow: data.slow };
    scheduleReadiness();
  });
  updateReadiness();
}
