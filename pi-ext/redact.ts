/**
 * redact.ts — Redact local .env secrets before they reach the LLM
 *
 * Walks from cwd up to /, parses every .env* file found, and holds nontrivial
 * secret values in memory. Scrubs tool results and outbound LLM context so
 * accidental `cat .env`, `read`, or pasted secrets are replaced with
 * `<REDACTED--PLEASE-DO-NOT-READ-SECRETS>`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const REDACTED = "<REDACTED--PLEASE-DO-NOT-READ-SECRETS>";
// Regex must not match its own literal: "["/"*" are outside [A-Z0-9 ].
// XXX: keep it that way — a self-matching marker here would make the redact
// extension mangle this file's content when it is read back in a loaded session.
const PEM_BLOCK_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const TOKEN_PREFIX_RE =
    /^(?:sk[_-]|rk_(?:live|test)_|whsec_|gh[pousr]_|github_pat_|glpat-|xox[bpars]-|xapp-|AKIA|ASIA|AIza|hf_|npm_|pypi-|SG\.)/;
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const URL_PASS_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/:?#\s]*:([^/?#\s]+)@/;
const SECRET_KEY_NAME_RE = /(?:^|_)(?:KEY|PASS|PASSWORD|SECRET|TOKEN|PSWD)$|_PWD$/i;
const URL_KEY_NAME_RE = /(?:^|_)(?:URL|URI)$/i;
const SINGLE_CASE_WORD_RE = /^[a-z]+$|^[A-Z]+$/;

// Match values >= 8 chars by secret key name or known token prefix; ignore paths, URLs, and whitespace.
export function isSecret(v: string, key = ""): boolean {
    if (v.length < 8 || /\s/.test(v) || v.startsWith("/") || URL_RE.test(v)) return false;
    return SECRET_KEY_NAME_RE.test(key) || TOKEN_PREFIX_RE.test(v);
}

// Extract the secret to redact from an env value (for URLs, only a non-trivial embedded password).
export function extractSecret(v: string, key = ""): string | null {
    if (URL_RE.test(v)) {
        if (key && !URL_KEY_NAME_RE.test(key) && !SECRET_KEY_NAME_RE.test(key)) return null;
        const pass = URL_PASS_RE.exec(v)?.[1];
        return pass && pass.length >= 8 && !SINGLE_CASE_WORD_RE.test(pass) ? pass : null;
    }
    return isSecret(v, key) ? v : null;
}

function addSecretVariants(found: Map<string, string>, secret: string, key: string): void {
    for (const variant of [secret, encodeURIComponent(secret), Buffer.from(secret).toString("base64")]) {
        if (!found.has(variant)) found.set(variant, key);
    }
}

// Walk from cwd up to / collecting secrets from every .env* file and process.env.
// Longest-first order prevents a prefix secret from partially eating a longer one.
function collectSecrets(cwd: string, env: NodeJS.ProcessEnv = process.env): { secrets: string[]; count: number; keys: Map<string, string> } {
    const raw = new Set<string>();
    const rawKeys = new Map<string, string>();
    let dir = resolve(cwd);
    while (true) {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.name.startsWith(".env") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
                const content = readFileSync(join(dir, entry.name), "utf8");
                // Also parse each line individually (stripping leading #) so duplicate and commented-out keys stay protected.
                const parsed = [
                    parseEnv(content),
                    ...content.split("\n").map((line) => parseEnv(line.replace(/^\s*#+\s*/, ""))),
                ];
                for (const envObj of parsed) {
                    for (const [key, val] of Object.entries(envObj)) {
                        const secret = typeof val === "string" ? extractSecret(val, key) : null;
                        if (secret && !rawKeys.has(secret)) rawKeys.set(secret, key);
                        if (secret) raw.add(secret);
                    }
                }
            }
        } catch {
            // Skip unreadable parent directories (e.g. permission denied on the walk to /)
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    for (const [key, val] of Object.entries(env)) {
        const secret = typeof val === "string" ? extractSecret(val, key) : null;
        if (secret && !rawKeys.has(secret)) rawKeys.set(secret, key);
        if (secret) raw.add(secret);
    }

    // Map variant → first key name; secret may appear under several keys (first wins).
    const found = new Map<string, string>();
    for (const [secret, key] of rawKeys) addSecretVariants(found, secret, key);
    return {
        secrets: [...found.keys()].sort((a, b) => b.length - a.length),
        keys: found,
        count: raw.size,
    };
}

