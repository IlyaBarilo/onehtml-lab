// Read GLB metadata as data. A model is rendered only inside the game sandbox.
const glbType = 'model/gltf-binary';
const glbExtensions = new Set(['KHR_materials_unlit', 'KHR_texture_transform', 'KHR_materials_clearcoat',
  'KHR_materials_ior', 'KHR_materials_transmission', 'KHR_materials_specular', 'KHR_materials_volume',
  'KHR_materials_emissive_strength', 'KHR_materials_sheen', 'KHR_materials_iridescence',
  'KHR_materials_anisotropy', 'KHR_mesh_quantization', 'KHR_lights_punctual', 'EXT_mesh_gpu_instancing']);

function glbInfo(bytes) {
  const invalid = () => { throw Error('Не удалось прочитать GLB 2.0: проверьте целостность модели.'); };
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) invalid();
  let offset = 12, json = null, binary = null;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.length) invalid();
    if (offset === 12 && type !== 0x4e4f534a) invalid();
    if (type === 0x4e4f534a) {
      if (json) invalid();
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 8, offset + 8 + length))); }
      catch { invalid(); }
    } else if (type === 0x004e4942) { if (binary) invalid(); binary = bytes.subarray(offset + 8, offset + 8 + length); }
    offset += 8 + length;
  }
  if (json?.asset?.version !== '2.0' || !Array.isArray(json.meshes) || !json.meshes.length) invalid();
  const buffers = json.buffers || [], images = json.images || [], views = json.bufferViews || [];
  if (!Array.isArray(buffers) || !Array.isArray(images) || !Array.isArray(views)) invalid();
  if (buffers.some(buffer => buffer?.uri) || images.some(image => image?.uri && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(image.uri))) {
    throw Error('Модель ссылается на внешние файлы. Экспортируйте GLB с текстурами и геометрией внутри.');
  }
  if (buffers.length !== 1 || !binary || !Number.isSafeInteger(buffers[0]?.byteLength)
    || buffers[0].byteLength < 1 || buffers[0].byteLength > binary.length || binary.length - buffers[0].byteLength > 3) invalid();
  for (const item of views) {
    const start = item?.byteOffset ?? 0;
    if (item?.buffer !== 0 || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(item.byteLength)
      || item.byteLength < 0 || start + item.byteLength > buffers[0].byteLength) invalid();
  }
  for (const image of images) if (!image || !image.uri && (!views[image.bufferView] || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType))) invalid();
  const unsupported = new Set();
  const pending = [json];
  while (pending.length) {
    const value = pending.pop();
    if (!Array.isArray(value) && value.extensions && typeof value.extensions === 'object') {
      for (const extension of Object.keys(value.extensions)) if (!glbExtensions.has(extension)) unsupported.add(extension);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (json[key] && (!Array.isArray(json[key]) || json[key].some(value => typeof value !== 'string'))) invalid();
    for (const extension of json[key] || []) if (!glbExtensions.has(extension)) unsupported.add(extension);
  }
  if (unsupported.size) throw Error('Модели нужны дополнительные расширения: ' + [...unsupported].join(', ') + '. Экспортируйте обычный GLB без Draco, Meshopt и KTX2.');
  return { meshes: json.meshes.length, animations: Array.isArray(json.animations) ? json.animations.length : 0,
    copyright: typeof json.asset.copyright === 'string' ? json.asset.copyright : '' };
}

function modelSummary(entry) {
  return entry?.type === glbType ? `GLB · геометрий: ${formatUIInteger(entry.model?.meshes || 0)} · анимаций: ${formatUIInteger(entry.model?.animations || 0)}` : '';
}
function appendModelDetails(container, entry) {
  if (entry.type !== glbType) return;
  const icon = document.createElement('span'); icon.className = 'media-model-icon'; icon.textContent = '3D'; icon.setAttribute('aria-hidden', 'true'); container.append(icon);
  const note = document.createElement('p'); note.className = 'diagnostic-note'; note.textContent = modelSummary(entry); container.append(note);
  if (entry.model?.copyright) { const credit = document.createElement('p'); credit.className = 'diagnostic-note'; credit.textContent = entry.model.copyright; container.append(credit); }
}

function modelPromptInstructions(engine = '', existing = false) {
  const connection = '<div id="model-source" data-model-src="имя.glb" hidden></div>';
  let text = `Для каждой GLB-модели добавь ${connection} с её исходным URL-кодированным именем и отдельным id. Возьми адрес через getAttribute("data-model-src") и передай загрузчику. OneHTML Lab подставит data URL при запуске и сохранении. Не записывай имя модели в JavaScript и не кодируй файл самостоятельно. Дождись загрузки, обработай ошибку, подгони камеру под габариты и дай вращать модель касанием или мышью.`;
  if (existing) text += ' Сохрани существующий 3D-движок и его версию; не подключай второй движок.';
  if (engine === 'babylon') text += ' Для Babylon.js 9.30.0 подключи после ядра обычный скрипт https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.30.0/babylon.glTF2FileLoader.min.js. Загружай data URL через BABYLON.SceneLoader.ImportMeshAsync(null, "", url, scene, undefined, ".glb"). Не добавляй декодеры или другие расширения.';
  else if (!existing || engine === 'three') text += ' Используй Three.js r160 как ES-модуль: importmap с "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"; импортируй GLTFLoader из "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js". В script type="module" используй import * as THREE from "three" и import { GLTFLoader } from точной ссылки. Не подключай классический THREE второй раз. Загружай через new GLTFLoader().loadAsync(url). Не добавляй Draco, Meshopt или KTX2.';
  return text;
}
