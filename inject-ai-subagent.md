

## Dispatching subagents via `pi`

A subagent is a **separate LLM session**: different model, fresh context, no workspace knowledge unless included in the prompt. Use for isolation, parallelism, specialisation.

1. **Limited, immutable subagent (only sees prompt and attached files, no file read/write/bash):** `pi --print --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --model <provider>/<model> [@file1.md] [@file2.jpg] "<prompt>"`
2. **Subagent with filesystem access, bash, skills:** `pi --print --model <provider>/<model> "<prompt>"`

Especially for the immutable agent, use `@file.md` or `@image.jpg` (vision models only) to attach the contents of a file. More info: `pi --help`

Parallel fan-out: background each call (`&`), redirect to `/tmp/subagent-<id>.md`, then `wait` — watch rate limits.

The `--print` option makes `pi` exit on ready, else it waits for user input. Remove `--print` only if instructed to run it in a `tmux` window.

**Gotchas:**
- `@file.md` loads as a file *attachment*; some models (e.g. MiniMax-M3) treat it as external input rather than prompt text. To prompt from a file, use `"$(cat prompt.md)"`.
- Always capture output to a file or variable; otherwise it interleaves with main session logs.

Run `pi --list-models` for the authoritative list; the last (`images`) column shows vision support (`yes`/`no`).

Model: prefer `opencode-go/` (flat subscription). Cheap bulk: `opencode-go/deepseek-v4-flash`.


