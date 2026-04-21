import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from '../helpers/compile-import.mjs';

test.beforeEach(() => {
  resetCompiledTestModules();
});

function createRuntimeConfigStore(initialMode = 'native_bridge') {
  const state = { mode: initialMode };
  return {
    getCurrentConfig() {
      return {
        anthropicToolMode: state.mode,
        hotReload: true,
        logModeSwitch: true,
      };
    },
    setMode(nextMode) {
      state.mode = nextMode;
    },
  };
}

test('bridge mode router dispatches to the native handler when config is native_bridge', async () => {
  const mod = await compileAndImportTsModule('src/services/bridge-mode-router.ts');
  const store = createRuntimeConfigStore('native_bridge');
  const calls = [];

  await mod.handleAnthropicMessageByConfiguredMode(
    {
      req: { headers: {} },
      res: {},
      body: { model: 'claude-sonnet-4-6' },
      authKey: 'sk-test',
      modelKey: 'claude-sonnet-4-6',
    },
    {
      runtimeConfigStore: store,
      nativeHandler: async context => {
        calls.push(`native:${context.modelKey}`);
      },
      promptHandler: async () => {
        calls.push('prompt');
      },
    },
  );

  assert.deepEqual(calls, ['native:claude-sonnet-4-6']);
});

test('bridge mode router dispatches to the prompt handler when config is prompt_emulation', async () => {
  const mod = await compileAndImportTsModule('src/services/bridge-mode-router.ts');
  const store = createRuntimeConfigStore('prompt_emulation');
  const calls = [];

  await mod.handleAnthropicMessageByConfiguredMode(
    {
      req: { headers: {} },
      res: {},
      body: { model: 'claude-sonnet-4-6' },
      authKey: 'sk-test',
      modelKey: 'claude-sonnet-4-6',
    },
    {
      runtimeConfigStore: store,
      nativeHandler: async () => {
        calls.push('native');
      },
      promptHandler: async context => {
        calls.push(`prompt:${context.modelKey}`);
      },
    },
  );

  assert.deepEqual(calls, ['prompt:claude-sonnet-4-6']);
});

test('bridge mode router applies config changes to subsequent requests only', async () => {
  const mod = await compileAndImportTsModule('src/services/bridge-mode-router.ts');
  const store = createRuntimeConfigStore('native_bridge');
  const calls = [];

  const deps = {
    runtimeConfigStore: store,
    nativeHandler: async context => {
      calls.push(`native:${context.body.requestId}`);
    },
    promptHandler: async context => {
      calls.push(`prompt:${context.body.requestId}`);
    },
  };

  await mod.handleAnthropicMessageByConfiguredMode(
    {
      req: { headers: {} },
      res: {},
      body: { model: 'claude-sonnet-4-6', requestId: 'one' },
      authKey: 'sk-test',
      modelKey: 'claude-sonnet-4-6',
    },
    deps,
  );

  store.setMode('prompt_emulation');

  await mod.handleAnthropicMessageByConfiguredMode(
    {
      req: { headers: {} },
      res: {},
      body: { model: 'claude-sonnet-4-6', requestId: 'two' },
      authKey: 'sk-test',
      modelKey: 'claude-sonnet-4-6',
    },
    deps,
  );

  assert.deepEqual(calls, ['native:one', 'prompt:two']);
});
