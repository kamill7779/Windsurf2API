import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP_ROOT_DIR = path.resolve('.tmp-test-build');
const TSC_CLI_PATH = path.resolve('node_modules', 'typescript', 'bin', 'tsc');
const ownedSessionRoots = new Set();

let sessionRoot = '';
let compileCounter = 0;

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function allocateSessionRoot() {
  ensureDir(TMP_ROOT_DIR);

  const root = path.join(
    TMP_ROOT_DIR,
    `worker-${process.pid}-session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  ensureDir(root);
  ownedSessionRoots.add(root);
  return root;
}

function getCurrentSessionRoot() {
  if (!sessionRoot) {
    sessionRoot = allocateSessionRoot();
  }
  return sessionRoot;
}

export function resetCompiledTestModules() {
  sessionRoot = allocateSessionRoot();
  compileCounter = 0;
}

export async function compileAndImportTsModule(entryRelativePath) {
  const entryPath = path.resolve(entryRelativePath);
  const outputRoot = path.join(getCurrentSessionRoot(), `build-${compileCounter++}`);
  ensureDir(outputRoot);
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
      outputRoot,
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
    outputRoot,
    entryRelativePath.replace(/\.ts$/, '.js').replaceAll('/', path.sep),
  );

  return import(pathToFileURL(outputPath).href + `?t=${Date.now()}`);
}

process.once('exit', () => {
  for (const root of ownedSessionRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});
