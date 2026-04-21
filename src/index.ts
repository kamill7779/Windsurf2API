/**
 * Windsurf2API entrypoint.
 */

import { config, log } from './config.js';
import { closeRuntimeConfigStore } from './config/index.js';
import { startLanguageServer, stopLanguageServer } from './core/langserver.js';
import { startServer } from './server.js';
import { initChannels } from './services/channel.js';
import { initTokens } from './services/token.js';
import { initStats } from './services/stats.js';

async function main() {
  console.log(`
  __      __        __       __    _    ____ ___
  \\ \\    / /__ _ __/ _|_   _/ /   / \\  |  _ \\_ _|
   \\ \\/\\/ / _ \\ '_ \\ |\\ \\ / / /   / _ \\ | |_) | |
    \\  V /  __/ | | | |\\ V / /___/ ___ \\|  __/| |
     \\_/ \\___|_| |_|_| \\_/|_____/_/   \\_\\_|  |___|

  Windsurf2API - Windsurf-to-OpenAI/Anthropic API Proxy
`);

  initChannels();
  initTokens();
  initStats();

  try {
    await startLanguageServer({
      binaryPath: config.lsBinaryPath,
      port: config.lsPort,
      apiServerUrl: config.apiServerUrl,
    });
  } catch (err: any) {
    log.error('Language server failed to start:', err.message);
    log.error('Chat completions will not work.');
  }

  const server = startServer(config.port);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down...`);
    server.close(() => {
      closeRuntimeConfigStore();
      stopLanguageServer();
      process.exit(0);
    });
    setTimeout(() => {
      log.warn('Force exit');
      closeRuntimeConfigStore();
      stopLanguageServer();
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
