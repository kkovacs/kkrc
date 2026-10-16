#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Visual dashboard of what coding-harness sessions cost at API list prices.

Reads every harness that is present on this machine, tags each session with its
harness, and shows one combined hourly chart + model breakdown. Drill-down works
across harnesses by index, GUID substring, or file path.

Harnesses (missing ones are skipped silently - usually 1-2 are active per box):
    pi        ~/.pi/agent/sessions/**/*.jsonl        (uses pi's stored cost verbatim)
    claude    ~/.claude/projects/**/*.jsonl          (priced from models.dev/anthropic)
    codex     $CODEX_HOME/sessions/**/*.jsonl        (priced from models.dev/openai)
    opencode  ~/.local/share/opencode/opencode.db    (SQLite; priced from models.dev)

Directory overrides come from the environment (no CLI clutter):
    PI_SESSIONS_DIR, CLAUDE_PROJECTS_DIR, CODEX_HOME, OPENCODE_DB, XDG_DATA_HOME.

OpenCode note: we trust OpenCode's own per-message cost as the authoritative
total and derive the component split from its tokens (scaled to that total).
The provider it stores (per message and per session) is looked up in models.dev,
so non-opencode-go models price correctly; providers absent from models.dev
still show their total, just without a component shape.

pi note: pi prices its own calls, so its stored cost is used verbatim; messages
without one (pi couldn't price them) are excluded, never guessed.

Usage:
    session-stats.py                    # all harnesses: session list + hourly + models
    session-stats.py N                  # Nth most expensive session (detail)
    session-stats.py <guid>             # specific session by GUID substring
    session-stats.py <path>             # session by file path
    session-stats.py N -a               # show all steps (no 60-step cap)
    session-stats.py N -c               # cumulative costs in session detail
    session-stats.py -r                 # refresh pricing first
    session-stats.py --harness pi,claude   # restrict to a subset
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

HOME = Path.home()
CATALOG_URL = "https://models.dev/catalog.json"
CACHE_DIR = HOME / ".cache" / "models-dev"
CATALOG_CACHE = CACHE_DIR / "models_dev_catalog.json"
CACHE_TTL_HOURS = 24

PI_DIR = Path(os.environ.get("PI_SESSIONS_DIR", HOME / ".pi" / "agent" / "sessions"))
CLAUDE_DIR = Path(os.environ.get("CLAUDE_PROJECTS_DIR", HOME / ".claude" / "projects"))
CODEX_DIR = Path(os.environ.get("CODEX_HOME", HOME / ".codex")) / "sessions"
OPENCODE_DB = Path(os.environ.get("OPENCODE_DB", Path(
    os.environ.get("XDG_DATA_HOME", HOME / ".local" / "share")) / "opencode" / "opencode.db"))

COST_KEYS = ("cacheRead", "cacheWrite", "input", "output", "total")
BAR_WIDTH = 40
MAX_TURNS_DEFAULT = 60
MIN_UTC = datetime.min.replace(tzinfo=timezone.utc)

# Cost components in stacking order (bottom -> top of bar)
COMPONENTS = [
    ("cacheRead",  "█", "cacheRd"),
    ("cacheWrite", "▓", "cacheWr"),
    ("input",      "▒", "context"),
    ("output",     "░", "outputs"),
]


# --- ANSI helpers ----------------------------------------------

def color_cost(value: float, display: str | None = None) -> str:
    """Wrap a dollar amount in ANSI color by magnitude.

    Colors by *value* but can show a different *display* string - useful in
    cumulative mode to color by per-step delta while showing the running total.
    """
    if display is None:
        display = f"${value:.4f}"
    if value <= 0.0001:
        return f"\033[2m{display}\033[0m"      # dim
    if value >= 1.0:
        return f"\033[41m{display}\033[0m"     # red bg (dollars)
    if value >= 0.50:
        return f"\033[31m{display}\033[0m"     # red
    if value >= 0.10:
        return f"\033[35m{display}\033[0m"     # magenta
    if value >= 0.01:
        return f"\033[33m{display}\033[0m"     # yellow
    return f"\033[32m{display}\033[0m"         # green


_ANSI_RE = re.compile(r'\033\[[0-9;]*m')


def _ansi_ljust(s: str, width: int) -> str:
    """Left-justify a string that may contain ANSI escapes."""
    return s + " " * (width - len(_ANSI_RE.sub('', s)))


def component_bar(comps: dict[str, float], max_total: float) -> str:
    """Return a BAR_WIDTH-character bar stacked by cost component.

    The filled width is proportional to comps['total'] / max_total; columns are
    assigned to components by their share of the total.
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

_COL_W = 7
_COST_COLS = "  ".join(f"{h:<{_COL_W}}" for h in ["total"] + [d for _, _, d in COMPONENTS])
_COST_DASH = "  ".join(["─" * _COL_W] * (len(COMPONENTS) + 1))


def _cost_columns(comps: dict[str, float]) -> str:
    """Return 5 space-separated, color-coded, right-aligned dollar columns."""
    parts = [color_cost(comps.get("total", 0.0))]
    for key, _, *_ in COMPONENTS:
        parts.append(color_cost(comps.get(key, 0.0)))
    return "  ".join(_ansi_ljust(p, _COL_W) for p in parts)


def _bar_table(lead_header: str, lead_dash: str, max_total: float,
               rows: list[str | tuple[str, dict[str, float], str]],
               tail_header: str, tail_dash_w: int, title: str | None = None) -> list[str]:
    """Shared scaffold: optional title, then [lead cols] | bar | cost cols | tail.

    A row is either a preformatted string (e.g. an empty-hour marker) or a
    (lead, comps, tail) tuple.
    """
    lines = ["", *([f"  {title}"] if title else []),
             f"  {lead_header}  {'bar':^{BAR_WIDTH}}  {_COST_COLS}  {tail_header}",
             f"  {lead_dash}  {'─' * BAR_WIDTH}  {_COST_DASH}  {'─' * tail_dash_w}"]
    for row in rows:
        if isinstance(row, str):
            lines.append(row)
        else:
            lead, comps, tail = row
            lines.append(f"  {lead}  {component_bar(comps, max_total)}  "
                         f"{_cost_columns(comps)}  {tail}")
    return lines


# --- time helpers ----------------------------------------------

def _parse_ts(ts: Any) -> datetime | None:
    """Parse an ISO timestamp string (or epoch-ms int) to aware UTC datetime."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_local(dt: datetime | None) -> datetime | None:
    return dt.astimezone() if dt else None


def _fmt_range(first: datetime, last: datetime) -> str:
    """Format a local start/end pair, collapsing the shared date."""
    a, b = _to_local(first), _to_local(last)
    if a.date() == b.date():
        return f"{a.strftime('%Y-%m-%d %H:%M')} – {b.strftime('%H:%M')}"
    return f"{a.strftime('%Y-%m-%d %H:%M')} – {b.strftime('%Y-%m-%d %H:%M')}"


# --- pricing ---------------------------------------------------

def load_catalog(refresh: bool) -> dict[str, Any]:
    """Fetch the whole models.dev catalog, cached 24h (shared with models-dev.py)."""
    CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    stale = (not CATALOG_CACHE.exists()
             or time.time() - CATALOG_CACHE.stat().st_mtime > CACHE_TTL_HOURS * 3600)
    if refresh or stale:
        try:
            req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "stats/2.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                CATALOG_CACHE.write_text(json.dumps(json.load(resp)))
        except Exception as exc:
            if not CATALOG_CACHE.exists():
                sys.exit(f"Failed to fetch pricing and no cache available: {exc}")
            print(f"Warning: pricing refresh failed ({exc}); using cache.", file=sys.stderr)
    return json.loads(CATALOG_CACHE.read_text())


def provider_models(catalog: dict[str, Any], provider: str) -> dict[str, Any]:
    return catalog.get("providers", {}).get(provider, {}).get("models", {})


def model_cost(prices: dict[str, Any], model: str) -> dict | None:
    """Look up a model's cost, tolerating dated snapshot suffixes."""
    m = prices.get(model)
    if not m and len(model) > 9 and model[-8:].isdigit():        # ...-20250101
        m = prices.get(model[:-9])
    if not m and len(model) > 11:                                # ...-2025-01-01
        try:
            datetime.strptime(model[-10:], "%Y-%m-%d")
        except ValueError:
            pass
        else:
            m = prices.get(model[:-11])
    return (m or {}).get("cost")


def _sum_cost(d: dict[str, float]) -> dict[str, float]:
    d["total"] = sum(d.values())
    return d


def claude_usage_cost(c: dict, u: dict) -> dict[str, float]:
    """Claude list-price cost; 1h cache writes are assumed 2x input."""
    pin, pout = c["input"], c["output"]
    pread = c.get("cache_read", pin)
    p5 = c.get("cache_write", pin * 1.25)
    p1 = pin * 2
    cc = u.get("cache_creation") or {}
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    w5 = cc.get("ephemeral_5m_input_tokens", 0) if cc else u.get("cache_creation_input_tokens", 0)
    return _sum_cost({
        "input": u.get("input_tokens", 0) * pin / 1e6,
        "output": u.get("output_tokens", 0) * pout / 1e6,
        "cacheRead": u.get("cache_read_input_tokens", 0) * pread / 1e6,
        "cacheWrite": (w5 * p5 + w1 * p1) / 1e6,
    })


def openai_usage_cost(c: dict, u: dict) -> dict[str, float]:
    """Codex list-price cost; cached input is part of input_tokens."""
    cached = u.get("cached_input_tokens", 0)
    return _sum_cost({
        "input": max(0, u.get("input_tokens", 0) - cached) * c["input"] / 1e6,
        "cacheRead": cached * c.get("cache_read", c["input"]) / 1e6,
        "cacheWrite": u.get("cache_write_input_tokens", 0) * c.get("cache_write", 0) / 1e6,
        "output": u.get("output_tokens", 0) * c["output"] / 1e6,
    })


def opencode_usage_cost(c: dict, tok: dict) -> dict[str, float]:
    """OpenCode list-price cost; reasoning is additive to output (unlike Codex)."""
    return _sum_cost({
        "input": tok["input"] * c["input"] / 1e6,
        "output": (tok["output"] + tok.get("reasoning", 0)) * c["output"] / 1e6,
        "cacheRead": tok["cache"].get("read", 0) * c.get("cache_read", c["input"]) / 1e6,
        "cacheWrite": tok["cache"].get("write", 0) * c.get("cache_write", 0) / 1e6,
    })


# --- pi collector ----------------------------------------------
# pi writes its own cost dict per assistant message, so we trust it verbatim.

def _pi_guid(path: Path) -> str:
    return path.stem.rsplit("_", 1)[-1]


def collect_pi(_catalog: dict) -> dict[str, Any] | None:
    if not PI_DIR.exists():
        return None
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, set] = defaultdict(set)
    skipped: dict[str, int] = defaultdict(int)
    for proj_dir in sorted(PI_DIR.iterdir()):
        if not proj_dir.is_dir():
            continue
        for sf in sorted(proj_dir.iterdir()):
            if sf.suffix != ".jsonl":
                continue
            costs = {k: 0.0 for k in COST_KEYS}
            msgs: list[dict] = []
            model = provider = "?"
            n_turns = 0
            start_ts = end_ts = None
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
                            if ts is not None:
                                user_ts.append(ts)
                            continue
                        if role != "assistant":
                            continue
                        m_model = msg.get("model", "?")
                        m_provider = msg.get("provider", "?")
                        stored = (msg.get("usage") or {}).get("cost")
                        if not stored:
                            # pi prices every call it can; anything unpriced is unusable.
                            skipped[f"{m_model} ({m_provider})"] += 1
                            continue
                        cost_dict = {k: stored.get(k, 0.0) for k in COST_KEYS}
                        if model == "?":
                            model, provider = m_model, m_provider
                        msgs.append({"timestamp": ts, "model": m_model, "provider": m_provider,
                                     "harness": "pi", "cost": cost_dict, "session": sf})
                        model_turns[m_model].add((sf, n_turns))
            except OSError:
                continue
            if not msgs:
                continue
            messages.extend(msgs)
            for m in msgs:
                for k in COST_KEYS:
                    costs[k] += m["cost"][k]
            sessions.append({"harness": "pi", "locator": sf, "guid": _pi_guid(sf),
                             "total": costs["total"], "calls": len(msgs), "model": model,
                             "provider": provider, "start_ts": start_ts, "end_ts": end_ts,
                             "costs": costs, "turns": n_turns})
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": {m: len(t) for m, t in model_turns.items()},
            "skipped": dict(skipped)}


