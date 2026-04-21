/**
 * Native tool bridge status helpers.
 *
 * Windsurf2Api no longer simulates tool calling via prompt injection.
 * Until a real client-executed native bridge exists, tool requests must be
 * rejected explicitly instead of being silently rewritten.
 */

export const NATIVE_TOOL_BRIDGE_MESSAGE =
  'Only the minimal Anthropic Bash native tool bridge is implemented in Windsurf2Api. Other tool paths remain unsupported.';

export interface SupportedAnthropicMockTool {
  name: 'Bash' | 'Write';
  originalName: string;
  description: string;
  inputSchema: any;
}

const ANTHROPIC_MOCK_TOOL_MAP: Record<string, SupportedAnthropicMockTool['name'] | null> = {
  bash: 'Bash',
  run_command: 'Bash',
  write: 'Write',
  writefile: 'Write',
  write_to_file: 'Write',
};

function hasToolChoice(value: any): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value !== '' && value !== 'none';
  return true;
}

function hasAnthropicToolBlocks(content: any): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(block =>
    block &&
    typeof block === 'object' &&
    (block.type === 'tool_use' || block.type === 'tool_result'),
  );
}

function hasResponsesToolItems(input: any): boolean {
  if (!Array.isArray(input)) return false;
  return input.some(item => {
    if (!item || typeof item !== 'object') return false;
    if (item.role === 'tool') return true;
    if (
      item.type === 'function_call' ||
      item.type === 'function_call_output' ||
      item.type === 'tool_use' ||
      item.type === 'tool_result'
    ) {
      return true;
    }
    return hasAnthropicToolBlocks(item.content);
  });
}

export function hasOpenAIToolInput(body: any): boolean {
  if (Array.isArray(body?.tools) && body.tools.length > 0) return true;
  if (hasToolChoice(body?.tool_choice)) return true;
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some((message: any) => {
    if (!message || typeof message !== 'object') return false;
    if (message.role === 'tool') return true;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  });
}

export function hasResponsesToolInput(body: any): boolean {
  if (Array.isArray(body?.tools) && body.tools.length > 0) return true;
  if (hasToolChoice(body?.tool_choice)) return true;
  return hasResponsesToolItems(body?.input);
}

export function hasAnthropicToolInput(body: any): boolean {
  if (Array.isArray(body?.tools) && body.tools.length > 0) return true;
  if (hasToolChoice(body?.tool_choice)) return true;
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some((message: any) => hasAnthropicToolBlocks(message?.content));
}

export function hasAnthropicToolMessages(body: any): boolean {
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some((message: any) => hasAnthropicToolBlocks(message?.content));
}

export function extractSupportedAnthropicMockTools(body: any): SupportedAnthropicMockTool[] {
  if (!Array.isArray(body?.tools)) return [];

  const tools: SupportedAnthropicMockTool[] = [];
  const seen = new Set<string>();

  for (const tool of body.tools) {
    if (!tool || typeof tool !== 'object') continue;
    const originalName = String(tool.name || tool.type || '').trim();
    if (!originalName) continue;

    const normalizedKey = originalName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const mappedName = ANTHROPIC_MOCK_TOOL_MAP[normalizedKey];
    if (!mappedName || seen.has(mappedName)) continue;

    seen.add(mappedName);
    tools.push({
      name: mappedName,
      originalName,
      description: String(tool.description || ''),
      inputSchema: tool.input_schema || {},
    });
  }

  return tools;
}

export function filterAnthropicToolInput(
  input: Record<string, any>,
  inputSchema: any,
): Record<string, any> {
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

export function buildOpenAIToolUnsupportedError() {
  return {
    error: {
      message: NATIVE_TOOL_BRIDGE_MESSAGE,
      type: 'not_implemented_error',
      code: 'native_tool_bridge_not_implemented',
    },
  };
}

export function buildAnthropicToolUnsupportedError() {
  return {
    type: 'error',
    error: {
      type: 'not_implemented_error',
      message: NATIVE_TOOL_BRIDGE_MESSAGE,
    },
  };
}
