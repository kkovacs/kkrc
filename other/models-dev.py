#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Generate a markdown price-comparison table from models.dev.

Usage:
    uv run models-dev.py                 # defaults to -p opencode-go
    uv run models-dev.py -a              # all models, all providers
    ./models-dev.py -p opencode-go -i aud
    ./models-dev.py -m deepseek-v4-flash -M 0.3   # defaults to -p openrouter
    ./models-dev.py -m '.*gpt.*' -M 10            # cap the Over ~1.75M input tokens bar
    ./models-dev.py -p openrouter -O               # sort by output price (desc)
    ./models-dev.py -p openrouter -I               # sort by input price (desc)
    ./models-dev.py -p openrouter -c               # context column, sorted asc by context
    ./models-dev.py -p openrouter -C               # cache write column
    ./models-dev.py -p openrouter -P               # sort by effective blended price (desc)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any

CATALOG_URL = "https://models.dev/catalog.json"
CACHE_TTL_HOURS = 24
# --- Cost column: "blended price once ~1.75M input tokens are processed" ---
# effective_price() below is the blended per-M price assuming a typical request mix of
# 90% cache-read / 7% fresh input / 3% output tokens. We frame the displayed column as the
# total cost at the point 1.75M INPUT tokens have been processed. At a 7% input share that
# implies 1.75 / 0.07 = 25M total tokens, so the per-M blended price is multiplied by 25
# (BASE_VOLUME == PRICE_SCALE). INPUT_VOLUME_M = BASE_VOLUME * INPUT_WEIGHT derives the
# 1.75M input-token count used in the label. Retune by changing INPUT_WEIGHT / BASE_VOLUME;
# the label and scaling follow automatically.
INPUT_WEIGHT = 0.07   # Fresh-input share of the blended-price mix (90% cache / 7% input / 3% output).
BASE_VOLUME = 25       # Total token volume (M) framed; also the multiplier on the per-M blended price.
INPUT_VOLUME_M = BASE_VOLUME * INPUT_WEIGHT  # 1.75 → input tokens (M) within that volume.
PRICE_SCALE = BASE_VOLUME  # Blended cost for ~25M tokens (which hold ~1.75M input).


