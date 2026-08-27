// Local LLM provider. Discovers models from a local OpenAI-compatible
// server (llama.cpp, vLLM, LM Studio, etc.) and registers them as a
// custom provider.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_URL = "http://127.0.0.1:8080";
const PROBE_TIMEOUT_MS = 2000;

// Per-model defaults when the server does not advertise caps.
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

// Output-token budget guardrails (see the maxTokens computation below).
// Local servers (e.g. llama.cpp) advertise their *runtime* context via
// meta.n_ctx, which can be small -- it is simply whatever was passed to -c.
// The previous `ctxWin / 8` heuristic turned a 4096-token context into a
// 512-token output cap and produced "Response was truncated before
// completion." These constants keep a usable floor while never requesting
// more output than the server's real context can actually hold.
const MIN_OUTPUT_TOKENS = 2_048; // floor so small-context servers can still answer
const MAX_OUTPUT_TOKENS = 32_768; // ceiling to avoid oversized generation requests
const INPUT_RESERVE_TOKENS = 1_024; // tokens kept free for prompt/system/tools

// Extract context window from meta.n_ctx, direct field, etc.
function getCtxWin(m: Record<string, unknown>): number | undefined {
    if (typeof m.context_window === "number" && m.context_window > 0)
        return m.context_window;
    if (typeof m.max_model_len === "number" && m.max_model_len > 0)
        return m.max_model_len;
    const meta = m.meta as Record<string, unknown> | undefined;
    if (meta) {
        if (typeof meta.n_ctx === "number" && meta.n_ctx > 0) return meta.n_ctx;
        if (typeof meta.n_ctx_train === "number" && meta.n_ctx_train > 0)
            return meta.n_ctx_train;
    }
    return undefined;
}

// Extract the model's maximum supported context (training context), used to
// suggest a -c value when the server was launched with a small context.
function getMaxCtx(m: Record<string, unknown>): number | undefined {
    const meta = m.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta.n_ctx_train === "number" && meta.n_ctx_train > 0)
        return meta.n_ctx_train;
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
    apiKey?: string,
): Promise<{
    chatBase: string;
    models: {
        id: string;
        context_window: number;
        max_tokens: number;
        multimodal: boolean;
        recommended_ctx?: number;
    }[];
} | null> {
    const tries = [
        {
            probe: `${baseUrl}/v1/models`,
            chat: `${baseUrl}/v1`,
            extract: (j: Record<string, unknown>) =>
                (j.data as unknown[]) ?? (j.models as unknown[]),
        },
        {
            probe: `${baseUrl}/models`,
            chat: baseUrl,
            extract: (j: Record<string, unknown>) =>
                (j.models as unknown[]) ?? (j.data as unknown[]),
        },
    ];
    for (const t of tries) {
        try {
            const r = await fetch(t.probe, {
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            });
            if (!r.ok) continue;
            const list = t.extract((await r.json()) as Record<string, unknown>);
            if (!Array.isArray(list) || list.length === 0) continue;
            const models = list
                .map((entry) => {
                    const m = entry as Record<string, unknown>;
                    const id =
                        typeof m.id === "string"
                            ? m.id
                            : typeof m.name === "string"
                              ? m.name
                              : null;
                    if (!id) return null;
                    const ctxWin = getCtxWin(m);
                    // Derive an output budget from the (real) context window:
                    //  - floor half the context, but never below MIN_OUTPUT_TOKENS,
                    //    so a small -c (e.g. 4096) still yields a usable ~2048 tokens
                    //    instead of the old 512-token cap that truncated responses;
                    //  - capped at MAX_OUTPUT_TOKENS so we never ask for a huge output;
                    //  - also clamped to ctxWin - INPUT_RESERVE_TOKENS so the output
                    //    fits inside the server's actual context alongside the prompt
                    //    (this term dominates for tiny contexts, e.g. -c 2048);
                    //  - the outer Math.max(256, ...) guarantees a non-zero minimum
                    //    even for pathological contexts.
                    const maxTok =
                        numOrUndef(m.max_tokens) ??
                        (ctxWin
                            ? Math.max(
                                  256,
                                  Math.min(
                                      Math.max(
                                          Math.floor(ctxWin * 0.5),
                                          MIN_OUTPUT_TOKENS,
                                      ),
                                      MAX_OUTPUT_TOKENS,
                                      ctxWin - INPUT_RESERVE_TOKENS,
                                  ),
                              )
                            : DEFAULT_MAX_TOKENS);
                    return {
                        id,
                        context_window: ctxWin ?? DEFAULT_CONTEXT_WINDOW,
                        max_tokens: maxTok,
                        multimodal: isMultimodal(m),
                        recommended_ctx: getMaxCtx(m),
                    };
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

export default async function (pi: ExtensionAPI) {
    const baseUrl = (process.env.LOCAL_URL ?? DEFAULT_URL).replace(/\/+$/, "");
    const envKey = process.env.LOCAL_KEY;

    const result = await probe(baseUrl, envKey);
    if (!result) {
        // Server unreachable: skip silently so pi startup is not blocked.
        return;
    }

    pi.registerProvider("local-llm", {
        name: "Local LLM",
        baseUrl: result.chatBase,
        // pi hides models without an apiKey in /model and --list-models,
        // so keyless local servers keep a dummy placeholder value.
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

    // Remind the user when a local model is loaded with a small context
    // window: agentic coding needs room for the system prompt, tool schemas,
    // history, and output. Recommend relaunching llama.cpp with a larger -c.
    const LOW_CTX_THRESHOLD = 65536;
    const lowCtx = result.models
        .filter((m) => m.context_window < LOW_CTX_THRESHOLD)
        .map((m) => ({ id: m.id, have: m.context_window, max: m.recommended_ctx }));
    if (lowCtx.length > 0) {
        pi.on("session_start", (_event, ctx) => {
            if (!ctx.ui.hasUI) return;
            for (const w of lowCtx) {
                const tip = w.max
                    ? `Relaunch llama.cpp with -c ${w.max} (model max) for agentic coding.`
                    : `Relaunch llama.cpp with a larger -c (e.g. 65536+) for agentic coding.`;
                ctx.ui.notify(
                    `Local LLM "${w.id}" context is ${w.have} tokens (< 64k). ${tip}`,
                    "warning",
                );
            }
        });
    }
}
