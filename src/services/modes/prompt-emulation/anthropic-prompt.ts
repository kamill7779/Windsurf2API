import http from 'http';
import { randomUUID } from 'crypto';

import { getModelInfo } from '../../../models.js';
import { PlannerMode } from '../../../core/windsurf.js';
import { runChatCore } from '../../chat.js';
import {
  AnthropicToolDefinition,
  buildToolPreambleForAnthropicTools,
  extractAnthropicToolDefinitions,
  normalizeAnthropicMessagesForToolEmulation,
  parseToolCallsFromText,
} from './tool-emulation.js';
import { hasAnthropicToolMessages, PROMPT_EMULATION_MODE_ID } from './tool-support.js';

export { PROMPT_EMULATION_MODE_ID };

export interface AnthropicPromptToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface AnthropicPromptToolResponseShape {
  text: string;
  toolCalls: AnthropicPromptToolCall[];
}

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

function computeAnthropicUsage(messages: any[], text: string): { promptTokens: number; completionTokens: number } {
  const promptChars = messages.reduce((sum, message) => {
    return sum + extractAnthropicTextContent(message?.content).length;
  }, 0);
  return {
    promptTokens: Math.ceil(promptChars / 4),
    completionTokens: Math.ceil(text.length / 4),
  };
}

function generateToolUseId(): string {
  return 'toolu_' + randomUUID().replace(/-/g, '').slice(0, 24);
}

export function materializeAnthropicPromptToolResponse(
  text: string,
  tools: AnthropicToolDefinition[],
): AnthropicPromptToolResponseShape {
  const schemaMap = new Map<string, any>();
  for (const tool of tools) {
    schemaMap.set(tool.name, tool.inputSchema);
  }

  const parsed = parseToolCallsFromText(text, schemaMap);
  return {
    text: parsed.text,
    toolCalls: parsed.toolCalls.map(toolCall => ({
      id: generateToolUseId(),
      name: toolCall.name,
      input: toolCall.input,
    })),
  };
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

export function writeAnthropicPromptToolResponse(
  res: http.ServerResponse,
  body: any,
  result: { text: string; modelInfo: { name: string }; promptTokens: number; completionTokens: number },
  tools: AnthropicToolDefinition[],
) {
  const parsed = materializeAnthropicPromptToolResponse(result.text, tools);

  if (parsed.toolCalls.length === 0) {
    return writeAnthropicTextResponse(res, body, {
      ...result,
      text: parsed.text,
    });
  }

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

    let index = 0;
    if (parsed.text) {
      anthropicEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      anthropicEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: parsed.text },
      });
      anthropicEvent(res, 'content_block_stop', {
        type: 'content_block_stop',
        index,
      });
      index++;
    }

    for (const toolCall of parsed.toolCalls) {
      anthropicEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: {},
        },
      });
      anthropicEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(toolCall.input),
        },
      });
      anthropicEvent(res, 'content_block_stop', {
        type: 'content_block_stop',
        index,
      });
      index++;
    }

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
  const content = [];
  if (parsed.text) {
    content.push({ type: 'text', text: parsed.text });
  }
  for (const toolCall of parsed.toolCalls) {
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
    });
  }

  json(res, 200, {
    id: msgId,
    type: 'message',
    role: 'assistant',
    model: body.model || result.modelInfo.name,
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: result.promptTokens,
      output_tokens: result.completionTokens,
    },
  });
}

export async function handleAnthropicPromptMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: any,
  authKey: string,
  modelKey: string,
): Promise<void> {
  void req;

  const modelInfo = getModelInfo(modelKey);
  if (!modelInfo) {
    throw new Error(`Model "${modelKey}" not found`);
  }

  const anthropicTools = extractAnthropicToolDefinitions(body);
  const shouldUsePromptToolEmulation =
    anthropicTools.length > 0 || hasAnthropicToolMessages(body);

  if (!shouldUsePromptToolEmulation) {
    const messages = convertMessages(body.messages || [], body.system);
    const result = await runChatCore(messages, modelKey, authKey);
    return writeAnthropicTextResponse(res, body, result);
  }

  const emulatedMessages = normalizeAnthropicMessagesForToolEmulation(body.messages || [], body.system);
  const toolPreamble = buildToolPreambleForAnthropicTools(
    anthropicTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    body.tool_choice,
  );
  const result = await runChatCore(
    emulatedMessages,
    modelKey,
    authKey,
    {
      plannerMode: PlannerMode.NO_TOOL,
      toolPreamble,
    },
  );
  const usage = computeAnthropicUsage(body.messages || [], result.text);
  return writeAnthropicPromptToolResponse(res, body, {
    ...result,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  }, anthropicTools);
}
