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

function addSecretVariants(found: Set<string>, secret: string): void {
    found.add(secret);
    found.add(encodeURIComponent(secret));
    found.add(Buffer.from(secret).toString("base64"));
}

// Walk from cwd up to / collecting secrets from every .env* file and process.env.
// Longest-first order prevents a prefix secret from partially eating a longer one.
function collectSecrets(cwd: string, env: NodeJS.ProcessEnv = process.env): { secrets: string[]; count: number } {
    const raw = new Set<string>();
    let dir = resolve(cwd);
    while (true) {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.name.startsWith(".env") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
                const parsed = parseEnv(readFileSync(join(dir, entry.name), "utf8"));
                for (const [key, val] of Object.entries(parsed)) {
                    const secret = typeof val === "string" ? extractSecret(val, key) : null;
                    if (secret) raw.add(secret);
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
        if (secret) raw.add(secret);
    }

    const found = new Set<string>();
    for (const secret of raw) addSecretVariants(found, secret);
    return { secrets: [...found].sort((a, b) => b.length - a.length), count: raw.size };
}

export function loadSecrets(cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
    return collectSecrets(cwd, env).secrets;
}

// Recursively replace all secret occurrences and PEM private key blocks in strings/arrays/plain objects.
function scrub<T>(value: T, secrets: string[], onRedact: () => void): T {
    if (typeof value === "string") {
        let out = value.replace(PEM_BLOCK_RE, () => {
            onRedact();
            return REDACTED;
        });
        for (const s of secrets) {
            if (out.includes(s)) {
                out = out.replaceAll(s, REDACTED);
                onRedact();
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
    const { secrets, count } = collectSecrets(process.cwd());

    const redact = <T>(value: T, warning: string, ctx: ExtensionContext): T | undefined => {
        let hit = false;
        const out = scrub(value, secrets, () => {
            hit = true;
        });
        if (!hit) return undefined;
        ctx.ui.notify(`redact: ${warning}`, "warning");
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
            `Redacted secret in ${e.toolName} tool output`,
            ctx,
        ),
    );

    // Scrub full outbound transcript (system prompt, user prompts, !bash, tool results)
    // right before each LLM call.
    pi.on("context_with_system", (e, ctx) =>
        redact({ messages: e.messages }, "Redacted secret in outbound LLM context", ctx),
    );
}
