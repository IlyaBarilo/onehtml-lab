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

Project / Проект: [Babylon.js](https://www.babylonjs.com/). Exact release / Точный выпуск: [9.30.0](https://github.com/BabylonJS/Babylon.js/releases/tag/9.30.0). GUI, Havok, inspector and WebGPU are not part of the supported profile. / GUI, Havok, инспектор и WebGPU в поддерживаемый профиль не входят.

## GLB loaders and sample / Загрузчики GLB и пример

Three.js r160 GLTFLoader and BufferGeometryUtils use the same full MIT notice as the Three.js package. Babylon.js loaders 9.30.0 use [Apache-2.0](licenses/babylonjs-loaders-9.30.0-LICENSE.txt). These optional modules are downloaded separately and are not bundled with the editor. Embedded and adjacent copies retain their full licenses; Babylon loader copies also carry the Babylon project NOTICE linked above. The loader npm package does not supply a separate NOTICE file.

GLTFLoader и BufferGeometryUtils версии Three.js r160 используют полный текст MIT из пакета Three.js. Загрузчики Babylon.js 9.30.0 распространяются под Apache-2.0 по ссылке выше. Эти необязательные компоненты скачиваются отдельно и не входят в редактор. Встроенные и отдельные копии сохраняют полные лицензии; к загрузчику Babylon также добавляется NOTICE проекта Babylon по ссылке выше. Отдельного NOTICE в npm-пакете загрузчика нет.

The satellite model, its texture and animation are authored for OneHTML Lab and covered by the project MIT license. User-supplied models retain their own terms; importing a model does not relicense it.

Модель спутника, текстура и анимация созданы для OneHTML Lab и распространяются под MIT проекта. Загруженные пользователем модели сохраняют собственные условия использования; добавление модели не меняет её лицензию.

## cannon-es 0.20.0

cannon-es is an optional 3D physics library under [MIT](licenses/cannon-es-0.20.0-LICENSE.txt). The pinned ES module is downloaded separately and is not bundled with the editor. Cached, embedded and adjacent copies retain the full copyright and permission notice. The package provides the actual distribution used by browser checks.

cannon-es — необязательная библиотека 3D-физики под MIT. Поддерживается ES-модуль точной версии 0.20.0; он скачивается отдельно и не включён в редактор. Кэш, встроенные и отдельные копии сохраняют полный текст лицензии с авторскими правами. npm-пакет предоставляет настоящий дистрибутив для браузерных проверок.

Project / Проект: [cannon-es](https://github.com/pmndrs/cannon-es). The tower example and library benchmark use the project's MIT license. / Пример башни и тест работы библиотек распространяются под MIT проекта.
