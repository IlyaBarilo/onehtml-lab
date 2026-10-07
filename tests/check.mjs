import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^--release-tag=v\d+(?:\.\d+){0,3}$/.test(args[0]))) throw new Error('Use: node tests/check.mjs [--release-tag=v1.2.3]');
const tag = args[0]?.slice('--release-tag='.length);
const browsers = ['browser', 'stage7', 'workspace', 'editor', 'alternative-editor', 'syntax', 'comparison-game', 'ai-prompts', 'desktop', 'diagnostics', 'workshop', 'learning-examples', 'code-guide', 'media-examples', 'quality', 'readiness', 'network', 'library-bundle', 'module-libraries', 'media-assets', 'draft', 'previous', 'game-storage', 'reliability'];
const commands = [
  ['build.mjs', ...args],
  ['tests/build.mjs', ...(tag ? [tag] : [])],
  ['tests/unit.mjs'], ['tests/clean-copy.mjs'], ['tests/artifacts-test.mjs'],
  ...browsers.map(name => ['tests/run-browser.mjs', `tests/${name}.mjs`, ...(['network', 'draft', 'previous'].includes(name) ? [] : ['--engines=chromium'])])
];
for (const command of commands) {
  console.log(process.env.GITHUB_ACTIONS ? `::group::${command.join(' ')}` : `Checking: ${command.join(' ')}`);
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, command, { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
    child.on('error', error => { console.error(error); resolve(1); });
    child.on('close', value => resolve(value ?? 1));
  });
  if (process.env.GITHUB_ACTIONS) console.log('::endgroup::');
  if (code) { process.exitCode = code; break; }
}
