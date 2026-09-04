#!/usr/bin/env bun
/**
 * Opencode Go — Privacy / ZDR Retriever
 *
 * Fetches the public OpenCode Go docs page and parses:
 *   - the "Privacy" table   (ZDR status per model)
 *   - the pricing table     (Usage tier + token prices)
 *
 * Prints one concise table per model with ZDR status, tier, token prices,
 * and a STATUS column that is either OK or a compact list of failed filters.
 *
 * Usage:
 *   ./other/opencode-status.ts
 */

const DOCS_URL = "https://opencode.ai/docs/go/";

// ─── Terminal colors ───────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  black: "\x1b[30m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  orange: "\x1b[38;5;208m",
  red: "\x1b[31m",
  bgRed: "\x1b[41m",
  cyan: "\x1b[36m",
};

function paint(color: string, text: string): string {
  return `${color}${text}${C.reset}`;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

function pad(s: string, width: number, align: "left" | "right" = "left"): string {
  const len = visibleLen(s);
  if (len >= width) return s;
  const spaces = " ".repeat(width - len);
  return align === "left" ? s + spaces : spaces + s;
}

function printTable(
  headers: string[],
  aligns: ("left" | "right")[],
  rows: string[][],
): void {
  const widths = headers.map((h, i) =>
    Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i])))
  );
  console.log(headers.map((h, i) => paint(C.bold, pad(h, widths[i], aligns[i]))).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i], aligns[i])).join("  "));
  }
}

interface PrivacyRow {
  model: string;
  training: string;
  retention: string;
}

// Collapse a model name so dash/space/spacing variants join across tables.
function normalizeModel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// ─── HTML helpers ──────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// ─── Fetch & parse ─────────────────────────────────────────────────────────

async function fetchDocsHtml(): Promise<string> {
  const res = await fetch(DOCS_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      "Accept": "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${DOCS_URL}`);
  return res.text();
}

function extractPrivacy(html: string): { rows: PrivacyRow[]; notes: string[] } {
  const anchor = html.indexOf('<h2 id="privacy"');
  if (anchor === -1) throw new Error("Could not locate the Privacy section (#privacy)");

  const section = html.slice(anchor);

  const tableMatch = section.match(/<table>([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error("Could not locate the Privacy table");

  const rows: PrivacyRow[] = [];
  for (const tr of tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === "model") continue; // header row
    rows.push({ model: cells[0], training: cells[1], retention: cells[2] });
  }

  // Footnotes are the <ul> immediately after the table.
  const afterTable = section.slice((tableMatch.index ?? 0) + tableMatch[0].length);
  const ulMatch = afterTable.match(/<ul>([\s\S]*?)<\/ul>/);
  const notes: string[] = [];
  if (ulMatch) {
    for (const li of ulMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const text = stripTags(li[1]);
      if (text) notes.push(text);
    }
  }

  return { rows, notes };
}

// Locate a <table> whose header row contains ALL of `headers`.
function findTableByHeader(html: string, headers: string[]): string {
  for (const table of html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
    const body = table[1];
    const firstRow = body.match(/<tr>([\s\S]*?)<\/tr>/);
    if (!firstRow) continue;
    const head = [...firstRow[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      stripTags(m[1]).toLowerCase(),
    );
    if (headers.every((h) => head.some((c) => c.includes(h)))) return body;
  }
  throw new Error(`Could not locate table with headers: ${headers.join(", ")}`);
}

// "$2.00" -> 2.00, "-" -> null
function parseMoney(s: string): number | null {
  const v = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isNaN(v) ? null : v;
}

// Strip a trailing variant suffix like " (≤ 272K tokens)".
function baseName(s: string): string {
  return s.replace(/\s*\(.*\)\s*$/, "").trim();
}

interface PricingRow {
  usage: number | null;
  input: number | null;
  output: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  name: string; // cleaned model name
}

// Parse the pricing table: normalized model name -> full pricing.
function extractPricing(html: string): Map<string, PricingRow> {
  const body = findTableByHeader(html, ["cached read", "usage"]);
  const out = new Map<string, PricingRow>();
  for (const tr of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length < 6) continue;
    if (cells[0].toLowerCase() === "model") continue; // header row
    const key = normalizeModel(baseName(cells[0]));
    if (out.has(key)) continue; // keep first variant row
    out.set(key, {
      usage: parseMoney(cells[5]),
      input: parseMoney(cells[1]),
      output: parseMoney(cells[2]),
      cachedRead: parseMoney(cells[3]),
      cachedWrite: parseMoney(cells[4]),
      name: baseName(cells[0]),
    });
  }
  return out;
}

// The pricing table is followed by DeepSeek peak/off-peak + vision notes
// (<p><strong>DeepSeek ...</strong> ...</p>). Privacy DeepSeek note lives in a
// <li>, so the <p> prefix keeps this scoped to pricing notes.
function extractUsageNotes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<p><strong>DeepSeek[\s\S]*?<\/p>/g)) {
    const note = stripTags(m[0]);
    if (note) out.push(note);
  }
  return out;
}