# --- claude collector ------------------------------------------

def _claude_is_prompt(d: dict) -> bool:
    m = d.get("message")
    if d.get("type") != "user" or d.get("isMeta") or d.get("isSidechain") or not isinstance(m, dict):
        return False
    content = m.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    return isinstance(content, list) and any(b.get("type") == "text" for b in content if isinstance(b, dict))


def collect_claude(catalog: dict) -> dict[str, Any] | None:
    if not CLAUDE_DIR.exists():
        return None
    prices = provider_models(catalog, "anthropic")
    files = sorted(CLAUDE_DIR.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    best: dict[Any, dict] = {}                       # response id -> fullest log entry
    span: dict[Path, list] = {}                      # file -> [first_ts, last_ts]
    prompts: dict[Path, list] = defaultdict(list)
    user_ts: list[datetime] = []
    skipped: dict[str, int] = defaultdict(int)

    for sf in files:
        try:
            with open(sf, errors="ignore") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts = _parse_ts(d.get("timestamp"))
                    if ts:
                        s = span.setdefault(sf, [ts, ts])
                        s[1] = ts
                    if _claude_is_prompt(d) and ts:
                        prompts[sf].append(ts)
                        user_ts.append(ts)
                    m = d.get("message")
                    u = m.get("usage") if isinstance(m, dict) else None
                    if d.get("type") != "assistant" or not u or not m.get("model"):
                        continue
                    k = (m["id"], d.get("requestId")) if m.get("id") else (sf, line)
                    out = u.get("output_tokens", 0)
                    cur = best.get(k)
                    if cur is None or out > cur["out"] or (out == cur["out"] and cur["file"] == sf):
                        best[k] = {"out": out, "file": sf, "ts": ts, "model": m["model"], "usage": u}
        except OSError:
            continue

    messages: list[dict] = []
    for b in best.values():
        c = model_cost(prices, b["model"])
        if not c:
            skipped[b["model"]] += 1
            continue
        messages.append({"timestamp": b["ts"], "model": b["model"], "provider": "anthropic",
                         "harness": "claude", "cost": claude_usage_cost(c, b["usage"]),
                         "session": b["file"]})
    messages.sort(key=lambda m: m["timestamp"] or MIN_UTC)

    by_file: dict[Path, list[dict]] = defaultdict(list)
    for m in messages:
        by_file[m["session"]].append(m)
    sessions = []
    for sf, msgs in by_file.items():
        costs = {k: sum(m["cost"][k] for m in msgs) for k in COST_KEYS}
        start, end = span.get(sf, (msgs[0]["timestamp"], msgs[-1]["timestamp"]))
        sessions.append({"harness": "claude", "locator": sf, "guid": sf.stem, "total": costs["total"],
                         "calls": len(msgs), "model": msgs[0]["model"], "provider": "anthropic",
                         "start_ts": start, "end_ts": end, "costs": costs,
                         "turns": len(prompts.get(sf, []))})
    sessions.sort(key=lambda s: s["start_ts"] or MIN_UTC)
    user_ts.sort()

    # turns per model: distinct (session, prompt) pairs answered by that model
    model_turns: dict[str, set] = defaultdict(set)
    for m in messages:
        pts = prompts.get(m["session"])
        if pts and m["timestamp"]:
            idx = sum(t <= m["timestamp"] for t in pts)
            if idx:
                model_turns[m["model"]].add((m["session"], idx))

    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": {m: len(t) for m, t in model_turns.items()},
            "skipped": dict(skipped)}


