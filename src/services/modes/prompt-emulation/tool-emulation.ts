export interface AnthropicToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ParsedToolCall {
  name: string;
  input: Record<string, any>;
}

const TOOL_PROTOCOL_SYSTEM_HEADER = `You have access to the following functions. To invoke a function, emit a block in this EXACT format:

<tool_call>{"name":"<function_name>","arguments":{...}}</tool_call>

Rules:
1. Each <tool_call>...</tool_call> block must fit on ONE line (no line breaks inside the JSON).
2. "arguments" must be a JSON object matching the function's parameter schema.
3. You MAY emit MULTIPLE <tool_call> blocks if the request requires calling several functions in parallel. Emit ALL needed calls consecutively, then STOP generating.
4. After emitting the last <tool_call> block, STOP. Do not write any explanation after it. The caller executes the functions and returns results wrapped in <tool_result tool_call_id="...">...</tool_result> tags in the next user turn.
5. NEVER say "I don't have access to tools" or "I cannot perform that action" because the functions listed below are your available tools.`;

const TOOL_CHOICE_SUFFIX = {
  auto: `
6. When a function is relevant to the user's request, you SHOULD call it rather than guessing from memory.`,
  required: `
6. You MUST call at least one function for this request. Do NOT answer directly in plain text.`,
  none: `
6. Do NOT call any functions. Answer directly in plain text.`,
} as const;

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveToolChoice(toolChoice: any): { mode: 'auto' | 'required' | 'none'; forceName: string | null } {
  if (!toolChoice || toolChoice === 'auto' || toolChoice?.type === 'auto') {
    return { mode: 'auto', forceName: null };
  }
  if (toolChoice === 'none' || toolChoice?.type === 'none') {
    return { mode: 'none', forceName: null };
  }
  if (toolChoice === 'required' || toolChoice === 'any' || toolChoice?.type === 'any') {
    return { mode: 'required', forceName: null };
  }
  if (toolChoice?.type === 'tool' && typeof toolChoice.name === 'string') {
    return { mode: 'required', forceName: toolChoice.name };
  }
  if (typeof toolChoice?.function?.name === 'string') {
    return { mode: 'required', forceName: toolChoice.function.name };
  }
  return { mode: 'auto', forceName: null };
}

function contentBlockToText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (!block || typeof block !== 'object') return String(block ?? '');
        if (block.type === 'text') return String(block.text || '');
        if (typeof block.text === 'string') return block.text;
        return JSON.stringify(block);
      })
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.stdout === 'string') return content.stdout;
    if (typeof content.output === 'string') return content.output;
    if (typeof content.result === 'string') return content.result;
    return JSON.stringify(content);
  }
  return String(content ?? '');
}

function filterInputBySchema(input: Record<string, any>, inputSchema: any): Record<string, any> {
  if (!input || typeof input !== 'object') return {};
  const properties = inputSchema && typeof inputSchema === 'object'
    ? inputSchema.properties
    : null;
  if (!properties || typeof properties !== 'object') {
    return { ...input };
  }

  const allowedKeys = new Set(Object.keys(properties));
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => allowedKeys.has(key) && value !== undefined),
  );
}

export function buildToolPreambleForAnthropicTools(
  tools: Array<{ name?: string; description?: string; input_schema?: any }> = [],
  toolChoice?: any,
): string {
  if (!Array.isArray(tools) || tools.length === 0) return '';

  const { mode, forceName } = resolveToolChoice(toolChoice);
  const lines = [TOOL_PROTOCOL_SYSTEM_HEADER, TOOL_CHOICE_SUFFIX[mode], '', 'Available functions:'];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const name = String(tool.name || '').trim();
    if (!name) continue;

    lines.push('');
    lines.push(`### ${name}`);
    if (tool.description) lines.push(String(tool.description));
    lines.push('Parameters:');
    lines.push('```json');
    lines.push(JSON.stringify(tool.input_schema || {}, null, 2));
    lines.push('```');
  }

  if (forceName) {
    lines.push('');
    lines.push(`You MUST call the function "${forceName}". Do not call any other function first.`);
  }

  return lines.join('\n');
}

