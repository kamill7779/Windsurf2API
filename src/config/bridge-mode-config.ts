export type AnthropicToolMode = 'native_bridge' | 'prompt_emulation';

export interface BridgeModeConfig {
  anthropicToolMode: AnthropicToolMode;
  hotReload: boolean;
  logModeSwitch: boolean;
}

export const DEFAULT_BRIDGE_MODE_CONFIG: BridgeModeConfig = {
  anthropicToolMode: 'native_bridge',
  hotReload: true,
  logModeSwitch: true,
};

const VALID_TOOL_MODES = new Set<AnthropicToolMode>([
  'native_bridge',
  'prompt_emulation',
]);

export function isAnthropicToolMode(value: unknown): value is AnthropicToolMode {
  return typeof value === 'string' && VALID_TOOL_MODES.has(value as AnthropicToolMode);
}

export function parseBridgeModeConfig(raw: unknown): BridgeModeConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Bridge mode config must be a JSON object');
  }

  const input = raw as Record<string, unknown>;
  const anthropicToolMode = input.anthropicToolMode;
  if (!isAnthropicToolMode(anthropicToolMode)) {
    throw new Error(`Unsupported anthropicToolMode: ${String(anthropicToolMode)}`);
  }

  const hotReload = typeof input.hotReload === 'boolean'
    ? input.hotReload
    : DEFAULT_BRIDGE_MODE_CONFIG.hotReload;
  const logModeSwitch = typeof input.logModeSwitch === 'boolean'
    ? input.logModeSwitch
    : DEFAULT_BRIDGE_MODE_CONFIG.logModeSwitch;

  return {
    anthropicToolMode,
    hotReload,
    logModeSwitch,
  };
}
