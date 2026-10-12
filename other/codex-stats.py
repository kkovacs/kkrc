#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Visual dashboard of Codex sessions at API list prices (not subscription bills).

Reads $CODEX_HOME/sessions/**/*.jsonl (default ~/.codex/sessions), and reuses
pi-stats.py's charts. Prices come from models.dev, with the same 24h cache as
claude-stats.py. Unknown models are reported and excluded, never guessed.

Usage:
    codex-stats.py                  # sessions + hourly bars + model breakdown
    codex-stats.py N                # Nth most expensive session
    codex-stats.py <guid-or-path>   # specific session
    codex-stats.py N -a -c          # all steps, cumulative costs
    codex-stats.py -r               # refresh pricing

New logs have per-response token_usage_record entries; older logs have
event_msg/token_count entries. These are alternative sources, not additive.
For old logs, cumulative deltas discard repeated usage/rate-limit updates.
Cached input is part of input_tokens; reasoning is part of output_tokens.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOG_DIR = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "sessions"
CATALOG_URL = "https://models.dev/catalog.json"
CACHE_DIR = Path.home() / ".cache" / "models-dev"
COST_KEYS = ("cacheRead", "cacheWrite", "input", "output", "total")
TOKEN_KEYS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
              "output_tokens", "reasoning_output_tokens", "total_tokens")

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("pi_stats", Path(__file__).with_name("pi-stats.py"))
pi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pi)


def load_prices(refresh: bool, cache_dir: Path = CACHE_DIR) -> dict[str, Any]:
    cache = cache_dir / "models_dev_catalog.json"
    stale = not cache.exists() or time.time() - cache.stat().st_mtime > 24 * 3600
    if refresh or stale:
        try:
            req = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "codex-stats/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                catalog = json.load(resp)
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(catalog))
        except Exception as exc:
            if not cache.exists():
                sys.exit(f"Failed to fetch pricing and no cache available: {exc}")
            print(f"Warning: pricing refresh failed ({exc}); using cache.", file=sys.stderr)
    return json.loads(cache.read_text())["providers"]["openai"]["models"]


def model_cost(prices: dict[str, Any], model: str) -> dict | None:
    entry = prices.get(model)
    if not entry and len(model) > 11:
        # OpenAI dated snapshots use a YYYY-MM-DD suffix.
        try:
            datetime.strptime(model[-10:], "%Y-%m-%d")
        except ValueError:
            pass
        else:
            entry = prices.get(model[:-11])
    return (entry or {}).get("cost")


def usage_cost(c: dict, u: dict) -> dict[str, float]:
    cached = u.get("cached_input_tokens", 0)
    d = {
        "input": max(0, u.get("input_tokens", 0) - cached) * c["input"] / 1e6,
        "cacheRead": cached * c.get("cache_read", c["input"]) / 1e6,
        "cacheWrite": u.get("cache_write_input_tokens", 0) * c.get("cache_write", 0) / 1e6,
        "output": u.get("output_tokens", 0) * c["output"] / 1e6,
    }
    d["total"] = sum(d.values())
    return d


def _is_prompt(payload: dict) -> bool:
    if payload.get("type") != "message" or payload.get("role") != "user":
        return False
    text = "\n".join(b.get("text", "") for b in payload.get("content", []) if isinstance(b, dict))
    return bool(text.strip()) and not text.lstrip().startswith((
        "# AGENTS.md instructions", "<environment_context>", "<user_shell_command>",
        "<permissions instructions>", "<collaboration_mode>",
    ))


