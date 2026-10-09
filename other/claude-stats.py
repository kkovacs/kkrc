#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Visual dashboard of what Claude Code sessions would cost at API list prices.

Same output as pi-stats.py (it imports that file's renderers); only the data
collection and pricing differ. Token counts come from ~/.claude/projects/**/*.jsonl
(each API response counted once - streamed responses are logged several times),
prices from the models.dev catalog (cache shared with models-dev.py, 24h TTL).
5m cache writes use the catalog's cache_write price; 1h writes are assumed 2x input.

Usage:
    claude-stats.py                  # session list + hourly bars + model breakdown
    claude-stats.py N                # Nth most expensive session (detail)
    claude-stats.py <guid>           # specific session by GUID substring
    claude-stats.py <path>           # session by file path
    claude-stats.py N -a             # show all steps (no 60-step cap)
    claude-stats.py N -c             # cumulative costs in session detail
    claude-stats.py -r               # refresh pricing first
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG_DIR = Path.home() / ".claude" / "projects"
CATALOG_URL = "https://models.dev/catalog.json"
CATALOG_CACHE = Path.home() / ".cache" / "models-dev" / "models_dev_catalog.json"
CACHE_TTL_HOURS = 24

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("pi_stats", Path(__file__).with_name("pi-stats.py"))
pi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pi)


# ─── pricing ───────────────────────────────────────────────────

def load_prices(refresh: bool) -> dict[str, Any]:
    CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    stale = (not CATALOG_CACHE.exists()
             or time.time() - CATALOG_CACHE.stat().st_mtime > CACHE_TTL_HOURS * 3600)
    if refresh or stale:
        try:
            req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "claude-stats/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                CATALOG_CACHE.write_text(json.dumps(json.load(resp)))
        except Exception as exc:
            if not CATALOG_CACHE.exists():
                sys.exit(f"Failed to fetch pricing and no cache available: {exc}")
            print(f"Warning: pricing refresh failed ({exc}); using cache.", file=sys.stderr)
    return json.loads(CATALOG_CACHE.read_text())["providers"]["anthropic"]["models"]


def model_cost(prices: dict[str, Any], model: str) -> dict | None:
    m = prices.get(model)
    if not m and model[-8:].isdigit():  # date-suffixed id
        m = prices.get(model.rsplit("-", 1)[0])
    return (m or {}).get("cost")


def usage_cost(c: dict, u: dict) -> dict[str, float]:
    pin, pout = c["input"], c["output"]
    pread = c.get("cache_read", pin)
    p5 = c.get("cache_write", pin * 1.25)
    p1 = pin * 2
    cc = u.get("cache_creation") or {}
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    w5 = cc.get("ephemeral_5m_input_tokens", 0) if cc else u.get("cache_creation_input_tokens", 0)
    d = {
        "input": u.get("input_tokens", 0) * pin / 1e6,
        "output": u.get("output_tokens", 0) * pout / 1e6,
        "cacheRead": u.get("cache_read_input_tokens", 0) * pread / 1e6,
        "cacheWrite": (w5 * p5 + w1 * p1) / 1e6,
    }
    d["total"] = sum(d.values())
    return d


# ─── data collection ───────────────────────────────────────────

def _is_prompt(d: dict) -> bool:
    """A real user prompt (not a tool result or injected meta message)."""
    m = d.get("message")
    if d.get("type") != "user" or d.get("isMeta") or d.get("isSidechain") or not isinstance(m, dict):
        return False
    content = m.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    return isinstance(content, list) and any(b.get("type") == "text" for b in content if isinstance(b, dict))


