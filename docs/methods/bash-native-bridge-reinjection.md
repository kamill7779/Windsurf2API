# Native Bridge Mode — Bash Reinjection

**One of two switchable Anthropic tool methods.** See [`README.md`](./README.md) for mode selection.

This method supports Claude Code style `Bash` tool calls by reusing the `run_command` proposal flow that Windsurf Cascade already exposes natively. It turns a Cascade native proposal into an Anthropic `tool_use`, lets the downstream client execute the command locally, then reinjects the execution result back into the same Cascade session so generation can continue.

## Short version

1. Downstream requests a Bash tool via Anthropic `tools[]`.
2. Upstream Windsurf natively emits a `run_command` proposal.
3. The proxy converts that proposal into Anthropic `tool_use(name="Bash")`.
4. The client executes locally and returns `tool_result` with stdout, stderr, and exit code.
5. The proxy replays that result back into the same Cascade trajectory so the model can continue.

This is **not** prompt injection and **not** direct execution by the language server. It is:

- native tool proposal capture
- client-side local execution
- result reinjection into the original session
- continued generation on the same trajectory

## Scope

Applies to:

- `POST /v1/messages`
- Claude Code style Bash tool calls
- Scenarios where commands must run in the client's local environment

Does not cover:

- Arbitrary non-Bash tool bridging
- OpenAI / Responses tool surfaces (those endpoints remain unsupported for tools in this mode)
- Tool flows that must run inside the upstream model's own sandbox

## Core idea

A single tool turn is split into two halves.

**First half — Windsurf:**

- receives the conversation
- in its native planning stage, proposes `run_command` with a concrete command line

**Second half — proxy + client:**

- proxy converts the proposal into Anthropic `tool_use(Bash)`
- client executes in its local environment
- proxy reinjects the result into the same Cascade trajectory

From the client's perspective this looks like a standard Anthropic tool turn. From Cascade's perspective it looks like a continuation of its own native Bash interaction flow.

## End-to-end flow

### 1. Receive an Anthropic request with Bash tools

The proxy inspects `tools[]` and detects a Bash-compatible declaration (for example, a tool named `Bash`, `bash`, or `run_command`).

If no compatible tool is declared, this mode exits and the request is handled as a plain Anthropic conversation or rejected as unsupported.

### 2. Run native planning and capture the proposal

The proxy makes an ordinary Cascade request using the default planner mode, allowing Windsurf to perform its own tool planning.

As soon as a `run_command` proposal appears in the streamed trajectory, the proxy treats it as a candidate for outbound `tool_use`. At that moment the proxy records the minimum context required to resume this trajectory later, including:

- cascade id
- trajectory id
- the step where the proposal appeared
- the associated tool call id
- the proposed command line

### 3. Return an Anthropic `tool_use` to the client

Once the proposal is captured, the proxy stops advancing the upstream trajectory and returns an Anthropic-compatible response:

- `tool_use` block with `name: "Bash"` and the proposed command as input
- `stop_reason: "tool_use"`

The downstream client now owns execution.

### 4. Accept a `tool_result` from the client

When the client runs the command locally and returns a `tool_result`, the proxy extracts:

- `tool_use_id`
- stdout
- stderr
- exit code

The `tool_use_id` is used to look up the stored bridge session so the result is reinjected into the correct trajectory.

### 5. Reinject the result via the interaction channel (primary path)

The default reinjection strategy uses Windsurf's existing `run_command` interaction channel, not a plain-text echo.

The proxy synthesizes a shell replay command that reproduces the client's execution result:

- if the command succeeded cleanly, the replay produces only stdout
- if there is stderr or a non-zero exit code, the replay reproduces stdout, stderr, and the original exit status

The proxy then sends a confirmation against the original proposal step, with this synthesized command line as the submitted command. The goal is **not** to run the command again — it is to make the upstream state machine accept that this Bash step has produced exactly these results.

### 6. Collect continuation and return the final answer

Once the reinjection is accepted, the proxy pulls subsequent trajectory steps and wraps the resulting assistant text back into a standard Anthropic assistant response.

From the client's point of view, this completes a clean loop:

- `tool_use`
- local execution
- `tool_result`
- final `assistant` message

## Fallback path

If the interaction channel does not advance the trajectory, the proxy falls back to a more conservative path in two stages:

1. **Idle the cascade.** Cancel the current invocation and wait for it to return to an idle state.
2. **Replay path A — additional steps.** Send a new user message carrying synthetic `run_command` and command-status steps, asking the upstream to continue from there.
3. **Replay path B — ground-truth replay.** If additional steps still do not advance, replay the original proposal step together with the synthetic result steps through the ground-truth replay channel.

The bridge therefore has an **interaction-first, replay-as-fallback** two-layer structure.

## Why synthetic shell replay is necessary

The downstream client returns structured execution data, but the upstream's known stable entry point is a Bash interaction confirmation. These are not the same data shape.

The synthesized replay command is a **semantic translator**:

- it does not require the language server to parse `tool_result` objects
- it does not re-execute the original command
- it only needs the upstream state machine to accept one equivalent execution outcome

That translation step is what makes the reinjection route viable at all.

## Advantages

- Preserves the Anthropic external contract; Claude Code works with standard tools
- No prompt-level emulation; the model never sees a custom tool protocol
- Reuses a Windsurf-native interaction channel that is already validated
- Bash executes in the client's local environment, matching expected tool semantics
- Two-layer recovery: interaction-first, replay-as-fallback

## Limitations

- Currently scoped to the minimal Bash bridge; other tool proposals are not automatically bridged through this path
- The upstream must actually produce a `run_command` proposal; if native planning chooses a different path, this mode produces no tool call
- Assumes the client can reliably execute Bash locally and return structured stdout / stderr / exit code

## Validation checklist

At minimum verify:

1. A request with a Bash tool declaration returns a standard Anthropic `tool_use`.
2. The command carried by `tool_use` matches the upstream native proposal.
3. The follow-up `tool_result` is routed to the correct bridge session using `tool_use_id`.
4. After reinjection, the original Cascade trajectory continues rather than stalling on the proposal step.
5. The final response to the client is a normal assistant message, with no internal bridge artifacts leaking out.
6. When interaction reinjection fails, the fallback path either completes or returns a clear error boundary.

## When to choose this mode

Choose `native_bridge` when:

- the goal is a working Bash tool loop with Claude Code clients first
- commands should execute in the client's local environment
- you want to rely on an already-validated Windsurf native interaction channel
- you explicitly do not want to inject tool protocols into the model's prompt

Prefer [`prompt_emulation`](./system-prompt-tool-emulation.md) when you need arbitrary tool coverage beyond Bash and you accept a prompt-level protocol.
