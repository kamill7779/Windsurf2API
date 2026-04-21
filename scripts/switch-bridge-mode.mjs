import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_MODES = new Set(['native_bridge', 'prompt_emulation']);

const DEFAULT_CONFIG = {
  anthropicToolMode: 'native_bridge',
  hotReload: true,
  logModeSwitch: true,
};

function resolveConfigPath(explicitPath) {
  return explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(process.cwd(), 'config', 'bridge-mode.json');
}

export async function readBridgeModeConfig(configPath) {
  const resolvedPath = resolveConfigPath(configPath);
  try {
    const raw = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

export async function writeBridgeModeConfig(mode, options = {}) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported bridge mode "${mode}". Expected one of: ${Array.from(VALID_MODES).join(', ')}`);
  }

  const configPath = resolveConfigPath(options.configPath);
  const current = await readBridgeModeConfig(configPath);
  const next = {
    ...current,
    anthropicToolMode: mode,
  };

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  return {
    configPath,
    previousMode: current.anthropicToolMode,
    nextMode: next.anthropicToolMode,
    config: next,
  };
}

function parseCliArgs(argv) {
  let mode = '';
  let configPath;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!mode && !arg.startsWith('--')) {
      mode = arg;
      continue;
    }
    if (arg === '--config') {
      configPath = argv[i + 1];
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mode, configPath, help: false };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help || !args.mode) {
    console.log('Usage: node scripts/switch-bridge-mode.mjs <native_bridge|prompt_emulation> [--config <path>]');
    process.exit(args.help ? 0 : 1);
  }

  const result = await writeBridgeModeConfig(args.mode, { configPath: args.configPath });
  console.log(`[bridge-mode] ${result.previousMode} -> ${result.nextMode}`);
  console.log(`[bridge-mode] config: ${result.configPath}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(error => {
    console.error(`[bridge-mode] ${error.message}`);
    process.exit(1);
  });
}
