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
const SECRET_KEY_NAME_RE = /(?:^|_)(?:KEY|PASS|PASSWORD|SECRET|TOKEN)$|_PWD$/i;
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

    // Module-level so `/reload` (fresh runtime) doubles as the counter reset.
    let redactions = 0;
    const redactedKeys = new Set<string>();

    const redact = <T>(value: T, where: string, ctx: ExtensionContext): T | undefined => {
        const hits = new Set<string>();
        const out = scrub(value, secrets, (s) => {
            hits.add(s);
            redactions++;
            // Map lookup covers raw/encoded/base64 variants; PEM blocks have no key.
            redactedKeys.add(keys.get(s) ?? "<PEM private key>");
        });
        if (!hits.size) return undefined;
        ctx.ui.notify(`🕵️ redact: Redacted ${hits.size} secret${hits.size === 1 ? "" : "s"} in ${where}`, "warning");
        return out;
    };

    // Use "warning" so Pi TUI doesn't coalesce consecutive session_start info lines.
    pi.on("session_start", (_event, ctx) => {
        ctx.ui.notify(`🕵️ redact: Protecting ${count} secret${count === 1 ? "" : "s"}`, "warning");
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
    pi.on("context_with_system", (e, ctx) => redact({ messages: e.messages }, "outbound LLM context", ctx));

    // Redaction statistics command.
    pi.registerCommand("redact", {
        description: "Show redaction statistics",
        handler: async (_args, ctx) => {
            ctx.ui.notify(
                redactions
                    ? `🕵️ redact: ${redactions} redaction${redactions === 1 ? "" : "s"} so far: ${[...redactedKeys].sort().join(", ")} (protecting ${count} secret${count === 1 ? "" : "s"})`
                    : `🕵️ redact: No redactions yet (protecting ${count} secret${count === 1 ? "" : "s"})`,
                "info",
            );
        },
    });
}
