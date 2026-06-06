

## Dispatching subagents via `pi`

A subagent is a **separate LLM session** — different model, fresh context, no workspace knowledge unless included in the prompt. Use for isolation, parallelism, specialisation.

`pi --print --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --model <model> "<prompt>"`

Shorthand: `-p -nt -ne -ns -np -nc`. Use `@file.md` to load prompt from a file, `@image.jpg` to attach (vision models only). More info: `pi --help`

Model: prefer `opencode-go/` (flat subscription). Cheap bulk: `opencode-go/deepseek-v4-flash`. Run `pi --list-models` for the authoritative list; the `images` column shows vision support (`yes`/`no`).

Parallel fan-out: background each call (`&`), redirect to `/tmp/subagent-<id>.md`, then `wait` — watch rate limits.

**Gotchas:**
- `@file.md` loads as a file *attachment*; some models (e.g. MiniMax-M3) treat it as external input rather than prompt text. For reliable inline loading, use `"$(cat file.md)"`.
- Always capture output to a file or variable; otherwise it interleaves with main session logs.