function isZDR(retention: string): boolean {
  const r = retention.replace(/\*/g, "").trim().toLowerCase();
  return r === "0 days" || r === "0";
}

function priceColor(n: number): string {
  if (n >= 10) return C.black + C.bgRed;
  if (n >= 5) return C.red;
  if (n >= 2) return C.orange;
  if (n >= 1) return C.yellow;
  return C.green;
}

function formatPrice(n: number | null | undefined): string {
  return n != null ? paint(priceColor(n), n.toFixed(3)) : "-";
}

function tierColor(n: number): string {
  if (n >= 60) return C.green;
  if (n >= 30) return C.yellow;
  return C.orange;
}

function formatStatus(r: ModelRec, filters: Filter[]): string {
  const failing = filters.filter((f) => !f.test(r));
  if (failing.length === 0) return paint(C.green, "OK");
  return failing.map((f) => paint(f.color, f.label)).join(", ");
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface ModelRec {
  display: string; // model name, with footnote `*` if present
  base: string; // model name without the footnote marker
  zdr: boolean;
  usage: number | null; // monthly Usage tier ($) from pricing table
  prices: PricingRow | undefined;
}

interface Filter {
  label: string; // e.g. "ZDR", "$60"
  color: string; // color used for the failing tag in STATUS
  test: (r: ModelRec) => boolean;
}

async function main() {
  const html = await fetchDocsHtml();
  const { rows, notes } = extractPrivacy(html);

  if (rows.length === 0) {
    throw new Error("Parsed zero rows from the Privacy table");
  }

  // Master list = privacy table; join pricing via normalized name.
  const pricing = extractPricing(html);
  const recs: ModelRec[] = rows.map((row) => {
    const display = row.retention.includes("*") ? `${row.model}*` : row.model;
    return {
      display,
      base: row.model,
      zdr: isZDR(row.retention) && row.training.trim().toLowerCase() === "not used",
      usage: pricing.get(normalizeModel(row.model))?.usage ?? null,
      prices: pricing.get(normalizeModel(row.model)),
    };
  });

  // Add filters here as new dimensions arrive.
  const filters: Filter[] = [
    { label: "ZDR", color: C.red, test: (r) => r.zdr }, // blocking
    { label: "$$", color: C.yellow, test: (r) => r.usage === null || r.usage >= 30 }, // sub-$30 only
  ];

  // Sort by output_price + 10*cache_read descending.
  function score(r: ModelRec): number {
    const p = r.prices;
    return (p?.output ?? 0) + 10 * (p?.cachedRead ?? 0);
  }
  recs.sort((a, b) => score(b) - score(a));

  const headers = ["OPENCODE-GO MODEL", "cacheRd", "cacheWr", "context", "outputs", "ZDR", "TIER", "STATUS"];
  const aligns: ("left" | "right")[] = ["left", "right", "right", "right", "right", "left", "right", "left"];

  const tableRows = recs.map((r) => {
    const p = r.prices;
    return [
      r.display,
      formatPrice(p?.cachedRead),
      formatPrice(p?.cachedWrite),
      formatPrice(p?.input),
      formatPrice(p?.output),
      paint(r.zdr ? C.green : C.red, r.zdr ? "yes" : "no"),
      r.usage !== null ? paint(tierColor(r.usage), `$${r.usage}`) : "-",
      formatStatus(r, filters),
    ];
  });

  console.log("");
  printTable(headers, aligns, tableRows);

  const allNotes = [...notes, ...extractUsageNotes(html)];

  if (allNotes.length > 0) {
    console.log("");
    console.log(paint(`${C.cyan}${C.bold}`, "NOTES:"));
    for (const note of allNotes) {
      console.log(`${paint(C.dim, "•")} ${note}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
