// Only explicitly marked OneHTML Lab copies can be removed from a document.
// This parser reads source text; it never executes a library in the editor.
function normalizedLibraryText(value) { return value.replace(/\r\n?/g, '\n'); }

async function embeddedLibraryRows(code) {
  const rows = [];
  let comment = null;
  for (const match of code.matchAll(libraryScriptTag)) {
    // Keep the literal HTML comment opener out of the standalone script body.
    if (match[0].startsWith('<' + '!--')) {
      comment = { index: match.index, end: match.index + match[0].length, text: match[0].slice(4, -3) };
      continue;
    }
    const adjacent = comment && /^\s*$/.test(code.slice(comment.end, match.index)) ? comment : null;
    comment = null;
    if (match[2] === undefined) continue;
    const attributes = scriptAttributes(match[2]);
    const value = name => decodeScriptUrl(attributes.get(`data-onehtml-${name}`)?.value || '');
    const key = value('library');
    if (!key || attributes.has('src')) continue;
    const cached = libraryCache.get(key);
    const catalog = libraryCatalogReference(value('catalog') || cached?.catalogKey || key);
    const originalUrl = value('source') || cached?.localPath || cached?.sourceUrl || '';
    const filename = packageFilename(value('filename') || libraryFilename({ filename: cached?.filename
      || cached?.localPath?.split('/').pop() }, cached || { key }));
    const bodyEnd = match[0].search(/<\/script\s*>$/i);
    const source = match[0].slice(8 + match[2].length, bodyEnd).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const row = { index: match.index, end: match.index + match[0].length, start: match.index,
      title: catalog?.title || filename, filename, key, originalUrl, source, license: '', notice: '', cdn: '',
      inlineAttributes: libraryInlineAttributes(attributes), reason: '' };
    rows.push(row);
    if (['async', 'defer', 'nomodule'].some(name => attributes.has(name))
      || (attributes.get('type')?.value && !/^(?:text|application)\/javascript$/i.test(attributes.get('type').value))) {
      row.reason = 'Этот способ подключения пока не поддерживается.';
      continue;
    }
    const commentText = adjacent ? normalizedLibraryText(adjacent.text) : '';
    const hash = await librarySourceHash(source);
    if (value('bundle') === '1') {
      const marker = `onehtml-library:${encodeURIComponent(key)}\n`;
      const titleEnd = commentText.indexOf('\n', marker.length);
      const type = /, (MIT|Apache-2\.0) license:$/.exec(commentText.slice(marker.length, titleEnd))?.[1];
      if (!commentText.startsWith(marker) || titleEnd < 0 || !type || (value('license') && value('license') !== type)) {
        row.reason = 'Не найдена лицензия встроенной копии.';
        continue;
      }
      row.license = commentText.slice(titleEnd + 1).trim();
      row.licenseType = type;
      const noticeStart = row.license.lastIndexOf('\nNOTICE:\n');
      if (noticeStart >= 0) { row.notice = row.license.slice(noticeStart + 9).trim(); row.license = row.license.slice(0, noticeStart).trim(); }
      if (!hash || !/^[a-f\d]{64}$/.test(value('sha256'))) {
        row.reason = 'Недоступна проверка исходного кода библиотеки.';
        continue;
      }
      if (hash !== value('sha256')) {
        row.reason = 'Код библиотеки изменён — оставлен в HTML.';
        continue;
      }
    } else {
      if (!cached) { row.reason = 'Старая копия: нужна исходная библиотека в кэше.'; continue; }
      const title = cached.title.replace(/--/g, '—').replace(/[<>]/g, '');
      const expected = `\n${title}, MIT license:\n${cached.license}\n`;
      if (normalizedLibraryText(source) !== normalizedLibraryText(cached.source)
        || commentText !== normalizedLibraryText(expected)) {
        row.reason = 'Исходный код или лицензия изменены — оставлены в HTML.';
        continue;
      }
      row.license = cached.license;
      if (!hash) { row.reason = 'Недоступна проверка исходного кода библиотеки.'; continue; }
    }
    if (!validLibraryEntry(row)) { row.reason = 'Не удалось проверить библиотеку, лицензию или NOTICE.'; continue; }
    row.start = adjacent.index;
    row.assetKey = 'asset@' + await librarySourceHash(libraryAssetIdentity(source, row.license, row.notice));
    row.catalogKey = catalog?.key;
    const requestedCdn = value('cdn') || (libraryReference(originalUrl)?.key === catalog?.key ? originalUrl : cached?.sourceUrl);
    row.cdn = catalog ? (libraryReference(requestedCdn)?.key === catalog.key ? requestedCdn : catalog.url) : '';
  }
  return rows;
}

