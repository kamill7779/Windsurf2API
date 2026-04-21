## Summary

<!-- One-liner describing what this branch is for. -->

## Prefix

<!-- Choose one of the current branch prefixes in this repo. -->

- `feat/<topic>`
- `research/<topic>`

## Rules

<!-- Keep branch names aligned with the current repository convention. -->

- Use lowercase only.
- Use kebab-case for the topic segment.
- Keep exactly one `/` between prefix and topic.
- Make the topic short, specific, and tied to one line of work.
- If continuing or recovering an existing line, keep the topic stem stable and only add a small qualifier such as `recover-`, `-next`, or `-current`.

## When To Use

<!-- Match the branch purpose to the correct prefix. -->

- `feat/`
  Use for implementation work intended to become a normal development branch.
- `research/`
  Use for reverse engineering, probes, experiments, or other investigation-heavy work.

## Examples

<!-- Real examples based on the current repository naming style. -->

- `feat/system-prompt-tool-emulation`
- `feat/recover-system-prompt-tool-emulation`
- `research/cc-bash-bridge-next`
- `research/cc-bash-mvp-current`

## Do Not Use

<!-- Keep naming predictable and easy to scan. -->

- Do not create new work branches directly on `main`.
- Do not use spaces, uppercase letters, or underscores.
- Do not invent new prefixes unless the repository convention is updated first.
