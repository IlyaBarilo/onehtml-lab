function htmlFilename(value) {
  const name = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  if (!name) return 'game.html';
  return /\.html$/i.test(name) ? name : name + '.html';
}

function downloadHtml(code, filename) {
  const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, htmlFilename(filename));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // Some browsers consume the Blob asynchronously after the click.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function prepareGameFiles(code, filename) {
  const htmlName = packageFilename(htmlFilename(filename));
  const matches = await resolvedLibraryMatches(code);
  const missingLibraries = [...new Map(matches.filter(ref => !cachedLibrary(ref)).map(ref => [ref.key, ref])).values()];
  const reservedNames = new Set([htmlName.toLowerCase(), ...missingLibraries.filter(ref => ref.filename).map(ref => packageFilename(ref.filename).toLowerCase())]);
  const assets = new Map();
  let html = '';
  let cursor = 0;
  for (const reference of matches) {
    const entry = cachedLibrary(reference);
    if (!entry) continue;
    let asset = assets.get(entry.key);
    if (!asset) {
      const requested = libraryFilename(reference, entry);
      let name = requested;
      let number = 2;
      while (reservedNames.has(name.toLowerCase())) {
        const suffix = `-${number++}.js`;
        name = Array.from(requested.replace(/\.js$/i, '')).slice(0, 160 - suffix.length).join('') + suffix;
      }
      reservedNames.add(name.toLowerCase());
      asset = { name, content: licensedLibrarySource(reference, entry) };
      assets.set(entry.key, asset);
    }
    html += code.slice(cursor, reference.index);
    const pin = reference.assetKey ? ` data-onehtml-asset="${reference.assetKey}"` : '';
    html += `<script ${reference.inlineAttributes ? reference.inlineAttributes + ' ' : ''}src="./${encodeURIComponent(asset.name)}"${pin}></script>`;
    cursor = reference.index + reference.tag.length;
  }
  html += code.slice(cursor);
  if (typeof prepareModuleLibraries === 'function') {
    const modules = await prepareModuleLibraries(html, 'files', [...reservedNames]);
    return { html: modules.html, files: [{ name: htmlName, content: modules.html }, ...assets.values(), ...modules.files],
      missingLibraries: [...missingLibraries, ...modules.missingLibraries], modules: modules.modules };
  }
  const files = [{ name: htmlName, content: html }, ...assets.values()];
  return { html, files, missingLibraries };
}

function downloadGameFile(file) {
  const type = /\.html$/i.test(file.name) ? 'text/html;charset=utf-8' : 'text/javascript;charset=utf-8';
  downloadBlob(new Blob([file.content], { type }), file.name);
}

function downloadGameFiles(files) {
  for (const file of files) downloadGameFile(file);
}

async function shareHtml(code, filename, shareNavigator = navigator) {
  const file = new File([code], htmlFilename(filename), { type: 'text/html' });
  const data = { files: [file] };
  if (!shareNavigator.share || !shareNavigator.canShare?.(data)) return 'unsupported';
  try {
    await shareNavigator.share(data);
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    throw error;
  }
}
