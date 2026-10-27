/**
 * pingme.ts - Pi Extension
 *
 * Calls a URL when the agent settles after running for more than 1 minute
 * (or PINGME_AFTER=<seconds>).
 *
 * Activate with PINGME=<url> or /pingme <url>. Use /pingme off to disable it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function normalizePingmeUrl(value: string): string | undefined {
    const url = value.trim();
    return !url ? undefined : /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function (pi: ExtensionAPI) {
    // The command overrides the environment for this extension runtime only.
    let url = process.env.PINGME;
    const afterSec = Number(process.env.PINGME_AFTER ?? 60);
    const afterMs = afterSec * 1000;
    let agentStartTime: number | null = null;

    pi.registerCommand("pingme", {
        description: "Show, set, or disable the ping URL (usage: /pingme [url|off])",
        handler: async (args, ctx) => {
            const value = args.trim();
            if (!value) {
                ctx.ui.notify(url ? `📟 pingme: ${url} (use /pingme off to disable)` : "📟 pingme: Off", "info");
                return;
            }
            url = value.toLowerCase() === "off" ? undefined : normalizePingmeUrl(value);
            agentStartTime = null;
            ctx.ui.notify(url ? `📟 pingme: Active (>${afterSec}s)` : "📟 pingme: Off", "info");
        },
    });

    // Use "warning" so Pi TUI doesn't coalesce consecutive session_start info lines.
    pi.on("session_start", (_event, ctx) => {
        if (url) ctx.ui.notify(`📟 pingme: Active (>${afterSec}s)`, "warning");
    });

    pi.on("agent_start", () => {
        agentStartTime ??= Date.now();
    });

    pi.on("agent_settled", () => {
        if (!url || agentStartTime === null) return;

        const elapsed = Date.now() - agentStartTime;
        agentStartTime = null;

        if (elapsed > afterMs) {
            fetch(url).catch((err) => {
                console.error("[pingme] fetch failed:", err.message);
            });
        }
    });
}
