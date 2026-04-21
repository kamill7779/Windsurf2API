import { existsSync, readFileSync } from 'fs';
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
