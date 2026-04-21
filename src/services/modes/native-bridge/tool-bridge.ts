import { WindsurfClient } from '../../../core/client.js';
import {
  BashToolResultInput,
  ToolBridgeSession,
  ToolBridgeSubmissionResult,
} from '../../../types.js';
import {
  createToolBridgeSession,
  findToolBridgeSessionByToolCallId,
  getToolBridgeSession,
} from './tool-bridge-store.js';
import { collectCascadeContinuation } from './tool-bridge-runtime.js';
import { submitBashToolResultViaInteraction } from './tool-bridge-interaction.js';
import { submitBashToolResultViaLegacy } from './tool-bridge-legacy.js';

function getBridgeMode(): 'interaction' | 'legacy' {
  return process.env.WINDSURF_TOOL_BRIDGE_PATH === 'legacy' ? 'legacy' : 'interaction';
}

async function collectContinuation(
  client: WindsurfClient,
  cascadeId: string,
  stepOffset: number,
): Promise<{
  advanced: boolean;
  text: string;
  thinking: string;
  observation: ToolBridgeSubmissionResult['observation'];
}> {
  return collectCascadeContinuation(client, cascadeId, stepOffset);
}

export {
  createToolBridgeSession,
  getToolBridgeSession,
  findToolBridgeSessionByToolCallId,
};

export async function submitBashToolResult(args: {
  payload: BashToolResultInput;
  port: number;
  csrfToken: string;
}): Promise<ToolBridgeSubmissionResult> {
  if (getBridgeMode() === 'legacy') {
    return submitBashToolResultViaLegacy({ ...args, collectContinuation });
  }

  const primary = await submitBashToolResultViaInteraction({ ...args, collectContinuation });
  if (primary.accepted) {
    return primary;
  }

  const fallback = await submitBashToolResultViaLegacy({ ...args, collectContinuation });
  return fallback.accepted ? fallback : primary;
}

export type { ToolBridgeSession };
