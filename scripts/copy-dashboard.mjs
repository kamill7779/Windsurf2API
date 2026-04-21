import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const sourceDir = resolve(rootDir, 'src', 'dashboard');
const targetDir = resolve(rootDir, 'dist', 'dashboard');

if (!existsSync(sourceDir)) {
  console.warn(`[copy-dashboard] source directory not found: ${sourceDir}`);
  process.exit(0);
}

mkdirSync(resolve(rootDir, 'dist'), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });
console.log(`[copy-dashboard] copied ${sourceDir} -> ${targetDir}`);
