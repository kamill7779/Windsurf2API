# Prompt Emulation Mode — System-Prompt Tool Protocol

**One of two switchable Anthropic tool methods.** See [`README.md`](./README.md) for mode selection.

This method supports Claude Code style tool calling by serializing the Anthropic tool contract into plain text and injecting it into the Cascade system prompt area. The model is instructed to emit strict `<tool_call>` blocks, which the server then parses and translates back into Anthropic `tool_use`.

This is a **prompt-level compatibility layer**. It does not rely on Windsurf's native tool planning — in fact, it deliberately bypasses it — and it supports arbitrary tools, not just Bash.

## Short version

1. Incoming Anthropic `tools[]` is converted into a text protocol.
2. The protocol is injected into the Cascade system prompt area.
3. The model is asked to emit `<tool_call>...</tool_call>` blocks in a strict format.
4. The proxy parses those blocks server-side and translates them back into Anthropic `tool_use`.
5. On the next turn, Anthropic `tool_result` messages are rewritten as tagged transcript text, and the conversation continues.

## Scope

Applies to:

- `POST /v1/messages`
- Claude Code or other Anthropic-compatible clients
- Cases where the proxy must preserve arbitrary Anthropic tool semantics without depending on upstream native tool proposals

Does not replace:

- A true upstream native structured-tools API
- A client-executed local bridge for shell or file actions (see [Native Bridge](./bash-native-bridge-reinjection.md))
- OpenAI-style tool calling on `/v1/chat/completions` or `/v1/responses`

## Core idea

Anthropic clients expect a structured function-calling contract. Windsurf Cascade exposes a prompt-oriented conversational shape. This method closes that gap by letting the proxy own both sides of a text protocol:

- the **injected preamble** teaches the model how to emit tool calls
- the **server-side parser** turns those tool calls back into structured Anthropic objects

The model is instructed to emit a strict machine-readable tag:

```xml
<tool_call>{"name":"<function_name>","arguments":{...}}</tool_call>
```

The server treats that tag as a transport format, not as user-visible prose.

## End-to-end flow

### 1. Receive an Anthropic request

A normal Anthropic Messages payload arrives with `model`, `messages`, optional `system`, optional `tools`, and optional `tool_choice`.

If no tools are present, the request is handled as a plain Anthropic text request and this mode exits.

If tools are present, the proxy switches into prompt emulation.

### 2. Convert `tools[]` into a prompt protocol

Each Anthropic tool definition is rewritten into a readable text section that includes:

- the tool name
- the tool description
- the JSON parameter schema
- explicit output rules

The injected rules tell the model:

- exactly how to format tool calls
- that `arguments` must be valid JSON
- that multiple tool calls may be emitted consecutively
- that generation must stop after the last tool call block
- that tool results will return on the next user turn inside `<tool_result ...>` tags

`tool_choice` is mapped into prompt instructions:

- `auto`: call a tool when appropriate
- `required` / `any`: at least one tool must be called
- specific tool: call that tool first
- `none`: answer directly without tools

### 3. Rewrite message history as a text transcript

Anthropic content blocks are normalized into plain text turns.

- an assistant `tool_use` becomes a `<tool_call>...</tool_call>` line
- a user `tool_result` becomes a `<tool_result tool_call_id="...">...</tool_result>` block

This preserves tool history across turns even though the upstream model only sees a text transcript.

### 4. Send to Cascade with native tools disabled

The proxy forwards the conversation to Windsurf using:

- the normalized transcript
- the injected tool preamble
- a planner configuration that disables Windsurf's own tool planning for this request

A single source of truth for tool behavior matters here. Native Windsurf planning and prompt-emulated planning must not compete in the same request path, or the model can produce mixed outputs that the server cannot reliably parse.

### 5. Receive plain assistant text

Upstream Cascade returns plain assistant text. In emulation mode, that text may contain:

- no tool tags — a normal assistant answer
- one or more `<tool_call>...</tool_call>` blocks

At this point nothing is returned to the client yet.

### 6. Parse `<tool_call>` blocks server-side

The proxy scans the returned text for tool tags. For each block it:

1. parses the embedded JSON
2. validates the shape `{"name": "...", "arguments": {...}}`
3. filters `arguments` against the declared input schema
4. generates an Anthropic-style tool use id
5. removes the raw tag from user-visible assistant text

Then the proxy returns a normal Anthropic response:

