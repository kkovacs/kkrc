/**
 * pingme.ts - Pi Extension
 *
 * Calls a URL when the agent settles after running for more than 1 minute
 * (or PINGME_AFTER=<seconds>).
 *
 * Activate by setting PINGME=<url> in the environment.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    // Do not register any hooks if no ping URL is configured.
    const url = process.env.PINGME;
    if (!url) return;

    const afterSec = Number(process.env.PINGME_AFTER ?? 60);
    const afterMs = afterSec * 1000;
    let agentStartTime: number | null = null;

    // Use "warning" so Pi TUI doesn't coalesce consecutive session_start info lines.
    pi.on("session_start", (_event, ctx) => {
        ctx.ui.notify(`🔔 pingme: Active (>${afterSec}s)`, "warning");
    });

    pi.on("agent_start", () => {
        agentStartTime ??= Date.now();
    });

    pi.on("agent_settled", () => {
        if (agentStartTime === null) return;

        const elapsed = Date.now() - agentStartTime;
        agentStartTime = null;

        if (elapsed > afterMs) {
            fetch(url).catch((err) => {
                console.error("[pingme] fetch failed:", err.message);
            });
        }
    });
}
