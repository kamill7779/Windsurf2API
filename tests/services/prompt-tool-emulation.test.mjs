import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileAndImportTsModule,
  resetCompiledTestModules,
} from '../helpers/compile-import.mjs';

test.beforeEach(() => {
  resetCompiledTestModules();
});

test('prompt emulation module serializes Anthropic tools into a tool protocol preamble', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/prompt-emulation/tool-emulation.ts');

  const preamble = mod.buildToolPreambleForAnthropicTools([
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

test('prompt emulation normalizes Anthropic tool history into tagged transcript blocks', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/prompt-emulation/tool-emulation.ts');

  const normalized = mod.normalizeAnthropicMessagesForToolEmulation(
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

test('prompt emulation builds a cascade transcript with prior turns and latest user message', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/prompt-emulation/tool-emulation.ts');

  const transcript = mod.buildCascadeTranscriptFromMessages([
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

test('prompt emulation collapses tool history into one upstream Cascade user transcript', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/prompt-emulation/tool-emulation.ts');

  const cascadeMessages = mod.buildPromptEmulationCascadeMessages(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: '当前 pwd 是什么？' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_pwd', name: 'Bash', input: { command: 'pwd' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_pwd',
            content: [{ type: 'text', text: '/c/Users/23999' }],
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '不是中文目录吧？' }],
      },
    ],
    'You are a coding assistant.',
  );

  assert.deepEqual(cascadeMessages, [
    {
      role: 'user',
      content:
        'You are a coding assistant.\n\n[Conversation so far]\n' +
        'User: 当前 pwd 是什么？\n\n' +
        'Assistant: <tool_call>{"name":"Bash","arguments":{"command":"pwd"}}</tool_call>\n\n' +
        'User: <tool_result tool_call_id="toolu_pwd">\n/c/Users/23999\n</tool_result>\n\n' +
        '[Current user message]\n不是中文目录吧？',
    },
  ]);
});

test('prompt emulation parses tool call tags and strips them from assistant text', async () => {
  const mod = await compileAndImportTsModule('src/services/modes/prompt-emulation/tool-emulation.ts');

  const parsed = mod.parseToolCallsFromText(
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

test('cascade config can inject prompt emulation overrides while staying in NO_TOOL mode', async () => {
  const windsurf = await compileAndImportTsModule('src/core/windsurf.ts');
  const proto = await compileAndImportTsModule('src/core/proto.ts');

  const preamble = 'Injected tool protocol';
  const config = windsurf.buildCascadeConfig(0, 'claude-sonnet-4-6', { toolPreamble: preamble });
  const topFields = proto.parseFields(config);
  const plannerField = proto.getField(topFields, 1, 2);
  assert.ok(plannerField, 'planner config should exist');

  const plannerFields = proto.parseFields(plannerField.value);
  const convField = proto.getField(plannerFields, 2, 2);
  assert.ok(convField, 'conversational config should exist');

  const convFields = proto.parseFields(convField.value);
  const plannerModeField = proto.getField(convFields, 4, 0);
  assert.ok(plannerModeField, 'planner mode field should exist');
  assert.equal(plannerModeField.value, 3);

  const toolSection = proto.getField(convFields, 10, 2);
  const additionalSection = proto.getField(convFields, 12, 2);
  assert.ok(toolSection, 'tool_calling_section override should exist');
  assert.ok(additionalSection, 'additional_instructions_section override should exist');
});
