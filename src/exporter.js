function htmlFilename(value) {
  const name = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  if (!name) return 'game.html';
  return /\.html$/i.test(name) ? name : name + '.html';
}

function downloadHtml(code, filename) {
  const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = htmlFilename(filename);
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // Some browsers consume the Blob asynchronously after the click.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
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
