import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from '../helpers/compile-import.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error('Timed out waiting for hot reload state');
}

test.beforeEach(() => {
  resetCompiledTestModules();
});

test('hot reload updates current mode after the config file changes', async (t) => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-runtime-config-'));
  const configPath = path.join(tempDir, 'bridge-mode.json');
  const reloads = [];

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'native_bridge',
      hotReload: true,
      logModeSwitch: true,
    }),
  );

  const store = mod.createRuntimeConfigStore(configPath, {
    reloadDebounceMs: 40,
    onReload(nextConfig, previousConfig) {
      reloads.push({
        from: previousConfig.anthropicToolMode,
        to: nextConfig.anthropicToolMode,
      });
    },
  });

  t.after(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: true,
      logModeSwitch: true,
    }),
  );

  await waitFor(() => store.getCurrentConfig().anthropicToolMode === 'prompt_emulation');

  assert.equal(store.getCurrentConfig().anthropicToolMode, 'prompt_emulation');
  assert.deepEqual(reloads, [{ from: 'native_bridge', to: 'prompt_emulation' }]);
});

test('hot reload keeps the last good value when the updated file is malformed', async (t) => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-runtime-config-'));
  const configPath = path.join(tempDir, 'bridge-mode.json');

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: true,
      logModeSwitch: true,
    }),
  );

  const store = mod.createRuntimeConfigStore(configPath, {
    reloadDebounceMs: 40,
  });

  t.after(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  writeFileSync(configPath, '{this is not valid json');
  await sleep(200);

  assert.equal(store.getCurrentConfig().anthropicToolMode, 'prompt_emulation');
});

test('hot reload debounces rapid writes into one effective state transition', async (t) => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-runtime-config-'));
  const configPath = path.join(tempDir, 'bridge-mode.json');
  const reloads = [];

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'native_bridge',
      hotReload: true,
      logModeSwitch: true,
    }),
  );

  const store = mod.createRuntimeConfigStore(configPath, {
    reloadDebounceMs: 80,
    onReload(nextConfig, previousConfig) {
      reloads.push(`${previousConfig.anthropicToolMode}->${nextConfig.anthropicToolMode}`);
    },
  });

  t.after(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: true,
      logModeSwitch: true,
    }),
  );
  await sleep(10);
  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: true,
      logModeSwitch: false,
    }),
  );

  await waitFor(() => store.getCurrentConfig().logModeSwitch === false);

  assert.equal(store.getCurrentConfig().anthropicToolMode, 'prompt_emulation');
  assert.equal(store.getCurrentConfig().logModeSwitch, false);
  assert.equal(reloads.length, 1);
});
