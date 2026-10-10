import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'onehtml-lab-clean-'));
const textExtensions = new Set(['.mjs', '.js', '.html', '.css', '.svg', '.json', '.txt']);
async function convertCheckoutToLF(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await convertCheckoutToLF(path);
    else if (textExtensions.has(extname(path)) || entry.name === 'LICENSE') await writeFile(path, (await readFile(path, 'utf8')).replace(/\r\n/g, '\n'), 'utf8');
  }
}
try {
  await cp(join(root, 'src'), join(scratch, 'src'), { recursive: true });
  await mkdir(join(scratch, 'tests'));
  for (const file of ['build.mjs', 'package.json', 'LICENSE']) await cp(join(root, file), join(scratch, file));
  for (const file of (await readdir(join(root, 'tests'))).filter(file => file.endsWith('.mjs'))) await cp(join(root, 'tests', file), join(scratch, 'tests', file));
  await mkdir(join(scratch, '.github', 'workflows'), { recursive: true });
  await cp(join(root, '.github', 'workflows', 'release.yml'), join(scratch, '.github', 'workflows', 'release.yml'));
  const scripts = [['build.mjs'], ['tests/build.mjs'], ['tests/paste.mjs'], ['tests/share.mjs'], ['tests/library-paths.mjs'], ['tests/library-package.mjs'], ['tests/library-extract.mjs'], ['tests/media-assets-unit.mjs'], ['tests/model-assets-unit.mjs'], ['tests/media-prompts-unit.mjs'], ['tests/media-images-unit.mjs'], ['tests/ai-applications-unit.mjs'], ['tests/ai-session-unit.mjs'], ['tests/ai-profiles-unit.mjs'], ['tests/check-plan-test.mjs']];
  for (const script of scripts) {
    const result = spawnSync(process.execPath, script, { cwd: scratch, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script[0]} failed in clean copy:\n${result.stdout}\n${result.stderr}`);
  }
  console.log('Build and core checks passed in a copy without local/ or node_modules/.');
  await convertCheckoutToLF(scratch);
  for (const script of scripts) {
    const result = spawnSync(process.execPath, script, { cwd: scratch, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script[0]} failed with LF checkout files:\n${result.stdout}\n${result.stderr}`);
  }
  console.log('Build and core checks passed with LF checkout files, matching Linux CI line endings.');
  const artifactPath = join(scratch, 'onehtml-lab.html');
  const artifact = await readFile(artifactPath, 'utf8');
  const licenses = await readFile(join(scratch, 'src/vendor/codemirror-LICENSE.txt'), 'utf8');
  const copyrightLine = licenses.split('\n').find(line => line.startsWith('Copyright'));
  assert(copyrightLine && artifact.includes(copyrightLine));
  await writeFile(artifactPath, artifact.replace(copyrightLine, ''), 'utf8');
  const incomplete = spawnSync(process.execPath, ['tests/build.mjs'], { cwd: scratch, encoding: 'utf8' });
  assert.notEqual(incomplete.status, 0, 'Missing copyright must fail the build check');
  assert.match(incomplete.stderr, /All CodeMirror copyright and permission notices/);
  console.log('The license check still rejects missing copyright text.');
} finally {
  const tempRoot = resolve(tmpdir());
  assert(resolve(scratch).startsWith(tempRoot + sep) && scratch.includes('onehtml-lab-clean-'));
  await rm(scratch, { recursive: true, force: true });
}
