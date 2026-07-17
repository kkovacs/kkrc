/**
 * /collapse — Manual compaction command
 *
 * Serializes the current session branch into a compact text format and
 * writes a compaction entry directly. Zero LLM cost.
 *
 * Unlike the built-in /compact, this does not involve the LLM — it is a
 * deterministic text transform that strips thinking blocks, tool results,
 * and collapses file/batch tool calls to one-liners.
 *
 * Usage: /collapse
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RW = new Set(["read", "write", "edit"]);

interface CompactResult {
  text: string;
  isToolOnly: boolean; // assistant message with tool calls and no text
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
      return { text: texts.length ? `# User\n\n${texts.join("")}\n` : "", isToolOnly: false };
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
          if (RW.has(c.name)) acc.push(`[${c.name}] ${c.arguments?.path ?? ""}`);
          else if (c.name === "bash") {
            const cmd = String(c.arguments?.command ?? "");
            let bashLine = `[bash] ${cmd.split("\n")[0]}${cmd.includes("\n") ? " ..." : ""}`;
            if (c.arguments?.outfile) bashLine += `\nOutput: ${c.arguments.outfile}`;
            acc.push(bashLine);
          } else acc.push(`[${c.name}]`);
        }
        return acc;
      }, []);
      if (!lines.length) return { text: "", isToolOnly: false };
      const isToolOnly = !hasText && hasToolCall;
      if (hasText) return { text: `# Assistant\n\n${lines.join("\n")}\n`, isToolOnly };
      return { text: `${lines.join("\n")}\n`, isToolOnly };
    }

    case "bashExecution": {
      let r = `# User\n\n[bash] ${command ?? ""}\n`;
      if (fullOutputPath) r += `[output: ${fullOutputPath}]\n`;
      else if (output) r += `${String(output)}\n`;
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
          parts.push(`# Assistant\n\n${result.text}`);
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
  pi.registerCommand("collapse", {
    description: "Compact the session by stripping reasoning and tool calls (zero LLM)",
    handler: async (_args, ctx) => {
      const branch = ctx.sessionManager.getBranch() as any[];
      if (branch.length === 0) {
        ctx.ui.notify("No entries to compact", "error");
        return;
      }

      const summary = compactAll(branch);
      if (!summary.trim()) {
        ctx.ui.notify("Nothing to compact (no serializable messages)", "error");
        return;
      }

      const tokens = ctx.getContextUsage()?.tokens ?? 0;

      // Write the compaction entry directly into the session.
      // Bypasses the built-in ctx.compact() which rejects sessions
      // that are too small (prepareCompaction returns undefined).
      // Pass empty firstKeptEntryId so nothing pre-compaction is kept
      // verbatim — the summary captures everything.
      const sm = ctx.sessionManager as any;
      sm.appendCompaction(
        summary,
        "",         // firstKeptEntryId: keep nothing before the compaction
        tokens,
        undefined,  // no details
        true,       // fromHook
      );

      ctx.ui.notify(
        `/collapse: ${summary.length.toLocaleString()} chars (${tokens.toLocaleString()} tokens)`,
        "success",
      );

      // Reload to rebuild the TUI chat so the compaction entry is displayed.
      await ctx.reload();
    },
  });
}