- text blocks for any non-tool text that remains
- `tool_use` blocks for parsed calls
- `stop_reason: "tool_use"` when any tool call was emitted

### 7. Accept a follow-up `tool_result`

When the client sends the next turn with `tool_result`, the proxy does not try to replay a native upstream tool result object. Instead it:

1. rewrites each `tool_result` block as tagged transcript text
2. rebuilds the conversation history
3. sends a new upstream Cascade request using the same prompt protocol
4. lets the model continue from the updated transcript

If the model now answers in plain text, the proxy returns a normal Anthropic assistant message. If it emits another tool tag, the cycle repeats.

## Prompt protocol design

The protocol must be easy for the model to follow and easy for the server to parse.

Required properties:

- one tool call per tag block
- JSON on a single logical line
- explicit `name`
- explicit `arguments`
- no extra prose after the final tool call block

Tool call shape:

```xml
<tool_call>{"name":"Bash","arguments":{"command":"pwd"}}</tool_call>
```

Tool result shape (as sent back through the transcript):

```xml
<tool_result tool_call_id="toolu_123">
command output here
</tool_result>
```

The server owns the real conversion into Anthropic response objects.

## Why inject into system prompt instead of upstream tools

The real issue is an interface mismatch:

- Anthropic expects a downstream function-calling contract
- Windsurf Cascade exposes a prompt-oriented conversational request shape
- the proxy needs a stable contract it fully controls

Prompt injection works because:

- the proxy controls both the prompt protocol and the parser
- the client still receives standard Anthropic responses
- the implementation stays isolated to the Anthropic endpoint
- the approach does not depend on native proposal availability for every tool

## Advantages

- Supports arbitrary Anthropic tools, not just Bash
- Keeps the external contract Anthropic-compatible
- Supports multi-turn tool conversations
- Keeps the server fully in control of parsing and validation
- Isolated to the Anthropic endpoint; no impact on OpenAI or Responses paths

## Limitations

- This is prompt-level emulation, not native function calling; reliability depends on the model following the output protocol
- Malformed or partial tool tags must be treated as plain text or rejected
- Argument validation is only as strong as the declared input schema filtering
- OpenAI and Responses tool input remain separate problems
- The proxy must strip tool tags from user-visible text; any leakage is a visible bug

## Recommended guardrails

- Keep the tag grammar narrow and explicit
- Filter parsed arguments against the declared input schema
- Always strip tool tags from user-visible assistant text
- Log when emulation mode is selected
- Log parsed tool names and counts
- Log malformed tag cases
- Keep the implementation isolated to `/v1/messages`
- Do not mix prompt emulation with upstream native tool planning in the same request path

## Validation checklist

At minimum verify:

1. A text-only `/v1/messages` request still behaves normally.
2. A tool-enabled request returns Anthropic `tool_use` rather than raw tag text.
3. A follow-up `tool_result` request produces the next assistant turn correctly.
4. `tool_choice` modes behave as intended.
5. The server never leaks raw `<tool_call>` markup to the client.
6. Malformed tool tags do not crash the request handler.

## Example

### Request

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [
    { "role": "user", "content": "Use the Bash tool to print the current working directory." }
  ],
  "tools": [
    {
      "name": "Bash",
      "description": "Execute shell commands.",
      "input_schema": {
        "type": "object",
        "properties": { "command": { "type": "string" } },
        "required": ["command"]
      }
    }
  ],
  "tool_choice": { "type": "tool", "name": "Bash" }
}
```

### First response

```json
{
  "role": "assistant",
  "content": [
    { "type": "tool_use", "id": "toolu_123", "name": "Bash", "input": { "command": "pwd" } }
  ],
  "stop_reason": "tool_use"
}
```

### Follow-up result

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_123",
      "content": [{ "type": "text", "text": "/tmp/windsurf-workspace" }]
    }
  ]
}
```

### Final response

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "The current working directory is /tmp/windsurf-workspace." }
  ],
  "stop_reason": "end_turn"
}
```

## When to choose this mode

Choose `prompt_emulation` when:

- you need to support arbitrary Anthropic tools now, not only Bash
- the upstream cannot be relied on to produce a native proposal for every tool
- the proxy should fully own the tool compatibility layer
- shipping a working bridge matters more than waiting for a perfect native upstream tools interface

Prefer [`native_bridge`](./bash-native-bridge-reinjection.md) when Bash is the only tool you need and you want commands to execute in the client's local environment through Windsurf's validated native interaction channel.
