

## Long-running daemons (dev servers, etc.) in tmux windows

Shared session `llm`. Always target `llm:NAME` (distinct NAMEs; never bare `:NAME`). Bootstrap tmux session (safe to repeat):

```bash
tmux has-session -t llm 2>/dev/null || tmux new-session -d -s llm
```

Inspect:

```bash
tmux list-windows -t llm
tmux capture-pane -t llm:NAME -p
```

Initial start (one daemon per window; duplicate NAMEs lead to errors; wait for startup):

```bash
tmux new-window -t llm -n NAME; tmux send-keys -t llm:NAME 'command here' Enter
```

Restart (same window; preferred for updates):

```bash
tmux send-keys -t llm:NAME C-c; tmux send-keys -t llm:NAME 'command here' Enter
tmux capture-pane -t llm:NAME -p
```

Stop (force kill, last resort):

```bash
tmux kill-window -t llm:NAME || true
```


