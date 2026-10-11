// Metadata only. Source files are obtained from the upstream project, never this repository.
const p5SourceManifest = /* P5_SOURCE_MANIFEST */ null;
function p5SourceFileUrl(path) {
  return 'https://raw.githubusercontent.com/processing/p5.js/v' + p5SourceManifest.version + '/' + path.split('/').map(encodeURIComponent).join('/');
}
function p5SourceTar(files) {
  const encoder = new TextEncoder(), chunks = [];
  const field = (header, at, length, value) => {
    const bytes = encoder.encode(value);
    if (bytes.length >= length) throw Error('Слишком длинное поле архива исходников.');
    header.set(bytes, at);
  };
  for (let i = 0; i < p5SourceManifest.files.length; i++) {
    const [path, size, , mode] = p5SourceManifest.files[i], bytes = files[i];
    if (!bytes || bytes.length !== size) throw Error('Неполный набор исходников p5.js.');
    const name = 'p5.js-' + p5SourceManifest.version + '/' + path, header = new Uint8Array(512);
    if (encoder.encode(name).length < 100) field(header, 0, 100, name);
    else { const at = name.lastIndexOf('/'); field(header, 0, 100, name.slice(at + 1)); field(header, 345, 155, name.slice(0, at)); }
    field(header, 100, 8, mode.toString(8).padStart(7, '0'));
    field(header, 108, 8, '0000000'); field(header, 116, 8, '0000000');
    field(header, 124, 12, size.toString(8).padStart(11, '0')); field(header, 136, 12, '00000000000');
    header.fill(32, 148, 156); header[156] = 48; field(header, 257, 6, 'ustar'); header[263] = 48; header[264] = 48;
    field(header, 148, 7, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')); header[155] = 32;
    chunks.push(header, bytes, new Uint8Array((512 - size % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const tar = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0; for (const chunk of chunks) {tar.set(chunk, at); at += chunk.length;}
  return tar;
}
async function validP5SourceArchive(bytes) {
  if (!bytes || bytes[0] !== 31 || bytes[1] !== 139) return false;
  // Preserve already prepared, verified copies; gzip compression may differ between browsers.
  if (await librarySourceHash(bytes) === '93badf8b7c3b2e0e1d74e20734003620722bc60588a53742e3f1f1edf3f2383a') return true;
  try {
    const expected = 1024 + p5SourceManifest.files.reduce((sum, file) => sum + 512 + Math.ceil(file[1] / 512) * 512, 0);
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let total = 0;
    try {for (;;) {const {done, value} = await reader.read(); if (done) break; total += value.length; if (total > expected) {await reader.cancel(); return false;} chunks.push(value);}}
    finally {reader.releaseLock();}
    if (total !== expected) return false;
    const tar = new Uint8Array(total); let at = 0; for (const chunk of chunks) {tar.set(chunk, at); at += chunk.length;}
    const files = []; at = 0;
    for (const [, size, hash] of p5SourceManifest.files) {
      const content = tar.subarray(at + 512, at + 512 + size);
      if (await librarySourceHash(content) !== hash) return false;
      files.push(content); at += 512 + Math.ceil(size / 512) * 512;
    }
    return await librarySourceHash(tar) === await librarySourceHash(p5SourceTar(files));
  } catch {return false;}
}
async function downloadP5Source(reference, options) {
  if (typeof CompressionStream !== 'function') throw libraryDownloadError(reference, 'архив исходников', '', 'Этот браузер не поддерживает упаковку исходников. Установите готовую копию из файлов.');
  const controller = new AbortController(), abort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', abort, {once:true});
  if (options.signal?.aborted) abort();
  const files = new Array(p5SourceManifest.files.length); let next = 0, done = 0;
  try {
    await Promise.all(Array.from({length:6}, async () => {
      while (next < files.length) {
        const index = next++, [path, size, hash] = p5SourceManifest.files[index], url = p5SourceFileUrl(path);
        const bytes = await downloadLibraryResource(reference, url, 'исходник', {...options, signal:controller.signal}, 'binary', {bytes:size,sha256:hash});
        if (controller.signal.aborted) throw controller.signal.reason;
        files[index] = bytes; options.onProgress?.(`Исходники p5.js: ${++done} из ${files.length}`);
      }
    }));
    return new Uint8Array(await new Response(new Blob([p5SourceTar(files)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  } catch (error) {controller.abort(); throw error;}
  finally {options.signal?.removeEventListener('abort', abort);}
}
