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
    ./models-dev.py -m '.*gpt.*' -M 10
    ./models-dev.py -p openrouter -O               # sort by output price
    ./models-dev.py -p openrouter -I               # sort by input price
    ./models-dev.py -p openrouter -c               # context column, sorted desc by context
    ./models-dev.py -p openrouter -C               # cache r/w column
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
    cache_parts = [
        f"${cache_read:.2f}" if cache_read is not None else "-",
        f"${cache_write:.2f}" if cache_write is not None else "-",
    ]

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
        "cache_rw": " / ".join(cache_parts),
        "cache_read": cache_read,
        "cache_write": cache_write,
        "age_days": age_days,
        "context_limit": context_limit,
        "output_limit": output_limit,
    }


def format_chart(value: float, max_value: float, bar_width: int = 30) -> str:
    capped = max_value > 0 and value > max_value
    if capped:
        return f"{'█' * (bar_width - 1)}▶ ${value:.2f}+"
    if max_value <= 0 or value <= 0:
        bar = "░" * bar_width
    else:
        n = max(1, min(int(round(value / max_value * bar_width)), bar_width))
        bar = "█" * n + "░" * (bar_width - n)
    return f"{bar} ${value:.2f}"


def build_table(
    columns: list[tuple[str, str]],
    rows: list[dict[str, Any]],
    footnote: str,
    chart_max: float | None = None,
) -> str:
    if not rows:
        raise RuntimeError("No rows to render.")

    max_out = chart_max if chart_max is not None else max(r["out_price"] for r in rows)
    headers, keys = zip(*columns)

    formatted: list[dict[str, str]] = []
    for r in rows:
        tier_marker = " *" if r["has_tiers"] else ""
        formatted.append(
            {
                "label": r["label"],
                "provider": r.get("provider", ""),
                "input_modality": r["input_modality"],
                "in_out": f"${r['in_price']:.2f} / ${r['out_price']:.2f}{tier_marker}",
                "cache_rw": r["cache_rw"],
                "chart": format_chart(r["out_price"], max_out),
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
    if chart_max is not None:
        lines.append(
            f"_Chart capped at ${chart_max:.2f} output; values above the cap show a trailing `▶` and a `+` price suffix._"
        )

    return "\n".join(lines)


def build_filtered_table(
    catalog: dict[str, Any],
    provider_filter: str | None = None,
    model_filter: str | None = None,
    input_filter: str | None = None,
    chart_max: float | None = None,
    in_price_sort: bool = False,
    out_price_sort: bool = False,
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
        rows.sort(key=lambda r: (r["age_days"] if r["age_days"] is not None else float("inf"), r["label"].lower(), r["provider"].lower()))
    elif in_price_sort:
        rows.sort(key=lambda r: (r["in_price"], r["out_price"], r["label"].lower(), r["provider"].lower()))
    elif out_price_sort:
        rows.sort(key=lambda r: (r["out_price"], r["in_price"], r["label"].lower(), r["provider"].lower()))
    elif show_context:
        rows.sort(key=lambda r: (-r["context_limit"] if r["context_limit"] is not None else float("inf"), r["label"].lower(), r["provider"].lower()))
    else:
        rows.sort(key=lambda r: (r["label"].lower(), r["out_price"], r["provider"].lower()))

    columns = [
        ("Model", "label"),
        ("Provider", "provider"),
    ]
    if show_context:
        columns.append(("Context", "context_limit"))
    columns.extend([
        ("Input modality", "input_modality"),
        ("In/Out ($/M)", "in_out"),
    ])
    if show_cache:
        columns.append(("Cache r/w (M)", "cache_rw"))
    if show_date:
        columns.append(("Age", "age_days"))
    columns.append(("Output price chart", "chart"))

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
        "per million tokens. Base prices shown; `*` = context-length tiers._"
    )
    return build_table(columns, rows, footnote, chart_max)


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
        help="Cap the output price chart at this value (useful when a few expensive models dwarf the rest)",
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
        help="Sort by output price ascending, then model, then provider",
    )
    parser.add_argument(
        "-I",
        "--in-price",
        action="store_true",
        help="Sort by input price ascending, then model, then provider",
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
        help="Sort by model age ascending",
    )
    parser.add_argument(
        "-c",
        "--context",
        action="store_true",
        help="Show context length column and sort by it (descending)",
    )
    parser.add_argument(
        "-C",
        "--cache",
        action="store_true",
        help="Show cache read/write price column",
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
            chart_max=args.max,
            in_price_sort=args.in_price,
            out_price_sort=args.out_price,
            show_date=args.date,
            date_sort=args.date_sort,
            show_cache=args.cache,
            show_context=args.context,
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
