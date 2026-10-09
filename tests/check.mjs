import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCheckOptions, checkCommands } from './check-plan.mjs';
const options = parseCheckOptions(process.argv.slice(2));
const commands = checkCommands(options);
if (options.list) { console.log(JSON.stringify({ ...options, commands }, null, 2)); }
else {
  const results = [], started = performance.now();
  for (const command of commands) {
    const before = performance.now();
    console.log(process.env.GITHUB_ACTIONS ? `::group::${command.join(' ')}` : `Checking: ${command.join(' ')}`);
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, command, { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
      child.on('error', error => { console.error(error); resolve(1); });
      child.on('close', value => resolve(value ?? 1));
    });
    if (process.env.GITHUB_ACTIONS) console.log('::endgroup::');
    const seconds = (performance.now() - before) / 1000;
    results.push({ command: command.join(' '), code, seconds });
    console.log(`${code ? 'FAIL' : 'PASS'} ${command.join(' ')} (${seconds.toFixed(1)} s)`);
    if (code) {
      if (process.env.GITHUB_ACTIONS) console.error(`::error title=Check failed::${command.join(' ')} failed; expand its log group for details.`);
      process.exitCode = code; break;
    }
  }
  const total = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`Checks ${process.exitCode ? 'failed' : 'passed'}: ${options.quick ? 'quick' : options.group || 'full'}, ${total} s`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Checks: ${options.quick ? 'quick' : options.group || 'full'}\n\n| Check | Result | Seconds |\n| --- | --- | ---: |\n` +
    results.map(result => `| \`${result.command}\` | ${result.code ? 'FAIL' : 'PASS'} | ${result.seconds.toFixed(1)} |`).join('\n') +
    `\n\nTotal: **${total} s**. ${process.exitCode ? 'Failed; later checks in this group were not run.' : 'Passed.'}\n\n`
  );
}
