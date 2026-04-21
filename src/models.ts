/**
 * Minimal model catalog for Windsurf2Api MVP.
 */

export interface ModelInfo {
  name: string;
  provider: string;
  enumValue: number;
  modelUid: string | null;
  credit: number;
}

export const MODELS: Record<string, ModelInfo> = {
  // Claude
  'claude-sonnet-4.6': { name: 'claude-sonnet-4.6', provider: 'anthropic', enumValue: 0, modelUid: 'claude-sonnet-4-6', credit: 4 },
  'claude-opus-4.6': { name: 'claude-opus-4.6', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-6', credit: 6 },
  'claude-opus-4.6-thinking': { name: 'claude-opus-4.6-thinking', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-6-thinking', credit: 8 },
  'claude-opus-4-7-low': { name: 'claude-opus-4-7-low', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-7-low', credit: 6 },
  'claude-opus-4-7-medium': { name: 'claude-opus-4-7-medium', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-7-medium', credit: 6 },
  'claude-opus-4-7-high': { name: 'claude-opus-4-7-high', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-7-high', credit: 6 },
  'claude-opus-4-7-xhigh': { name: 'claude-opus-4-7-xhigh', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-7-xhigh', credit: 6 },
  'claude-opus-4-7-max': { name: 'claude-opus-4-7-max', provider: 'anthropic', enumValue: 0, modelUid: 'claude-opus-4-7-max', credit: 6 },

  // GPT
  'gpt-5.4-low': { name: 'gpt-5.4-low', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-low', credit: 1 },
  'gpt-5.4-medium': { name: 'gpt-5.4-medium', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-medium', credit: 2 },
  'gpt-5.4-xhigh': { name: 'gpt-5.4-xhigh', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-xhigh', credit: 8 },
  'gpt-5.4-mini-low': { name: 'gpt-5.4-mini-low', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-mini-low', credit: 1.5 },
  'gpt-5.4-mini-medium': { name: 'gpt-5.4-mini-medium', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-mini-medium', credit: 1.5 },
  'gpt-5.4-mini-high': { name: 'gpt-5.4-mini-high', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-mini-high', credit: 4.5 },
  'gpt-5.4-mini-xhigh': { name: 'gpt-5.4-mini-xhigh', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-4-mini-xhigh', credit: 12 },
  'gpt-5.3-codex': { name: 'gpt-5.3-codex', provider: 'openai', enumValue: 0, modelUid: 'gpt-5-3-codex-medium', credit: 1 },

  // Other
  'glm-5.1': { name: 'glm-5.1', provider: 'zhipu', enumValue: 0, modelUid: 'glm-5-1', credit: 1.5 },
  'kimi-k2.5': { name: 'kimi-k2.5', provider: 'moonshot', enumValue: 0, modelUid: 'kimi-k2-5', credit: 1 },
  'gemini-2.5-flash': { name: 'gemini-2.5-flash', provider: 'google', enumValue: 312, modelUid: 'MODEL_GOOGLE_GEMINI_2_5_FLASH', credit: 0.5 },
};

const _lookup = new Map<string, string>();
for (const [id, info] of Object.entries(MODELS)) {
  _lookup.set(id, id);
  _lookup.set(id.toLowerCase(), id);
  _lookup.set(info.name, id);
  _lookup.set(info.name.toLowerCase(), id);
  if (info.modelUid) {
    _lookup.set(info.modelUid, id);
    _lookup.set(info.modelUid.toLowerCase(), id);
  }
}

// OpenAI-compatible model aliases — tools send these names
const ALIASES: Record<string, string> = {
  // GPT family
  'gpt-4o': 'gpt-5.4-medium',
  'gpt-4o-mini': 'gpt-5.4-mini-medium',
  'gpt-4': 'gpt-5.4-medium',
  'gpt-4-turbo': 'gpt-5.4-medium',
  'gpt-4-turbo-preview': 'gpt-5.4-medium',
  'gpt-3.5-turbo': 'gpt-5.4-low',
  'gpt-3.5-turbo-16k': 'gpt-5.4-low',
  'gpt-3.5-turbo-1106': 'gpt-5.4-low',
  'gpt-3.5-turbo-0125': 'gpt-5.4-low',
  'gpt-4-1106-preview': 'gpt-5.4-medium',
  'gpt-4-0125-preview': 'gpt-5.4-medium',
  'gpt-4-vision-preview': 'gpt-5.4-medium',
  'gpt-4o-2024-08-06': 'gpt-5.4-medium',
  'gpt-4o-2024-11-20': 'gpt-5.4-medium',
  'gpt-4o-mini-2024-07-18': 'gpt-5.4-mini-medium',
  // Claude family
  'claude-3-5-sonnet': 'claude-sonnet-4.6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4.6',
  'claude-3-5-sonnet-latest': 'claude-sonnet-4.6',
  'claude-sonnet': 'claude-sonnet-4.6',
  'claude-3-opus': 'claude-opus-4.6',
  'claude-3-opus-20240229': 'claude-opus-4.6',
  'claude-opus': 'claude-opus-4.6',
  'claude-3-5-haiku': 'claude-sonnet-4.6',
  'claude-haiku': 'claude-sonnet-4.6',
  // Anthropic official model names (what Claude Code sends)
  'claude-sonnet-4-6': 'claude-sonnet-4.6',
  'claude-sonnet-4-6-20241022': 'claude-sonnet-4.6',
  'claude-opus-4-6': 'claude-opus-4.6',
  'claude-opus-4-6-20241022': 'claude-opus-4.6',
  'claude-opus-4-7': 'claude-opus-4-7-medium',
  'claude-opus-4.7': 'claude-opus-4-7-medium',
  'claude-opus-4-7-latest': 'claude-opus-4-7-medium',
  'claude-opus-4-7-20250219': 'claude-opus-4-7-medium',
  'claude-sonnet-4-7': 'claude-opus-4-7-medium',
  'claude-sonnet-4.7': 'claude-opus-4-7-medium',
  // Gemini family
  'gemini-pro': 'gemini-2.5-flash',
  'gemini-1.5-pro': 'gemini-2.5-flash',
  'gemini-1.5-flash': 'gemini-2.5-flash',
};

for (const [alias, target] of Object.entries(ALIASES)) {
  _lookup.set(alias, target);
  _lookup.set(alias.toLowerCase(), target);
}

// Strip ANSI escape codes that terminal tools sometimes embed in model names
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

export function resolveModel(name: string): string | null {
  const clean = stripAnsi(name).trim();
  return _lookup.get(clean) || _lookup.get(clean.toLowerCase()) || null;
}

export function getModelInfo(id: string): ModelInfo | null {
  return MODELS[id] || null;
}

// OpenAI-compatible model list
export function listModels() {
  const ts = Math.floor(Date.now() / 1000);
  return Object.entries(MODELS).map(([id, info]) => ({
    id: info.name,
    object: 'model' as const,
    created: ts,
    owned_by: info.provider,
  }));
}

// Anthropic-compatible model list (for Claude Code /v1/models)
export function listAnthropicModels() {
  const now = new Date().toISOString();
  const capSupported = { supported: true };
  const capSupportedAdaptive = { supported: true, types: { adaptive: { supported: true }, enabled: { supported: true } } };
  const capSupportedEnabled = { supported: true, types: { enabled: { supported: true } } };

  const entries = [
    {
      type: 'model' as const,
      id: 'claude-sonnet-4-6',
      display_name: 'Claude Sonnet 4.6',
      created_at: now,
      max_tokens: 64000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-6',
      display_name: 'Claude Opus 4.6',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7',
      display_name: 'Claude Opus 4.7',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7-low',
      display_name: 'Claude Opus 4.7 (low)',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7-medium',
      display_name: 'Claude Opus 4.7 (medium)',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7-high',
      display_name: 'Claude Opus 4.7 (high)',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7-xhigh',
      display_name: 'Claude Opus 4.7 (xhigh)',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'claude-opus-4-7-max',
      display_name: 'Claude Opus 4.7 (max)',
      created_at: now,
      max_tokens: 128000,
      capabilities: {
        code_execution: capSupported,
        thinking: capSupportedAdaptive,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'gpt-4o',
      display_name: 'GPT-4o',
      created_at: now,
      max_tokens: 16000,
      capabilities: {
        code_execution: capSupported,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
    {
      type: 'model' as const,
      id: 'gpt-4o-mini',
      display_name: 'GPT-4o Mini',
      created_at: now,
      max_tokens: 16000,
      capabilities: {
        code_execution: capSupported,
        structured_outputs: capSupported,
        image_input: capSupported,
      },
    },
  ];

  const firstId = entries[0]?.id || '';
  const lastId = entries[entries.length - 1]?.id || '';
  return {
    data: entries,
    has_more: false,
    first_id: firstId,
    last_id: lastId,
  };
}
