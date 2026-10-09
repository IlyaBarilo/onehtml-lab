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
const fullTrace = process.env.ONEHTML_CAPTURE_TRACE === '1';
async function run(folder, retry = false) {
  await mkdir(folder, { recursive: true });
  const log = createWriteStream(join(folder, 'output.log'));
  const child = spawn(process.execPath, ['--import', new URL('./capture.mjs', import.meta.url).href, script, ...args], {
    cwd: root, env: { ...process.env, ONEHTML_ARTIFACT_DIR: folder, TEST_RESULTS_DIR: folder,
      ONEHTML_CAPTURE_TRACE: fullTrace || retry ? '1' : '0', ONEHTML_DIAGNOSTIC_RETRY: retry ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => { process.stdout.write(data); log.write(data); });
  child.stderr.on('data', data => { process.stderr.write(data); log.write(data); });
  const result = await new Promise(resolve => {
    child.on('error', error => { const message = String(error); console.error(message); log.write(message); resolve({ code: 1, signal: null }); });
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  log.end(); await finished(log);
  return result;
}
const { code, signal } = await run(output);
if (code === 0) {
  if (!resolve(output).startsWith(base + sep)) throw new Error('Unexpected artifact path');
  await rm(output, { recursive: true, force: true });
} else {
  if (!fullTrace && !signal && code > 0 && code < 128) {
    console.error('Diagnostic retry with full trace; the original failure remains the result.');
    const retry = await run(join(output, 'trace-retry'), true);
    console.error(`Diagnostic retry ${retry.code ? 'failed' : 'passed'}; original exit code: ${code}.`);
  }
  console.error(`Browser failure artifacts: ${output}`);
}
process.exitCode = code;
