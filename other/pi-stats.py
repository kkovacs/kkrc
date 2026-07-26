#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Visual dashboard summary of pi agent sessions.

Default mode shows hourly cost chart (all sessions aggregated) + model breakdown.

Usage:
    uv run pi-sum.py                 # hourly bars + model breakdown
    uv run pi-sum.py -l              # list recent sessions
    uv run pi-sum.py -n N            # Nth most expensive session (detail)
    uv run pi-sum.py -s <guid>        # specific session by GUID substring
    uv run pi-sum.py -n N -a         # show all turns (no 60-turn cap)
    uv run pi-sum.py -n N -c         # cumulative costs in session detail
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SESSIONS_DIR = Path.home() / ".pi" / "agent" / "sessions"

# Cost components in stacking order (bottom → top of bar)
COMPONENTS = [
    ("cacheRead",  "█", "cacheRd"),
    ("cacheWrite", "▓", "cacheWr"),
    ("input",      "▒", "context"),
    ("output",     "░", "outputs"),
]

BAR_WIDTH = 40

# ─── ANSI helpers ──────────────────────────────────────────────

def color_cost(value: float, display: str | None = None) -> str:
    """Wrap a dollar amount in ANSI color by magnitude.

    Colors by *value* but can show a different *display* string —
    useful in cumulative mode where you color by the per-step delta
    but show the running cumulative total.
    """
    if display is None:
        display = f"${value:.4f}"
    if value <= 0.0001:
        return f"\033[2m{display}\033[0m"      # dim
    if value >= 1.0:
        return f"\033[41m{display}\033[0m"     # red bg (dollars)
    if value >= 0.50:
        return f"\033[31m{display}\033[0m"     # red (half-dollar to $1)
    if value >= 0.10:
        return f"\033[35m{display}\033[0m"     # magenta (dimes to half-dollar)
    if value >= 0.01:
        return f"\033[33m{display}\033[0m"     # yellow (cents)
    return f"\033[32m{display}\033[0m"         # green (sub-cent)


def component_bar(comps: dict[str, float], max_total: float) -> str:
    """Return a BAR_WIDTH-character bar stacked by cost component.

    The filled portion width is proportional to comps['total'] / max_total.
    Within it, columns are assigned to components by proportion.
    """
    total = comps["total"]
    if total <= 0 or max_total <= 0:
        return " " * BAR_WIDTH

    fill = min(BAR_WIDTH, max(1, round(total / max_total * BAR_WIDTH)))

    bar: list[str] = []
    for i in range(fill):
        pos = (i + 0.5) / fill
        acc = 0.0
        for key, ch, *_ in COMPONENTS:
            acc += comps[key]
            if pos <= acc / total:
                bar.append(ch)
                break
        else:
            bar.append(" ")

    bar.extend([" "] * (BAR_WIDTH - fill))
    return "".join(bar)


_COMPONENT_LEGEND = "  " + "  ".join(f"{ch} {display}" for _, ch, display in COMPONENTS)


# ─── data collection ───────────────────────────────────────────

def _session_guid(path: Path) -> str:
    """Extract the GUID from a session filename.

    Filenames like 2026-07-26T09-27-45-112Z_019f9dc0-...jsonl → 019f9dc0-...
    """
    return path.stem.rsplit("_", 1)[-1]


def _find_by_guid(sessions_dir: Path, needle: str) -> list[Path]:
    """Find session files whose GUID contains *needle* (case-insensitive)."""
    results: list[Path] = []
    if not sessions_dir.exists():
        return results
    needle_lower = needle.lower()
    for proj_dir in sessions_dir.iterdir():
        if not proj_dir.is_dir():
            continue
        for sf in proj_dir.iterdir():
            if sf.suffix != ".jsonl":
                continue
            if needle_lower in _session_guid(sf).lower():
                results.append(sf)
    return results


def _parse_ts(ts_str: str | None) -> datetime | None:
    """Parse an ISO timestamp string to a timezone-aware UTC datetime."""
    if not ts_str:
        return None
    try:
        return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except ValueError:
        return None


