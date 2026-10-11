import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const fixtureCatalog = {
  p5: ['p5@2.3.4/lib/p5.min.js', 'bb8b82b97fcbcd5bb2d5475d1b6a3904f3ab4ed01b821134fd8f1e7710fce559'],
  havok: ['@babylonjs/havok@1.3.14/lib/umd/HavokPhysics_umd.js', '8ffcf3b71f434e489275699abda074baa841c50c4fbcdf18a7fa94cdb998e590'],
  wasm: ['@babylonjs/havok@1.3.14/lib/umd/HavokPhysics.wasm', '026917766f534c156286f07975850978dabf17c42e742bbfaaebbcb2215e4e11'],
  rapier: ['@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs', '02dc6a4e2fffc013bab08fbb44fa68f501d8303615e9afe4c7d89ad4eedda0d0'],
  model: ['@google/model-viewer@4.4.0/dist/model-viewer-umd.min.js', 'd785423b1d046ea84a9f59ef6cf15f3077603e1bf938b01ced9b0240691884a2'],
  aframe: ['aframe@1.8.0/dist/aframe-v1.8.0.min.js', '40d5a4d63c67d8c50842bf3c36a06995cad712d0675c8e5d2eb4dbae38b7481f']
};
export const fixtureDirectory = join(tmpdir(), 'onehtml-additional-library-fixtures');
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export async function additionalFixtures() {
  await mkdir(fixtureDirectory, {recursive:true});
  return Object.fromEntries(await Promise.all(Object.entries(fixtureCatalog).map(async ([name,[file,hash]]) => {
    const path = join(fixtureDirectory, hash); let bytes;
    try { bytes = await readFile(path); } catch {}
    if (!bytes || hashBytes(bytes) !== hash) {
      const response = await fetch('https://cdn.jsdelivr.net/npm/' + file, {signal:AbortSignal.timeout(90000)});
      if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hashBytes(bytes) !== hash) throw Error(`${name}: distribution hash mismatch`);
      await writeFile(path, bytes);
    }
    return [name,bytes];
  })));
}
