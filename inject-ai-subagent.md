

## Dispatching subagents via `pi`

A subagent is a **separate LLM session** — different model, fresh context, no workspace knowledge unless included in the prompt. Use for isolation, parallelism, specialisation.

`pi --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-context-files --model <model> --print "<prompt>"`

Shorthand: `-nt -ne -ns -np -nc`. Use `@file.md` to load prompt from a file, `@image.jpg` to attach (vision models only).

Model: prefer `opencode-go/` (flat subscription). Default: `opencode-go/minimax-m3`. Cheap bulk: `opencode-go/deepseek-v4-flash`. Run `pi --list-models | grep opencode-go` for the authoritative list.

Parallel fan-out: background each call (`&`), redirect to `/tmp/subagent-<id>.md`, then `wait` — watch rate limits.

Always capture output to a file or variable; otherwise it interleaves with main session logs.


