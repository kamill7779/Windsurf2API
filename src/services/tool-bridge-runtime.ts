import { WindsurfClient } from '../core/client.js';
import { ToolBridgeObservation } from '../types.js';

export function safeParseJson(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function buildCombinedOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) return `${stdout}\n${stderr}`;
  return stdout || stderr || '';
}

function quoteForSingleShellString(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

export function buildEchoCommand(stdout: string, stderr: string, exitCode: number): string {
  const quotedStdout = quoteForSingleShellString(stdout);
  const quotedStderr = quoteForSingleShellString(stderr);

  if (!stderr && exitCode === 0) {
    return `printf '%s' '${quotedStdout}'`;
  }

  const parts: string[] = [];
  parts.push(`printf '%s' '${quotedStdout}'`);
  if (stderr) {
    parts.push(`printf '%s' '${quotedStderr}' >&2`);
  }
  parts.push(`exit ${Number.isFinite(exitCode) ? exitCode : 0}`);
  return `(${parts.join('; ')})`;
}

export async function collectCascadeContinuation(
  client: WindsurfClient,
  cascadeId: string,
  stepOffset: number,
): Promise<{
  advanced: boolean;
  text: string;
  thinking: string;
  observation: ToolBridgeObservation;
}> {
  let fullText = '';
  let fullThinking = '';
  const stepKinds = new Set<string>();
  const toolNames = new Set<string>();
  let stepCount = stepOffset;
  let advanced = false;

  for await (const chunk of client.streamCascade(cascadeId, stepOffset, 30_000)) {
    if (chunk.text) fullText += chunk.text;
    if (chunk.thinking) fullThinking += chunk.thinking;
    if (chunk.stepKind) stepKinds.add(chunk.stepKind);
    if (Array.isArray(chunk.toolCalls)) {
      for (const toolCall of chunk.toolCalls) {
        if (toolCall.name) toolNames.add(toolCall.name);
      }
    }
    if (typeof chunk.stepIndex === 'number') {
      stepCount = Math.max(stepCount, chunk.stepIndex + 1);
      advanced = true;
    }
  }

  return {
    advanced: advanced || fullText.length > 0 || fullThinking.length > 0,
    text: fullText,
    thinking: fullThinking,
    observation: {
      status: 1,
      newStepKinds: [...stepKinds],
      newToolNames: [...toolNames],
      stepCount,
    },
  };
}
