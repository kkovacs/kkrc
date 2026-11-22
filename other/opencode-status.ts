#!/usr/bin/env bun
/**
 * Opencode Go — Privacy / ZDR Retriever
 *
 * Fetches model metadata (ZDR flag, token prices, monthly usage tier) from
 * the public models API, and the docs page only for the Privacy footnotes.
 *
 * Prints one concise table per model with ZDR status, tier, token prices,
 * and a STATUS column that is either OK or a compact list of failed filters.
 *
 * Usage:
 *   ./other/opencode-status.ts
 */

const DOCS_URL = "https://opencode.ai/docs/console/go/";
const MODELS_URL = "https://opencode.ai/inference/go/v1/models";

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

// ─── HTML helpers ────────────────────────────────────────────────────────────

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

// Footnotes are the <ul> immediately after the Privacy table.
function extractPrivacyNotes(html: string): string[] {
  const anchor = html.indexOf('<h2 id="privacy"');
  if (anchor === -1) throw new Error("Could not locate the Privacy section (#privacy)");

  const section = html.slice(anchor);
  const tableEnd = section.indexOf("</table>");
  if (tableEnd === -1) throw new Error("Could not locate the Privacy table");

  const afterTable = section.slice(tableEnd);
  const ulMatch = afterTable.match(/<ul>([\s\S]*?)<\/ul>/);
  const notes: string[] = [];
  if (ulMatch) {
    for (const li of ulMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const text = stripTags(li[1]);
      if (text) notes.push(text);
    }
  }
  return notes;
}

interface ApiCacheWrite {
  // Either a flat $/M price or time-bucketed e.g. { "30m": 0.25, "12h": 0.5 }.
  [key: string]: number | undefined;
}

interface ApiModel {
  name: string;
  cost: {
    text: {
      input: { price: number; cache?: { read?: number; write?: number | ApiCacheWrite } };
      output: { price: number };
    };
  };
  go: {
    monthly_usage: { go?: number | null } | null;
    training: boolean;
    zdr: boolean;
  } | null;
}

async function fetchModels(): Promise<ApiModel[]> {
  const res = await fetch(MODELS_URL, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${MODELS_URL}`);
  const json = await res.json();
  return json.data as ApiModel[];
}

// Collapse time-bucketed cache-write prices to the long-lived ("12h") one.
function cacheWritePrice(cw: number | ApiCacheWrite | undefined): number | null {
  if (cw == null) return null;
  if (typeof cw === "number") return cw;
  return cw["12h"] ?? Object.values(cw).find((v) => v != null) ?? null;
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

function isZDR(m: ApiModel): boolean {
  // ZDR = provider's zero-retention flag AND no training on your data.
  return !!m.go && m.go.zdr && !m.go.training;
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
  display: string;
  zdr: boolean;
  usage: number | null; // monthly usage tier ($) for the base Go plan
  cachedRead: number | null;
  cachedWrite: number | null;
  input: number | null;
  output: number | null;
}

interface Filter {
  label: string; // e.g. "ZDR", "$60"
  color: string; // color used for the failing tag in STATUS
  test: (r: ModelRec) => boolean;
}

async function main() {
  const [models, html] = await Promise.all([fetchModels(), fetchDocsHtml()]);
  const notes = extractPrivacyNotes(html);

  if (models.length === 0) {
    throw new Error("Models API returned zero models");
  }

  const recs: ModelRec[] = models.map((m) => ({
    display: m.name,
    zdr: isZDR(m),
    usage: m.go?.monthly_usage?.go ?? null,
    cachedRead: m.cost.text.input.cache?.read ?? null,
    cachedWrite: cacheWritePrice(m.cost.text.input.cache?.write),
    input: m.cost.text.input.price ?? null,
    output: m.cost.text.output.price ?? null,
  }));

  // Add filters here as new dimensions arrive.
  const filters: Filter[] = [
    { label: "ZDR", color: C.red, test: (r) => r.zdr }, // blocking
    { label: "$$", color: C.yellow, test: (r) => r.usage === null || r.usage >= 30 }, // sub-$30 only
  ];

  // Sort by output_price + 10*cache_read descending.
  function score(r: ModelRec): number {
    return (r.output ?? 0) + 10 * (r.cachedRead ?? 0);
  }
  recs.sort((a, b) => score(b) - score(a));

  const headers = ["OPENCODE-GO MODEL", "cacheRd", "cacheWr", "context", "outputs", "ZDR", "TIER", "STATUS"];
  const aligns: ("left" | "right")[] = ["left", "right", "right", "right", "right", "left", "right", "left"];

  const tableRows = recs.map((r) => {
    return [
      r.display,
      formatPrice(r.cachedRead),
      formatPrice(r.cachedWrite),
      formatPrice(r.input),
      formatPrice(r.output),
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