# --- codex collector -------------------------------------------
# Only modern logs (per-response token_usage_record) are supported.

def _codex_is_prompt(payload: dict) -> bool:
    if payload.get("type") != "message" or payload.get("role") != "user":
        return False
    text = "\n".join(b.get("text", "") for b in payload.get("content", []) if isinstance(b, dict))
    return bool(text.strip()) and not text.lstrip().startswith((
        "# AGENTS.md instructions", "<environment_context>", "<user_shell_command>",
        "<permissions instructions>", "<collaboration_mode>",
    ))


def collect_codex(catalog: dict) -> dict[str, Any] | None:
    if not CODEX_DIR.exists():
        return None
    prices = provider_models(catalog, "openai")
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, set] = defaultdict(set)
    skipped: dict[str, int] = defaultdict(int)
    seen_responses: set[str] = set()
    files = [CODEX_DIR] if CODEX_DIR.is_file() else sorted(CODEX_DIR.rglob("*.jsonl"))
    for sf in files:
        records: list = []
        prompts: list = []
        event_prompts: list = []
        start = end = None
        model, provider, guid = "?", "openai", sf.stem[-36:]
        try:
            with sf.open(errors="ignore") as f:
                for line in f:
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(e, dict) or not isinstance(e.get("payload"), dict):
                        continue
                    p = e["payload"]
                    ts = _parse_ts(e.get("timestamp"))
                    if ts:
                        start = min(start, ts) if start else ts
                        end = max(end, ts) if end else ts
                    typ = e.get("type")
                    if typ == "session_meta":
                        guid = p.get("id", guid)
                        provider = p.get("model_provider", provider)
                    elif typ == "turn_context":
                        model = p.get("model", model)
                    elif typ == "response_item" and _codex_is_prompt(p) and ts:
                        prompts.append(ts)
                    elif typ == "event_msg" and p.get("type") == "user_message" and ts:
                        event_prompts.append(ts)
                    elif typ == "token_usage_record" and isinstance(p.get("usage"), dict):
                        rid = p.get("response_id")
                        if rid and rid in seen_responses:
                            continue
                        if rid:
                            seen_responses.add(rid)
                        records.append((ts, model, p["usage"]))
        except OSError as exc:
            print(f"Warning: cannot read {sf}: {exc}", file=sys.stderr)
            continue

        pts = event_prompts or prompts
        user_ts.extend(pts)
        msgs = []
        for ts, m, usage in records:
            c = model_cost(prices, m) if provider == "openai" else None
            if not c:
                skipped[f"{m} ({provider})"] += 1
                continue
            msgs.append({"timestamp": ts, "model": m, "provider": provider, "harness": "codex",
                         "cost": openai_usage_cost(c, usage), "session": sf})
        if not msgs:
            continue
        messages.extend(msgs)
        for ts, m, usage in records:
            if ts is None:
                continue
            idx = sum(t <= ts for t in pts)
            if idx:
                model_turns[m].add((sf, idx))
        costs = {k: sum(m["cost"][k] for m in msgs) for k in COST_KEYS}
        sessions.append({"harness": "codex", "locator": sf, "guid": guid, "total": costs["total"],
                         "calls": len(msgs), "turns": len(pts), "costs": costs,
                         "start_ts": start, "end_ts": end, "model": msgs[0]["model"],
                         "provider": provider})

    messages.sort(key=lambda m: m["timestamp"] or MIN_UTC)
    sessions.sort(key=lambda s: s["start_ts"] or MIN_UTC)
    user_ts.sort()
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": {m: len(t) for m, t in model_turns.items()},
            "skipped": dict(skipped)}


