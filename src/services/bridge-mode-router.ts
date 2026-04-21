import http from 'http';

import { BridgeModeConfig } from '../config/bridge-mode-config.js';
import { getRuntimeConfigStore } from '../config/index.js';
import { handleAnthropicNativeMessage } from './modes/native-bridge/anthropic-native.js';
import { handleAnthropicPromptMessage } from './modes/prompt-emulation/anthropic-prompt.js';

export interface AnthropicModeHandlerContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  body: any;
  authKey: string;
  modelKey: string;
}

export type AnthropicModeHandler = (context: AnthropicModeHandlerContext) => Promise<void>;

export interface BridgeModeRouterDependencies {
  runtimeConfigStore?: {
    getCurrentConfig(): BridgeModeConfig;
  };
  nativeHandler?: AnthropicModeHandler;
  promptHandler?: AnthropicModeHandler;
}

export async function handleAnthropicMessageByConfiguredMode(
  context: AnthropicModeHandlerContext,
  deps: BridgeModeRouterDependencies = {},
): Promise<void> {
  const runtimeConfigStore = deps.runtimeConfigStore ?? getRuntimeConfigStore();
  const currentConfig = runtimeConfigStore.getCurrentConfig();

  const nativeHandler = deps.nativeHandler ?? (async currentContext => (
    handleAnthropicNativeMessage(
      currentContext.req,
      currentContext.res,
      currentContext.body,
      currentContext.authKey,
      currentContext.modelKey,
    )
  ));

  const promptHandler = deps.promptHandler ?? (async currentContext => (
    handleAnthropicPromptMessage(
      currentContext.req,
      currentContext.res,
      currentContext.body,
      currentContext.authKey,
      currentContext.modelKey,
    )
  ));

  if (currentConfig.anthropicToolMode === 'prompt_emulation') {
    return promptHandler(context);
  }

  return nativeHandler(context);
}
