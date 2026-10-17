/**
 * /undo — Rewind the conversation by n user messages (default 1)
 *
 * Moves the session leaf back with ctx.navigateTree(): same session file, no
 * fork, no summary. The undone entries stay in the file as an abandoned
 * branch. Files changed by tools are NOT reverted. Notifies with the tail of
 * the message that is now last, i.e. what the next prompt responds to.
 * Zero LLM cost.
 *
 * Usage: /undo [n]
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TAIL = 200; // chars of the new last message shown in the notify

function text(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
}

export default function (pi: ExtensionAPI) {
    pi.registerCommand("undo", {
        description: "Undo the last n user messages (default 1)",
        handler: async (args, ctx) => {
            const n = args.trim() ? Number(args.trim()) : 1;
            if (!Number.isInteger(n) || n < 1) {
                ctx.ui.notify("Usage: /undo [n]", "warning");
                return;
            }

            const sm = ctx.sessionManager as any;
            const users = (sm.getBranch() as any[])
                .filter((e) => e.type === "message" && e.message.role === "user");
            if (users.length === 0) {
                ctx.ui.notify("Nothing to undo", "warning");
                return;
            }
            const count = Math.min(n, users.length);

            try {
                // Navigating to a user message moves the leaf to its parent.
                // Throws while the agent is streaming or compacting.
                await ctx.navigateTree(users[users.length - count].id);
            } catch (err) {
                ctx.ui.notify(`Undo failed: ${err instanceof Error ? err.message : String(err)}`, "error");
                return;
            }

            const last = (sm.getBranch() as any[])
                .filter((e) => e.type === "message" && (e.message.role === "user" || e.message.role === "assistant"))
                .map((e) => text(e.message.content).trim())
                .filter(Boolean)
                .pop();
            const tail = last ? (last.length > TAIL ? "…" + last.slice(-TAIL) : last) : "(empty session)";
            ctx.ui.notify(`Undid ${count} message${count > 1 ? "s" : ""}. Now at:\n${tail}`, "info");
        },
    });
}
