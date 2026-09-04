# Shared GNU screen session: run & observe daemons for human + AI

One `llm` session where a human + AI watch the SAME output and inject input via `stuff`.
Buffer is CLEANED every restart (previous run is noise -> close+recreate).
Human in-window restart: Ctrl-C, Up, Enter.

```bash
NAME=srv
screen -S llm -Q windows >/dev/null 2>&1 || screen -S llm -d -m   # ensure detached 'llm' session exists
screen -S llm -Q windows   # list windows: "0! bash  1 srv" (grep -w the title)
screen -S llm -Q windows | grep -qw "$NAME" && screen -S llm -p "$NAME" -X kill; screen -S llm -X screen -t "$NAME" && screen -S llm -p "$NAME" -X stuff 'cd /path/to/srv && ./server^M' && sleep 2  # Idempotent (re)start: ensure window, stop any old daemon, launch new. Sleep a little for daemon to start
screen -S llm -p "$NAME" -X hardcopy /tmp/scr-"$NAME" && cat /tmp/scr-"$NAME";   # verify or check output: visible screen
screen -S llm -p "$NAME" -X hardcopy -h /tmp/scr-"$NAME" && tail -n 20 /tmp/scr-"$NAME"   # verify or check output: last 20 lines of scrollback
```

# Gotchas:
- `^M`=Enter, `^C`=Ctrl-C, `^[[A`=Up (screen caret notation: `^[`=ESC). Send `^C` in its own `stuff`, never chained.
- EMPTY shell window (`screen -t NAME`) + `stuff` the cmd; never make the cmd the window program or Ctrl-C kills the window (breaks human Up/Enter restart).
- Titles are single tokens (no spaces) so `grep -qw` matches.
- Recreate resets cwd to session cwd; `cd` inside the launch `stuff` if the daemon needs a specific dir.
- Kill/stop ONLY windows you created.
- Quote the `stuff` string (single quotes) so `$`, `$(...)`, backticks reach the remote shell literally.
- `hardcopy` echoes the input line with `$vars` rendered oddly; trust the output lines, not the echoed prompt.
