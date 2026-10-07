import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv.find(value => value.startsWith('--probe='))?.slice(8);
if (mode) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent('<h1>Browser capture probe</h1><button>Ready</button>');
      await page.getByRole('button').click();
      if (mode === 'failure') throw new Error('Expected artifact probe failure');
    } finally { await context.close(); }
  } finally { await browser.close(); }
} else {
  const output = await mkdtemp(join(tmpdir(), 'onehtml-artifact-probe-'));
  try {
    async function probe(value) {
      return new Promise(resolve => {
        const child = spawn(process.execPath, ['tests/run-browser.mjs', 'tests/artifacts-test.mjs', `--probe=${value}`], {
          cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, ONEHTML_TEST_RESULTS: output }, stdio: ['ignore', 'pipe', 'pipe']
        });
        let logs = '';
        child.stdout.on('data', data => { logs += data; });
        child.stderr.on('data', data => { logs += data; });
        child.on('error', error => resolve({ code: 1, logs: String(error) }));
        child.on('close', code => resolve({ code, logs }));
      });
    }
    const failed = await probe('failure');
    assert.equal(failed.code, 1, failed.logs);
    assert.match(failed.logs, /Expected artifact probe failure/);
    const [folder] = await readdir(output);
    const [context] = (await readdir(join(output, folder))).filter(name => name.startsWith('context-'));
    assert(context, failed.logs);
    assert((await readFile(join(output, folder, context, 'trace.zip'))).length > 1000);
    assert.equal((await readFile(join(output, folder, context, 'page-1.png'))).subarray(1, 4).toString(), 'PNG');
    assert.match(await readFile(join(output, folder, 'output.log'), 'utf8'), /Expected artifact probe failure/);
    const passed = await probe('success');
    assert.equal(passed.code, 0, passed.logs);
    assert.deepEqual(await readdir(output), [folder], 'A successful suite removes its temporary captures');
    console.log('Failed browser checks preserve screenshots, trace and logs; successful checks clean their captures.');
  } finally {
    assert(resolve(output).startsWith(resolve(tmpdir()) + sep) && output.includes('onehtml-artifact-probe-'));
    await rm(output, { recursive: true, force: true });
  }
}
