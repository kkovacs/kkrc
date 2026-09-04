## Long-running processes (dev servers, etc.) in GNU screen

```bash
# The 'llm' session must exist. Create it detached if it doesn't:
screen -S llm -Q windows >/dev/null 2>&1 || screen -S llm -d -m

# List windows:
screen -S llm -Q windows                       # list: "0! bash  1 srv" (grep the title)

# Idempotent (re)start: ensure window, stop any old daemon, launch new.
NAME=srv
screen -S llm -Q windows | grep -qw "$NAME" && screen -S llm -X select "$NAME" || screen -S llm -X screen -t "$NAME"; screen -S llm -X select "$NAME" && screen -S llm -X stuff '^C' && sleep 1 && screen -S llm -X eval 'scrollback 0' 'scrollback 10000' && screen -S llm -X clear && screen -S llm -X stuff './server^M' # ^M = Enter
# XXX: if the old daemon ignores SIGINT, force-kill it before this block.

# Verify (hardcopy dumps the selected window to a per-name file; then read it)
screen -S llm -X select "$NAME"
screen -S llm -X hardcopy /tmp/scr-"$NAME" && cat /tmp/scr-"$NAME"        # visible screen only
screen -S llm -X hardcopy -h /tmp/scr-"$NAME" && tail -n 20 /tmp/scr-"$NAME"   # incl. scrollback, last 20 lines

# Stop: Ctrl-C in its own stuff call. Leaves exit/error output on screen for capture - prefer this over `kill`, which destroys the window and the evidence.
screen -S llm -X select "$NAME" && screen -S llm -X stuff '^C'

# Force kill the window (last resort)
screen -S llm -X select "$NAME" && screen -S llm -X kill
```

Gotchas:
- `^M` is Enter, `^C` is Ctrl-C (screen's caret notation). Send `^C` in its own `stuff` call, never chained.
- Create an **empty** shell window, then `stuff` the command — if you make the command the window's program, `^C` kills the window instead of the process.
- Titles are single tokens (no spaces) so `grep -qw` matches reliably.
- Kill/stop **only windows you created**.
- Build the `stuff` string with single quotes or escape `$` — it is sent literally to the *remote* shell; double quotes let your *local* shell eat `$`, `$(...)`, backticks before they ever reach screen.
- `hardcopy` echoes the input line with `$vars` rendered differently from the executed output (screen pty artifact) — trust the output lines, not the echoed prompt line.
