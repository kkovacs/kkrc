// Local LLM provider. Discovers models from an OpenAI-compatible server
// (llama.cpp, vLLM, LM Studio, ...) and registers them with Pi.
// Pi clamps max output tokens to the live context on every request, so we
// only feed it the real context window -- that's what makes its clamp and
// overflow/compaction recovery work. No token-budget math here.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_URL = "http://127.0.0.1:8080";
const PROBE_TIMEOUT_MS = 2000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

// Real context window: vLLM max_model_len, OpenAI context_window, or
// llama.cpp runtime n_ctx. Accurate value lets Pi clamp + recover.
function getCtxWin(m: Record<string, unknown>): number | undefined {
  if (typeof m.context_window === "number" && m.context_window > 0) return m.context_window;
  if (typeof m.max_model_len === "number" && m.max_model_len > 0) return m.max_model_len;
  const meta = m.meta as Record<string, unknown> | undefined;
  if (typeof meta?.n_ctx === "number" && meta.n_ctx > 0) return meta.n_ctx;
  return undefined;
}

function isMultimodal(m: Record<string, unknown>): boolean {
  const caps = m.capabilities as string[] | undefined;
  if (caps?.includes("multimodal")) return true;
  const details = m.details as Record<string, unknown> | undefined;
  return details?.multimodal === true;
}

// Ollama-style servers return both `data` (carries meta.n_ctx) and `models`
// (carries capabilities). Merge by id so we keep the context window AND the
// multimodal flag from whichever array exposes each.
function mergeModelLists(data?: unknown, models?: unknown): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  const add = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      const m = e as Record<string, unknown>;
      const key = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : null;
      if (!key) continue;
      byKey.set(key, { ...byKey.get(key), ...m });
    }
  };
  add(data);
  add(models);
  return [...byKey.values()];
}

// First reachable listing wins; its path defines the chat base URL.
async function probe(baseUrl: string, apiKey?: string) {
  const tries = [
    { list: `${baseUrl}/v1/models`, chat: `${baseUrl}/v1` },
    { list: `${baseUrl}/models`, chat: baseUrl },
  ];
  for (const t of tries) {
    try {
      const r = await fetch(t.list, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!r.ok) continue;
      const j = (await r.json()) as Record<string, unknown>;
      const list = mergeModelLists(j.data, j.models);
      if (list.length === 0) continue;
      const models = list
        .map((e) => {
          const m = e as Record<string, unknown>;
          const id = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : null;
          if (!id) return null;
          return {
            id,
            context_window: getCtxWin(m) ?? DEFAULT_CONTEXT_WINDOW,
            // Pi clamps this to the live context per request; static default is fine.
            max_tokens: typeof m.max_tokens === "number" ? m.max_tokens : DEFAULT_MAX_TOKENS,
            multimodal: isMultimodal(m),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (models.length === 0) continue;
      return { chatBase: t.chat, models };
    } catch {
      // try next
    }
  }
  return null;
}

export default async function (pi: ExtensionAPI) {
  const baseUrl = (process.env.LOCAL_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  const envKey = process.env.LOCAL_KEY;

  const result = await probe(baseUrl, envKey);
  if (!result) return; // unreachable: skip silently so startup isn't blocked

  // Some servers require *any* non-empty key even when unauthenticated, so
  // keep a dummy placeholder when none is configured.
  // XXX: verify Pi no longer hides keyless models; drop the dummy if so.
  // XXX: llama.cpp /v1/models omits n_ctx, so small -c servers fall back to
  // 128k and won't clamp. Probe the singular /v1/model (meta.n_ctx) to fix.
  pi.registerProvider("local-llm", {
    name: "Local LLM",
    baseUrl: result.chatBase,
    apiKey: envKey ?? "no-key",
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
