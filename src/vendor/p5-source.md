# p5.js 2.3.4 corresponding source

p5.js is licensed under LGPL-2.1. Its complete license and bundled dependency notices are in [p5-LICENSE.txt](p5-LICENSE.txt).

OneHTML Lab downloads the unchanged preferred source, translations, utilities, package manifest, release lockfile and Rollup build configuration directly from the [official v2.3.4 source release](https://github.com/processing/p5.js/tree/v2.3.4). The browser verifies every file against [the source manifest](p5-source-2.3.4.json) and creates `p5-source-2.3.4.tar.gz` locally. Neither the library distribution nor its source archive is stored in this repository. Documentation, website examples and test artwork are omitted. No upstream examples or artwork are used by OneHTML Lab.

After extracting the archive, enter its `p5.js-2.3.4` directory and run `npm ci --ignore-scripts`, then `npm run build`. Use Node.js 22 or newer. Rollup produces `lib/p5.min.js`; its banner uses the current build date, so a rebuilt file need not be byte-identical to the published distribution. You may modify or replace the library and rebuild it. Preserve the license and provide corresponding source when redistributing a modified LGPL library.

OneHTML Lab accepts the pinned, unmodified distribution with its corresponding source; imports are checked against the source file and distribution hashes. Gzip compression can differ between browsers; the archive content and paths must match exactly. Modified builds need their own corresponding source and are not substituted by this catalog entry.

OneHTML Lab preserves this archive in a Base64 comment inside downloaded p5.js copies. The **Исходники p5** button in library preparation saves the archive separately. It is also retained in library ZIP sets, adjacent JavaScript files and embedded game HTML. The editor itself contains notices, not the p5.js runtime or its source payload.

The first download obtains 197 source/build files (about 4.7 MiB before network compression) and displays progress. The prepared copy is cached for reuse and can be transferred through portable library sets or installed from files. p5.js is experimental: **Скачать все библиотеки** excludes it by default; choose p5.js explicitly with **Скачать выбранные** or enable the experimental-library checkbox. Its interactive composition is a separate example, outside the shared library benchmark.

To verify or regenerate only the metadata, download the [upstream tar.gz](https://codeload.github.com/processing/p5.js/tar.gz/refs/tags/v2.3.4), then run `node scripts/prepare-p5-source.mjs <downloaded-file>`. The script checks the upstream hash and writes file names, sizes, modes and hashes; it does not copy library or source content into this repository. Browser tests obtain their source fixture from upstream and cache it outside the repository.

| File | SHA-256 |
|---|---|
| Upstream v2.3.4 source tar.gz | `efd86925ca0a8e66c53ffdbe8c5799b1abfc85c2921a99a1a03fd5147fd7ef21` |
| Published `lib/p5.min.js` | `bb8b82b97fcbcd5bb2d5475d1b6a3904f3ab4ed01b821134fd8f1e7710fce559` |
