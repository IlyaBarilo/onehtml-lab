import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist', 'pages');
await mkdir(output, { recursive: true });
await copyFile(join(root, 'onehtml-lab.html'), join(output, 'index.html'));
console.log('Prepared dist/pages/index.html from onehtml-lab.html.');
