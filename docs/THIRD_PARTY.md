# Third-party licenses / Лицензии сторонних компонентов

OneHTML Lab includes CodeMirror 6 and its runtime dependencies in the standalone HTML. Full copyright and permission notices are preserved in the bundled code and in [codemirror-LICENSE.txt](../src/vendor/codemirror-LICENSE.txt).

OneHTML Lab включает CodeMirror 6 и его зависимости в самостоятельный HTML. Полные уведомления об авторских правах и условиях использования сохранены во встроенном коде и в файле лицензий выше.

| Component / Компонент | Version / Версия | License / Лицензия |
|---|---|---|
| @codemirror/autocomplete | 6.20.3 | MIT |
| @codemirror/commands | 6.11.1 | MIT |
| @codemirror/lang-css | 6.3.1 | MIT |
| @codemirror/lang-html | 6.4.12 | MIT |
| @codemirror/lang-javascript | 6.2.5 | MIT |
| @codemirror/language | 6.12.4 | MIT |
| @codemirror/state | 6.7.6 | MIT |
| @codemirror/view | 6.43.13 | MIT |
| @lezer/common | 1.5.3 | MIT |
| @lezer/css | 1.3.8 | MIT |
| @lezer/highlight | 1.2.5 | MIT |
| @lezer/html | 1.3.13 | MIT |
| @lezer/javascript | 1.5.6 | MIT |
| @lezer/lr | 1.4.10 | MIT |
| @marijn/find-cluster-break | 1.0.4 | MIT |
| crelt | 1.0.7 | MIT |
| style-mod | 4.1.4 | MIT |
| w3c-keyname | 2.2.8 | MIT |

