

## Dispatching subagents via `pi`

A subagent is a **separate LLM session**: different model, fresh context, no workspace knowledge unless included in the prompt. Use for isolation, parallelism, specialisation.

1. **Isolated subagent (only sees prompt and attached files, no fs read/write/bash):** `pi --print --no-tools --no-extensions --no-skills --no-context-files --model <provider>/<model> [@file1.md] [@file2.jpg] "<prompt>"`
1. **Subagent with read-only tools:** `pi --print --tools read,grep,find,ls --no-extensions --no-skills --model <provider>/<model> "<prompt>"`
2. **Subagent with full fs and bash access:** `pi --print --model <provider>/<model> "<prompt>"`

**Gotchas/notes:**
- Especially for the isolated agent, use `@file.md` or `@image.jpg` (vision models only) to attach the contents of a file. More info: `pi --help`
- `@file.md` loads as a file *attachment*; some models treat it as external input rather than prompt text. To prompt from a file, use `"$(cat prompt.md)"`.
- The `--print` option makes `pi` exit on ready, else it waits for user input. Remove `--print` only if you run pi interactively in a `tmux` window.
- Parallel fan-out: background each call (`&`), redirect output, then `wait` — watch rate limits.
- Always capture output to a file or variable; otherwise it interleaves with main session logs.

Run `pi --list-models` for the authoritative list; the last (`images`) column shows vision support (`yes`/`no`).

Model: prefer `opencode-go/` (flat subscription). Cheap bulk: `opencode-go/deepseek-v4-flash`.


