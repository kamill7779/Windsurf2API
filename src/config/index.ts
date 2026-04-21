import { config, log } from '../config.js';
import { RuntimeConfigStore, createRuntimeConfigStore } from './runtime-config.js';

let runtimeConfigStore: RuntimeConfigStore | null = null;

export function getRuntimeConfigStore(): RuntimeConfigStore {
  if (!runtimeConfigStore) {
    runtimeConfigStore = createRuntimeConfigStore(config.bridgeModeConfigPath, {
      onReload(nextConfig, previousConfig) {
        if (!nextConfig.logModeSwitch && !previousConfig.logModeSwitch) return;
        log.info('[Config] anthropic tool mode reloaded', {
          previous: previousConfig.anthropicToolMode,
          next: nextConfig.anthropicToolMode,
        });
      },
    });
  }

  return runtimeConfigStore;
}

export function closeRuntimeConfigStore(): void {
  runtimeConfigStore?.close();
  runtimeConfigStore = null;
}
