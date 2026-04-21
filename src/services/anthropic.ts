/**
 * Anthropic Messages API compatibility layer
 * Converts Anthropic /v1/messages to Windsurf Cascade flow
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { log } from '../config.js';
import { getCsrfToken, getLsPort } from '../core/langserver.js';
import { resolveModel, getModelInfo } from '../models.js';
import { runChatCore, runToolMockCore, ChatError, ToolMockResult } from './chat.js';
import {
  findToolBridgeSessionByToolCallId,
  getToolBridgeSession,
  submitBashToolResult,
} from './modes/native-bridge/tool-bridge.js';
import {
  buildAnthropicToolUnsupportedError,
  extractSupportedAnthropicMockTools,
  filterAnthropicToolInput,
  hasAnthropicToolMessages,
  hasAnthropicToolInput,
  SupportedAnthropicMockTool,
} from './modes/native-bridge/tool-support.js';

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function anthropicEvent(res: http.ServerResponse, event: string, data: object) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getApiKey(req: http.IncomingMessage): string | null {
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey) return String(xApiKey);
  const auth = req.headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function extractAnthropicTextContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(block => block && typeof block === 'object' && block.type === 'text')
      .map(block => String(block.text || ''))
      .join('\n');
  }
  return String(content ?? '');
}

function extractAnthropicResultText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (!block || typeof block !== 'object') return String(block ?? '');
        if (block.type === 'text') return String(block.text || '');
        return JSON.stringify(block);
      })
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.stdout === 'string') return content.stdout;
    if (typeof content.output === 'string') return content.output;
    if (typeof content.text === 'string') return content.text;
    if (typeof content.result === 'string') return content.result;
  }
  return String(content ?? '');
}

function extractAnthropicResultStderr(content: any): string {
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    if (typeof content.stderr === 'string') return content.stderr;
    if (typeof content.error === 'string') return content.error;
  }
  return '';
}

function extractAnthropicResultExitCode(content: any): number | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  for (const key of ['exitCode', 'exit_code', 'code']) {
    const value = (content as any)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function extractLatestAnthropicToolResult(body: any): {
  toolUseId: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  success?: boolean;
} | null {
  if (!Array.isArray(body?.messages)) return null;

  for (let i = body.messages.length - 1; i >= 0; i--) {
    const message = body.messages[i];
    const content = Array.isArray(message?.content) ? message.content : [];
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue;
      const toolUseId = String(block.tool_use_id || block.toolUseId || '').trim();
      if (!toolUseId) continue;
      const exitCode = extractAnthropicResultExitCode(block.content);
      const contentSuccess = block.content && typeof block.content === 'object'
        ? (block.content as any).success
        : undefined;
      const success = typeof block.is_error === 'boolean'
        ? !block.is_error
        : (typeof contentSuccess === 'boolean'
            ? !!contentSuccess
            : (exitCode == null ? undefined : exitCode === 0));
      return {
        toolUseId,
        stdout: extractAnthropicResultText(block.content),
        stderr: extractAnthropicResultStderr(block.content),
        exitCode,
        success,
      };
    }
  }

  return null;
}

function computeAnthropicUsage(messages: any[], text: string): { promptTokens: number; completionTokens: number } {
  const promptChars = messages.reduce((sum, message) => {
    return sum + extractAnthropicTextContent(message?.content).length;
  }, 0);
  return {
    promptTokens: Math.ceil(promptChars / 4),
    completionTokens: Math.ceil(text.length / 4),
  };
}

/**
 * Convert Anthropic messages to plain text conversation history.
 */
function convertMessages(anthropicMessages: any[], systemPrompt?: string): any[] {
  const messages: any[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of anthropicMessages) {
    messages.push({
      role: msg.role,
      content: extractAnthropicTextContent(msg.content),
    });
  }
  return messages;
}

function writeAnthropicTextResponse(
  res: http.ServerResponse,
  body: any,
  result: { text: string; modelInfo: { name: string }; promptTokens: number; completionTokens: number },
) {
  const stream = !!body.stream;
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const msgId = 'msg_' + randomUUID().replace(/-/g, '');

    anthropicEvent(res, 'message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: body.model || result.modelInfo.name,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: result.promptTokens, output_tokens: 0 },
      },
    });

    anthropicEvent(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });

    const chunkSize = 20;
    for (let i = 0; i < result.text.length; i += chunkSize) {
      const chunk = result.text.slice(i, i + chunkSize);
      anthropicEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: chunk },
      });
    }

    anthropicEvent(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    });

    anthropicEvent(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: result.completionTokens },
    });

    anthropicEvent(res, 'message_stop', { type: 'message_stop' });
    res.end();
    return;
  }

  const msgId = 'msg_' + randomUUID().replace(/-/g, '');
  json(res, 200, {
    id: msgId,
    type: 'message',
    role: 'assistant',
    model: body.model || result.modelInfo.name,
    content: [
      { type: 'text', text: result.text },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: result.promptTokens,
      output_tokens: result.completionTokens,
    },
  });
}

