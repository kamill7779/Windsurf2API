import { resolve } from 'path';

/**
 * Global config and logger.
 */

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  lsBinaryPath: process.env.LS_BINARY_PATH || '/opt/windsurf/language_server_linux_x64',
  lsPort: parseInt(process.env.LS_PORT || '42100', 10),
  apiServerUrl: process.env.API_SERVER_URL || 'https://server.self-serve.windsurf.com',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  bridgeModeConfigPath: process.env.BRIDGE_MODE_CONFIG_PATH || resolve(process.cwd(), 'config', 'bridge-mode.json'),
};

export const log = {
  debug: (...args: any[]) => console.log('[DEBUG]', ...args),
  info: (...args: any[]) => console.log('[INFO]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};