# --- opencode (v2, SQLite) collector ---------------------------

def collect_opencode(catalog: dict) -> dict[str, Any] | None:
    if not OPENCODE_DB.exists():
        return None
    con = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, set] = defaultdict(set)
    skipped: dict[str, int] = defaultdict(int)

    srows = con.execute(
        "select id, title, model, time_created, time_updated from session_v2").fetchall()
    mcur = con.cursor()                              # separate cursor: don't clobber srows
    for srow in srows:
        sid = srow["id"]
        smodel = json.loads(srow["model"]) if srow["model"] else {}
        default_model = smodel.get("id", "?")
        default_provider = smodel.get("providerID", "?")
        msgs: list[dict] = []
        prompts: list[datetime] = []
        model = provider = "?"
        for r in mcur.execute(
                "select type, seq, time_created, data from session_message "
                "where session_id=? order by seq", (sid,)):
            d = json.loads(r["data"])
            ts = _parse_ts(r["time_created"])
            if r["type"] == "user":
                if (d.get("text") or "").strip():
                    prompts.append(ts)
                    user_ts.append(ts)
            elif r["type"] == "assistant":
                tok = d.get("tokens")
                if not tok:
                    continue                         # aborted/partial response
                md = d.get("model") or {}
                provider = md.get("providerID", default_provider)
                model = md.get("id", default_model)
                # Prefer OpenCode's own money sum (it prices via models.dev). Derive
                # the component shape from tokens, scaled to that total so the split
                # always adds up. If the provider isn't in models.dev, keep the total
                # and leave the components flat (the bar just won't show).
                comps = None
                c = model_cost(provider_models(catalog, provider), model)
                if c:
                    comps = opencode_usage_cost(c, tok)
                stored = d.get("cost")
                if isinstance(stored, (int, float)):
                    total = float(stored)
                    if comps and comps["total"] > 0:
                        factor = total / comps["total"]
                        for k in COST_KEYS[:-1]:
                            comps[k] *= factor
                    else:
                        comps = {k: 0.0 for k in COST_KEYS}
                    comps["total"] = total
                elif comps is None:
                    skipped[f"{model} ({provider})"] += 1
                    continue
                idx = sum(t <= ts for t in prompts) if ts else 0
                if idx:
                    model_turns[model].add((sid, idx))
                msgs.append({"timestamp": ts, "model": model, "provider": provider,
                             "harness": "opencode", "cost": comps, "session": sid})
        if not msgs:
            continue
        messages.extend(msgs)
        costs = {k: sum(m["cost"][k] for m in msgs) for k in COST_KEYS}
        sessions.append({"harness": "opencode", "locator": sid, "guid": sid,
                         "title": srow["title"], "total": costs["total"], "calls": len(msgs),
                         "turns": len(prompts), "costs": costs,
                         "start_ts": _parse_ts(srow["time_created"]),
                         "end_ts": _parse_ts(srow["time_updated"]),
                         "model": model or default_model, "provider": provider or default_provider})

    con.close()
    messages.sort(key=lambda m: m["timestamp"] or MIN_UTC)
    sessions.sort(key=lambda s: s["start_ts"] or MIN_UTC)
    user_ts.sort()
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": {m: len(t) for m, t in model_turns.items()},
            "skipped": dict(skipped)}


