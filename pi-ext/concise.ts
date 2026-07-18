/**
 * /concise — Manual compaction command
 *
 * Serializes the current session branch into a compact text format and
 * writes a compaction entry directly. Zero LLM cost.
 *
 * Unlike the built-in /compact, this does not involve the LLM — it is a
 * deterministic text transform that strips thinking blocks, tool results,
 * and concises file/batch tool calls to one-liners.
 *
 * After appending the compaction, navigates away and back to force a context
 * rebuild (updating agent.state.messages so the LLM sees the compacted context).
 *
 * Usage: /concise
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RW = new Set(["read", "write", "edit"]);

interface CompactResult {
  text: string;
  isToolOnly: boolean;
}

function compact(msg: Record<string, unknown>): CompactResult {
  const { role, content, toolName, command, output, fullOutputPath } = msg;

  switch (role) {
    case "user": {
      const texts: string[] =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? (content as any[]).filter((b) => b?.type === "text").map((b) => b.text)
            : [];
      return { text: texts.length ? "# User\n\n" + texts.join("") + "\n" : "", isToolOnly: false };
    }

    case "assistant": {
      if (!Array.isArray(content)) return { text: "", isToolOnly: false };
      let hasText = false;
      let hasToolCall = false;
      const lines = (content as any[]).reduce<string[]>((acc, c) => {
        if (c.type === "text") {
          hasText = true;
          acc.push(c.text);
        } else if (c.type === "toolCall") {
          hasToolCall = true;
          if (RW.has(c.name)) acc.push("[" + c.name + "] " + (c.arguments?.path ?? ""));
          else if (c.name === "bash") {
            const cmd = String(c.arguments?.command ?? "");
            let bashLine = "[bash] " + cmd.split("\n")[0] + (cmd.includes("\n") ? " …" : "");
            if (c.arguments?.outfile) bashLine += "\nOutput: " + c.arguments.outfile;
            acc.push(bashLine);
          } else acc.push("[" + c.name + "]");
        }
        return acc;
      }, []);
      if (!lines.length) return { text: "", isToolOnly: false };
      const isToolOnly = !hasText && hasToolCall;
      if (hasText) return { text: "# Assistant\n\n" + lines.join("\n") + "\n", isToolOnly };
      return { text: lines.join("\n") + "\n", isToolOnly };
    }

    case "bashExecution": {
      let r = "# User\n\n[bash] " + (command ?? "") + "\n";
      if (fullOutputPath) r += "[output: " + fullOutputPath + "]\n";
      else if (output) r += String(output) + "\n";
      return { text: r, isToolOnly: false };
    }

    default:
      return { text: "", isToolOnly: false };
  }
}

/** Serialize all entries in a branch to compact text. */
function compactAll(branch: any[]): string {
  const parts: string[] = [];
  let prevWasToolOnly = false;
  for (const e of branch) {
    if (e.type === "message" && e.message) {
      const result = compact(e.message);
      if (result.text) {
        if (result.isToolOnly && !prevWasToolOnly) {
          parts.push("# Assistant\n\n" + result.text);
        } else if (result.isToolOnly && prevWasToolOnly) {
          parts[parts.length - 1] += result.text;
        } else {
          parts.push(result.text);
        }
        prevWasToolOnly = result.isToolOnly;
      }
    } else if (e.type === "compaction" && e.summary) {
      parts.push(e.summary);
      prevWasToolOnly = false;
    }
  }
  return parts.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("concise", {
    description: "Compact the session by stripping reasoning and tool calls (zero LLM)",
    handler: async (_args, ctx) => {
      const sm = ctx.sessionManager as any;
      const branch = sm.getBranch() as any[];
      if (branch.length === 0) {
        ctx.ui.notify("No entries to compact", "error");
        return;
      }

      // Already compacted?
      const lastEntry = branch[branch.length - 1];
      if (lastEntry?.type === "compaction") {
        ctx.ui.notify("Already compacted", "error");
        return;
      }

      // Generate the deterministic summary
      const summary = compactAll(branch);
      if (!summary.trim()) {
        ctx.ui.notify("Nothing to compact (no serializable messages)", "error");
        return;
      }

      const tokens = ctx.getContextUsage()?.tokens ?? 0;

      // Append the compaction entry
      sm.appendCompaction(summary, "", tokens, undefined, true);

      // XXX: agent.state.messages is NOT updated by sm.appendCompaction() alone.
      // Without updating it, the agent still sends all the old uncompacted messages
      // to the LLM on the next prompt, keeping the cache hit at ~99%.
      // The built-in /compact does this internally (agent-session.ts:1857-1859), but
      // since we bypass it with direct sm.appendCompaction(), we need another way.
      //
      // navigateTree updates agent.state.messages as a side effect (line 3004-3005).
      // Navigating away to the parent then back to the compaction entry forces this
      // rebuild: first to the pre-compaction state, then to the compacted context.
      const compactionId = sm.getLeafId();
      const parentId = sm.getEntry(compactionId)?.parentId;

      if (parentId) {
        await ctx.navigateTree(parentId, { summarize: false });
        await ctx.navigateTree(compactionId, { summarize: false });
      }

      ctx.ui.notify(
        "/concise: " +
          summary.length.toLocaleString() +
          " chars (" +
          tokens.toLocaleString() +
          " tokens)",
        "success",
      );
    },
  });
}
