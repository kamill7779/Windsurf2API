/**
 * Chat completions + Responses business logic
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { log } from '../config.js';
import { ChatRequest } from '../types.js';
import { resolveModel, getModelInfo, ModelInfo } from '../models.js';
import { pickChannel, markChannelError, markChannelSuccess } from './channel.js';
import { Channel } from '../types.js';
import { validateToken, isModelAllowedForToken, consumeQuota } from './token.js';
import { recordRequest } from './stats.js';
import { WindsurfClient, ChatChunk } from '../core/client.js';
import { getLsPort, getCsrfToken } from '../core/langserver.js';
import { PlannerMode } from '../core/windsurf.js';
import {
  buildOpenAIToolUnsupportedError,
  hasOpenAIToolInput,
  hasResponsesToolInput,
} from './tool-support.js';
import { createToolBridgeSession } from './tool-bridge.js';

// ─── Shared core: auth → pick channel → stream → collect ───

export interface ChatResult {
  text: string;
  thinking: string;
  modelInfo: ModelInfo;
  modelKey: string;
  channel: Channel;
  authKey: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ToolMockCall {
  id: string;
  name: 'Bash' | 'Write';
  input: Record<string, any>;
  rawName: string;
  rawArgumentsJson: string;
}

export interface ToolMockResult extends ChatResult {
  toolCall: ToolMockCall | null;
  bridgeId: string | null;
}

export class ChatError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}

function computeUsage(messages: any[], text: string) {
  const promptTokens = Math.ceil(messages.reduce((s, m) =>
    s + (typeof m.content === 'string' ? m.content.length : 0), 0) / 4);
  const completionTokens = Math.ceil(text.length / 4);
  return { promptTokens, completionTokens, tokensUsed: promptTokens + completionTokens };
}

function generateToolCallId(): string {
  return 'toolu_' + randomUUID().replace(/-/g, '').slice(0, 24);
}

function mapWindsurfToolCall(rawName: string, rawArgumentsJson: string): ToolMockCall | null {
  let parsedArgs: any = {};
  try {
    parsedArgs = rawArgumentsJson ? JSON.parse(rawArgumentsJson) : {};
  } catch {
    parsedArgs = {};
  }

  if (rawName === 'run_command') {
    const command = parsedArgs.command || parsedArgs.commandLine || parsedArgs.command_line;
    if (!command) return null;
    return {
      id: '',
      name: 'Bash',
      input: {
        command,
        cwd: parsedArgs.cwd || parsedArgs.workdir || parsedArgs.working_directory || '',
      },
      rawName,
      rawArgumentsJson,
    };
  }

  if (rawName === 'write_to_file') {
    const filePath = parsedArgs.file_path || parsedArgs.path || parsedArgs.TargetFile;
    const content = parsedArgs.content || parsedArgs.contents || parsedArgs.CodeContent;
    if (!filePath || content == null) return null;
    return {
      id: '',
      name: 'Write',
      input: {
        file_path: filePath,
        content,
      },
      rawName,
      rawArgumentsJson,
    };
  }

  return null;
}

export async function runChatCore(
  messages: any[], modelKey: string, authKey: string
): Promise<ChatResult> {
  const tokenCheck = validateToken(authKey);
  if (!tokenCheck.valid) {
    throw new ChatError(tokenCheck.error || 'Unauthorized', 401);
  }

  const modelInfo = getModelInfo(modelKey);
  if (!modelInfo) {
    throw new ChatError(`Model "${modelKey}" not found`, 404);
  }

  if (tokenCheck.token && !isModelAllowedForToken(tokenCheck.token, modelKey)) {
    throw new ChatError(`Model "${modelKey}" not allowed for this key`, 403);
  }

  const ch = pickChannel();
  if (!ch) {
    throw new ChatError('All channels rate limited or in error state', 429);
  }

  const client = new WindsurfClient(ch.apiKey, getLsPort(), getCsrfToken());
  const gen = client.streamChat(messages, modelInfo.enumValue, modelInfo.modelUid!);

  let fullText = '';
  let fullThinking = '';
  for await (const chunk of gen) {
    if (chunk.text) fullText += chunk.text;
    if (chunk.thinking) fullThinking += chunk.thinking;
  }

  const { promptTokens, completionTokens, tokensUsed } = computeUsage(messages, fullText);

  markChannelSuccess(ch.apiKey);
  consumeQuota(authKey, tokensUsed);
  recordRequest({ model: modelKey, channelId: ch.id, tokenKey: authKey, tokensUsed });

  return {
    text: fullText,
    thinking: fullThinking,
    modelInfo,
    modelKey,
    channel: ch,
    authKey,
    promptTokens,
    completionTokens,
  };
}

export async function runToolMockCore(
  messages: any[],
  modelKey: string,
  authKey: string,
  allowedTools: Set<string>,
): Promise<ToolMockResult> {
  const tokenCheck = validateToken(authKey);
  if (!tokenCheck.valid) {
    throw new ChatError(tokenCheck.error || 'Unauthorized', 401);
  }

  const modelInfo = getModelInfo(modelKey);
  if (!modelInfo) {
    throw new ChatError(`Model "${modelKey}" not found`, 404);
  }

  if (tokenCheck.token && !isModelAllowedForToken(tokenCheck.token, modelKey)) {
    throw new ChatError(`Model "${modelKey}" not allowed for this key`, 403);
  }

  const ch = pickChannel();
  if (!ch) {
    throw new ChatError('All channels rate limited or in error state', 429);
  }

  const client = new WindsurfClient(ch.apiKey, getLsPort(), getCsrfToken());
  const gen = client.streamChat(messages, modelInfo.enumValue, modelInfo.modelUid!, {
    plannerMode: PlannerMode.DEFAULT,
  });

  let fullText = '';
  let fullThinking = '';
  let toolCall: ToolMockCall | null = null;
  let proposalRawStep: Buffer | null = null;
  let proposalStepIndex = -1;
  let proposalTrajectoryId = '';
  let proposedCommandLine = '';

  for await (const chunk of gen) {
    if (chunk.text) fullText += chunk.text;
    if (chunk.thinking) fullThinking += chunk.thinking;

    if (!toolCall && Array.isArray(chunk.toolCalls)) {
      for (const rawCall of chunk.toolCalls) {
        const mapped = mapWindsurfToolCall(rawCall.name, rawCall.argumentsJson);
        if (!mapped || !allowedTools.has(mapped.name)) continue;
        toolCall = {
          ...mapped,
          id: rawCall.id || generateToolCallId(),
        };
        proposalRawStep = chunk.rawStep || null;
        proposalStepIndex = typeof chunk.stepIndex === 'number' ? chunk.stepIndex : -1;
        proposalTrajectoryId = chunk.trajectoryId || '';
        proposedCommandLine = String(mapped.input.command || '');
        break;
      }
    }

    if (!toolCall && chunk.runCommand && allowedTools.has('Bash')) {
      const command = chunk.runCommand.commandLine || chunk.runCommand.proposedCommandLine;
      if (command) {
        toolCall = {
          id: chunk.runCommand.commandId || generateToolCallId(),
          name: 'Bash',
          input: {
            command,
            cwd: chunk.runCommand.cwd || '',
          },
          rawName: 'run_command',
          rawArgumentsJson: JSON.stringify({
            command,
            cwd: chunk.runCommand.cwd || '',
          }),
        };
        proposalRawStep = chunk.rawStep || null;
        proposalStepIndex = typeof chunk.stepIndex === 'number' ? chunk.stepIndex : -1;
        proposalTrajectoryId = chunk.trajectoryId || '';
        proposedCommandLine = command;
      }
    }

    if (toolCall) break;
  }

  const usageText = toolCall ? JSON.stringify(toolCall.input) : fullText;
  const { promptTokens, completionTokens, tokensUsed } = computeUsage(messages, usageText);

  let bridgeId: string | null = null;
  if (toolCall && proposalRawStep) {
    const sessionInfo = client.getSessionInfo();
    if (sessionInfo.cascadeId && (proposalTrajectoryId || sessionInfo.trajectoryId)) {
      const bridge = createToolBridgeSession({
        downstreamAuthKey: authKey,
        channelId: ch.id,
        upstreamApiKey: ch.apiKey,
        modelKey,
        modelUid: modelInfo.modelUid,
        modelEnum: modelInfo.enumValue,
        sessionId: sessionInfo.sessionId,
        cascadeId: sessionInfo.cascadeId,
        trajectoryId: proposalTrajectoryId || sessionInfo.trajectoryId || '',
        plannerMode: PlannerMode.DEFAULT,
        proposalStepIndex,
        proposalStepCount: proposalStepIndex >= 0 ? proposalStepIndex + 1 : 0,
        proposalStep: proposalRawStep,
        proposalToolCallId: toolCall.id,
        proposalToolName: toolCall.rawName,
        proposalArgumentsJson: toolCall.rawArgumentsJson,
        proposedCommandLine,
        mockToolName: toolCall.name,
      });
      bridgeId = bridge.id;
    }
  }

  markChannelSuccess(ch.apiKey);
  consumeQuota(authKey, tokensUsed);
  recordRequest({ model: modelKey, channelId: ch.id, tokenKey: authKey, tokensUsed });

  return {
    text: fullText,
    thinking: fullThinking,
    modelInfo,
    modelKey,
    channel: ch,
    authKey,
    promptTokens,
    completionTokens,
    toolCall,
    bridgeId,
  };
}

// ─── /v1/chat/completions ───

export async function handleChatCompletion(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: ChatRequest,
  authKey: string
): Promise<void> {
  try {
    if (!Array.isArray(body.messages)) {
      return json(res, 400, { error: 'messages must be an array' });
    }

    if (hasOpenAIToolInput(body)) {
      return json(res, 501, buildOpenAIToolUnsupportedError());
    }

    const modelKey = resolveModel(body.model);
    if (!modelKey) {
      return json(res, 404, { error: `Model "${body.model}" not found` });
    }

    const result = await runChatCore(body.messages, modelKey, authKey);
    const stream = !!body.stream;
    const chatId = 'chatcmpl-' + randomUUID().replace(/-/g, '').slice(0, 20);
    const created = Math.floor(Date.now() / 1000);

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      sse(res, {
        id: chatId,
        object: 'chat.completion.chunk',
        created,
        model: result.modelInfo.name,
        choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
      });
      sse(res, {
        id: chatId,
        object: 'chat.completion.chunk',
        created,
        model: result.modelInfo.name,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      json(res, 200, {
        id: chatId,
        object: 'chat.completion',
        created,
        model: result.modelInfo.name,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.text },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.promptTokens + result.completionTokens,
        },
      });
    }
  } catch (err: any) {
    if (err instanceof ChatError) {
      json(res, err.statusCode, { error: err.message });
    } else {
      log.error('Chat error:', err.message);
      json(res, 500, { error: err.message });
    }
  }
}

// ─── /v1/responses ───

export async function handleResponse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: any,
  authKey: string
): Promise<void> {
  try {
    if (hasResponsesToolInput(body)) {
      return json(res, 501, buildOpenAIToolUnsupportedError());
    }

    const messages: any[] = [];

    if (body.instructions) {
      messages.push({ role: 'system', content: body.instructions });
    }

    if (typeof body.input === 'string') {
      messages.push({ role: 'user', content: body.input });
    } else if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (typeof item === 'string') {
          messages.push({ role: 'user', content: item });
        } else if (item && typeof item === 'object') {
          if (item.type === 'message' || item.role) {
            messages.push({ role: item.role || 'user', content: item.content || '' });
          } else if (item.type === 'file' || item.type === 'image') {
            messages.push({ role: 'user', content: `[${item.type}]` });
          } else {
            messages.push(item);
          }
        }
      }
    }

    const modelKey = resolveModel(body.model);
    if (!modelKey) {
      return json(res, 404, { error: `Model "${body.model}" not found` });
    }

    const result = await runChatCore(messages, modelKey, authKey);
    const stream = !!body.stream;

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const respId = 'resp_' + randomUUID().replace(/-/g, '').slice(0, 20);
      const msgId = 'msg_' + randomUUID().replace(/-/g, '').slice(0, 20);

      sse(res, {
        type: 'response.created',
        response: {
          id: respId,
          object: 'response',
          status: 'in_progress',
          model: result.modelInfo.name,
          output: [],
        },
      });

      sse(res, {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: msgId, role: 'assistant', status: 'in_progress', content: [] },
      });

      sse(res, {
        type: 'response.content_part.added',
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      });

      sse(res, {
        type: 'response.output_text.delta',
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        delta: result.text,
      });

      sse(res, {
        type: 'response.content_part.done',
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: result.text },
      });

      sse(res, {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: msgId,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: result.text }],
        },
      });

      sse(res, {
        type: 'response.completed',
        response: {
          id: respId,
          object: 'response',
          status: 'completed',
          model: result.modelInfo.name,
          output: [{
            type: 'message',
            id: msgId,
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: result.text }],
          }],
          usage: {
            input_tokens: result.promptTokens,
            output_tokens: result.completionTokens,
            total_tokens: result.promptTokens + result.completionTokens,
          },
        },
      });

      res.end();
    } else {
      const respId = 'resp_' + randomUUID().replace(/-/g, '').slice(0, 20);
      const msgId = 'msg_' + randomUUID().replace(/-/g, '').slice(0, 20);

      json(res, 200, {
        id: respId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: result.modelInfo.name,
        output: [{
          type: 'message',
          id: msgId,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: result.text }],
        }],
        usage: {
          input_tokens: result.promptTokens,
          output_tokens: result.completionTokens,
          total_tokens: result.promptTokens + result.completionTokens,
        },
      });
    }
  } catch (err: any) {
    if (err instanceof ChatError) {
      json(res, err.statusCode, { error: err.message });
    } else {
      log.error('Response error:', err.message);
      json(res, 500, { error: err.message });
    }
  }
}

// ─── Helpers ───

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function sse(res: http.ServerResponse, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
