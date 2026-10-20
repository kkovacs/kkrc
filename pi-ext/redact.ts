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
const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const PASSPHRASE_RE = /^[a-zA-Z]{3,}(?:-[a-zA-Z]{3,}){3,}$/;
const SK_PREFIX_RE = /^sk[_-]/;
const URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const URL_PASS_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/:?#\s]*:([^/?#\s]+)@/;
const SECRET_KEY_NAME_RE = /(?:^|_)(?:KEY|PASS|PASSWORD|SECRET|TOKEN)$|_PWD$/i;
const TRIVIAL_LITERAL_RE = /^(?:true|false|null|none)$/i;

// Filter out short/trivial config values (ports, booleans, plain words, sentences, full URLs)
// so we don't redact normal code or prose in the prompt. Env vars whose name ends with
// KEY/PASS/PASSWORD/SECRET/TOKEN/_PWD relax the character-class rules.
export function isSecret(v: string, key = ""): boolean {
    if (PEM_RE.test(v)) return true;
    if (/\s/.test(v) || URL_RE.test(v) || TRIVIAL_LITERAL_RE.test(v)) return false;
    if (SECRET_KEY_NAME_RE.test(key)) return v.length >= 4;
    if (v.length < 8 || /^\d+$/.test(v)) return false;
    const hasMixedAlnum = /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v);
    return hasMixedAlnum || HEX_RE.test(v) || UUID_RE.test(v) || PASSPHRASE_RE.test(v) || SK_PREFIX_RE.test(v);
}

// Extract the secret to redact from a .env value (for URLs, only the embedded password).
export function extractSecret(v: string, key = ""): string | null {
    const candidate = URL_RE.test(v) ? URL_PASS_RE.exec(v)?.[1] : v;
    return candidate && isSecret(candidate, key) ? candidate : null;
}

function addSecretVariants(found: Set<string>, secret: string): void {
    found.add(secret);
    found.add(encodeURIComponent(secret));
    found.add(Buffer.from(secret).toString("base64"));
    if (PEM_RE.test(secret)) {
        for (const line of secret.split(/\\n|\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed.length >= 8 && !trimmed.startsWith("-----")) found.add(trimmed);
        }
    }
}

// Walk from cwd up to / collecting secrets from every .env* file.
// Longest-first order prevents a prefix secret from partially eating a longer one.
function collectSecrets(cwd: string): { secrets: string[]; count: number } {
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

    const found = new Set<string>();
    for (const secret of raw) addSecretVariants(found, secret);
    return { secrets: [...found].sort((a, b) => b.length - a.length), count: raw.size };
}

export function loadSecrets(cwd: string): string[] {
    return collectSecrets(cwd).secrets;
}

// Recursively replace all secret occurrences in strings/arrays/plain objects.
function scrub<T>(value: T, secrets: string[], onRedact: () => void): T {
    if (typeof value === "string") {
        let out: string = value;
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
    // Scan at load time; if no secrets exist, hook nothing.
    const { secrets, count } = collectSecrets(process.cwd());
    if (count === 0) return;

    const redact = <T>(value: T, warning: string, ctx: ExtensionContext): T | undefined => {
        let hit = false;
        const out = scrub(value, secrets, () => {
            hit = true;
        });
        if (!hit) return undefined;
        ctx.ui.notify(`redact: ${warning}`, "warning");
        return out;
    };

    pi.on("session_start", (_event, ctx) => {
        ctx.ui.notify(`redact: Protecting ${count} secret${count === 1 ? "" : "s"}`, "info");
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
