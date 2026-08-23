/**
 * pingme.ts - Pi Extension
 *
 * Calls a URL when the agent settles after running for more than 1 minute.
 *
 * Activate by giving the URL with --pingme <url> .
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    pi.registerFlag("pingme", {
        description: "URL to GET when a long agent run settles (>1 min)",
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

        if (elapsed > 60_000) {
            const url = pi.getFlag("pingme") as string | undefined;
            if (url) {
                fetch(url).catch((err) => {
                    console.error("[pingme] fetch failed:", err.message);
                });
            }
        }
    });
}
