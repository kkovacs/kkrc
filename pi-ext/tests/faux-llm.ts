/**
 * faux-llm.ts — Test-only Pi extension: a deterministic fake LLM
 *
 * Registers Pi's own faux provider (the one Pi's test suite uses) as
 * `--provider faux --model faux-1`. Each reply is computed from the context the
 * model receives, so tests can check what the LLM actually sees:
 *
 *   default  → "SEEN: <user msg 1> | <user msg 2> | …"
 *   "LONG"   → 300 × "A" + "END"
 *   "EMPTY"  → "" (empty assistant message)
 *   "SLOW"   → waits 1.5s first (keeps Pi streaming), then default
 *   "TOOLS"  → two tool-only turns (bash `echo hi`, then read `README.md`),
 *              then default
 *   "THINK"  → thinking "secret thoughts" + default text
 *
 * Lives in tests/ so it is never auto-loaded as a real extension.
 * Used by: rpc.ts (startPi loads it with -e).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxThinking, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

function userTexts(context: any): string[] {
    return context.messages
        .filter((m: any) => m.role === "user")
        .map((m: any) => typeof m.content === "string"
            ? m.content
            : m.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(""));
}

export default function (pi: ExtensionAPI) {
    const faux = fauxProvider();
    // One queued response per call: each step queues the next one
    const step = async (context: any) => {
        faux.appendResponses([step]);
        const seen = userTexts(context);
        const last = seen[seen.length - 1];
        if (last === "TOOLS") {
            // Tool results since the last user message decide the next step
            const msgs = context.messages;
            const lastUser = msgs.map((m: any) => m.role).lastIndexOf("user");
            const results = msgs.slice(lastUser).filter((m: any) => m.role === "toolResult").length;
            if (results === 0) return fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" });
            if (results === 1) return fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" });
        }
        if (last === "THINK") return fauxAssistantMessage([fauxThinking("secret thoughts"), fauxText("SEEN: " + seen.join(" | "))]);
        if (last === "LONG") return fauxAssistantMessage("A".repeat(300) + "END");
        if (last === "EMPTY") return fauxAssistantMessage("");
        if (last === "SLOW") await new Promise((r) => setTimeout(r, 1500));
        return fauxAssistantMessage("SEEN: " + seen.join(" | "));
    };
    faux.setResponses([step]);
    (pi as any).registerProvider(faux.provider);
}
