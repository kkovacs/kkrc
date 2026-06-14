

## Long-running daemons (dev servers, etc.) in tmux windows

Shared session `llm`, unless told otherwise. Always target `llm:NAME` (distinct NAMEs; never bare `:NAME`). Use these commands:

```bash
tmux has-session -t llm 2>/dev/null || tmux new-session -d -s llm # Bootstrap tmux session
tmux list-windows -t llm -F '#{window_index}: #{window_name}' # list windows
tmux new-window -t llm -S -n NAME # Idempotent
tmux send-keys -t llm:NAME C-c # To stop running daemon. Always send ctrl+c in separate send-keys!
tmux send-keys -t llm:NAME 'command here' Enter # Start the daemon
tmux capture-pane -t llm:NAME -p # Verify running; check for errors; add `-S - | tail` for more scrollback
tmux kill-window -t llm:NAME # Force kill, last resort; kills session if last window killed
```

Gotchas:
- Always use `-S` + `-n NAME` together: creates the window if it doesn't exist, otherwise selects the existing one.
- Without `-S`, new-window creates duplicate windows with the same name, making `llm:NAME` targets unreliable.
- Start daemons with send-keys after creating an empty window, not as the window command — otherwise C-c kills the window, not just the process.
- Kill/stop **only sessions/windows you created**. Others might be working in the same tmux.


