import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source = (await Promise.all(['library-bundle.js', 'exporter.js', 'library-extract.js'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
const context = { TextEncoder, TextDecoder, Blob, crypto: webcrypto, window: {} };
runInNewContext(source + '\nthis.api = { libraryCache, prepareGameHtml, prepareGameFiles, planLibraryExtraction, retainExtractionAssets, importLocalLibrary, extractedSavePreference };', context);
const { libraryCache, prepareGameHtml, prepareGameFiles, planLibraryExtraction, retainExtractionAssets, importLocalLibrary, extractedSavePreference } = context.api;
const license = 'MIT License\nCopyright (c) Library authors\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED AS IS';
const url = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const librarySource = '/* library body ' + 'x'.repeat(3000) + ' */\nwindow.THREE={REVISION:"128"};';
libraryCache.set('three@0.128.0', { key: 'three@0.128.0', title: 'Three.js r128', sourceUrl: url, source: librarySource, license });
const gameCode = '<script>window.gameLogic=true;</script><p>Game</p>';
const game = `<script id="engine" src="${url}"></script>` + gameCode;
const embedded = (await prepareGameHtml(game)).html;
assert(embedded.includes('data-onehtml-sha256="'));
assert(embedded.includes('data-onehtml-source="' + url + '"'));
assert(embedded.includes('data-onehtml-filename="three-r128.min.js"'));
assert(embedded.includes('onehtml-library:three%400.128.0'));

// A newly exported copy must remain reversible on a browser without its old cache.
libraryCache.clear();
const cdn = await planLibraryExtraction(embedded, 'cdn');
assert.equal(cdn.count, 1, JSON.stringify(cdn.rows.map(row => ({ title: row.title, note: row.note, sourceStart: row.source.slice(0, 40), sourceEnd: row.source.slice(-40) }))));
assert.equal(cdn.rows[0].title, 'Three.js r128');
assert(cdn.html.includes(`id="engine" src="${url}"`));
assert(cdn.html.endsWith(gameCode), 'Game logic outside the library must remain byte-for-byte unchanged');
assert(!cdn.html.includes(librarySource));
assert(!cdn.html.includes(license), 'The full license must move with the extracted source');
assert(cdn.removedBytes > 3000);
assert.equal(extractedSavePreference(cdn.html), 'cdn');
await retainExtractionAssets(cdn);
const rebound = await prepareGameHtml(cdn.html);
assert(rebound.html.includes(librarySource), 'The editor must preview the exact extracted copy from cache');
assert(rebound.html.includes(license));
assert.equal(rebound.missingLibraries.length, 0);
const files = await planLibraryExtraction(embedded, 'files');
assert.equal(files.count, 1);
assert(files.html.includes('src="./three-r128.min.js"'));
assert.equal(extractedSavePreference(files.html), 'files');
await retainExtractionAssets(files);
const packageFiles = await prepareGameFiles(files.html, 'game.html');
assert.deepEqual(Array.from(packageFiles.files, file => file.name), ['game.html', 'three-r128.min.js']);
assert(packageFiles.files[1].content.includes(librarySource));
assert(packageFiles.files[1].content.includes(license));
assert((await prepareGameHtml(files.html + '\n<p>Changed game</p>')).html.includes(librarySource), 'Game edits must preserve the extracted asset reference');
assert.equal((await planLibraryExtraction(embedded.replace(/\n/g, '\r\n'), 'files')).count, 1, 'Line-ending changes must not look like library edits');
const changed = await planLibraryExtraction(embedded.replace('REVISION:"128"', 'REVISION:"999"'));
assert.equal(changed.count, 0);
assert.equal(changed.html, embedded.replace('REVISION:"128"', 'REVISION:"999"'));
assert.match(changed.rows[0].note, /изменён/);

const unrelated = '<!-- <script data-onehtml-library="fake">ignore</script> --><textarea><script data-onehtml-library="fake">ignore</script></textarea><script>window.LargeGame=true;</script>';
assert.equal((await planLibraryExtraction(unrelated)).rows.length, 0);
assert.equal((await planLibraryExtraction(unrelated)).html, unrelated);
const missingLicense = embedded.replace(/<!--onehtml-library:[\s\S]*?-->\n/, '');
assert.equal((await planLibraryExtraction(missingLicense)).count, 0);
const unrelatedComment = '<!-- keep this note -->\n' + embedded;
assert((await planLibraryExtraction(unrelatedComment)).html.startsWith('<!-- keep this note -->\n'));
for (const attribute of ['type="module"', 'async', 'defer', 'nomodule']) {
  const unsupported = embedded.replace('<script id="engine"', `<script ${attribute} id="engine"`);
  assert.equal((await planLibraryExtraction(unsupported)).html, unsupported);
}

const customGame = '<script src="./a/engine.js"></script><script src="./b/engine.js"></script>' + gameCode;
for (const [index, ref] of (await prepareGameHtml(customGame)).missingLibraries.entries()) {
  await importLocalLibrary(ref, `window.Engine${index}=true;`, license);
}
const customEmbedded = (await prepareGameHtml(customGame)).html;
libraryCache.clear();
const customCdn = await planLibraryExtraction(customEmbedded, 'cdn');
assert.equal(customCdn.count, 0);
assert.equal(customCdn.html, customEmbedded);
assert(customCdn.rows.every(row => row.note.includes('Нет CDN')));
const customFiles = await planLibraryExtraction(customEmbedded, 'files');
assert.equal(customFiles.count, 2);
assert.deepEqual(Array.from(customFiles.assets, asset => asset.filename), ['engine.js', 'engine-2.js']);
assert(customFiles.html.endsWith(gameCode));
await retainExtractionAssets(customFiles);
assert.equal((await prepareGameHtml(customFiles.html)).missingLibraries.length, 0);
assert.equal((await prepareGameFiles(customFiles.html, 'game.html')).files.length, 3);

// Legacy copies only have the old key and must match a cached original exactly.
const entry = { key: 'three@0.128.0', title: 'Three.js r128', source: librarySource, sourceUrl: url, license };
const legacy = `<!--\nThree.js r128, MIT license:\n${license}\n-->\n<script data-onehtml-library="${entry.key}">\n${librarySource}\n</script>` + gameCode;
assert.equal((await planLibraryExtraction(legacy)).count, 0);
libraryCache.set(entry.key, entry);
assert.equal((await planLibraryExtraction(legacy)).count, 1);
const changedLegacy = legacy.replace('REVISION:"128"', 'REVISION:"999"');
assert.equal((await planLibraryExtraction(changedLegacy)).html, changedLegacy);
const repeated = embedded + embedded;
const repeatPlan = await planLibraryExtraction(repeated, 'files');
assert.equal(repeatPlan.count, 2);
assert.equal(repeatPlan.assets.length, 1, 'Identical copies must reuse one extracted file');
assert.equal(extractedSavePreference(game), null);
const tinyLicense = 'Copyright\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED';
libraryCache.set('three@0.128.0', { key: 'three@0.128.0', title: 'A', source: '0;', license: tinyLicense });
const tiny = `<!--\nA, MIT license:\n${tinyLicense}\n-->\n<script data-onehtml-library="three@0.128.0">\n0;\n</script>`;
const tinyPlan = await planLibraryExtraction(tiny);
assert.equal(tinyPlan.count, 1);
assert(tinyPlan.removedBytes < 0, 'A link longer than a tiny legacy block must report increased size');
assert.equal(tinyPlan.removedBytes, new Blob([tiny]).size - new Blob([tinyPlan.html]).size);
console.log('Library extraction: portable metadata, exact versions, licenses, legacy copies, cache, modified code and collisions passed.');
