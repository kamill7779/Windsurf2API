import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from '../helpers/compile-import.mjs';

test.beforeEach(() => {
  resetCompiledTestModules();
});

test('runtime config falls back to native_bridge defaults when file is missing', async () => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-bridge-mode-'));
  const missingPath = path.join(tempDir, 'bridge-mode.json');

  const result = mod.readBridgeModeConfigFile(missingPath);

  assert.equal(result.anthropicToolMode, 'native_bridge');
  assert.equal(result.hotReload, true);
  assert.equal(result.logModeSwitch, true);

  rmSync(tempDir, { recursive: true, force: true });
});

test('runtime config accepts prompt_emulation mode from JSON', async () => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-bridge-mode-'));
  const configPath = path.join(tempDir, 'bridge-mode.json');

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: false,
      logModeSwitch: false,
    }),
  );

  const result = mod.readBridgeModeConfigFile(configPath);

  assert.equal(result.anthropicToolMode, 'prompt_emulation');
  assert.equal(result.hotReload, false);
  assert.equal(result.logModeSwitch, false);

  rmSync(tempDir, { recursive: true, force: true });
});

test('runtime config keeps the last known-good value when a later file is invalid', async () => {
  const mod = await compileAndImportTsModule('src/config/runtime-config.ts');
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'w2a-bridge-mode-'));
  const configPath = path.join(tempDir, 'bridge-mode.json');

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'prompt_emulation',
      hotReload: true,
      logModeSwitch: true,
    }),
  );
  const previous = mod.readBridgeModeConfigFile(configPath);

  writeFileSync(
    configPath,
    JSON.stringify({
      anthropicToolMode: 'broken_mode',
      hotReload: true,
      logModeSwitch: false,
    }),
  );

  const result = mod.readBridgeModeConfigFile(configPath, previous);

  assert.deepEqual(result, previous);
  assert.equal(readFileSync(configPath, 'utf8').includes('broken_mode'), true);

  rmSync(tempDir, { recursive: true, force: true });
});
