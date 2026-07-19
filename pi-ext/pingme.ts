/**
 * pingme.ts - Pi Extension
 *
 * Calls a URL when the agent finishes a turn that took more than 1 minute.
 *
 * Activate by giving the URL with --pingme <url> .
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerFlag("pingme", {
    description: "URL to GET when a long turn finishes (>1 min)",
    type: "string",
  });

  const url = pi.getFlag("pingme") as string | undefined;
  if (!url) {
    //console.log("[pingme] No --pingme flag set — extension inactive.");
    return;
  }

  let agentStartTime: number | null = null;

  pi.on("agent_start", () => {
    agentStartTime = Date.now();
  });

  pi.on("agent_end", () => {
    if (agentStartTime === null) return;

    const elapsed = Date.now() - agentStartTime;
    agentStartTime = null;

    if (elapsed > 60_000) {
      fetch(url).catch((err) => {
        console.error("[pingme] fetch failed:", err.message);
      });
    }
  });
}
