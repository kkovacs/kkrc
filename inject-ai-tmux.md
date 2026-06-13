

## Long-running daemons (dev servers, etc.) in tmux windows

Shared session `llm`. Always target `llm:NAME` (distinct NAMEs; never bare `:NAME`). Bootstrap tmux session (safe to repeat):

```bash
tmux has-session -t llm 2>/dev/null || tmux new-session -d -s llm
```

**Inspect tmux windows:**

```bash
tmux list-windows -t llm -F '#{window_index}: #{window_name}' # list
tmux capture-pane -t llm:NAME -p # get content
```

**Start/restart daemons** (one daemon per window):

```bash
tmux new-window -t llm -S -n NAME # idempotent with -S
tmux send-keys -t llm:NAME C-c # To stop running daemon; always send ctrl+c in separate send-keys
tmux send-keys -t llm:NAME 'command here' Enter
tmux capture-pane -t llm:NAME -p # verify running
```

**Stop** (force kill, last resort):

```bash
tmux kill-window -t llm:NAME
```

Gotchas:
- Always use `-S` + `-n NAME` to create the window if it doesn't exist, otherwise select the existing one.
- Without `-S`, re-running creates duplicate windows with the same name (making `llm:NAME` targets unreliable).
- Start daemons with send-keys after creating an empty window, not as the window command — otherwise C-c kills the window, not just the process.
- Kill/stop **only sessions/windows you created**. Others might be working in the same tmux.


