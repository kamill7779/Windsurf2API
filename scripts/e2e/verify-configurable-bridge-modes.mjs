import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  readBridgeModeConfig,
  writeBridgeModeConfig,
} from '../switch-bridge-mode.mjs';

const DEFAULT_BASE_URL = process.env.W2A_BASE_URL || 'http://127.0.0.1:3003';
const DEFAULT_MODEL = process.env.W2A_MODEL || 'claude-sonnet-4.6';
const DEFAULT_CONFIG_PATH = process.env.BRIDGE_MODE_CONFIG_PATH || path.resolve(process.cwd(), 'config', 'bridge-mode.json');
const RELOAD_WAIT_MS = Number(process.env.BRIDGE_MODE_RELOAD_WAIT_MS || 600);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildBashRequestBody() {
  return {
    model: DEFAULT_MODEL,
    max_tokens: 256,
    stream: false,
    tool_choice: {
      type: 'tool',
      name: 'Bash',
    },
    tools: [
      {
        name: 'Bash',
        description: 'Execute shell commands.',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
          },
          required: ['command'],
        },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Use Bash to run pwd. Stop after emitting the Bash tool call.',
          },
        ],
      },
    ],
  };
}

async function postAnthropicMessages(apiKey, body) {
  const response = await fetch(`${DEFAULT_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

function extractToolUse(responseBody) {
  const blocks = Array.isArray(responseBody?.content) ? responseBody.content : [];
  return blocks.find(block => block && typeof block === 'object' && block.type === 'tool_use') || null;
}

function assertNativeBridgeResponse(responseBody) {
  const toolUse = extractToolUse(responseBody);
  if (!toolUse) {
    throw new Error(`native_bridge expected a tool_use block, got: ${JSON.stringify(responseBody)}`);
  }
  if (toolUse.name !== 'Bash') {
    throw new Error(`native_bridge expected Bash tool, got: ${toolUse.name}`);
  }
  if (responseBody.stop_reason !== 'tool_use') {
    throw new Error(`native_bridge expected stop_reason=tool_use, got: ${responseBody.stop_reason}`);
  }
  if (!responseBody?.w2a?.bridge_id) {
    throw new Error(`native_bridge expected w2a.bridge_id, got: ${JSON.stringify(responseBody)}`);
  }
}

function assertPromptEmulationResponse(responseBody) {
  const toolUse = extractToolUse(responseBody);
  if (!toolUse) {
    throw new Error(`prompt_emulation expected a tool_use block, got: ${JSON.stringify(responseBody)}`);
  }
  if (toolUse.name !== 'Bash') {
    throw new Error(`prompt_emulation expected Bash tool, got: ${toolUse.name}`);
  }
  if (responseBody.stop_reason !== 'tool_use') {
    throw new Error(`prompt_emulation expected stop_reason=tool_use, got: ${responseBody.stop_reason}`);
  }
  if (responseBody?.w2a?.bridge_id) {
    throw new Error(`prompt_emulation should not expose native bridge metadata, got: ${JSON.stringify(responseBody.w2a)}`);
  }
}

async function restoreConfig(configPath, originalContents) {
  await writeFile(configPath, originalContents, 'utf8');
}

async function main() {
  const apiKey = process.env.W2A_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Set W2A_API_KEY (or ANTHROPIC_API_KEY) before running this script.');
  }

  const configPath = path.resolve(DEFAULT_CONFIG_PATH);
  const originalConfigText = await readFile(configPath, 'utf8');
  const originalConfig = await readBridgeModeConfig(configPath);

  console.log(`[e2e] base url: ${DEFAULT_BASE_URL}`);
  console.log(`[e2e] config: ${configPath}`);
  console.log(`[e2e] original mode: ${originalConfig.anthropicToolMode}`);

  try {
    await writeBridgeModeConfig('native_bridge', { configPath });
    await sleep(RELOAD_WAIT_MS);
    const nativeFirst = await postAnthropicMessages(apiKey, buildBashRequestBody());
    assertNativeBridgeResponse(nativeFirst);
    console.log('[e2e] native_bridge response verified');

    await writeBridgeModeConfig('prompt_emulation', { configPath });
    await sleep(RELOAD_WAIT_MS);
    const prompt = await postAnthropicMessages(apiKey, buildBashRequestBody());
    assertPromptEmulationResponse(prompt);
    console.log('[e2e] prompt_emulation response verified');

    await writeBridgeModeConfig('native_bridge', { configPath });
    await sleep(RELOAD_WAIT_MS);
    const nativeSecond = await postAnthropicMessages(apiKey, buildBashRequestBody());
    assertNativeBridgeResponse(nativeSecond);
    console.log('[e2e] native_bridge response re-verified after switch-back');
  } finally {
    await restoreConfig(configPath, originalConfigText);
    console.log(`[e2e] restored config to original contents (${originalConfig.anthropicToolMode})`);
  }
}

main().catch(error => {
  console.error(`[e2e] ${error.message}`);
  process.exit(1);
});
