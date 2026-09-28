import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const extensions = new Set(['.mjs', '.js', '.css', '.html', '.svg', '.md', '.json', '.yml']);
const topLevel = ['.github', 'docs', 'scripts', 'src', 'tests', 'LICENSE', 'README.md', 'build.mjs', 'onehtml-lab.html', 'package.json', 'package-lock.json'];

async function format(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) await format(target);
    else if (extensions.has('.' + entry.name.split('.').pop())) await normalize(target);
  }
}

async function normalize(path) {
  const source = await readFile(path, 'utf8');
  const formatted = source.replace(/\r?\n/g, '\r\n');
  if (formatted !== source) await writeFile(path, formatted, 'utf8');
}

for (const name of topLevel) {
  const target = join(root, name);
  if (['.github', 'docs', 'scripts', 'src', 'tests'].includes(name)) await format(target);
  else await normalize(target);
}
for (const name of process.argv.slice(2)) {
  const target = resolve(root, name);
  if (!target.startsWith(root + sep)) throw new Error(`Path outside project: ${name}`);
  await normalize(target);
}