export function loadSecrets(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
    return collectSecrets(cwd, env).secrets;
}

// Recursively replace all secret occurrences and PEM private key blocks in strings/arrays/plain objects.
function scrub<T>(value: T, secrets: string[], onRedact: (s: string) => void): T {
    if (typeof value === "string") {
        let out = value.replace(PEM_BLOCK_RE, (m) => {
            onRedact(m);
            return REDACTED;
        });
        for (const s of secrets) {
            if (out.includes(s)) {
                out = out.replaceAll(s, REDACTED);
                onRedact(s);
            }
        }
        return out as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => scrub(item, secrets, onRedact)) as T;
    }
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = scrub(v, secrets, onRedact);
        }
        return out as T;
    }
    return value;
}

export default function (pi: ExtensionAPI) {
    const { secrets, keys, count } = collectSecrets(process.cwd());

    // Runtime-only counters; the last snapshot supplies the per-key deltas.
    const counts = new Map([...new Set(keys.values())].map((key) => [key, 0] as const));
    let lastCounts = new Map<string, number>();

    const redact = <T>(value: T, where: string, ctx: ExtensionContext): T | undefined => {
        const hits = new Set<string>();
        const out = scrub(value, secrets, (s) => {
            hits.add(s);
            // Map lookup covers raw/encoded/base64 variants; PEM blocks have no key.
            const key = keys.get(s) ?? "<PEM private key>";
            counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        if (!hits.size) return undefined;
        ctx.ui.notify(`🤐 redact: Redacted ${hits.size} secret${hits.size === 1 ? "" : "s"} in ${where}`, "warning");
        return out;
    };

    // Use "warning" so Pi TUI doesn't coalesce consecutive session_start info lines.
    // Key count = distinct names, matching how /redact groups rows; a duplicated
    // key name (e.g. stale value in .env.example) makes secrets > keys.
    pi.on("session_start", (_event, ctx) => {
        const keyCount = new Set(keys.values()).size;
        ctx.ui.notify(
            `🤐 redact: Protecting ${count} secret${count === 1 ? "" : "s"} from ${keyCount} key${keyCount === 1 ? "" : "s"}`,
            "warning",
        );
    });

    // Scrub tool results immediately (covers bash `cat .env`, read, codemode, etc.).
    pi.on("tool_result", (e, ctx) =>
        redact(
            { content: e.content, structuredContent: e.structuredContent, details: e.details },
            `${e.toolName} tool output`,
            ctx,
        ),
    );

    // Scrub full outbound transcript (system prompt, user prompts, !bash, tool results)
    // right before each LLM call.
    // XXX: !bash commands get redacted as going to the LLM, but not redacted
    // in the session JSONL.
    pi.on("context_with_system", (e, ctx) => redact({ messages: e.messages }, "outbound LLM context", ctx));

    // Scrub prompts at intake (interactive, RPC, steer, followUp) so the user
    // message is persisted to the session JSONL already redacted.
    pi.on("input", (e, ctx) => {
        const out = redact(e.text, "your prompt", ctx);
        return out === undefined ? undefined : { action: "transform", text: out };
    });

    // Redaction statistics command.
    pi.registerCommand("redact", {
        description: "Show redaction statistics",
        handler: async (_args, ctx) => {
            // Redacted keys keep the count table (count DESC); keys with no
            // redactions yet collapse into a single summary line.
            const rows = [...counts].filter(([, n]) => n > 0);
            const width = Math.max(0, ...rows.map(([key]) => key.length));
            const body = rows
                .sort(([a, na], [b, nb]) => nb - na || a.localeCompare(b))
                .map(([key, n]) => `${key.padEnd(width)} ${n} (+${n - (lastCounts.get(key) ?? 0)})`);
            const untouched = [...counts].filter(([, n]) => n === 0).map(([key]) => key).sort();
            if (untouched.length) body.push(`Also protecting (0 redacts yet): ${untouched.join(", ")}.`);
            lastCounts = new Map(counts);
            ctx.ui.notify(
                body.length ? `🤐 redact:\n${body.join("\n")}` : "🤐 redact: No protected keys found",
                "info",
            );
        },
    });
}
