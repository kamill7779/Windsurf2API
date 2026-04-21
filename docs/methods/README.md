# Anthropic Tool Bridging Methods

Windsurf2API offers **two switchable methods** for supporting Anthropic-style tool calling on `POST /v1/messages`. The active method is controlled by runtime configuration; both paths are compiled into every build and can be swapped without restarting the server.

## Available methods

| Method | When to use |
|---|---|
| [**Native Bridge (Bash)**](./bash-native-bridge-reinjection.md) | When the client must execute Bash locally and you want to reuse Windsurf's own `run_command` proposal flow. Minimal, deterministic, limited to Bash. |
| [**Prompt Emulation**](./system-prompt-tool-emulation.md) | When you need to support arbitrary Anthropic tools without relying on Windsurf's native tool proposals. Wider tool coverage, relies on the model following a strict output protocol. |

## How switching works

- Mode is read from a runtime config file (default: `config/bridge-mode.json`).
- The active mode applies to `/v1/messages` only; OpenAI and Responses endpoints are unaffected.
- Mode changes can take effect without a restart when hot reload is enabled.
- Mode transitions are logged for observability.

Example configuration:

```json
{
  "anthropicToolMode": "native_bridge",
  "hotReload": true,
  "logModeSwitch": true
}
```

Valid values for `anthropicToolMode`:

- `native_bridge`
- `prompt_emulation`

## Shared external contract

Regardless of which method is active, clients see a standard Anthropic Messages response:

- request side: `tools[]`, `tool_choice`, `messages[].content[]` blocks
- assistant side: `tool_use` blocks with `stop_reason: "tool_use"`
- user follow-up: `tool_result` blocks

The two methods differ only in **how the proxy internally satisfies that contract** against the Windsurf Cascade upstream.

## Chinese translations

- [`bash-native-bridge-reinjection-zh.md`](./bash-native-bridge-reinjection-zh.md)
- [`system-prompt-tool-emulation-zh.md`](./system-prompt-tool-emulation-zh.md)
- [`README-zh.md`](./README-zh.md)
