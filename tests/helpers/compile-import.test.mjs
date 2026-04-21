import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from './compile-import.mjs';

test('compile helper isolates reset + compile cycles so concurrent test tasks do not share one output directory', async () => {
  const compileConfig = async () => {
    resetCompiledTestModules();
    return compileAndImportTsModule('src/config/runtime-config.ts');
  };

  const compileNativeBridge = async () => {
    resetCompiledTestModules();
    return compileAndImportTsModule('src/services/modes/native-bridge/tool-bridge.ts');
  };

  const [configModule, nativeBridgeModule] = await Promise.all([
    compileConfig(),
    compileNativeBridge(),
  ]);

  assert.equal(typeof configModule.createRuntimeConfigStore, 'function');
  assert.equal(typeof nativeBridgeModule.submitBashToolResult, 'function');
});