function writeAnthropicToolMockResponse(
  res: http.ServerResponse,
  body: any,
  result: ToolMockResult,
  supportedTools: SupportedAnthropicMockTool[],
) {
  const toolCall = result.toolCall;
  if (!toolCall) {
    return writeAnthropicTextResponse(res, body, result);
  }

  const requestedTool = supportedTools.find(tool => tool.name === toolCall.name);
  const filteredInput = requestedTool
    ? filterAnthropicToolInput(toolCall.input, requestedTool.inputSchema)
    : toolCall.input;

  const stream = !!body.stream;
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const msgId = 'msg_' + randomUUID().replace(/-/g, '');
    anthropicEvent(res, 'message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        model: body.model || result.modelInfo.name,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: result.promptTokens, output_tokens: 0 },
      },
    });

    anthropicEvent(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: {},
      },
    });

    anthropicEvent(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify(filteredInput),
      },
    });

    anthropicEvent(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    });

    anthropicEvent(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: result.completionTokens },
    });

    anthropicEvent(res, 'message_stop', { type: 'message_stop' });
    res.end();
    return;
  }

  const msgId = 'msg_' + randomUUID().replace(/-/g, '');
  json(res, 200, {
    id: msgId,
    type: 'message',
    role: 'assistant',
    model: body.model || result.modelInfo.name,
    content: [
      {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: filteredInput,
      },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: result.promptTokens,
      output_tokens: result.completionTokens,
    },
    w2a: result.bridgeId ? { bridge_id: result.bridgeId, experimental: true } : undefined,
  });
}

export async function handleAnthropicMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: any,
): Promise<void> {
  try {
    const authKey = getApiKey(req);
    if (!authKey) {
      return json(res, 401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'Missing x-api-key header' },
      });
    }

    const modelKey = resolveModel(body.model);
    if (!modelKey) {
      return json(res, 404, {
        type: 'error',
        error: { type: 'not_found_error', message: `Model "${body.model}" not found` },
      });
    }

    const toolResult = extractLatestAnthropicToolResult(body);
    if (toolResult) {
      const explicitBridgeId = typeof body?.w2a?.bridge_id === 'string' ? body.w2a.bridge_id : '';
      const bridge = explicitBridgeId
        ? getToolBridgeSession(explicitBridgeId)
        : findToolBridgeSessionByToolCallId(toolResult.toolUseId, authKey);

      if (!bridge) {
        return json(res, 404, {
          type: 'error',
          error: {
            type: 'not_found_error',
            message: `Tool bridge session not found for ${toolResult.toolUseId}`,
          },
        });
      }

      const continuation = await submitBashToolResult({
        payload: {
          bridgeId: bridge.id,
          toolCallId: toolResult.toolUseId,
          stdout: toolResult.stdout,
          stderr: toolResult.stderr,
          exitCode: toolResult.exitCode,
          success: toolResult.success,
        },
        port: getLsPort(),
        csrfToken: getCsrfToken(),
      });

      if (!continuation.accepted) {
        return json(res, 500, {
          type: 'error',
          error: {
            type: 'api_error',
            message: continuation.error || 'Tool bridge continuation failed',
          },
          w2a: {
            bridge_id: bridge.id,
            bridge_path: continuation.bridgePath,
            submitted_command_line: continuation.submittedCommandLine,
          },
        });
      }

      const bridgeModelInfo = getModelInfo(bridge.modelKey);
      if (!bridgeModelInfo) {
        return json(res, 500, {
          type: 'error',
          error: { type: 'api_error', message: `Unknown bridge model "${bridge.modelKey}"` },
        });
      }

      const usage = computeAnthropicUsage(body.messages || [], continuation.text);
      return writeAnthropicTextResponse(res, body, {
        text: continuation.text,
        modelInfo: bridgeModelInfo,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
    }

    const messages = convertMessages(body.messages || [], body.system);
    const supportedTools = extractSupportedAnthropicMockTools(body);

    if (hasAnthropicToolMessages(body)) {
      return json(res, 501, buildAnthropicToolUnsupportedError());
    }

    if (Array.isArray(body?.tools) && body.tools.length > 0) {
      if (supportedTools.length === 0 || !hasAnthropicToolInput(body)) {
        return json(res, 501, buildAnthropicToolUnsupportedError());
      }

      const result = await runToolMockCore(
        messages,
        modelKey,
        authKey,
        new Set(supportedTools.map(tool => tool.name)),
      );
      return writeAnthropicToolMockResponse(res, body, result, supportedTools);
    }

    const result = await runChatCore(messages, modelKey, authKey);
    return writeAnthropicTextResponse(res, body, result);
  } catch (err: any) {
    if (err instanceof ChatError) {
      json(res, err.statusCode, {
        type: 'error',
        error: {
          type: err.statusCode === 401 ? 'authentication_error' :
                err.statusCode === 429 ? 'rate_limit_error' : 'api_error',
          message: err.message,
        },
      });
    } else {
      log.error('Anthropic API error:', err.message);
      json(res, 500, {
        type: 'error',
        error: { type: 'api_error', message: err.message },
      });
    }
  }
}
