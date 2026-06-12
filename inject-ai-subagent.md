

## Dispatching subagents via `pi`

A subagent is a **separate LLM session**: different model, fresh context, no workspace knowledge unless included in the prompt. Use for isolation, parallelism, specialisation.

- **Immutable subagent (only sees prompt and optional attached files):** `pi --print --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --model <provider>/<model> [@file1.md] [@file2.jpg] "<prompt>"`
- **Subagent with full filesystem and bash access:** `pi --print --no-session --model <model> "<prompt>"`

Especially for the immutable agent, use `@file.md` to attach the contents of a file, or `@image.jpg` (vision models only). More info: `pi --help`

Run `pi --list-models` for the authoritative list; the last (`images`) column shows vision support (`yes`/`no`).

Parallel fan-out: background each call (`&`), redirect to `/tmp/subagent-<id>.md`, then `wait` — watch rate limits.

**Gotchas:**
- `@file.md` loads as a file *attachment*; some models (e.g. MiniMax-M3) treat it as external input rather than prompt text. For prompt from a file, use `"$(cat file.md)"`.
- Always capture output to a file or variable; otherwise it interleaves with main session logs.

Model: prefer `opencode-go/` (flat subscription). Cheap bulk: `opencode-go/deepseek-v4-flash`.


