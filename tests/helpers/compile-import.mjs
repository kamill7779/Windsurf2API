import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP_DIR = path.resolve('.tmp-test-build');
const TSC_CLI_PATH = path.resolve('node_modules', 'typescript', 'bin', 'tsc');

export function resetCompiledTestModules() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

export async function compileAndImportTsModule(entryRelativePath) {
  const entryPath = path.resolve(entryRelativePath);
  const compile = spawnSync(
    process.execPath,
    [
      TSC_CLI_PATH,
      '--pretty',
      'false',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      '--resolveJsonModule',
      'true',
      '--esModuleInterop',
      'true',
      '--skipLibCheck',
      'true',
      '--rootDir',
      '.',
      '--outDir',
      TMP_DIR,
      entryPath,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );

  if (compile.status !== 0) {
    if (compile.error) {
      throw compile.error;
    }
    throw new Error(
      `tsc failed for ${entryRelativePath}\n${compile.stdout || ''}\n${compile.stderr || ''}`.trim(),
    );
  }

  const outputPath = path.resolve(
    TMP_DIR,
    entryRelativePath.replace(/\.ts$/, '.js').replaceAll('/', path.sep),
  );

  return import(pathToFileURL(outputPath).href + `?t=${Date.now()}`);
}