# --- registry + merge ------------------------------------------

HARNESSES: list[dict[str, Any]] = [
    {"name": "pi",       "needs_catalog": False, "collect": collect_pi},
    {"name": "claude",   "needs_catalog": True,  "collect": collect_claude},
    {"name": "codex",    "needs_catalog": True,  "collect": collect_codex},
    {"name": "opencode", "needs_catalog": True,  "collect": collect_opencode},
]


def collect_all(selected: list[dict], catalog: dict) -> dict[str, Any]:
    """Run each selected harness and merge into one tagged dataset."""
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, int] = defaultdict(int)
    skipped: dict[str, int] = defaultdict(int)
    for h in selected:
        data = h["collect"](catalog)
        if data is None:                             # harness absent on this box
            continue
        messages.extend(data["messages"])
        sessions.extend(data["sessions"])
        user_ts.extend(data["user_ts"])
        for m, n in data["model_turns"].items():
            model_turns[m] += n
        for m, n in data["skipped"].items():
            skipped[m] += n
    messages.sort(key=lambda m: m["timestamp"] or MIN_UTC)
    sessions.sort(key=lambda s: s["start_ts"] or MIN_UTC)
    user_ts.sort()
    for model, n in skipped.items():
        print(f"note: no pricing for '{model}' ({n} responses) - excluded", file=sys.stderr)
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": dict(model_turns)}


