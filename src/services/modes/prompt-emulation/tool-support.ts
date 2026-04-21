export const PROMPT_EMULATION_MODE_ID = 'prompt_emulation' as const;

function hasAnthropicToolBlocks(content: any): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(block =>
    block &&
    typeof block === 'object' &&
    (block.type === 'tool_use' || block.type === 'tool_result'),
  );
}

export function hasAnthropicToolMessages(body: any): boolean {
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some((message: any) => hasAnthropicToolBlocks(message?.content));
}
