#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Chart cumulative cost composition of pi agent sessions.

Each assistant message (API call) is one step on the y-axis.
The stacked bar shows the proportion of cumulative cost from
input, output, cacheRead, and cacheWrite at each step.

Usage:
    uv run session-costs.py              # analyze most expensive session
    uv run session-costs.py -l           # list all sessions with totals
    uv run session-costs.py -s <file>    # analyze a specific session file
    uv run session-costs.py -n 3         # analyze 3rd most expensive session
    uv run session-costs.py -a           # show all turns (no limit)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SESSIONS_DIR = Path.home() / ".pi" / "agent" / "sessions"

# Characters for stacked-bar components, in stacking order
COMPONENTS = [
    ("cacheRead",  "█"),  # darkest
    ("cacheWrite", "▓"),
    ("input",      "▒"),
    ("output",     "░"),  # lightest
]
# ANSI color codes per component (match cost color bands roughly)
BAR_WIDTH = 40
DEFAULT_MAX_TURNS = 60  # don't flood the terminal by default


def collect_sessions(sessions_dir: Path) -> list[tuple[Path, float, int, str]]:
    """Return (path, total_cost, assistant_msg_count, model) for every session, sorted by cost desc."""
    sessions: list[tuple[Path, float, int, str]] = []
    if not sessions_dir.exists():
        return sessions
    for proj_dir in sorted(sessions_dir.iterdir()):
        if not proj_dir.is_dir():
            continue
        for sf in sorted(proj_dir.iterdir()):
            if sf.suffix != ".jsonl":
                continue
            total = 0.0
            n = 0
            model = "?"
            try:
                with open(sf) as f:
                    for line in f:
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if e.get("type") != "message":
                            continue
                        msg = e.get("message", {})
                        if msg.get("role") != "assistant":
                            continue
                        if model == "?":
                            model = msg.get("model", "?")
                        usage = msg.get("usage", {})
                        total += usage.get("cost", {}).get("total", 0.0)
                        n += 1
            except OSError:
                continue
            if n > 0:
                sessions.append((sf, total, n, model))
    sessions.sort(key=lambda s: s[1], reverse=True)
    return sessions


def parse_turns(path: Path) -> list[dict]:
    """Extract per-API-call cost dicts from a session file."""
    turns: list[dict] = []
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("type") != "message":
                continue
            msg = e.get("message", {})
            if msg.get("role") != "assistant":
                continue
            c = msg.get("usage", {}).get("cost", {})
            turns.append({
                "model":    msg.get("model", "?"),
                "provider": msg.get("provider", "?"),
                "input":      c.get("input", 0.0),
                "output":     c.get("output", 0.0),
                "cacheRead":  c.get("cacheRead", 0.0),
                "cacheWrite": c.get("cacheWrite", 0.0),
                "total":      c.get("total", 0.0),
            })
    return turns


def color_cost(value: float, display: str | None = None) -> str:
    """Wrap a dollar amount in ANSI color based on magnitude.

    Colors by *value* but can display a different string (useful for
    cumulative mode: color by delta, show cumulative).
    """
    s = f"${value:.4f}"  # for color determination
    out = display if display is not None else s
    if s == "$0.0000":
        return f"\033[2m{out}\033[0m"        # dim
    if s[1] != "0" or s[3] != "0":   # $X.XXXX or $0.XXXX
        return f"\033[41m{out}\033[0m"     # red bg (inverted)
    if s[4] != "0":   # $0.0XXX
        return f"\033[31m{out}\033[0m"     # red
    if s[5] != "0":   # $0.00XX
        return f"\033[33m{out}\033[0m"     # yellow
    # $0.000X
    return f"\033[32m{out}\033[0m"         # green


def stacked_bar(values: dict[str, float], max_total: float) -> str:
    """Return a BAR_WIDTH-character bar.

    The filled portion width is proportional to values['total'] / max_total.
    Within it, columns are assigned to components by proportion.
    """
    total = values["total"]
    if total <= 0 or max_total <= 0:
        return " " * BAR_WIDTH

    fill = max(1, round(total / max_total * BAR_WIDTH))

    bar: list[str] = []
    for i in range(fill):
        pos = (i + 0.5) / fill
        acc = 0.0
        for key, ch in COMPONENTS:
            acc += values[key]
            if pos <= acc / total:
                bar.append(ch)
                break
        else:
            bar.append(" ")

    bar.extend([" "] * (BAR_WIDTH - fill))
    return "".join(bar)


