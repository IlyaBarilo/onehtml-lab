// A bounded, forgiving lexer for display only. User code never enters innerHTML.
const syntaxLimit = 1_000_000;
const syntaxTokenLimit = 60000;
function scanCodeColors(code) {
  const tokens = [], accents = [];
  if (code.length > syntaxLimit) return { tokens, accents, limited: true };
  let limited = false;
  const add = (start, end, kind) => {
    if (tokens.length >= syntaxTokenLimit) { limited = true; return; }
    start = Math.max(start, tokens.at(-1)?.end || 0);
    if (end > start) tokens.push({ start, end, kind });
  };
  const accent = (start, end, label, color = '') => { if (accents.length < 1000) accents.push({ start, end, label, color }); };
  const keywords = new Set('async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield'.split(' '));
  function language(text, offset, css = false, accentsOnly = false) {
    let depth = accentsOnly ? 1 : 0, valueMode = false;
    const pattern = css
      ? /\/\*[\s\S]*?(?:\*\/|$)|url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|#[\da-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:red|blue|green|white|black|gray|grey|orange|purple|yellow|transparent)\b|[\w-]+(?=\s*:)|@[-\w]+|\b\d+(?:\.\d+)?(?:[a-z%]+)?|[{}:;(),]/gi
      : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?|\b(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[\p{L}_$][\p{L}\p{N}_$]*|[{}()[\];.,?:=+*%!<>|&~-]/gu;
    for (const match of text.matchAll(pattern)) {
      if (limited) break;
      const value = match[0], start = offset + match.index, end = start + value.length;
      if (css) {
        if (value === '{') { depth++; valueMode = false; }
        if (value === '}') { depth--; valueMode = false; }
        if (value === ':' && depth > 0) valueMode = true;
        if (value === ';') valueMode = false;
      }
      let kind = '';
      if (value.startsWith('/*') || (!css && value.startsWith('//'))) kind = 'comment';
      else if (/^["'`]/.test(value)) kind = 'string';
      else if (/^\d/.test(value)) kind = 'number';
      else if (css && /^url\(/i.test(value)) { kind = 'string'; accent(start, end, `Ресурс CSS · ${value.slice(0,160)}`); }
      else if (css && /^(?:#|rgba?\(|hsla?\(|red$|blue$|green$|white$|black$|gr[ae]y$|orange$|purple$|yellow$|transparent$)/i.test(value)) {
        kind = 'number';
        if (valueMode) accent(start, end, `Цвет: ${value}`, value);
      } else if (css && /^[\w@-]/.test(value)) kind = 'property';
      else if (!css && keywords.has(value)) kind = 'keyword';
      else if (!css && /^\s*\(/.test(text.slice(match.index + value.length, match.index + value.length + 30))) kind = 'function';
      if (kind && !accentsOnly) add(start, end, kind);
    }
  }
  const html = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-zA-Z](?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  let cursor = 0, match;
  while ((match = html.exec(code)) && !limited) {
    if (match.index > cursor) add(cursor, match.index, 'text');
    const tag = match[0], start = match.index, end = start + tag.length;
    if (tag.startsWith('<!--')) add(start, end, 'comment');
    else {
      const name = /^<\/?([\w:-]+)/.exec(tag)?.[1]?.toLowerCase();
      const prefix = /^<\/?[^\s/>]+/.exec(tag)?.[0] || tag;
      add(start, start + prefix.length, 'tag');
      const attrs = /([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
      attrs.lastIndex = prefix.length;
      const parsed = scriptAttributes(tag.slice(prefix.length, -1));
      let attribute;
      while ((attribute = attrs.exec(tag)) && attribute.index < tag.length - 1) {
        const at = start + attribute.index, key = attribute[1].toLowerCase(), value = attribute[2];
        add(at, at + attribute[1].length, 'attribute');
        if (!value) continue;
        const valueAt = at + attribute[0].lastIndexOf(value);
        add(valueAt, valueAt + value.length, 'string');
        const quoted = /^["']/.test(value), raw = quoted ? value.slice(1, -1) : value;
        const path = decodeScriptUrl(raw);
        if (['src', 'href', 'poster', 'data'].includes(key) && ['script', 'link', 'img', 'audio', 'video', 'source', 'iframe', 'object', 'track'].includes(name)) {
          let label = name === 'script' ? 'Скрипт' : name === 'link' ? 'Ресурс link' : ['img','video'].includes(name) && key === 'poster' || name === 'img' ? 'Изображение' : 'Ресурс';
          const ref = name === 'script' && (libraryReference(path.split(/[?#]/)[0]) || localLibraryReference(path));
          if (ref?.title && ref.title !== ref.filename) label = `Библиотека: ${ref.title}`;
          accent(valueAt, valueAt + value.length, `${label} · ${path.slice(0, 160)}`);
        }
        if (key === 'style') {
          // Attribute remains a string; color chips are metadata only.
          language(raw, valueAt + (quoted ? 1 : 0), true, true);
        }
      }
      add(end - (tag.endsWith('/>') ? 2 : 1), end, 'tag');
      if (!tag.startsWith('</') && ['script', 'style', 'textarea', 'title'].includes(name)) {
        const close = new RegExp(`<\\/${name}\\s*>`, 'gi'); close.lastIndex = end;
        const closing = close.exec(code), bodyEnd = closing ? closing.index : code.length;
        const body = code.slice(end, bodyEnd);
        if (name === 'style') language(body, end, true);
        else if (name === 'script') {
          const type = parsed.get('type')?.value || '';
          if (!type || /^(?:module|(?:text|application)\/(?:javascript|ecmascript|json|ld\+json))$/i.test(type)) language(body, end);
          const bundled = parsed.get('data-onehtml-filename')?.value;
          if (bundled) accent(start, end, `Встроенная библиотека: ${decodeScriptUrl(bundled).slice(0, 160)}`);
        } else add(end, bodyEnd, 'text');
        cursor = bodyEnd; html.lastIndex = bodyEnd; continue;
      }
    }
    cursor = end;
  }
  if (!limited && cursor < code.length) add(cursor, code.length, 'text');
  return { tokens, accents, limited };
}

let syntaxSnapshot = null;
let syntaxComposing = false;
let syntaxColorContext;
const syntaxColorInks = new Map();
function syntaxColorInk(value) {
  if (syntaxColorInks.has(value)) return syntaxColorInks.get(value);
  syntaxColorContext ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!syntaxColorContext) return '#000';
  syntaxColorContext.clearRect(0, 0, 1, 1);
  syntaxColorContext.fillStyle = value;
  syntaxColorContext.fillRect(0, 0, 1, 1);
  const rgba = syntaxColorContext.getImageData(0, 0, 1, 1).data, alpha = rgba[3] / 255;
  // Match both checkerboard squares, including the actual alpha of the sample.
  const luminances = [[255,255,255], [228,232,238]].map(background => {
    const rgb = background.map((channel, i) => (rgba[i] * alpha + channel * (1-alpha)) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722;
  });
  const black = Math.min(...luminances.map(light => (light + 0.05) / 0.05));
  const white = Math.min(...luminances.map(light => 1.05 / (light + 0.05)));
  const ink = black >= white ? '#000' : '#fff';
  if (syntaxColorInks.size >= 1000) syntaxColorInks.clear();
  syntaxColorInks.set(value, ink);
  return ink;
}
const syntaxLayer = document.querySelector('#code-colors');
const syntaxCaption = document.querySelector('#syntax-caption');
function clearCodeColors() {
  const hadCaption = !syntaxCaption.hidden;
  codeField.classList.remove('has-colors'); syntaxLayer.hidden = true; syntaxCaption.hidden = true;
  if (hadCaption) updateInlineGeometry();
}

function drawCodeColors() {
  if (editView.colors === 'off' || syntaxComposing || codeField.hidden || currentPanel() || codeField.disabled) { clearCodeColors(); return; }
  const code = codeField.value;
  if (syntaxSnapshot?.code !== code) syntaxSnapshot = { code, longLine: code.split('\n').some(line => line.length > 12000), ...scanCodeColors(code) };
  const note = document.querySelector('#edit-colors-note');
  const limited = syntaxSnapshot.limited || syntaxSnapshot.longLine;
  note.textContent = limited ? 'Для этого большого файла или длинной строки используется обычный текст, чтобы сохранить отзывчивость.' : 'Оформление не меняет код. Подключения подчёркнуты, пояснение появляется при выборе строки. Большие файлы автоматически показываются обычным текстом.';
  if (limited || !code) { clearCodeColors(); return; }
  const style = getComputedStyle(codeField), box = codeField.getBoundingClientRect(), origin = workspaceElement.getBoundingClientRect();
  Object.assign(syntaxLayer.style, { top: `${box.top-origin.top}px`, left: `${box.left-origin.left}px`, width: `${codeField.clientWidth}px`, height: `${codeField.clientHeight}px` });
  const accents = editView.colors === 'accents' ? syntaxSnapshot.accents : [];
  syntaxLayer.classList.toggle('has-accents', editView.colors === 'accents');
  const starts = editMeasured.starts;
  let low = 0, high = starts.length;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (codePointRect(starts[mid]).top < codeField.scrollTop) low = mid; else high = mid; }
  const rows = [];
  let tokenIndex = 0;
  while (tokenIndex < syntaxSnapshot.tokens.length && syntaxSnapshot.tokens[tokenIndex].end <= starts[low]) tokenIndex++;
  for (let i = low; i < starts.length; i++) {
    const top = editMirror.children[i].offsetTop - codeField.scrollTop;
    if (top > codeField.clientHeight) break;
    const start = starts[i], end = i + 1 < starts.length ? starts[i + 1] - 1 : code.length;
    const row = document.createElement('div'); row.className = 'syntax-line';
    row.dataset.line = String(i + 1);
    for (const key of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','tabSize','paddingLeft','paddingRight']) row.style[key] = style[key];
    Object.assign(row.style, { top: `${top}px`, left: `${-codeField.scrollLeft}px`, width: `${codeField.clientWidth}px`, whiteSpace: editView.wrap ? 'pre-wrap' : 'pre', overflowWrap: editView.wrap ? 'break-word' : 'normal' });
    const lineTokens = [];
    for (let j = tokenIndex; j < syntaxSnapshot.tokens.length && syntaxSnapshot.tokens[j].start < end; j++) {
      const token = syntaxSnapshot.tokens[j];
      if (token.end > start) lineTokens.push(token);
      if (token.end <= end) tokenIndex = j + 1;
    }
    const lineAccents = accents.filter(item => item.start < end && item.end > start);
    const cuts = [...new Set([start, end, ...lineTokens.flatMap(t => [Math.max(start,t.start),Math.min(end,t.end)]), ...lineAccents.flatMap(t => [Math.max(start,t.start),Math.min(end,t.end)])])].sort((a,b)=>a-b);
    let tokenCursor = 0;
    for (let j = 0; j + 1 < cuts.length; j++) {
      const a = cuts[j], b = cuts[j+1];
      while (tokenCursor < lineTokens.length && lineTokens[tokenCursor].end <= a) tokenCursor++;
      const token = lineTokens[tokenCursor], mark = lineAccents.find(item => item.start <= a && item.end >= b);
      const span = document.createElement('span'); span.textContent = code.slice(a,b);
      if (token && token.start <= a) span.className = `syntax-${token.kind}`;
      if (mark) {
        span.classList.add('syntax-accent');
        if (mark.color && CSS.supports('color',mark.color)) {
          span.classList.add('syntax-color');
          span.style.setProperty('--sample-color',mark.color);
          span.style.setProperty('--sample-ink',syntaxColorInk(mark.color));
        }
      }
      row.append(span);
    }
    row.append('\u200b'); rows.push(row);
  }
  syntaxLayer.replaceChildren(...rows); syntaxLayer.hidden = false; codeField.classList.add('has-colors');
  const caret = codeField.selectionStart, from = caret ? code.lastIndexOf('\n',caret-1)+1 : 0;
  const nextLine = code.indexOf('\n',caret), to = nextLine < 0 ? code.length : nextLine;
  const labels = [...new Set(accents.filter(item=>item.start<=to && item.end>from).map(item=>item.label))];
  const hadCaption = !syntaxCaption.hidden;
  syntaxCaption.textContent = labels.slice(0,2).join(' · ');
  syntaxCaption.hidden = !labels.length;
  if (hadCaption !== !syntaxCaption.hidden) updateInlineGeometry();
}
