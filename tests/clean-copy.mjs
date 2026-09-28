import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-clean-'));
try {
  await cp(join(root, 'src'), join(scratch, 'src'), { recursive: true });
  await mkdir(join(scratch, 'tests'));
  for (const file of ['build.mjs', 'package.json', 'LICENSE']) await cp(join(root, file), join(scratch, file));
  for (const file of ['paste.mjs', 'share.mjs', 'build.mjs']) await cp(join(root, 'tests', file), join(scratch, 'tests', file));
  for (const script of [['build.mjs'], ['tests/build.mjs'], ['tests/paste.mjs'], ['tests/share.mjs']]) {
    const result = spawnSync(process.execPath, script, { cwd: scratch, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script[0]} failed in clean copy:\n${result.stdout}\n${result.stderr}`);
  }
  console.log('Build and core checks passed in a copy without local/ or node_modules/.');
} finally {
  const tempRoot = resolve(tmpdir());
  assert(resolve(scratch).startsWith(tempRoot + sep) && scratch.includes('onehtml-lab-clean-'));
  await rm(scratch, { recursive: true, force: true });
}
