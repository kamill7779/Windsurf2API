import { existsSync, readFileSync, watch, FSWatcher } from 'fs';
import { basename, dirname } from 'path';
import {
  BridgeModeConfig,
  DEFAULT_BRIDGE_MODE_CONFIG,
  parseBridgeModeConfig,
} from './bridge-mode-config.js';

export function readBridgeModeConfigFile(
  filePath: string,
  previousConfig: BridgeModeConfig = DEFAULT_BRIDGE_MODE_CONFIG,
): BridgeModeConfig {
  if (!existsSync(filePath)) {
    return previousConfig === DEFAULT_BRIDGE_MODE_CONFIG
      ? { ...DEFAULT_BRIDGE_MODE_CONFIG }
      : { ...previousConfig };
  }

  try {
    const rawText = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(rawText);
    return parseBridgeModeConfig(parsed);
  } catch {
    return { ...previousConfig };
  }
}

export interface RuntimeConfigStoreOptions {
  hotReload?: boolean;
  reloadDebounceMs?: number;
  onReload?: (nextConfig: BridgeModeConfig, previousConfig: BridgeModeConfig) => void;
}

export interface RuntimeConfigStore {
  getCurrentConfig(): BridgeModeConfig;
  reloadNow(): BridgeModeConfig;
  close(): void;
}

function cloneBridgeModeConfig(config: BridgeModeConfig): BridgeModeConfig {
  return {
    anthropicToolMode: config.anthropicToolMode,
    hotReload: config.hotReload,
    logModeSwitch: config.logModeSwitch,
  };
}

function bridgeModeConfigsEqual(left: BridgeModeConfig, right: BridgeModeConfig): boolean {
  return left.anthropicToolMode === right.anthropicToolMode
    && left.hotReload === right.hotReload
    && left.logModeSwitch === right.logModeSwitch;
}

export function createRuntimeConfigStore(
  filePath: string,
  options: RuntimeConfigStoreOptions = {},
): RuntimeConfigStore {
  let currentConfig = readBridgeModeConfigFile(filePath);
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  const debounceMs = Math.max(0, options.reloadDebounceMs ?? 100);

  const applyReload = (): BridgeModeConfig => {
    const previousConfig = currentConfig;
    const nextConfig = readBridgeModeConfigFile(filePath, previousConfig);
    if (!bridgeModeConfigsEqual(previousConfig, nextConfig)) {
      currentConfig = cloneBridgeModeConfig(nextConfig);
      options.onReload?.(cloneBridgeModeConfig(currentConfig), cloneBridgeModeConfig(previousConfig));
    }
    return cloneBridgeModeConfig(currentConfig);
  };

  const scheduleReload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      applyReload();
    }, debounceMs);
  };

  const shouldWatch = options.hotReload ?? currentConfig.hotReload;
  if (shouldWatch && existsSync(dirname(filePath))) {
    const targetName = basename(filePath);
    watcher = watch(dirname(filePath), (_eventType, filename) => {
      const changedName = typeof filename === 'string' ? filename : '';
      if (changedName && changedName !== targetName) return;
      scheduleReload();
    });
  }

  return {
    getCurrentConfig(): BridgeModeConfig {
      return cloneBridgeModeConfig(currentConfig);
    },
    reloadNow(): BridgeModeConfig {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return applyReload();
    },
    close(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher?.close();
      watcher = null;
    },
  };
}