def collect_all(sessions_dir: Path) -> dict[str, Any]:
    """Single-pass collection of all session data.

    Returns dict with keys: messages, sessions, user_ts, model_turns.
    """
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, set[int]] = defaultdict(set)

    if not sessions_dir.exists():
        return {
            "messages": messages, "sessions": sessions,
            "user_ts": user_ts, "model_turns": {},
        }

    for proj_dir in sorted(sessions_dir.iterdir()):
        if not proj_dir.is_dir():
            continue
        for sf in sorted(proj_dir.iterdir()):
            if sf.suffix != ".jsonl":
                continue

            total = 0.0
            n = 0
            model = "?"
            provider = "?"
            start_ts = None
            end_ts = None
            costs = {"cacheRead": 0.0, "cacheWrite": 0.0, "input": 0.0, "output": 0.0}
            n_turns = 0
            turn_idx = 0

            try:
                with open(sf) as f:
                    for line in f:
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        ts = _parse_ts(e.get("timestamp"))
                        if start_ts is None:
                            start_ts = ts
                        if ts is not None:
                            end_ts = ts

                        if e.get("type") != "message":
                            continue

                        msg = e.get("message", {})
                        role = msg.get("role")

                        if role == "user":
                            n_turns += 1
                            turn_idx += 1
                            if ts is not None:
                                user_ts.append(ts)
                            continue

                        if role != "assistant":
                            continue

                        if model == "?":
                            model = msg.get("model", "?")
                            provider = msg.get("provider", "?")

                        cost = msg.get("usage", {}).get("cost", {})
                        cost_dict = {
                            "input": cost.get("input", 0.0),
                            "output": cost.get("output", 0.0),
                            "cacheRead": cost.get("cacheRead", 0.0),
                            "cacheWrite": cost.get("cacheWrite", 0.0),
                            "total": cost.get("total", 0.0),
                        }

                        # Per-message model/provider (may differ across a session)
                        msg_model = msg.get("model", "?")
                        if cost:
                            messages.append({
                                "timestamp": ts,
                                "model": msg_model,
                                "provider": msg.get("provider", "?"),
                                "cost": cost_dict,
                                "session": sf,
                            })

                        total += cost_dict["total"]
                        for key in costs:
                            costs[key] += cost_dict[key]
                        n += 1

                        if msg_model and msg_model != "?":
                            model_turns[msg_model].add(turn_idx)
            except OSError:
                continue

            if n > 0:
                costs["total"] = total
                sessions.append({
                    "path": sf,
                    "guid": _session_guid(sf),
                    "total": total,
                    "calls": n,
                    "model": model,
                    "provider": provider,
                    "start_ts": start_ts,
                    "end_ts": end_ts,
                    "costs": costs,
                    "turns": n_turns,
                })

    messages.sort(key=lambda m: m["timestamp"] or datetime.min.replace(tzinfo=timezone.utc))
    sessions.sort(key=lambda s: s["start_ts"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    user_ts.sort()

    return {
        "messages": messages,
        "sessions": sessions,
        "user_ts": user_ts,
        "model_turns": {m: len(turns) for m, turns in model_turns.items()},
    }


# ─── grouping helpers ──────────────────────────────────────────

def _to_local(dt: datetime | None) -> datetime | None:
    """Convert UTC datetime to local time."""
    if dt is None:
        return None
    return dt.astimezone()


def group_by_hour(messages: list[dict]) -> dict[int, list[dict]]:
    """Group messages by hour-of-day (0-23)."""
    groups: dict[int, list[dict]] = defaultdict(list)
    for m in messages:
        ts = m["timestamp"]
        if ts is None:
            continue
        groups[_to_local(ts).hour].append(m)
    return dict(groups)


def group_by_model(messages: list[dict]) -> dict[str, list[dict]]:
    """Group messages by model name."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for m in messages:
        groups[m["model"]].append(m)
    return dict(groups)


# ─── rendering helpers ─────────────────────────────────────────

def msg_total(msgs: list[dict]) -> float:
    return sum(m["cost"]["total"] for m in msgs)


def _n_sessions(msgs: list[dict]) -> int:
    """Count unique session files among a list of messages."""
    return len(set(m["session"] for m in msgs))


def msg_cost_components(msgs: list[dict]) -> dict[str, float]:
    comps: dict[str, float] = {}
    for key, _, *_ in COMPONENTS:
        comps[key] = sum(m["cost"][key] for m in msgs)
    comps["total"] = sum(comps.values())
    return comps


_ANSI_RE = re.compile(r'\033\[[0-9;]*m')

def _ansi_ljust(s: str, width: int) -> str:
    """Left-justify a string that may contain ANSI escapes."""
    return s + " " * (width - len(_ANSI_RE.sub('', s)))


_COL_W = 7  # width of each $X.XXXX column
_COST_COLS = "  ".join(f"{h:<{_COL_W}}" for h in ["total"] + [d for _, _, d in COMPONENTS])
_COST_DASH = "  ".join(["─" * _COL_W] * (len(COMPONENTS) + 1))


def _cost_columns(comps: dict[str, float]) -> str:
    """Return 5 space-separated, color-coded, right-aligned dollar columns."""
    parts = [color_cost(comps.get("total", 0.0))]
    for key, _, *_ in COMPONENTS:
        parts.append(color_cost(comps.get(key, 0.0)))
    return "  ".join(_ansi_ljust(p, _COL_W) for p in parts)


# ─── user-message (turn) counting ─────────────────────────────

def _count_by_hour(timestamps: list[datetime]) -> dict[int, int]:
    """Count timestamps per hour 0-23."""
    counts: dict[int, int] = defaultdict(int)
    for ts in timestamps:
        counts[_to_local(ts).hour] += 1
    return dict(counts)


# ─── section renderers ─────────────────────────────────────────

def _date_range_label(messages: list[dict]) -> str:
    """Return a label like '2026-07-26' or '2026-07-24 – 2026-07-26'."""
    dates: set[str] = set()
    for m in messages:
        ts = m["timestamp"]
        if ts is None:
            continue
        dates.add(_to_local(ts).strftime("%Y-%m-%d"))
    if not dates:
        return "no data"
    if len(dates) == 1:
        return next(iter(dates))
    return f"{min(dates)} – {max(dates)}"


def render_header(
    messages: list[dict],
    sessions: list[dict],
    *,
    n_turns: int = 0,
) -> str:
    """Top-of-dashboard header block."""
    total = msg_total(messages)
    n_sessions = len(sessions)
    n_calls = len(messages)
    date_label = _date_range_label(messages)

    lines = [
        f"  pi summary — {date_label}",
        "  " + "─" * 58,
        f"  sessions: {n_sessions:<4}  calls: {n_calls:<5}  turns: {n_turns:<5}  total: {color_cost(total)}",
    ]
    return "\n".join(lines)


def render_hourly_chart(hour_groups: dict[int, list[dict]],
                        turn_counts: dict[int, int] | None = None) -> str:
    """Render hourly cost bar chart (0–23).

    *turn_counts* maps hour → number of user prompts (conversation turns).
    """
    if not hour_groups:
        return "  (no data for this period)"

    max_cost = max(msg_total(msgs) for msgs in hour_groups.values())
    if turn_counts is None:
        turn_counts = {}

    # Find active range: first and last hour with any data
    active = [h for h in range(24) if hour_groups.get(h) or turn_counts.get(h, 0) > 0]
    if not active:
        return "  (no data for this period)"
    first_hour, last_hour = active[0], active[-1]

    lines = [
        "",
        f"  {'hour':5}  {'bar':^{BAR_WIDTH}}  {_COST_COLS}  calls/turns/sessions",
        f"  {'─' * 5}  {'─' * BAR_WIDTH}  {_COST_DASH}  {'─' * 22}",
    ]

    for hour in range(first_hour, last_hour + 1):
        msgs = hour_groups.get(hour, [])
        total = msg_total(msgs)
        n_calls = len(msgs)
        n_turns = turn_counts.get(hour, 0)
        if total <= 0 and n_turns <= 0:
            lines.append(f"  {hour:02d}:00  \033[2m·\033[0m")
        else:
            comps = msg_cost_components(msgs)
            bar = component_bar(comps, max_cost)
            cols = _cost_columns(comps)
            n_sess = _n_sessions(msgs)
            tail = f"{n_calls}c"
            if n_turns > 0:
                tail += f" · {n_turns}t"
            if n_sess > 0:
                tail += f" · {n_sess}s"
            lines.append(f"  {hour:02d}:00  {bar}  {cols}  {tail}")

    lines.append("")
    lines.append(_COMPONENT_LEGEND)

    return "\n".join(lines)


def render_model_breakdown(messages: list[dict],
                           model_turns: dict[str, int] | None = None) -> str:
    """Model usage with component-stacked bars, same format as hourly chart."""
    if not messages:
        return "  (no data)"

    model_groups = group_by_model(messages)
    total = msg_total(messages)
    # Scale bars so the overall total fills 100% width; models are proportional
    max_total = total
    if model_turns is None:
        model_turns = {}

    # Sort by cost descending
    sorted_models = sorted(model_groups.items(), key=lambda kv: msg_total(kv[1]), reverse=True)

    lines = [
        "",
        f"  {'model':35}  {'bar':^{BAR_WIDTH}}  {_COST_COLS}  calls/turns/sessions",
        f"  {'─' * 35}  {'─' * BAR_WIDTH}  {_COST_DASH}  {'─' * 22}",
    ]

    for model, msgs in sorted_models:
        mt = msg_total(msgs)
        n_calls = len(msgs)
        provider = msgs[0]["provider"] if msgs else "?"
        comps = msg_cost_components(msgs)
        bar = component_bar(comps, max_total)
        cols = _cost_columns(comps)
        label = f"{model} ({provider})"
        n_sess = _n_sessions(msgs)
        n_turns = model_turns.get(model, 0)
        tail = f"{n_calls}c"
        if n_turns > 0:
            tail += f" · {n_turns}t"
        if n_sess > 0:
            tail += f" · {n_sess}s"
        lines.append(f"  {label:<35}  {bar}  {cols}  {tail}")

    # Total line (aggregate of all models)
    if total > 0:
        comps_all = msg_cost_components(messages)
        bar_all = component_bar(comps_all, max_total)
        cols_all = _cost_columns(comps_all)
        n_sess_all = _n_sessions(messages)
        n_turns_all = sum(model_turns.values()) if model_turns else 0
        tail_all = f"{len(messages)}c"
        if n_turns_all > 0:
            tail_all += f" · {n_turns_all}t"
        if n_sess_all > 0:
            tail_all += f" · {n_sess_all}s"
        lines.append(f"  {'(total)':<35}  {bar_all}  {cols_all}  {tail_all}")

    return "\n".join(lines)


def render_session_list(sessions: list[dict], limit: int = 20) -> str:
    """List recent sessions with component-stacked bars."""
    if not sessions:
        return "  No sessions with cost data found."

    visible = sessions[:limit]
    max_total = max(s["total"] for s in visible) if visible else 0.0

    # Precompute time-range strings for header width
    time_strs: list[str] = []
    for s in visible:
        start = _to_local(s["start_ts"])
        end = _to_local(s.get("end_ts"))
        if start and end:
            if start.date() == end.date():
                time_strs.append(f"{start.strftime('%Y-%m-%d %H:%M')} – {end.strftime('%H:%M')}")
            else:
                time_strs.append(f"{start.strftime('%Y-%m-%d %H:%M')} – {end.strftime('%Y-%m-%d %H:%M')}")
        elif start:
            time_strs.append(start.strftime("%Y-%m-%d %H:%M"))
        else:
            time_strs.append("?")
    TIME_W = max((len(s) for s in time_strs), default=4)

    GUID_W = 36  # UUID length
    lines = [
        "",
        f"  Recent sessions (showing {min(limit, len(sessions))} of {len(sessions)})",
        f"  {'time':{TIME_W}}  {'guid':{GUID_W}}  {'bar':^{BAR_WIDTH}}  {_COST_COLS}  calls/turns",
        f"  {'─' * TIME_W}  {'─' * GUID_W}  {'─' * BAR_WIDTH}  {_COST_DASH}  {'─' * 11}",
    ]

    for i, s in enumerate(visible):
        comps = s["costs"]
        bar = component_bar(comps, max_total)
        cols = _cost_columns(comps)
        tail = f"{s['calls']}c"
        if s.get("turns", 0) > 0:
            tail += f" · {s['turns']}t"
        lines.append(f"  {time_strs[i]:{TIME_W}}  {s['guid']:{GUID_W}}  {bar}  {cols}  {tail}")

    lines.append("")
    lines.append(_COMPONENT_LEGEND)

    return "\n".join(lines)


# ─── session detail (drill-down) ──────────────────────────────

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
                "timestamp": e.get("timestamp"),
                "model":    msg.get("model", "?"),
                "provider": msg.get("provider", "?"),
                "cacheRead":  c.get("cacheRead", 0.0),
                "cacheWrite": c.get("cacheWrite", 0.0),
                "input":      c.get("input", 0.0),
                "output":     c.get("output", 0.0),
                "total":      c.get("total", 0.0),
            })
    return turns


def render_session_detail(turns: list[dict], max_turns: int | None = None,
                          cumulative: bool = False, guid: str = "?") -> str:
    """Render per-step cost chart for a single session."""
    if not turns:
        return "  No assistant messages with cost data."

    total_steps = len(turns)

    if cumulative:
        # Build cumulative cost at each step
        steps: list[dict] = []
        cum = {"cacheRead": 0.0, "cacheWrite": 0.0, "input": 0.0, "output": 0.0, "total": 0.0}
        for t in turns:
            for key, _, *_ in COMPONENTS:
                cum[key] += t[key]
            cum["total"] += t["total"]
            steps.append(dict(cum))
        mode_label = "cumulative cost"
    else:
        # Per-step (non-cumulative)
        steps = [{key: t[key] for key, _, *_ in COMPONENTS} | {"total": t["total"]} for t in turns]
        mode_label = "per-step cost"

    # Slice to most recent N if needed
    if max_turns is not None and total_steps > max_turns:
        start = total_steps - max_turns
        visible_turns = turns[start:]
        visible_steps = steps[start:]
        shown_label = f"  showing  : steps {start+1}–{total_steps} (most recent {max_turns})"
    else:
        start = 0
        visible_turns = turns
        visible_steps = steps
        shown_label = ""

    # Scale bars to max in visible range (or final cumulative for cumulative mode)
    if cumulative:
        scale_max = steps[-1]["total"] if steps else 0.0
    else:
        scale_max = max((s["total"] for s in visible_steps), default=0.0)

    # Unique model/provider pairs in this session
    seen: set[tuple[str, str]] = set()
    for t in turns:
        seen.add((t["model"], t["provider"]))
    model_parts = [f"{m} ({p})" for m, p in seen]
    models_str = ", ".join(model_parts) if model_parts else "?"

    # Time range
    tss = [_parse_ts(t.get("timestamp")) for t in turns]
    tss = [ts for ts in tss if ts is not None]
    time_range = "?"
    if tss:
        first = _to_local(min(tss))
        last = _to_local(max(tss))
        if first and last:
            if first.date() == last.date():
                time_range = f"{first.strftime('%Y-%m-%d %H:%M')} – {last.strftime('%H:%M')}"
            else:
                time_range = f"{first.strftime('%Y-%m-%d %H:%M')} – {last.strftime('%Y-%m-%d %H:%M')}"

    tw = max(4, len(str(total_steps)))

    # ── chart ──
    lines = [
        "",
        f"  {'step':>{tw}}  {mode_label:^{BAR_WIDTH}}  {_COST_COLS}",
        f"  {'─' * tw}  {'─' * BAR_WIDTH}  {_COST_DASH}",
    ]

    for i, (delta, step) in enumerate(zip(visible_turns, visible_steps)):
        step_num = start + i + 1
        bar = component_bar(step, scale_max)
        if cumulative:
            parts = [color_cost(delta["total"], display=f"${step['total']:.4f}")]
            for key, _, *_ in COMPONENTS:
                parts.append(color_cost(delta[key], display=f"${step[key]:.4f}"))
        else:
            parts = [color_cost(step["total"])]
            for key, _, *_ in COMPONENTS:
                parts.append(color_cost(step.get(key, 0.0)))
        cols = "  ".join(_ansi_ljust(p, _COL_W) for p in parts)
        lines.append(f"  {step_num:>{tw}}  {bar}  {cols}")

    lines.append("")
    lines.append(_COMPONENT_LEGEND)

    # ── session info (below chart) ──
    full = {key: sum(t[key] for t in turns) for key, _, *_ in COMPONENTS}
    full["total"] = sum(full.values())
    comp_display = {key: display for key, _, display in COMPONENTS}
    parts = [color_cost(full["total"]) + " (total)"]
    for key, _, *_ in COMPONENTS:
        parts.append(color_cost(full[key]) + f" ({comp_display[key]})")
    lines.append("")
    lines.append(f"  guid     : {guid}")
    lines.append(f"  time     : {time_range}")
    lines.append(f"  models   : {models_str}")
    lines.append(f"  api calls: {total_steps}")
    if shown_label:
        lines.append(shown_label)
    lines.append(f"  total    : {parts[0]} = {' + '.join(parts[1:])}")

    return "\n".join(lines)


# ─── main ──────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Visual dashboard summary of pi agent sessions"
    )
    parser.add_argument(
        "-l", "--list", action="store_true",
        help="List recent sessions",
    )
    parser.add_argument(
        "-s", "--session", type=str,
        help="Analyze a specific session (path or GUID substring)",
    )
    parser.add_argument(
        "-n", "--nth", type=int, default=0, metavar="N",
        help="Analyze Nth most expensive session",
    )
    parser.add_argument(
        "-a", "--all-turns", action="store_true",
        help="Show all steps in session detail (no 60-step cap)",
    )
    parser.add_argument(
        "-c", "--cumulative", action="store_true",
        help="Show cumulative costs in session detail",
    )
    parser.add_argument(
        "--sessions-dir", type=Path, default=SESSIONS_DIR,
        help="Custom sessions directory",
    )
    args = parser.parse_args()

    # ── session detail mode (-s or -n) ──
    if args.session or args.nth > 0:
        if args.session:
            path = Path(args.session)
            if path.exists():
                pass  # explicit path
            else:
                # Try GUID substring lookup
                matches = _find_by_guid(args.sessions_dir, args.session)
                if len(matches) == 0:
                    print(f"Error: no session found for '{args.session}'", file=sys.stderr)
                    return 1
                if len(matches) > 1:
                    print(f"Error: '{args.session}' matches {len(matches)} sessions; be more specific:", file=sys.stderr)
                    for m in matches:
                        print(f"  {_session_guid(m)}", file=sys.stderr)
                    return 1
                path = matches[0]
        else:
            data = collect_all(args.sessions_dir)
            sessions = data["sessions"]
            # -n picks Nth most expensive, so re-sort by cost descending
            sessions.sort(key=lambda s: s["total"], reverse=True)
            if not sessions:
                print("No sessions with cost data found.", file=sys.stderr)
                return 1
            if args.nth < 1 or args.nth > len(sessions):
                print(f"Error: -n {args.nth} out of range (1..{len(sessions)})", file=sys.stderr)
                return 1
            path = sessions[args.nth - 1]["path"]

        turns = parse_turns(path)
        max_turns = None if args.all_turns else 60
        cumulative = args.cumulative
        print(f"Session: {path}")
        print(render_session_detail(turns, max_turns=max_turns, cumulative=cumulative,
                                     guid=_session_guid(path)))
        return 0

    # ── session list mode ──
    if args.list:
        data = collect_all(args.sessions_dir)
        print(render_session_list(data["sessions"]))
        return 0

    # ── collect all data (single pass) ──
    data = collect_all(args.sessions_dir)
    messages = data["messages"]
    sessions = data["sessions"]
    user_ts = data["user_ts"]
    n_turns = len(user_ts)

    if not messages:
        print("  No sessions with cost data found.")
        return 1

    # ── default: hourly chart + model breakdown ──
    print(render_header(messages, sessions, n_turns=n_turns))

    hour_groups = group_by_hour(messages)
    turn_hours = _count_by_hour(user_ts)
    print(render_hourly_chart(hour_groups, turn_counts=turn_hours))

    print(render_model_breakdown(messages, model_turns=data["model_turns"]))

    return 0


if __name__ == "__main__":
    sys.exit(main())
