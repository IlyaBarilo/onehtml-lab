export const browserGroups = Object.freeze({
  core: ['browser', 'workspace', 'editor', 'alternative-editor', 'syntax', 'desktop'],
  ai: ['ai-prompts', 'ai-session', 'preview-picker', 'quality', 'workshop', 'comparison-game', 'learning-examples'],
  libraries: ['stage7', 'network', 'library-bundle', 'module-libraries', 'library-preparation', 'model-assets', 'physics-libraries', 'babylon-libraries', 'native-technologies', 'diagnostics', 'game-storage', 'code-guide'],
  media: ['media-assets', 'media-examples', 'readiness', 'draft', 'previous', 'reliability']
});
const usage = 'Use: node tests/check.mjs [--quick | --group=core|ai|libraries|media] [--release-tag=v1.2.3] [--list]';
export function parseCheckOptions(args) {
  const options = { quick: false, group: null, tag: null, list: false };
  const seen = new Set();
  for (const argument of args) {
    const key = argument.split('=')[0];
    if (seen.has(key)) throw new Error(usage);
    seen.add(key);
    if (argument === '--quick') options.quick = true;
    else if (argument === '--list') options.list = true;
    else if (argument.startsWith('--group=') && Object.hasOwn(browserGroups, argument.slice(8))) options.group = argument.slice(8);
    else if (/^--release-tag=v\d+(?:\.\d+){0,3}$/.test(argument)) options.tag = argument.slice(14);
    else throw new Error(usage);
  }
  if (options.quick && (options.group || options.tag)) throw new Error(usage);
  return options;
}
export function checkCommands(options) {
  const commands = [
    ['build.mjs', ...(options.tag ? [`--release-tag=${options.tag}`] : [])],
    ['tests/build.mjs', ...(options.tag ? [options.tag] : [])]
  ];
  if (!options.group || options.group === 'core') commands.push(
    ['tests/unit.mjs'], ['tests/clean-copy.mjs'], ['tests/check-plan-test.mjs'], ['tests/artifacts-test.mjs']
  );
  if (options.quick) return [...commands,
    ['tests/run-browser.mjs', 'tests/browser.mjs', '--engines=chromium', '--http'],
    ['tests/run-browser.mjs', 'tests/smoke.mjs', '--engines=chromium'],
    ['tests/run-browser.mjs', 'tests/draft.mjs']
  ];
  const browsers = options.group ? browserGroups[options.group] : Object.values(browserGroups).flat();
  return [...commands, ...browsers.map(name => ['tests/run-browser.mjs', `tests/${name}.mjs`,
    ...(['network', 'draft', 'previous'].includes(name) ? [] : ['--engines=chromium'])
  ])];
}
