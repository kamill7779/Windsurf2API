import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildToolPreambleForAnthropicTools,
  buildCascadeTranscriptFromMessages,
  normalizeAnthropicMessagesForToolEmulation,
  parseToolCallsFromText,
} from '../dist/services/tool-emulation.js';
import { buildCascadeConfig } from '../dist/core/windsurf.js';
import { getField, parseFields } from '../dist/core/proto.js';

test('buildToolPreambleForAnthropicTools serializes Anthropic tools into the tool protocol', () => {
  const preamble = buildToolPreambleForAnthropicTools([
    {
      name: 'Bash',
      description: 'Execute shell commands.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  ]);

  assert.match(preamble, /<tool_call>\{"name":"<function_name>","arguments":\{\.\.\.\}\}<\/tool_call>/);
  assert.match(preamble, /### Bash/);
  assert.match(preamble, /Execute shell commands\./);
  assert.match(preamble, /"command"/);
});

test('normalizeAnthropicMessagesForToolEmulation rewrites tool history into tag-based transcript', () => {
  const normalized = normalizeAnthropicMessagesForToolEmulation(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: 'List files' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_123', name: 'Bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_123',
            content: [{ type: 'text', text: 'a.txt\nb.txt' }],
          },
        ],
      },
    ],
    'You are a coding assistant.',
  );

  assert.equal(normalized[0].role, 'system');
  assert.match(normalized[0].content, /You are a coding assistant\./);
  assert.equal(normalized[1].role, 'user');
  assert.equal(normalized[1].content, 'List files');
  assert.equal(normalized[2].role, 'assistant');
  assert.match(normalized[2].content, /<tool_call>\{"name":"Bash","arguments":\{"command":"ls"\}\}<\/tool_call>/);
  assert.equal(normalized[3].role, 'user');
  assert.match(normalized[3].content, /<tool_result tool_call_id="toolu_123">/);
  assert.match(normalized[3].content, /a\.txt/);
});

test('buildCascadeTranscriptFromMessages preserves system text and prior turns for a fresh cascade', () => {
  const transcript = buildCascadeTranscriptFromMessages([
    { role: 'system', content: 'System rules' },
    { role: 'user', content: 'First request' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: '<tool_result tool_call_id="toolu_123">done</tool_result>' },
  ]);

  assert.match(transcript, /^System rules/);
  assert.match(transcript, /\[Conversation so far\]/);
  assert.match(transcript, /User: First request/);
  assert.match(transcript, /Assistant: First answer/);
  assert.match(transcript, /\[Current user message\]\n<tool_result tool_call_id="toolu_123">done<\/tool_result>/);
});

test('parseToolCallsFromText extracts tool calls and strips tool tags from plain text', () => {
  const parsed = parseToolCallsFromText(
    'Working...\n<tool_call>{"name":"Bash","arguments":{"command":"pwd"}}</tool_call>\nDone.',
    new Map([
      ['Bash', { properties: { command: { type: 'string' } } }],
    ]),
  );

  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, 'Bash');
  assert.deepEqual(parsed.toolCalls[0].input, { command: 'pwd' });
  assert.equal(parsed.text.trim(), 'Working...\nDone.');
});

test('buildCascadeConfig injects tool preamble into system override sections and stays in NO_TOOL mode', () => {
  const preamble = 'Injected tool protocol';
  const config = buildCascadeConfig(0, 'claude-sonnet-4-6', { toolPreamble: preamble });
  const topFields = parseFields(config);
  const plannerField = getField(topFields, 1, 2);
  assert.ok(plannerField, 'planner config should exist');

  const plannerFields = parseFields(plannerField.value);
  const convField = getField(plannerFields, 2, 2);
  assert.ok(convField, 'conversational config should exist');

  const convFields = parseFields(convField.value);
  const plannerModeField = getField(convFields, 4, 0);
  assert.ok(plannerModeField, 'planner mode field should exist');
  assert.equal(plannerModeField.value, 3);

  const toolSection = getField(convFields, 10, 2);
  const additionalSection = getField(convFields, 12, 2);
  assert.ok(toolSection, 'tool_calling_section override should exist');
  assert.ok(additionalSection, 'additional_instructions_section override should exist');
});