def fetch_catalog(cache_dir: Path, refresh: bool = False) -> dict[str, Any]:
    cache_path = cache_dir / "models_dev_catalog.json"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    use_cache = (
        not refresh
        and cache_path.exists()
        and time.time() - cache_path.stat().st_mtime <= CACHE_TTL_HOURS * 3600
    )
    if not use_cache:
        try:
            req = urllib.request.Request(
                CATALOG_URL,
                headers={"User-Agent": "models-dev/1.0"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
        except urllib.error.URLError as exc:
            if not cache_path.exists():
                raise RuntimeError(f"Failed to fetch catalog and no cache available: {exc}") from exc
            print(f"Warning: failed to refresh catalog ({exc}); using cached version.", file=sys.stderr)
            use_cache = True
        else:
            with cache_path.open("w", encoding="utf-8") as f:
                json.dump(data, f)

    if use_cache:
        with cache_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    return data


MODALITY_SHORT = {
    "text": "txt",
    "image": "img",
    "audio": "aud",
    "video": "vid",
    "pdf": "pdf",
}
MODALITY_LONG = {v: k for k, v in MODALITY_SHORT.items()}


def make_row(label: str, info: dict[str, Any]) -> dict[str, Any]:
    cost = info.get("cost", {})
    modalities = info.get("modalities", {})
    has_tiers = bool(cost.get("tiers") or cost.get("context_over_200k"))

    cache_read = cost.get("cache_read")
    cache_write = cost.get("cache_write")

    age_days: int | None = None
    release_date_str = info.get("release_date")
    if release_date_str:
        try:
            rd = datetime.strptime(release_date_str, "%Y-%m-%d").date()
            age_days = (date.today() - rd).days
        except ValueError:
            pass

    limit = info.get("limit", {}) or {}
    context_limit = limit.get("context")
    output_limit = limit.get("output")

    return {
        "label": label,
        "input_modality": ", ".join(MODALITY_SHORT.get(m, m) for m in modalities.get("input", [])),
        "in_price": cost.get("input", 0.0),
        "out_price": cost.get("output", 0.0),
        "has_tiers": has_tiers,
        "cache_read": cache_read,
        "cache_write": cache_write,
        "age_days": age_days,
        "context_limit": context_limit,
        "output_limit": output_limit,
    }


def format_calc_bar(row: dict[str, Any], max_value: float, bar_width: int = 30) -> str:
    # Stacked bar of the blended price: █ cache, ▓ input, ▒ output (lengths ∝ each $ share).
    eff = effective_price(row) * PRICE_SCALE
    cr = row["cache_read"] if row["cache_read"] is not None else row["in_price"]
    cache = 0.9 * cr
    inp = INPUT_WEIGHT * row["in_price"]
    out = 0.03 * row["out_price"]
    raw = cache + inp + out  # = effective_price(row)

    capped = max_value > 0 and eff > max_value
    if max_value <= 0 or eff <= 0:
        bar = ""  # free / zero-cost model: no bar (avoid a full-width empty line)
    else:
        total = bar_width if capped else max(1, min(int(round(eff / max_value * bar_width)), bar_width))
        c_len = int(round(cache / raw * total))
        i_len = int(round(inp / raw * total))
        o_len = total - c_len - i_len
        if o_len < 0:  # rounding overshoot: trim the larger segment
            if c_len >= i_len:
                c_len += o_len
            else:
                i_len += o_len
            o_len = 0
        bar = "█" * c_len + "▓" * i_len + "▒" * o_len
    mark = "†" if row["cache_write"] else ""  # cache-write price exists (matches `†` in Cache/In/Out)
    if capped:
        return f"{bar}▶ ${eff:.2f}{mark}+"
    return f"{bar} ${eff:.2f}{mark}"


def effective_price(row: dict[str, Any]) -> float:
    # Blended cost: 90% cache read (input price when no cache), 7% input, 3% output.
    cr = row["cache_read"] if row["cache_read"] is not None else row["in_price"]
    return 0.9 * cr + INPUT_WEIGHT * row["in_price"] + 0.03 * row["out_price"]


def build_table(
    columns: list[tuple[str, str]],
    rows: list[dict[str, Any]],
    footnote: str,
    calc_max: float | None = None,
) -> str:
    if not rows:
        raise RuntimeError("No rows to render.")

    # Scale the bar by the max displayed blended cost, or the -M cap (both in displayed units).
    max_val = calc_max if calc_max is not None else max(effective_price(r) * PRICE_SCALE for r in rows)
    headers, keys = zip(*columns)

    formatted: list[dict[str, str]] = []
    for r in rows:
        tier_marker = " *" if r["has_tiers"] else ""
        # Cache read first, in a fixed-width token so in/out align even with no cache read.
        # `†` marks a cache-write price; `-     ` is the no-cache-read placeholder (left-aligned).
        if r["cache_read"] is not None:
            mark = "†" if r["cache_write"] else " "
            cr_token = f"${r['cache_read']:.2f}{mark}"
        else:
            cr_token = f"{'-':<6}"
        cache_read_str = f"{cr_token} / "
        cache_write_str = f"${r['cache_write']:.2f}" if r["cache_write"] is not None else "-"
        formatted.append(
            {
                "label": r["label"],
                "provider": r.get("provider", ""),
                "input_modality": r["input_modality"],
                "in_out": f"{cache_read_str}${r['in_price']:.2f} / ${r['out_price']:.2f}{tier_marker}",
                "cache_write": cache_write_str,
                "calc": format_calc_bar(r, max_val),
                "age_days": str(r["age_days"]) if r["age_days"] is not None else "-",
                "context_limit": f"{r['context_limit']:,}" if r.get("context_limit") is not None else "-",
            }
        )

    widths = [
        max(len(headers[i]), max(len(str(f[key])) for f in formatted))
        for i, key in enumerate(keys)
    ]

    def row_line(cells: list[str]) -> str:
        return "| " + " | ".join(c.ljust(w) for c, w in zip(cells, widths)) + " |"

    lines = [
        row_line(headers),
        "|" + "|".join("-" * (w + 2) for w in widths) + "|",
    ]
    for f in formatted:
        lines.append(row_line([str(f[key]) for key in keys]))

    lines.append("")
    lines.append(footnote)
    if calc_max is not None:
        lines.append(
            f"_Over ~1.75M input tokens capped at ${calc_max:.2f}; values above the cap show a trailing `▶` and a `+` price suffix._"
        )

    return "\n".join(lines)


def build_filtered_table(
    catalog: dict[str, Any],
    provider_filter: str | None = None,
    model_filter: str | None = None,
    input_filter: str | None = None,
    calc_max: float | None = None,
    in_price_sort: bool = False,
    out_price_sort: bool = False,
    price_sort: bool = False,
    show_date: bool = False,
    date_sort: bool = False,
    show_cache: bool = False,
    show_context: bool = False,
) -> str:
    providers = catalog.get("providers", {})
    if provider_filter is not None:
        if provider_filter not in providers:
            available = sorted(providers.keys())
            raise RuntimeError(
                f"Provider '{provider_filter}' not found in models.dev catalog.\n"
                f"Available providers: {', '.join(available)}"
            )
        providers = {provider_filter: providers[provider_filter]}

    pattern = re.compile(model_filter, re.IGNORECASE) if model_filter else None

    rows: list[dict[str, Any]] = []
    for provider_id, provider_info in providers.items():
        for model_id, info in provider_info.get("models", {}).items():
            if pattern is not None and not pattern.search(model_id):
                continue
            if input_filter:
                modalities = info.get("modalities", {})
                target = MODALITY_LONG.get(input_filter, input_filter)
                if target not in modalities.get("input", []):
                    continue
            row = make_row(model_id, info)
            row["provider"] = provider_id
            rows.append(row)

    if not rows:
        parts = []
        if model_filter:
            parts.append(f"matching `/{model_filter}/i`")
        if provider_filter:
            parts.append(f"from provider `{provider_filter}`")
        if input_filter:
            parts.append(f"with input `{input_filter}`")
        suffix = " ".join(parts)
        raise RuntimeError(f"No models found{(' ' + suffix) if suffix else '.'}")

    if date_sort:
        show_date = True

    if date_sort:
        rows.sort(key=lambda r: (r["age_days"] if r["age_days"] is not None else float("inf"), r["label"].lower(), r["provider"].lower()), reverse=True)
    elif in_price_sort:
        rows.sort(key=lambda r: (r["in_price"], r["out_price"], r["label"].lower(), r["provider"].lower()), reverse=True)
    elif out_price_sort:
        rows.sort(key=lambda r: (r["out_price"], r["in_price"], r["label"].lower(), r["provider"].lower()), reverse=True)
    elif price_sort:
        rows.sort(key=lambda r: (effective_price(r), r["label"].lower(), r["provider"].lower()), reverse=True)
    elif show_context:
        rows.sort(key=lambda r: (r["context_limit"] if r["context_limit"] is not None else float("inf"), r["label"].lower(), r["provider"].lower()))
    else:
        rows.sort(key=lambda r: (r["label"].lower(), r["out_price"], r["provider"].lower()), reverse=True)

    columns = [
        ("Model", "label"),
        ("Provider", "provider"),
    ]
    if show_context:
        columns.append(("Context", "context_limit"))
    columns.extend([
        ("Input modality", "input_modality"),
        ("Cache/In/Out ($/M)", "in_out"),
    ])
    if show_cache:
        columns.append(("CacheW", "cache_write"))
    if show_date:
        columns.append(("Age", "age_days"))
    columns.append(("Over ~1.75M input tokens", "calc"))

    filter_notes = []
    if model_filter:
        filter_notes.append(f"matching `/{model_filter}/i`")
    if provider_filter:
        filter_notes.append(f"provider `{provider_filter}`")
    if input_filter:
        filter_notes.append(f"input `{input_filter}`")
    filter_note = ""
    if filter_notes:
        filter_note = " (" + "; ".join(filter_notes) + ")"

    footnote = (
        f"_Prices from [models.dev](https://models.dev) catalog{filter_note}, "
        "per million tokens. Base prices shown; `*` = context-length tiers, "
        "`†` = a cache write price exists (use -C to reveal it). "
        "Bar glyphs `█`/`▓`/`▒` show cache/input/output shares of the price._"
    )
    return build_table(columns, rows, footnote, calc_max)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a markdown price-comparison table from models.dev",
    )
    parser.add_argument(
        "-p",
        "--provider",
        default=None,
        help="Filter to a single provider",
    )
    parser.add_argument(
        "-r",
        "--refresh",
        action="store_true",
        help="Force re-fetch of models.dev catalog.json",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path.home() / ".cache" / "models-dev",
        help="Directory for caching catalog.json",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write markdown to this file instead of stdout",
    )
    parser.add_argument(
        "-l",
        "--list-providers",
        action="store_true",
        help="List available providers from models.dev and exit",
    )
    parser.add_argument(
        "-a",
        "--all",
        action="store_true",
        help="Disable boot defaults and scan all providers",
    )
    parser.add_argument(
        "-m",
        "--model",
        metavar="REGEXP",
        help="Filter models by case-insensitive regex, e.g. -m gpt-4 or -m 'deepseek.*flash'",
    )
    parser.add_argument(
        "-M",
        "--max",
        type=float,
        metavar="PRICE",
        help="Cap the Over ~1.75M input tokens bar at this value (useful when a few expensive models dwarf the rest)",
    )
    parser.add_argument(
        "-i",
        "--input",
        metavar="MODALITY",
        help="Filter by input modality, e.g. txt, img, aud, vid, pdf (or text, image, etc.)",
    )
    parser.add_argument(
        "-O",
        "--out-price",
        action="store_true",
        help="Sort by output price descending, then model, then provider",
    )
    parser.add_argument(
        "-I",
        "--in-price",
        action="store_true",
        help="Sort by input price descending, then model, then provider",
    )
    parser.add_argument(
        "-d",
        "--date",
        action="store_true",
        help="Show model age in days from release_date",
    )
    parser.add_argument(
        "-D",
        "--date-sort",
        action="store_true",
        help="Sort by model age descending (newest at bottom)",
    )
    parser.add_argument(
        "-c",
        "--context",
        action="store_true",
        help="Show context length column and sort by it (ascending)",
    )
    parser.add_argument(
        "-C",
        "--cache",
        action="store_true",
        help="Show cache write price column (cache read is always shown in Cache/In/Out)",
    )
    parser.add_argument(
        "-P",
        "--price",
        action="store_true",
        help="Sort by effective blended price (90% cache read + 7% input + 3% output), descending",
    )
    args = parser.parse_args()

    try:
        catalog = fetch_catalog(args.cache_dir, refresh=args.refresh)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.list_providers:
        print(", ".join(sorted(catalog.get("providers", {}).keys())))
        return 0

    # XXX my current favorites
    # Boot defaults: no flags or only -i => opencode-go; only -m => openrouter.
    # --all disables these defaults. Explicit -p always wins.
    if args.all or args.provider is not None:
        provider_filter = args.provider
    elif args.model and not args.input:
        provider_filter = "openrouter"
    elif args.input and not args.model:
        provider_filter = "opencode-go"
    elif not args.model and not args.input:
        provider_filter = "opencode-go"
    else:
        provider_filter = None

    try:
        table = build_filtered_table(
            catalog,
            provider_filter=provider_filter,
            model_filter=args.model,
            input_filter=args.input,
            calc_max=args.max,
            in_price_sort=args.in_price,
            out_price_sort=args.out_price,
            show_date=args.date,
            date_sort=args.date_sort,
            show_cache=args.cache,
            show_context=args.context,
            price_sort=args.price,
        )
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if args.output:
        args.output.write_text(table, encoding="utf-8")
        print(f"Wrote markdown table to {args.output}")
    else:
        print(table)

    return 0


if __name__ == "__main__":
    sys.exit(main())
