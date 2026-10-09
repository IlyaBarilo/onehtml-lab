import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { browserGroups, parseCheckOptions, checkCommands } from './check-plan.mjs';

const full = checkCommands(parseCheckOptions([]));
const names = full.filter(command => command[0] === 'tests/run-browser.mjs').map(command => command[1]);
assert.equal(new Set(names).size, names.length, 'Full browser checks must not be duplicated');
const grouped = Object.keys(browserGroups).flatMap(group => checkCommands(parseCheckOptions([`--group=${group}`])))
  .filter(command => command[0] === 'tests/run-browser.mjs').map(command => command[1]);
assert.deepEqual(grouped.sort(), [...names].sort(), 'Release groups must cover the complete browser suite exactly once');
const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const matrixGroups = workflow.match(/group: \[([a-z, ]+)\]/)?.[1].split(',').map(value => value.trim());
assert.deepEqual(matrixGroups?.sort(), Object.keys(browserGroups).sort(), 'The release workflow must run every declared group');
for (const command of full) for (const argument of command.filter(value => value.endsWith('.mjs'))) {
  assert(existsSync(new URL(`../${argument}`, import.meta.url)), `Missing planned check: ${argument}`);
}
for (const args of [[], ['--quick'], ...Object.keys(browserGroups).map(group => [`--group=${group}`, '--release-tag=v1.2.3'])]) {
  const child = spawnSync(process.execPath, ['tests/check.mjs', ...args, '--list'], { encoding: 'utf8', cwd: new URL('../', import.meta.url) });
  assert.equal(child.status, 0, child.stderr);
  const plan = JSON.parse(child.stdout);
  assert.deepEqual(plan.commands, checkCommands(parseCheckOptions(args)), 'The actual CLI must use the declared plan');
  if (args.includes('--release-tag=v1.2.3')) {
    assert.deepEqual(plan.commands[0], ['build.mjs', '--release-tag=v1.2.3']);
    assert.deepEqual(plan.commands[1], ['tests/build.mjs', 'v1.2.3']);
    assert(!plan.quick, 'Release validation must never use the quick plan');
  }
}
for (const args of [['--quick', '--group=core'], ['--quick', '--release-tag=v1.2.3'], ['--group=unknown'], ['--group=core', '--group=ai'], ['--release-tag=main'], ['--list', '--list'], ['--unknown']]) {
  const child = spawnSync(process.execPath, ['tests/check.mjs', ...args], { encoding: 'utf8', cwd: new URL('../', import.meta.url) });
  assert.notEqual(child.status, 0, 'Invalid arguments must fail before running checks');
  assert.match(child.stderr, /Use: node tests\/check\.mjs/);
}
console.log('Quick/release routing, complete nonduplicated groups, pinned tags and CLI argument guards passed.');