def collect_all(log_dir: Path, prices: dict[str, Any]) -> dict[str, Any]:
    files = sorted(log_dir.rglob("*.jsonl"), key=lambda p: p.stat().st_mtime)
    best: dict[Any, dict] = {}                       # response id -> fullest log entry
    span: dict[Path, list] = {}                      # file -> [first_ts, last_ts]
    prompts: dict[Path, list[datetime]] = defaultdict(list)
    user_ts: list[datetime] = []

    for sf in files:
        try:
            with open(sf, errors="ignore") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts = pi._parse_ts(d.get("timestamp"))
                    if ts:
                        s = span.setdefault(sf, [ts, ts])
                        s[1] = ts
                    if _is_prompt(d) and ts:
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
    skipped: dict[str, int] = defaultdict(int)
    for b in best.values():
        c = model_cost(prices, b["model"])
        if not c:
            skipped[b["model"]] += 1
            continue
        messages.append({"timestamp": b["ts"], "model": b["model"], "provider": "anthropic",
                         "cost": usage_cost(c, b["usage"]), "session": b["file"]})
    messages.sort(key=lambda m: m["timestamp"] or datetime.min.replace(tzinfo=timezone.utc))

    by_file: dict[Path, list[dict]] = defaultdict(list)
    for m in messages:
        by_file[m["session"]].append(m)
    sessions = []
    for sf, msgs in by_file.items():
        costs = {k: sum(m["cost"][k] for m in msgs) for k in ("cacheRead", "cacheWrite", "input", "output", "total")}
        start, end = span.get(sf, (msgs[0]["timestamp"], msgs[-1]["timestamp"]))
        sessions.append({"path": sf, "guid": sf.stem, "total": costs["total"], "calls": len(msgs),
                         "model": msgs[0]["model"], "provider": "anthropic", "start_ts": start,
                         "end_ts": end, "costs": costs, "turns": len(prompts.get(sf, []))})
    sessions.sort(key=lambda s: s["start_ts"] or datetime.min.replace(tzinfo=timezone.utc))
    user_ts.sort()

    # turns per model: user prompts that were followed by a response from that model
    model_turns: dict[str, int] = {}
    for model in {m["model"] for m in messages}:
        n = 0
        for sf, pts in prompts.items():
            times = sorted(m["timestamp"] for m in by_file.get(sf, []) if m["model"] == model and m["timestamp"])
            if not times:
                continue
            bounds = pts + [datetime.max.replace(tzinfo=timezone.utc)]
            n += sum(1 for a, z in zip(bounds, bounds[1:]) if any(a <= t < z for t in times))
        model_turns[model] = n

    for model, n in skipped.items():
        print(f"note: no pricing for '{model}' ({n} responses) - excluded", file=sys.stderr)
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts, "model_turns": model_turns}


def session_turns(messages: list[dict], path: Path) -> list[dict]:
    return [{"timestamp": m["timestamp"].isoformat() if m["timestamp"] else None,
             "model": m["model"], "provider": m["provider"],
             **{k: m["cost"][k] for k in ("cacheRead", "cacheWrite", "input", "output", "total")}}
            for m in messages if m["session"] == path]


# ─── main ──────────────────────────────────────────────────────

def render_header(messages: list[dict], sessions: list[dict], n_turns: int) -> str:
    return "\n".join([
        f"  claude summary — {pi._date_range_label(messages)}",
        "  " + "─" * 58,
        f"  sessions: {len(sessions):<4}  calls: {len(messages):<5}  turns: {n_turns:<5}  "
        f"total: {pi.color_cost(pi.msg_total(messages))}",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description="Visual dashboard of Claude Code session costs at API prices")
    ap.add_argument("target", nargs="?", help="N (nth most expensive), GUID substring, or session file path")
    ap.add_argument("-a", "--all-turns", action="store_true", help="Show all steps in session detail")
    ap.add_argument("-c", "--cumulative", action="store_true", help="Show cumulative costs in session detail")
    ap.add_argument("-r", "--refresh", action="store_true", help="Refresh pricing from models.dev")
    ap.add_argument("--log-dir", type=Path, default=LOG_DIR, help="Claude projects directory")
    args = ap.parse_args()

    data = collect_all(args.log_dir, load_prices(args.refresh))
    messages, sessions = data["messages"], data["sessions"]
    if not messages:
        print("  No sessions with cost data found.")
        return 1

    if args.target is not None:
        t = args.target
        if t.isdigit():
            ranked = sorted(sessions, key=lambda s: s["total"], reverse=True)
            n = int(t)
            if not 1 <= n <= len(ranked):
                print(f"Error: {n} out of range (1..{len(ranked)})", file=sys.stderr)
                return 1
            sess = ranked[n - 1]
        else:
            if "/" in t or Path(t).exists():
                hits = [s for s in sessions if s["path"].resolve() == Path(t).resolve()]
            else:
                hits = [s for s in sessions if t.lower() in s["guid"].lower()]
            if not hits:
                print(f"Error: no session found for '{t}'", file=sys.stderr)
                return 1
            if len(hits) > 1:
                print(f"Error: '{t}' matches {len(hits)} sessions; be more specific:", file=sys.stderr)
                for s in hits:
                    print(f"  {s['guid']}", file=sys.stderr)
                return 1
            sess = hits[0]
        print(f"Session: {sess['path']}")
        print(pi.render_session_detail(session_turns(messages, sess["path"]),
                                       max_turns=None if args.all_turns else pi.MAX_TURNS_DEFAULT,
                                       cumulative=args.cumulative, guid=sess["guid"]))
        return 0

    print(pi.render_session_list(sessions))
    print()
    print(render_header(messages, sessions, len(data["user_ts"])))
    print(pi.render_hourly_chart(pi.group_by_hour(messages), turn_counts=pi._count_by_hour(data["user_ts"])))
    print(pi.render_model_breakdown(messages, model_turns=data["model_turns"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
