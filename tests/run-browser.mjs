import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [script, ...args] = process.argv.slice(2);
if (!/^tests\/[a-z0-9-]+\.mjs$/.test(script || '')) throw new Error('Use: node tests/run-browser.mjs tests/name.mjs [arguments]');
const base = resolve(process.env.ONEHTML_TEST_RESULTS || join(tmpdir(), 'onehtml-lab-checks'));
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, basename(script, '.mjs') + '-'));
const log = createWriteStream(join(output, 'output.log'));
const child = spawn(process.execPath, ['--import', new URL('./capture.mjs', import.meta.url).href, script, ...args], {
  cwd: root, env: { ...process.env, ONEHTML_ARTIFACT_DIR: output, TEST_RESULTS_DIR: output }, stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', data => { process.stdout.write(data); log.write(data); });
child.stderr.on('data', data => { process.stderr.write(data); log.write(data); });
const code = await new Promise(resolve => {
  child.on('error', error => { console.error(error); resolve(1); });
  child.on('close', value => resolve(value ?? 1));
});
log.end();
await finished(log);
if (code === 0) {
  if (!resolve(output).startsWith(base + sep)) throw new Error('Unexpected artifact path');
  await rm(output, { recursive: true, force: true });
} else console.error(`Browser failure artifacts: ${output}`);
process.exitCode = code;