def collect_all(log_dir: Path, prices: dict[str, Any]) -> dict[str, Any]:
    messages: list[dict] = []
    sessions: list[dict] = []
    user_ts: list[datetime] = []
    model_turns: dict[str, set] = defaultdict(set)
    skipped: dict[str, int] = defaultdict(int)
    seen_responses: set[str] = set()
    files = [log_dir] if log_dir.is_file() else sorted(log_dir.rglob("*.jsonl"))
    for sf in files:
        records, legacy, prompts, event_prompts = [], [], [], []
        start = end = None
        has_records = False
        model, provider, guid = "?", "openai", sf.stem[-36:]
        previous: dict = {}
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
                    ts = pi._parse_ts(e.get("timestamp"))
                    if ts:
                        start = min(start, ts) if start else ts
                        end = max(end, ts) if end else ts
                    typ = e.get("type")
                    if typ == "session_meta":
                        guid = p.get("id", guid)
                        provider = p.get("model_provider", provider)
                    elif typ == "turn_context":
                        model = p.get("model", model)
                    elif typ == "response_item" and _is_prompt(p) and ts:
                        prompts.append(ts)
                    elif typ == "event_msg" and p.get("type") == "user_message" and ts:
                        event_prompts.append(ts)
                    if typ == "token_usage_record" and isinstance(p.get("usage"), dict):
                        has_records = True
                        rid = p.get("response_id")
                        if rid and rid in seen_responses:
                            continue
                        if rid:
                            seen_responses.add(rid)
                        records.append((ts, model, p["usage"]))
                    elif typ == "event_msg" and p.get("type") == "token_count":
                        info = p.get("info") or {}
                        total = info.get("total_token_usage")
                        if not isinstance(total, dict) or total == previous:
                            continue
                        # A reset starts a fresh counter (e.g. after resume).
                        baseline = previous if total.get("total_tokens", 0) >= previous.get("total_tokens", 0) else {}
                        delta = {k: max(0, total.get(k, 0) - baseline.get(k, 0)) for k in TOKEN_KEYS}
                        previous = dict(total)
                        if delta["input_tokens"] or delta["output_tokens"]:
                            legacy.append((ts, model, delta))
        except OSError as exc:
            print(f"Warning: cannot read {sf}: {exc}", file=sys.stderr)
            continue

        pts = event_prompts or prompts
        user_ts.extend(pts)
        msgs = []
        for ts, m, usage in records if has_records else legacy:
            c = model_cost(prices, m) if provider == "openai" else None
            if not c:
                skipped[f"{m} ({provider})"] += 1
                continue
            msg = {"timestamp": ts, "model": m, "provider": provider,
                   "cost": usage_cost(c, usage), "usage": usage, "session": sf}
            msgs.append(msg)
            # Attribute each prompt to every model that answered it.
            prompt_index = sum(t <= ts for t in pts) if ts else 0
            if prompt_index:
                model_turns[m].add((sf, prompt_index))
        if not msgs:
            continue
        messages.extend(msgs)
        costs = {k: sum(m["cost"][k] for m in msgs) for k in COST_KEYS}
        sessions.append({"path": sf, "guid": guid, "total": costs["total"],
                         "calls": len(msgs), "turns": len(pts), "costs": costs,
                         "start_ts": start, "end_ts": end,
                         "model": msgs[0]["model"], "provider": provider})

    minimum = datetime.min.replace(tzinfo=timezone.utc)
    messages.sort(key=lambda m: m["timestamp"] or minimum)
    sessions.sort(key=lambda s: s["start_ts"] or minimum)
    user_ts.sort()
    for model, n in skipped.items():
        print(f"note: no pricing for '{model}' ({n} responses) - excluded", file=sys.stderr)
    return {"messages": messages, "sessions": sessions, "user_ts": user_ts,
            "model_turns": {m: len(turns) for m, turns in model_turns.items()}}


def session_turns(messages: list[dict], path: Path) -> list[dict]:
    return [{"timestamp": m["timestamp"].isoformat() if m["timestamp"] else None,
             "model": m["model"], "provider": m["provider"], **m["cost"]}
            for m in messages if m["session"] == path]


def main() -> int:
    ap = argparse.ArgumentParser(description="Visual dashboard of Codex session costs at API list prices")
    ap.add_argument("target", nargs="?", help="N (nth most expensive), GUID substring, or session file path")
    ap.add_argument("-a", "--all-turns", action="store_true", help="Show all steps in session detail")
    ap.add_argument("-c", "--cumulative", action="store_true", help="Show cumulative costs in session detail")
    ap.add_argument("-r", "--refresh", action="store_true", help="Refresh pricing from models.dev")
    ap.add_argument("--log-dir", "--session-dir", type=Path, default=LOG_DIR, help="Codex sessions directory")
    ap.add_argument("--cache-dir", type=Path, default=CACHE_DIR, help="models.dev pricing cache directory")
    args = ap.parse_args()
    target_path = Path(args.target).expanduser() if args.target else None
    direct = target_path is not None and ("/" in args.target or target_path.exists())
    if direct and not target_path.is_file():
        print(f"Error: file not found: {target_path}", file=sys.stderr)
        return 1
    data = collect_all(target_path if direct else args.log_dir.expanduser(),
                       load_prices(args.refresh, args.cache_dir.expanduser()))
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
            hits = sessions if direct else [s for s in sessions if t.lower() in s["guid"].lower()]
            if len(hits) != 1:
                print(f"Error: '{t}' matches {len(hits)} sessions; use a unique GUID or path.", file=sys.stderr)
                return 1
            sess = hits[0]
        print(f"Session: {sess['path']} (API list-price estimate)")
        print(pi.render_session_detail(session_turns(messages, sess["path"]),
                                       max_turns=None if args.all_turns else pi.MAX_TURNS_DEFAULT,
                                       cumulative=args.cumulative, guid=sess["guid"]))
        return 0
    print(pi.render_session_list(sessions))
    print(f"\n  codex summary — {pi._date_range_label(messages)} (API list-price estimate)")
    print("  " + "─" * 58)
    print(f"  sessions: {len(sessions):<4}  calls: {len(messages):<5}  turns: {len(data['user_ts']):<5}  "
          f"total: {pi.color_cost(pi.msg_total(messages))}")
    print(pi.render_hourly_chart(pi.group_by_hour(messages), turn_counts=pi._count_by_hour(data["user_ts"])))
    print(pi.render_model_breakdown(messages, model_turns=data["model_turns"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