def render(turns: list[dict], max_turns: int | None = None, cumulative: bool = True) -> str:
    """Render cost chart for a session."""
    if not turns:
        return "No assistant messages with cost data."

    total_turns = len(turns)

    # Build per-step or cumulative cost dicts for all turns
    all_steps: list[dict] = []
    cum = {key: 0.0 for key, _ in COMPONENTS}
    cum["total"] = 0.0
    for t in turns:
        if cumulative:
            for key, _ in COMPONENTS:
                cum[key] += t[key]
            cum["total"] += t["total"]
            all_steps.append(dict(cum))
        else:
            all_steps.append({key: t[key] for key, _ in COMPONENTS} | {"total": t["total"]})

    # Slice to most recent N if needed
    if max_turns is not None and total_turns > max_turns:
        start = total_turns - max_turns
        visible = turns[start:]
        visible_steps = all_steps[start:]
    else:
        start = 0
        visible = turns
        visible_steps = all_steps

    # Scale bars to the max total in the visible range
    scale_max = max(s["total"] for s in visible_steps) if visible_steps else 0.0
    if cumulative:
        scale_max = all_steps[-1]["total"]  # always scale to final cumulative total

    # Width for turn number column
    tw = max(4, len(str(total_turns)))

    lines: list[str] = []

    # Header
    provider = turns[0]["provider"]
    model = turns[0]["model"]
    lines.append(f"  provider : {provider}")
    lines.append(f"  model    : {model}")
    lines.append(f"  api calls: {total_turns}")
    if start > 0:
        lines.append(f"  showing  : turns {start+1}–{total_turns} (most recent {max_turns})")
    lines.append("")
    label = "cumulative cost composition" if cumulative else "per-turn cost composition"
    header = f"{'turn':>{tw}}  {label:^{BAR_WIDTH}}   total  =  cacheR +  cacheW +  input  +  output"
    lines.append(header)
    lines.append(f"{'':->{tw}}  {'':->{BAR_WIDTH}}  {'':-^45}")

    for i, c in enumerate(visible_steps):
        turn_num = start + i + 1
        t = visible[i]  # per-turn delta for coloring
        bar = stacked_bar(c, scale_max)
        if cumulative:
            parts = " + ".join(color_cost(t[key], display=f"${c[key]:.4f}") for key, _ in COMPONENTS)
            total_str = color_cost(t["total"], display=f"${c['total']:.4f}")
        else:
            parts = " + ".join(color_cost(c[key]) for key, _ in COMPONENTS)
            total_str = color_cost(c["total"])
        lines.append(f"{turn_num:>{tw}}  {bar}  {total_str} = {parts}")

    # Legend
    lines.append("")
    legend = "  ".join(f"{ch} {key}" for key, ch in COMPONENTS)
    lines.append(f"  {legend}")

    # Summary breakdown (always from full session)
    full_total = {key: sum(t[key] for t in turns) for key, _ in COMPONENTS}
    full_total["total"] = sum(full_total.values())
    lines.append("")
    lines.append(f"  total       ${full_total['total']:.6f}")
    max_key_w = max(len(k) for k, _ in COMPONENTS)
    for key, _ in COMPONENTS:
        label = key.rjust(max_key_w)
        lines.append(f"  {label}  ${full_total[key]:.6f}")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Chart cumulative cost composition of pi agent sessions"
    )
    parser.add_argument("-s", "--session", type=Path,
                        help="Analyze a specific session file")
    parser.add_argument("-l", "--list", action="store_true",
                        help="List all sessions with total cost and message count")
    parser.add_argument("-n", "--nth", type=int, default=1, metavar="N",
                        help="Analyze Nth most expensive session (default: 1)")
    parser.add_argument("-a", "--all-turns", action="store_true",
                        help="Show all turns (default: cap at most recent 60)")
    parser.add_argument("-c", "--cumulative", action="store_true",
                        help="Cumulative costs instead of per-turn (default)")
    parser.add_argument("--sessions-dir", type=Path, default=SESSIONS_DIR,
                        help="Custom sessions directory")
    args = parser.parse_args()

    if args.session:
        path = args.session
        if not path.exists():
            print(f"Error: session file not found: {path}", file=sys.stderr)
            return 1
    else:
        sessions = collect_sessions(args.sessions_dir)
        if not sessions:
            print("No sessions with cost data found.", file=sys.stderr)
            return 1

        if args.list:
            cw = max(6, max(len(f"${s[1]:.4f}") for s in sessions))
            mw = max(4, max(len(str(s[2])) for s in sessions))
            print(f" {'#':>3}  {'cost':>{cw}}  {'msgs':>{mw}}  {'model':20}  session")
            print(f" {'':->3}  {'':->{cw}}  {'':->{mw}}  {'':->20}  {'':->60}")
            for i, (p, cost, n, model) in enumerate(sessions):
                print(f" {i+1:3d}  ${cost:{cw-1}.4f}  {n:>{mw}d}  {model:20}  {p}")
            return 0

        if args.nth < 1 or args.nth > len(sessions):
            print(f"Error: -n {args.nth} out of range (1..{len(sessions)})", file=sys.stderr)
            return 1

        path, total_cost, n_msgs, _model = sessions[args.nth - 1]
        print(f"Session: {path}")
        print(f"Cost:    ${total_cost:.6f}  ({n_msgs} assistant messages)")
        print()

    turns = parse_turns(path)
    max_turns = None if args.all_turns else DEFAULT_MAX_TURNS
    print(render(turns, max_turns, cumulative=args.cumulative))
    return 0


if __name__ == "__main__":
    sys.exit(main())