async function planLibraryExtraction(code, mode = 'cdn') {
  if (!['cdn', 'files'].includes(mode)) throw new Error('Invalid library extraction mode');
  const rows = await embeddedLibraryRows(code);
  const names = new Set(libraryMatches(code).filter(ref => ref.filename).map(ref => packageFilename(ref.filename).toLowerCase()));
  const assets = new Map();
  let html = '';
  let cursor = 0;
  let count = 0;
  for (const row of rows) {
    if (row.reason || (mode === 'cdn' && !row.cdn)) {
      row.note = row.reason || 'Нет CDN-адреса — выберите «Файлы рядом».';
      row.removable = false;
      continue;
    }
    let asset = assets.get(row.assetKey);
    if (!asset) {
      let name = row.filename;
      let number = 2;
      while (names.has(name.toLowerCase())) {
        const suffix = `-${number++}.js`;
        name = Array.from(row.filename.replace(/\.js$/i, '')).slice(0, 160 - suffix.length).join('') + suffix;
      }
      names.add(name.toLowerCase());
      asset = { key: row.assetKey, title: row.title, source: row.source, license: row.license, filename: name,
        licenseType: libraryLicenseType(row.license), notice: row.notice,
        catalogKey: row.catalogKey, sourceUrl: row.cdn, originalUrl: row.originalUrl,
        bytes: new TextEncoder().encode(row.source).length, savedAt: Date.now() };
      assets.set(asset.key, asset);
    }
    const url = mode === 'cdn' ? row.cdn : './' + encodeURIComponent(asset.filename);
    const tag = `<script ${row.inlineAttributes ? row.inlineAttributes + ' ' : ''}src="${libraryAttribute(url)}" data-onehtml-asset="${asset.key}"></script>`;
    html += code.slice(cursor, row.start) + tag;
    cursor = row.end;
    row.removable = true;
    row.removedBytes = new Blob([code.slice(row.start, row.end)]).size - new Blob([tag]).size;
    count += 1;
  }
  html += code.slice(cursor);
  if (typeof embeddedModulePlan === 'function') {
    const modules = await embeddedModulePlan(html, mode);
    return { html: modules.html, rows: [...rows, ...modules.rows], assets: [...assets.values(), ...modules.assets],
      count: count + modules.count, mode, removedBytes: new Blob([code]).size - new Blob([modules.html]).size };
  }
  return { html, rows, assets: [...assets.values()], count, mode,
    removedBytes: new Blob([code]).size - new Blob([html]).size };
}

async function retainExtractionAssets(plan) {
  let persisted = true;
  for (const entry of plan.assets) {
    libraryCache.set(entry.key, entry);
    try { await saveLibraryToCache(entry); }
    catch { persisted = false; }
  }
  return persisted;
}

async function planLibraryEmbedding(code) {
  const references = await resolvedLibraryMatches(code);
  const prepared = await prepareGameHtml(code);
  const rows = await Promise.all(references.map(async reference => {
    const entry = cachedLibrary(reference);
    return { title: reference.title, removable: Boolean(entry),
      note: reference.localPath ? `Выберите ${reference.filename}, лицензию и NOTICE при наличии.` : 'Нужна копия библиотеки с полной лицензией и уведомлениями.',
      removedBytes: entry ? new Blob([reference.tag]).size - new Blob([await embeddedLibraryTag(reference, entry)]).size : 0 };
  }));
  if (typeof scanModules === 'function') {
    for (const reference of new Map(scanModules(code).references.map(ref => [ref.key, ref])).values()) {
      const detail = prepared.bundledLibraryDetails.find(item => item.title === reference.title);
      rows.push({ title: reference.title, removable: Boolean(detail), removedBytes: -(detail?.addedBytes || 0), note: 'Нужна модульная копия с MIT-лицензией.' });
    }
    rows.push(...scanModules(code).issues.map(row => ({ ...row, removable: false })));
  }
  return { html: prepared.html, rows, libraryLabels: bundledLibraryLabels(prepared), missingLibraries: prepared.missingLibraries, assets: [],
    count: prepared.bundledLibraries.length, mode: 'embed', removedBytes: new Blob([code]).size - new Blob([prepared.html]).size };
}

function extractedSavePreference(code) {
  if (typeof scanModules === 'function' && scanModules(code).map?.attrs.has('data-onehtml-module-links')) return scanModules(code).references.some(ref => ref.moduleLocal) ? 'files' : 'cdn';
  const refs = libraryMatches(code).filter(ref => ref.assetKey);
  return refs.length ? (refs.some(ref => ref.localPath) ? 'files' : 'cdn') : null;
}
