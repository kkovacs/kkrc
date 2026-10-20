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

    const afterMs = Number(process.env.PINGME_AFTER ?? 60) * 1000;
    let agentStartTime: number | null = null;

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