# --- grouping + aggregation helpers ----------------------------

def group_by_hour(messages: list[dict]) -> dict[int, list[dict]]:
    groups: dict[int, list[dict]] = defaultdict(list)
    for m in messages:
        ts = m["timestamp"]
        if ts is not None:
            groups[_to_local(ts).hour].append(m)
    return dict(groups)


def group_by_model(messages: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for m in messages:
        groups[m["model"]].append(m)
    return dict(groups)


def _count_by_hour(timestamps: list[datetime]) -> dict[int, int]:
    counts: dict[int, int] = defaultdict(int)
    for ts in timestamps:
        counts[_to_local(ts).hour] += 1
    return dict(counts)


def msg_total(msgs: list[dict]) -> float:
    return sum(m["cost"]["total"] for m in msgs)


def _n_sessions(msgs: list[dict]) -> int:
    return len({(m["harness"], m["session"]) for m in msgs})


def _tail(calls: int, turns: int = 0, sessions: int = 0) -> str:
    tail = f"{calls}c"
    if turns > 0:
        tail += f" · {turns}t"
    if sessions > 0:
        tail += f" · {sessions}s"
    return tail


def msg_cost_components(msgs: list[dict]) -> dict[str, float]:
    comps: dict[str, float] = {}
    for key, _, *_ in COMPONENTS:
        comps[key] = sum(m["cost"][key] for m in msgs)
    # Total is authoritative per message (harnesses that store it are trusted).
    comps["total"] = sum(m["cost"]["total"] for m in msgs)
    return comps


def _date_range_label(messages: list[dict]) -> str:
    dates: set[str] = set()
    for m in messages:
        ts = m["timestamp"]
        if ts is not None:
            dates.add(_to_local(ts).strftime("%Y-%m-%d"))
    if not dates:
        return "no data"
    if len(dates) == 1:
        return next(iter(dates))
    return f"{min(dates)} – {max(dates)}"


# --- section renderers -----------------------------------------

def render_header(messages: list[dict], sessions: list[dict], n_turns: int) -> str:
    harnesses = sorted({s["harness"] for s in sessions})
    return "\n".join([
        f"  summary — {_date_range_label(messages)}  [{', '.join(harnesses)}]",
        "  " + "─" * 58,
        f"  sessions: {len(sessions):<4}  calls: {len(messages):<5}  turns: {n_turns:<5}  "
        f"total: {color_cost(msg_total(messages))}",
    ])


def render_hourly_chart(hour_groups: dict[int, list[dict]],
                        turn_counts: dict[int, int] | None = None) -> str:
    if not hour_groups:
        return "  (no data for this period)"

    max_cost = max(msg_total(msgs) for msgs in hour_groups.values())
    turn_counts = turn_counts or {}

    active = [h for h in range(24) if hour_groups.get(h) or turn_counts.get(h, 0) > 0]
    if not active:
        return "  (no data for this period)"
    first_hour, last_hour = active[0], active[-1]

    rows: list = []
    for hour in range(first_hour, last_hour + 1):
        msgs = hour_groups.get(hour, [])
        n_turns = turn_counts.get(hour, 0)
        if msg_total(msgs) <= 0 and n_turns <= 0:
            rows.append(f"  {hour:02d}:00  \033[2m·\033[0m")
        else:
            rows.append((f"{hour:02d}:00", msg_cost_components(msgs),
                         _tail(len(msgs), n_turns, _n_sessions(msgs))))

    lines = _bar_table(f"{'hour':5}", "─" * 5, max_cost, rows, "calls/turns/sessions", 22)
    lines += ["", _COMPONENT_LEGEND]
    return "\n".join(lines)


def render_model_breakdown(messages: list[dict],
                           model_turns: dict[str, int] | None = None) -> str:
    if not messages:
        return "  (no data)"

    model_groups = group_by_model(messages)
    max_total = msg_total(messages)
    model_turns = model_turns or {}

    sorted_models = sorted(model_groups.items(), key=lambda kv: msg_total(kv[1]), reverse=True)

    all_labels = [f"{model} ({msgs[0]['provider'] if msgs else '?'})" for model, msgs in sorted_models]
    label_w = max([len(l) for l in all_labels] + [len("model"), len("(total)")])

    rows: list = []
    for label, (model, msgs) in zip(all_labels, sorted_models):
        rows.append((f"{label:{label_w}}", msg_cost_components(msgs),
                     _tail(len(msgs), model_turns.get(model, 0), _n_sessions(msgs))))
    if max_total > 0:
        rows.append((f"{'(total)':{label_w}}", msg_cost_components(messages),
                     _tail(len(messages), sum(model_turns.values()), _n_sessions(messages))))

    return "\n".join(_bar_table(f"{'model':{label_w}}", "─" * label_w, max_total, rows,
                                "calls/turns/sessions", 22))


def render_session_list(sessions: list[dict]) -> str:
    """List all sessions, tagged by harness, with component-stacked bars."""
    if not sessions:
        return "  No sessions with cost data found."

    max_total = max(s["total"] for s in sessions)

    time_strs: list[str] = []
    for s in sessions:
        start, end = s["start_ts"], s.get("end_ts")
        if start and end:
            time_strs.append(_fmt_range(start, end))
        elif start:
            time_strs.append(_to_local(start).strftime("%Y-%m-%d %H:%M"))
        else:
            time_strs.append("?")
    TIME_W = max((len(s) for s in time_strs), default=4)
    HARNESS_W = max(len("harness"), *(len(s["harness"]) for s in sessions))
    GUID_W = 36  # UUID length

    lead_header = f"{'time':{TIME_W}}  {'harness':{HARNESS_W}}  {'guid':{GUID_W}}"
    lead_dash = f"{'─' * TIME_W}  {'─' * HARNESS_W}  {'─' * GUID_W}"
    rows = [(f"{time_strs[i]:{TIME_W}}  {s['harness']:{HARNESS_W}}  {s['guid']:{GUID_W}}",
             s["costs"], _tail(s["calls"], s.get("turns", 0)))
            for i, s in enumerate(sessions)]

    return "\n".join(_bar_table(lead_header, lead_dash, max_total, rows, "calls/turns", 11,
                                title=f"Recent sessions ({len(sessions)})"))


# --- session detail (drill-down) -------------------------------

def session_turns(messages: list[dict], harness: str, locator: Any) -> list[dict]:
    """Per-API-call cost dicts for one session, straight from merged messages."""
    return [{"timestamp": m["timestamp"], "model": m["model"], "provider": m["provider"], **m["cost"]}
            for m in messages if m["harness"] == harness and m["session"] == locator]


def render_session_detail(turns: list[dict], max_turns: int | None = None,
                          cumulative: bool = False, guid: str = "?", harness: str = "?") -> str:
    if not turns:
        return "  No assistant messages with cost data."

    total_steps = len(turns)

    if cumulative:
        steps: list[dict] = []
        cum = {k: 0.0 for k in COST_KEYS}
        for t in turns:
            for key, _, *_ in COMPONENTS:
                cum[key] += t[key]
            cum["total"] += t["total"]
            steps.append(dict(cum))
        mode_label = "cumulative cost"
    else:
        steps = [{key: t[key] for key, _, *_ in COMPONENTS} | {"total": t["total"]} for t in turns]
        mode_label = "per-step cost"

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

    scale_max = steps[-1]["total"] if cumulative else max((s["total"] for s in visible_steps), default=0.0)

    seen: set[tuple[str, str]] = set()
    for t in turns:
        seen.add((t["model"], t["provider"]))
    models_str = ", ".join(f"{m} ({p})" for m, p in seen) or "?"

    tss = [t["timestamp"] for t in turns if t.get("timestamp") is not None]
    time_range = _fmt_range(min(tss), max(tss)) if tss else "?"

    tw = max(4, len(str(total_steps)))

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

    full = {key: sum(t[key] for t in turns) for key, _, *_ in COMPONENTS}
    full["total"] = sum(t["total"] for t in turns)
    comp_display = {key: display for key, _, display in COMPONENTS}
    comp_sum = sum(full[key] for key, _, *_ in COMPONENTS)
    total_str = color_cost(full["total"]) + " (total)"
    if comp_sum > 0 or full["total"] <= 0.0001:
        parts = [total_str] + [color_cost(full[key]) + f" ({comp_display[key]})"
                               for key, _, *_ in COMPONENTS]
        total_line = f"  total    : {parts[0]} = {' + '.join(parts[1:])}"
    else:
        # Harness reported a total but no priceable split (provider not in catalog).
        total_line = f"  total    : {color_cost(full['total'])} (no component split)"
    lines.append("")
    lines.append(f"  harness  : {harness}")
    lines.append(f"  guid     : {guid}")
    lines.append(f"  time     : {time_range}")
    lines.append(f"  models   : {models_str}")
    lines.append(f"  api calls: {total_steps}")
    if shown_label:
        lines.append(shown_label)
    lines.append(total_line)

    return "\n".join(lines)


# --- main ------------------------------------------------------

def _resolve_target(sessions: list[dict], t: str) -> dict | None:
    """N (nth most expensive), GUID substring, or file path -> one session."""
    if t.isdigit():
        ranked = sorted(sessions, key=lambda s: s["total"], reverse=True)
        n = int(t)
        if not 1 <= n <= len(ranked):
            print(f"Error: {n} out of range (1..{len(ranked)})", file=sys.stderr)
            return None
        return ranked[n - 1]
    if "/" in t or Path(t).exists():
        hits = [s for s in sessions
                if isinstance(s["locator"], Path) and s["locator"].resolve() == Path(t).resolve()]
    else:
        hits = [s for s in sessions if t.lower() in s["guid"].lower()]
    if not hits:
        print(f"Error: no session found for '{t}'", file=sys.stderr)
        return None
    if len(hits) > 1:
        print(f"Error: '{t}' matches {len(hits)} sessions; be more specific:", file=sys.stderr)
        for s in hits:
            print(f"  {s['harness']}/{s['guid']}", file=sys.stderr)
        return None
    return hits[0]


def main() -> int:
    ap = argparse.ArgumentParser(description="Visual dashboard of coding-harness session costs")
    ap.add_argument("target", nargs="?", help="N (nth most expensive), GUID substring, or session file path")
    ap.add_argument("-a", "--all-turns", action="store_true", help="Show all steps in session detail")
    ap.add_argument("-c", "--cumulative", action="store_true", help="Show cumulative costs in session detail")
    ap.add_argument("-r", "--refresh", action="store_true", help="Refresh pricing from models.dev")
    ap.add_argument("--harness", help="Comma-separated harness subset (default: all present)")
    args = ap.parse_args()

    names = [h["name"] for h in HARNESSES]
    if args.harness:
        wanted = [n.strip() for n in args.harness.split(",") if n.strip()]
        unknown = [n for n in wanted if n not in names]
        if unknown:
            print(f"Error: unknown harness(es): {', '.join(unknown)} (known: {', '.join(names)})",
                  file=sys.stderr)
            return 1
        selected = [h for h in HARNESSES if h["name"] in wanted]
    else:
        selected = HARNESSES

    catalog = load_catalog(args.refresh) if any(h["needs_catalog"] for h in selected) else {}
    data = collect_all(selected, catalog)
    messages, sessions = data["messages"], data["sessions"]
    if not messages:
        print("  No sessions with cost data found.")
        return 1

    if args.target is not None:
        sess = _resolve_target(sessions, args.target)
        if sess is None:
            return 1
        header = f"Session: {sess['locator']}"
        if sess.get("title"):
            header += f"  ({sess['title']})"
        print(header)
        print(render_session_detail(session_turns(messages, sess["harness"], sess["locator"]),
                                    max_turns=None if args.all_turns else MAX_TURNS_DEFAULT,
                                    cumulative=args.cumulative, guid=sess["guid"],
                                    harness=sess["harness"]))
        return 0

    print(render_session_list(sessions))
    print()
    print(render_header(messages, sessions, len(data["user_ts"])))
    print(render_hourly_chart(group_by_hour(messages), turn_counts=_count_by_hour(data["user_ts"])))
    print(render_model_breakdown(messages, model_turns=data["model_turns"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
