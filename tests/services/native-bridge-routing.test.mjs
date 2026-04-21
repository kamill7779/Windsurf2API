import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from '../helpers/compile-import.mjs';

test.beforeEach(() => {
  resetCompiledTestModules();
});

test('native bridge module exports submitBashToolResult from the mode-specific directory', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/native-bridge/tool-bridge.ts');

  assert.equal(typeof mod.submitBashToolResult, 'function');
  assert.equal(typeof mod.createToolBridgeSession, 'function');
  assert.equal(typeof mod.getToolBridgeSession, 'function');
});

test('native bridge tool support module is available from the mode-specific directory', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/native-bridge/tool-support.ts');

  assert.equal(typeof mod.NATIVE_TOOL_BRIDGE_MESSAGE, 'string');
  assert.match(mod.NATIVE_TOOL_BRIDGE_MESSAGE, /minimal Anthropic Bash native tool bridge/i);
});
