/**
 * pingme.ts - Pi Extension
 *
 * Calls a URL when the agent settles after running for more than 1 minute
 * (or --pingme-after <seconds>).
 *
 * Activate by giving the URL with --pingme <url> .
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    pi.registerFlag("pingme", {
        description: "URL to GET when a long agent run settles (>1 min)",
        type: "string",
    });
    pi.registerFlag("pingme-after", {
        description: "Seconds an agent run must take before --pingme fires (default 60)",
        type: "string",
    });

    let agentStartTime: number | null = null;

    pi.on("agent_start", () => {
        if (agentStartTime === null) {
            agentStartTime = Date.now();
        }
    });

    pi.on("agent_settled", () => {
        if (agentStartTime === null) return;

        const elapsed = Date.now() - agentStartTime;
        agentStartTime = null;

        const after = Number(pi.getFlag("pingme-after") ?? 60);
        if (elapsed > after * 1000) {
            const url = pi.getFlag("pingme") as string | undefined;
            if (url) {
                fetch(url).catch((err) => {
                    console.error("[pingme] fetch failed:", err.message);
                });
            }
        }
    });
}
