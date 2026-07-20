// Local LLM provider. Discovers models from a local OpenAI-compatible
// server (llama.cpp, vLLM, LM Studio, etc.) and registers them as a
// custom provider.

import { parseArgs } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_URL = "http://127.0.0.1:8080";
const PROBE_TIMEOUT_MS = 2000;

// Per-model defaults when the server does not advertise caps.
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

// Extract context window from meta.n_ctx, direct field, etc.
function getCtxWin(m: Record<string, unknown>): number | undefined {
  if (typeof m.context_window === "number" && m.context_window > 0) return m.context_window;
  const meta = m.meta as Record<string, unknown> | undefined;
  if (meta) {
    if (typeof meta.n_ctx === "number" && meta.n_ctx > 0) return meta.n_ctx;
    if (typeof meta.n_ctx_train === "number" && meta.n_ctx_train > 0) return meta.n_ctx_train;
  }
  return undefined;
}

// Detect multimodal from legacy capabilities or details.
function isMultimodal(m: Record<string, unknown>): boolean {
  const caps = m.capabilities as string[] | undefined;
  if (caps?.includes("multimodal")) return true;
  const details = m.details as Record<string, unknown> | undefined;
  return details?.multimodal === true;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

// Probe OpenAI-compat model listings. First hit wins; its path strip
// defines the chat completion base URL.
async function probe(
  baseUrl: string,
): Promise<{ chatBase: string; models: { id: string; context_window: number; max_tokens: number; multimodal: boolean }[] } | null> {
  const tries = [
    { probe: `${baseUrl}/v1/models`, chat: `${baseUrl}/v1`, extract: (j: Record<string, unknown>) => (j.data as unknown[]) ?? (j.models as unknown[]) },
    { probe: `${baseUrl}/models`, chat: baseUrl, extract: (j: Record<string, unknown>) => (j.models as unknown[]) ?? (j.data as unknown[]) },
  ];
  for (const t of tries) {
    try {
      const r = await fetch(t.probe, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!r.ok) continue;
      const list = t.extract(await r.json() as Record<string, unknown>);
      if (!Array.isArray(list) || list.length === 0) continue;
      const models = list
        .map((entry) => {
          const m = entry as Record<string, unknown>;
          const id = typeof m.id === "string" ? m.id : (typeof m.name === "string" ? m.name : null);
          if (!id) return null;
          const ctxWin = getCtxWin(m);
          const maxTok = numOrUndef(m.max_tokens) ?? (ctxWin ? Math.min(Math.floor(ctxWin / 8), 32768) : DEFAULT_MAX_TOKENS);
          return { id, context_window: ctxWin ?? DEFAULT_CONTEXT_WINDOW, max_tokens: maxTok, multimodal: isMultimodal(m) };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (models.length === 0) continue;
      return { chatBase: t.chat, models };
    } catch {
      // try next
    }
  }
  return null;
}

// XXX: pi binds CLI flag values to the registry AFTER factories run, so
// pi.getFlag() returns nothing at factory time. Parse from argv directly.
function getLocalUrlFromArgv(): string | undefined {
  const { values } = parseArgs({ options: { local: { type: "string" } }, strict: false });
  const raw = values["local"];
  if (typeof raw !== "string" || !raw) return undefined;
  return raw;
}

export default async function (pi: ExtensionAPI) {
  // Register CLI flag (so it shows in --help and isn't reported as unknown).
  // The value itself is read from process.argv because pi.getFlag is not yet
  // bound at factory time.
  pi.registerFlag("local", {
    description: "Local LLM server URL (default http://127.0.0.1:8080, e.g. --local http://localhost:9999)",
    type: "string",
  });

  const envUrl = process.env.PI_LOCAL_LLM_URL;
  const flagUrl = getLocalUrlFromArgv();
  const baseUrl = (flagUrl ?? envUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  const apiKey = process.env.LOCAL_API_KEY ?? "no-key";

  const result = await probe(baseUrl);
  if (!result) {
    // Server unreachable: skip silently so pi startup is not blocked.
    return;
  }

  pi.registerProvider("local-llm", {
    name: "Local LLM",
    baseUrl: result.chatBase,
    apiKey,
    api: "openai-completions",
    models: result.models.map((m) => ({
      id: m.id,
      name: m.id,
      reasoning: false,
      input: m.multimodal ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.context_window,
      maxTokens: m.max_tokens,
    })),
  });
}
