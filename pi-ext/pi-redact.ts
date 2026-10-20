/**
 * pi-redact.ts — Redact local .env secrets before they reach the LLM
 *
 * Walks from cwd up to /, parses every .env* file found, and holds nontrivial
 * secret values in memory. Scrubs tool results and outbound LLM context so
 * accidental `cat .env`, `read`, or pasted secrets are replaced with
 * `<REDACTED--PLEASE-DO-NOT-READ-SECRETS>`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REDACTED = "<REDACTED--PLEASE-DO-NOT-READ-SECRETS>";
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const PASSPHRASE_RE = /^[a-zA-Z]{3,}(?:-[a-zA-Z]{3,}){3,}$/;

// Filter out short/trivial config values (ports, booleans, plain words, sentences)
// so we don't redact normal code or prose in the prompt.
export function isSecret(v: string): boolean {
    if (v.length < 8 || /\s/.test(v) || /^\d+$/.test(v)) return false;
    const hasMixedAlnum = /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v);
    return hasMixedAlnum || HEX_RE.test(v) || UUID_RE.test(v) || PASSPHRASE_RE.test(v);
}

// Walk from cwd up to / collecting secrets from every .env* file.
// Longest-first order prevents a prefix secret from partially eating a longer one.
export function loadSecrets(cwd: string): string[] {
    const found = new Set<string>();
    let dir = resolve(cwd);
    while (true) {
        try {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.name.startsWith(".env") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
                const parsed = parseEnv(readFileSync(join(dir, entry.name), "utf8"));
                for (const val of Object.values(parsed)) {
                    if (typeof val === "string" && isSecret(val)) found.add(val);
                }
            }
        } catch {
            // Skip unreadable parent directories (e.g. permission denied on the walk to /)
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return [...found].sort((a, b) => b.length - a.length);
}

// Recursively replace all secret occurrences in strings/arrays/plain objects.
function scrub<T>(value: T, secrets: string[]): T {
    if (secrets.length === 0 || value === null || value === undefined) return value;
    if (typeof value === "string") {
        let out: string = value;
        for (const s of secrets) {
            if (out.includes(s)) out = out.replaceAll(s, REDACTED);
        }
        return out as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => scrub(item, secrets)) as T;
    }
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = scrub(v, secrets);
        }
        return out as T;
    }
    return value;
}

export default function (pi: ExtensionAPI) {
    let secrets: string[] | null = null;
    const getSecrets = (cwd: string) => (secrets ??= loadSecrets(cwd));

    pi.on("session_start", (_event, ctx) => {
        secrets = loadSecrets(ctx.cwd);
    });

    // Scrub tool results immediately (covers bash `cat .env`, read, codemode, etc.).
    pi.on("tool_result", (event, ctx) => {
        const list = getSecrets(ctx.cwd);
        if (list.length === 0) return;
        return {
            content: scrub(event.content, list),
            ...(event.structuredContent !== undefined
                ? { structuredContent: scrub(event.structuredContent, list) }
                : {}),
            ...(event.details !== undefined
                ? { details: scrub(event.details, list) }
                : {}),
        };
    });

    // Scrub full outbound transcript (system prompt, user prompts, !bash, tool results)
    // right before each LLM call.
    pi.on("context_with_system", (event, ctx) => {
        const list = getSecrets(ctx.cwd);
        if (list.length === 0) return;
        return { messages: scrub(event.messages, list) };
    });

    // Final pass on serialized provider payloads.
    pi.on("before_provider_request", (event, ctx) => {
        const list = getSecrets(ctx.cwd);
        if (list.length === 0) return;
        return scrub(event.payload, list);
    });
}