Project / Проект: [CodeMirror](https://codemirror.net/). Build dependencies, including esbuild and Playwright, are not included in the application. / Зависимости сборки, включая esbuild и Playwright, не входят в приложение.

## Three.js

The 3D showcase references Three.js r160 (npm 0.160.0), licensed under MIT. Three.js is not bundled with the editor. When a user downloads a copy through the editor and embeds it in an exported HTML, the complete copyright and permission notice is included with that copy. Tests use the same exact version as a development dependency; its source and LICENSE are supplied by the npm package.

3D-витрина ссылается на Three.js r160 (npm 0.160.0), распространяемую по MIT. Библиотека не включена в редактор. При получении копии через редактор и встраивании в сохраняемый HTML полный текст лицензии и сведения об авторских правах сохраняются вместе с ней. Тесты используют ту же точную версию как зависимость разработки; исходник и LICENSE поставляются npm-пакетом.

Project / Проект: [Three.js](https://threejs.org/). License / Лицензия: [MIT for r160](https://github.com/mrdoob/three.js/blob/r160/LICENSE). No third-party sound recordings, models or textures are included in the new examples. / Сторонние аудиозаписи, модели и текстуры в новых примерах не используются.

## Phaser and Matter.js / Phaser и Matter.js

Game profiles reference Phaser 3.90.0, Phaser 4.2.1 and Matter.js 0.20.0, all under MIT. Exact npm development dependencies supply real distributions and full licenses for tests. These libraries are not bundled with the editor. Downloaded copies retain their complete copyright and permission notices when embedded in a game or exported as separate JavaScript files.

Профили используют Phaser 3.90.0, Phaser 4.2.1 и Matter.js 0.20.0 под MIT. Точные зависимости разработки npm предоставляют настоящие сборки и полные лицензии для проверок. В редактор эти библиотеки не включены. Загруженные копии сохраняют полные авторские уведомления и условия лицензии при встраивании в игру и при сохранении отдельными JS-файлами.

Licenses / Лицензии: [Phaser 3.90.0](https://cdn.jsdelivr.net/npm/phaser@3.90.0/LICENSE.md), [Phaser 4.2.1](https://cdn.jsdelivr.net/npm/phaser@4.2.1/LICENSE.md), [Matter.js 0.20.0](https://cdn.jsdelivr.net/npm/matter-js@0.20.0/LICENSE).

## Babylon.js

Babylon.js 9.30.0 is an optional game engine under Apache-2.0. Its WebGL core is referenced by the game profile and library test; it is not bundled with the editor. The exact npm development dependency supplies the real distribution for tests. Downloading, embedding, exporting adjacent JavaScript files and shortening copies preserve the full [LICENSE](licenses/babylonjs-9.30.0-LICENSE.txt) and [NOTICE](licenses/babylonjs-9.30.0-NOTICE.txt) from that package. Babylon.js does not change the MIT license of OneHTML Lab.

Babylon.js 9.30.0 — необязательный игровой движок под Apache-2.0. Профиль игры и тест библиотек подключают его ядро WebGL; в редактор оно не включено. Точная зависимость npm предоставляет настоящий дистрибутив для проверок. При загрузке, встраивании, сохранении отдельного JS и сокращении копий сохраняются полные LICENSE и NOTICE из пакета по ссылкам выше. Лицензия OneHTML Lab остаётся MIT.

Project / Проект: [Babylon.js](https://www.babylonjs.com/). Exact release / Точный выпуск: [9.30.0](https://github.com/BabylonJS/Babylon.js/releases/tag/9.30.0). GUI, inspector and WebGPU are not part of the supported profile. Havok is available separately below. / GUI, инспектор и WebGPU в поддерживаемый профиль не входят. Havok доступен отдельно, см. ниже.

## GLB loaders and sample / Загрузчики GLB и пример

Three.js r160 GLTFLoader and BufferGeometryUtils use the same full MIT notice as the Three.js package. Babylon.js loaders 9.30.0 use [Apache-2.0](licenses/babylonjs-loaders-9.30.0-LICENSE.txt). These optional modules are downloaded separately and are not bundled with the editor. Embedded and adjacent copies retain their full licenses; Babylon loader copies also carry the Babylon project NOTICE linked above. The loader npm package does not supply a separate NOTICE file.

GLTFLoader и BufferGeometryUtils версии Three.js r160 используют полный текст MIT из пакета Three.js. Загрузчики Babylon.js 9.30.0 распространяются под Apache-2.0 по ссылке выше. Эти необязательные компоненты скачиваются отдельно и не входят в редактор. Встроенные и отдельные копии сохраняют полные лицензии; к загрузчику Babylon также добавляется NOTICE проекта Babylon по ссылке выше. Отдельного NOTICE в npm-пакете загрузчика нет.

The satellite model, its texture and animation are authored for OneHTML Lab and covered by the project MIT license. User-supplied models retain their own terms; importing a model does not relicense it.

Модель спутника, текстура и анимация созданы для OneHTML Lab и распространяются под MIT проекта. Загруженные пользователем модели сохраняют собственные условия использования; добавление модели не меняет её лицензию.

## cannon-es 0.20.0

cannon-es is an optional 3D physics library under [MIT](licenses/cannon-es-0.20.0-LICENSE.txt). The pinned ES module is downloaded separately and is not bundled with the editor. Cached, embedded and adjacent copies retain the full copyright and permission notice. The package provides the actual distribution used by browser checks.

cannon-es — необязательная библиотека 3D-физики под MIT. Поддерживается ES-модуль точной версии 0.20.0; он скачивается отдельно и не включён в редактор. Кэш, встроенные и отдельные копии сохраняют полный текст лицензии с авторскими правами. npm-пакет предоставляет настоящий дистрибутив для браузерных проверок.

Project / Проект: [cannon-es](https://github.com/pmndrs/cannon-es). The tower example and library benchmark use the project's MIT license. / Пример башни и тест работы библиотек распространяются под MIT проекта.

## Tone.js 15.1.22

Tone.js is an optional music framework under MIT. Its pinned classic `build/Tone.js` distribution is downloaded separately; the editor contains only its notices. The musical example synthesizes sounds without recordings or samples. Embedded HTML, adjacent JavaScript and portable library sets retain the complete [distribution licenses](../src/vendor/tone-LICENSE.txt).

Tone.js — необязательная музыкальная библиотека под MIT. Поддерживается классическая сборка `build/Tone.js` точной версии 15.1.22; она скачивается отдельно. В редактор входят только уведомления о лицензиях. Музыкальный пример синтезирует звук без сторонних записей и семплов. Встроенный HTML, отдельные JS-файлы и переносимые наборы сохраняют полные лицензии сборки по ссылке выше.

The distribution includes standardized-audio-context 25.3.70, automation-events 7.0.4, @babel/runtime 7.26.10 and tslib 2.6.2, as recorded in the Tone.js release commit's lockfile and source map. Their MIT and tslib permission notices are included in full. These are the bundled components, not the independently resolved development dependencies.

В готовую сборку входят standardized-audio-context 25.3.70, automation-events 7.0.4, @babel/runtime 7.26.10 и tslib 2.6.2, указанные в lock-файле коммита выпуска Tone.js и карте исходников. Полные уведомления MIT и условия tslib включены в общий файл. Это компоненты готовой сборки; версии зависимостей, отдельно установленных для разработки, могут отличаться.

Project / Проект: [Tone.js](https://tonejs.github.io/). Release source / Исходник выпуска: [Tone.js release commit](https://github.com/Tonejs/Tone.js/tree/d2d52ffa8803b35debd9f19f2da08ad1c3540de0). The musical example uses the project MIT license. / Музыкальный пример распространяется под MIT проекта.

## PixiJS 8.22.0

PixiJS is an optional 2D renderer under MIT. The pinned classic `dist/pixi.min.js` and official `dist/packages/unsafe-eval.min.js` compatibility module are downloaded separately. Despite its name, that module replaces generated functions with static implementations so PixiJS can run while CSP still blocks eval. Neither script is bundled with the editor. Embedded HTML, adjacent JavaScript and portable sets preserve the full [distribution notices](../src/vendor/pixi-LICENSE.txt).

PixiJS — необязательная библиотека 2D-отрисовки под MIT. Классическое ядро `dist/pixi.min.js` и официальный модуль совместимости `dist/packages/unsafe-eval.min.js` точной версии 8.22.0 скачиваются отдельно. Вопреки названию модуль заменяет генерацию функций статическими реализациями: запрет eval в предпросмотре сохраняется. В редактор входят только лицензии, а не эти JS-сборки. Встраивание, отдельные JS-файлы и переносимые наборы сохраняют полный файл уведомлений по ссылке выше.

The core distribution source map identifies eventemitter3, @pixi/colord, ismobilejs, earcut, parse-svg-path and tiny-lru. Their complete MIT, ISC and BSD-3-Clause notices, including the additional tiny-lru copyright carried by the distribution, are preserved. The compatibility module contains PixiJS code under the same MIT notice.

Карта исходников ядра указывает eventemitter3, @pixi/colord, ismobilejs, earcut, parse-svg-path и tiny-lru. Сохранены полные условия MIT, ISC и BSD-3-Clause, включая дополнительное уведомление tiny-lru из готового JS. Модуль совместимости содержит код PixiJS под той же MIT.

Project / Проект: [PixiJS](https://pixijs.com/). Core license / Лицензия ядра: [8.22.0](https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/LICENSE). The poster artwork and animation are authored for OneHTML Lab under the project MIT license. / Графика афиши и анимация созданы для OneHTML Lab и распространяются под MIT проекта.

## p5.js 2.3.4

p5.js is an optional creative-coding library under LGPL-2.1. Its classic distribution is downloaded separately. Full [library and bundled dependency notices](../src/vendor/p5-LICENSE.txt), including MIT, BSD and SGI permissions, accompany every prepared copy. Corresponding source files are downloaded directly from upstream and checked against metadata; the source archive is created in the browser and is not stored in this repository. p5.js belongs to the experimental catalog and is excluded from bulk download by default; the experimental-library checkbox enables it. The [source archive and build instructions](../src/vendor/p5-source.md) are preserved with embedded HTML, adjacent JS and portable sets; the editor can save the archive separately. p5.js code and source are not bundled with the editor. The composition is original project artwork under MIT; no p5 website examples or artwork are copied.

p5.js — экспериментальная библиотека творческого программирования под LGPL-2.1. Она скачивается отдельно по выбору и по умолчанию исключена из общей загрузки; галочка экспериментальных библиотек включает её в общий набор. Полные условия библиотеки и её зависимостей, архив исходников и файлы сборки сохраняются с каждой подготовленной копией. Исходники получаются непосредственно от разработчиков с проверкой контрольных сумм; архив создаётся в браузере и не хранится в репозитории OneHTML Lab. Архив можно скачать отдельно. В редактор входят уведомления и проверочные метаданные; сама композиция создана для проекта под MIT. Примеры и изображения сайта p5 не используются.

Project / Проект: [p5.js](https://p5js.org/). Source / Исходники: [v2.3.4](https://github.com/processing/p5.js/tree/v2.3.4). Licensing / Условия: [p5 copyright](https://p5js.org/copyright/).

## Rapier 0.21.0 and Havok 1.3.14 / Rapier и Havok

Rapier's compatible ES module embeds its WASM and uses the complete [Apache-2.0 license](../src/vendor/rapier-LICENSE.txt). Havok's UMD script and matching WASM use [MIT](../src/vendor/havok-LICENSE.txt); OneHTML Lab adds a wrapper to supply the unchanged WASM bytes locally. Both engines are optional downloads, not editor runtime dependencies. Cached, embedded, adjacent and portable copies retain dependencies and full notices. Babylon.js retains its separate Apache license and NOTICE.

Совместимый ES-модуль Rapier содержит WASM и распространяется под Apache-2.0. Havok включает UMD-скрипт и WASM под MIT; подготовленная копия получает оболочку для передачи неизменённого WASM без сети. Оба движка скачиваются отдельно. Кэш, встроенные и отдельные копии, переносимые наборы сохраняют зависимости и полные уведомления. У Babylon.js остаются собственные Apache-лицензия и NOTICE. Пример общей башни создан для проекта под MIT.

Projects / Проекты: [Rapier](https://rapier.rs/), [Havok for Babylon.js](https://github.com/BabylonJS/havok).

## model-viewer 4.4.0 and A-Frame 1.8.0 / model-viewer и A-Frame

The optional classic model-viewer distribution uses [Apache-2.0 with full bundled notices](../src/vendor/model-viewer-LICENSE.txt); A-Frame uses [MIT and its bundled component notices](../src/vendor/aframe-LICENSE.txt). The release source maps and lockfiles identify their Lit/Three.js and other bundled dependencies. These distributions contain their own Three.js renderer; a second Three.js download is unnecessary. They are not bundled with the editor. The project satellite, geometry and gallery artwork remain under MIT. No AR/VR service, compressed-model decoder or external gallery asset is enabled by these examples.

Классическая сборка model-viewer использует Apache-2.0, A-Frame — MIT; полные уведомления компонентов включены в файлы по ссылкам выше. Зависимости проверены по картам исходников и lock-файлам выпусков. Их собственная Three.js уже входит в сборки; второй экземпляр не нужен. Библиотеки скачиваются отдельно. Спутник, геометрия и оформление выставки распространяются под MIT проекта. В примерах не включены AR/VR-сервисы, декодеры сжатых моделей или внешние материалы выставки.

Projects / Проекты: [model-viewer](https://modelviewer.dev/), [A-Frame](https://aframe.io/).
