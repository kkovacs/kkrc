/**
 * /clean — Start a fresh session seeded with compacted context
 *
 * Serializes the current session branch into compact text and forks to a
 * brand-new session with that text as the opening message. The original
 * session is untouched. Zero LLM cost.
 *
 * Usage: /clean
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

/** Measure raw character count of a single message (before compaction). */
function measureOriginal(msg: Record<string, unknown>): number {
  const { role, content, command, output, fullOutputPath } = msg;

  switch (role) {
    case "user": {
      const texts: string[] =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? (content as any[]).filter((b) => b?.type === "text").map((b) => b.text)
            : [];
      return texts.join("").length;
    }

    case "assistant": {
      if (!Array.isArray(content)) return 0;
      return (content as any[]).reduce((acc, c) => {
        if (c.type === "text" && typeof c.text === "string") {
          return acc + c.text.length;
        }
        if (c.type === "toolCall") {
          return acc + (c.name?.length ?? 0) + JSON.stringify(c.arguments ?? {}).length;
        }
        return acc;
      }, 0);
    }

    case "bashExecution": {
      let len = String(command ?? "").length;
      if (fullOutputPath) len += String(fullOutputPath).length;
      else if (output) len += String(output).length;
      return len;
    }

    default:
      return 0;
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

/** Measure total raw character count of a branch (before compaction). */
function measureAll(branch: any[]): number {
  let total = 0;
  for (const e of branch) {
    if (e.type === "message" && e.message) {
      total += measureOriginal(e.message);
    } else if (e.type === "compaction" && e.summary) {
      total += e.summary.length;
    }
  }
  return total;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("clean", {
    description: "Start a fresh session seeded with compacted context (zero LLM)",
    handler: async (_args, ctx) => {
      const sm = ctx.sessionManager as any;
      const branch = sm.getBranch() as any[];
      if (branch.length === 0) {
        ctx.ui.notify("No entries to clean", "error");
        return;
      }

      const summary = compactAll(branch);
      if (!summary.trim()) {
        ctx.ui.notify("Nothing to clean (no serializable messages)", "error");
        return;
      }

      const tokens = ctx.getContextUsage()?.tokens ?? 0;
      const parentSession = sm.getSessionFile() as string | undefined;
      const sessionId = sm.getSessionId();
      const originalChars = measureAll(branch);
      const compactChars = summary.trim().length;
      const reduction = originalChars > 0 ? Math.round((1 - compactChars / originalChars) * 100) : 0;

      const seededText =
        "Here is a summary of our previous session " +
        sessionId +
        ". Let's continue on this:\n\n" +
        summary.trim();

      // Fork to a fresh session with the compact text seeded as a user message.
      const result = await ctx.newSession({
        parentSession,
        setup: async (sessionManager: any) => {
          sessionManager.appendMessage({
            role: "user",
            content: seededText,
          });
        },
        withSession: async (freshCtx) => {
          freshCtx.ui.notify(
            `/clean: ${originalChars.toLocaleString()} → ${compactChars.toLocaleString()} chars (${reduction}% reduction)`,
            "success",
          );
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("Clean cancelled", "warning");
      }
    },
  });
}