export function normalizeAnthropicMessagesForToolEmulation(
  messages: any[] = [],
  systemPrompt?: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  if (systemPrompt) {
    out.push({ role: 'system', content: String(systemPrompt) });
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = message.content;

    if (typeof content === 'string') {
      out.push({ role, content });
      continue;
    }

    if (!Array.isArray(content)) continue;

    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'text') {
        const text = String(block.text || '');
        if (text) parts.push(text);
        continue;
      }

      if (role === 'assistant' && block.type === 'tool_use') {
        parts.push(`<tool_call>${JSON.stringify({
          name: String(block.name || 'unknown'),
          arguments: block.input && typeof block.input === 'object' ? block.input : {},
        })}</tool_call>`);
        continue;
      }

      if (role === 'user' && block.type === 'tool_result') {
        const toolCallId = String(block.tool_use_id || block.toolUseId || 'unknown');
        const resultText = contentBlockToText(block.content);
        parts.push(`<tool_result tool_call_id="${toolCallId}">\n${resultText}\n</tool_result>`);
      }
    }

    out.push({ role, content: parts.join('\n').trim() });
  }

  return out.filter(message => message.content !== '');
}

export function buildCascadeTranscriptFromMessages(
  messages: Array<{ role: string; content: string }> = [],
): string {
  const systemMessages = messages
    .filter(message => message.role === 'system')
    .map(message => String(message.content || '').trim())
    .filter(Boolean);

  const conversation = messages.filter(
    message => message.role === 'user' || message.role === 'assistant',
  );

  let text = '';
  if (conversation.length <= 1) {
    text = conversation[0] ? String(conversation[0].content || '') : '';
  } else {
    const lines: string[] = [];
    for (let i = 0; i < conversation.length - 1; i++) {
      const message = conversation[i];
      const label = message.role === 'assistant' ? 'Assistant' : 'User';
      lines.push(`${label}: ${message.content}`);
    }
    const latest = conversation[conversation.length - 1];
    text = `[Conversation so far]\n${lines.join('\n\n')}\n\n[Current user message]\n${latest.content}`;
  }

  if (systemMessages.length > 0) {
    const prefix = systemMessages.join('\n\n');
    text = text ? `${prefix}\n\n${text}` : prefix;
  }

  return text;
}

export function buildPromptEmulationCascadeMessages(
  messages: any[] = [],
  systemPrompt?: string,
): Array<{ role: 'user'; content: string }> {
  const normalizedMessages = normalizeAnthropicMessagesForToolEmulation(messages, systemPrompt);
  const transcript = buildCascadeTranscriptFromMessages(normalizedMessages);
  return transcript
    ? [{ role: 'user', content: transcript }]
    : [];
}

export function parseToolCallsFromText(
  text: string,
  inputSchemas: Map<string, any> = new Map(),
): { text: string; toolCalls: ParsedToolCall[] } {
  const toolCalls: ParsedToolCall[] = [];
  const cleanText = String(text || '').replace(
    /<tool_call>([\s\S]*?)<\/tool_call>/g,
    (_match, body: string) => {
      const parsed = safeParseJson(String(body).trim());
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.name === 'string' &&
        parsed.name.trim() !== '' &&
        parsed.arguments &&
        typeof parsed.arguments === 'object' &&
        !Array.isArray(parsed.arguments)
      ) {
        const schema = inputSchemas.get(parsed.name);
        toolCalls.push({
          name: parsed.name,
          input: filterInputBySchema(parsed.arguments, schema),
        });
      }
      return '';
    },
  );

  return {
    text: cleanText.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    toolCalls,
  };
}

export function extractAnthropicToolDefinitions(body: any): AnthropicToolDefinition[] {
  const tools: AnthropicToolDefinition[] = [];
  const seen = new Set<string>();

  if (Array.isArray(body?.tools)) {
    for (const tool of body.tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = String(tool.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      tools.push({
        name,
        description: String(tool.description || ''),
        inputSchema: tool.input_schema || {},
      });
    }
  }

  if (tools.length > 0) return tools;

  if (!Array.isArray(body?.messages)) return tools;
  for (const message of body.messages) {
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
      const name = String(block.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      tools.push({
        name,
        description: '',
        inputSchema: {},
      });
    }
  }

  return tools;
}
