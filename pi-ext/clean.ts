/**
 * /clean — Start a fresh session with compacted context in the editor
 *
 * Serializes the current session branch into compact text, forks to a
 * brand-new session, and drops the compact text into the editor (unsent)
 * so you can edit it before sending. The original session is untouched.
 * Zero LLM cost.
 *
 * Usage: /clean
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RW = new Set(["read", "write", "edit"]);

function compact(msg: Record<string, unknown>): { text: string; isToolOnly: boolean; originalLength: number } {
  const { role, content, command, output, fullOutputPath } = msg;

  switch (role) {
    case "user": {
      const texts: string[] =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? (content as any[]).filter((b) => b?.type === "text").map((b) => b.text)
            : [];
      const text = texts.join("");
      return { text: texts.length ? "# User\n\n" + text + "\n" : "", isToolOnly: false, originalLength: text.length };
    }

    case "assistant": {
      if (!Array.isArray(content)) return { text: "", isToolOnly: false, originalLength: 0 };
      let hasText = false;
      let hasToolCall = false;
      let originalLength = 0;
      const lines: string[] = [];
      for (const c of content as any[]) {
        if (c.type === "text" && typeof c.text === "string") {
          hasText = true;
          originalLength += c.text.length;
          lines.push(c.text);
        } else if (c.type === "toolCall") {
          hasToolCall = true;
          originalLength += (c.name?.length ?? 0) + JSON.stringify(c.arguments ?? {}).length;
          if (RW.has(c.name)) lines.push("[" + c.name + "] " + (c.arguments?.path ?? ""));
          else if (c.name === "bash") {
            const cmd = String(c.arguments?.command ?? "");
            let bashLine = "[bash] " + cmd.split("\n")[0] + (cmd.includes("\n") ? " …" : "");
            if (c.arguments?.outfile) bashLine += "\nOutput: " + c.arguments.outfile;
            lines.push(bashLine);
          } else lines.push("[" + c.name + "]");
        }
      }
      if (!lines.length) return { text: "", isToolOnly: false, originalLength };
      const isToolOnly = !hasText && hasToolCall;
      const body = lines.join("\n") + "\n";
      const text = isToolOnly ? body : "# Assistant\n\n" + body;
      return { text, isToolOnly, originalLength };
    }

    case "bashExecution": {
      const r = "# User\n\n[bash] " + (command ?? "") + "\n" +
        (fullOutputPath ? "[output: " + fullOutputPath + "]\n" : output ? String(output) + "\n" : "");
      const originalLength = String(command ?? "").length +
        (fullOutputPath ? String(fullOutputPath).length : output ? String(output).length : 0);
      return { text: r, isToolOnly: false, originalLength };
    }

    default:
      return { text: "", isToolOnly: false, originalLength: 0 };
  }
}

/** Serialize all entries in a branch to compact text. */
function compactAll(branch: any[]): { text: string; originalChars: number } {
  const parts: string[] = [];
  let prevWasToolOnly = false;
  let originalChars = 0;
  for (const e of branch) {
    if (e.type === "message" && e.message) {
      const result = compact(e.message);
      originalChars += result.originalLength;
      if (result.text) {
        if (result.isToolOnly) {
          if (prevWasToolOnly) {
            parts[parts.length - 1] += result.text;
          } else {
            parts.push("# Assistant\n\n" + result.text);
          }
        } else {
          parts.push(result.text);
        }
        prevWasToolOnly = result.isToolOnly;
      }
    } else if (e.type === "compaction" && e.summary) {
      parts.push(e.summary);
      originalChars += e.summary.length;
      prevWasToolOnly = false;
    }
  }
  return { text: parts.join("\n"), originalChars };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("clean", {
    description: "Start a fresh session with compacted context in the editor (zero LLM)",
    handler: async (_args, ctx) => {
      const sm = ctx.sessionManager as any;
      const branch = sm.getBranch() as any[];
      if (branch.length === 0) {
        ctx.ui.notify("No entries to clean", "error");
        return;
      }

      const { text: rawSummary, originalChars } = compactAll(branch);
      const summary = rawSummary.trim();
      if (!summary) {
        ctx.ui.notify("Nothing to clean (no serializable messages)", "error");
        return;
      }

      const parentSession = sm.getSessionFile() as string | undefined;
      const sessionId = sm.getSessionId();
      const compactChars = summary.length;
      const reduction = originalChars > 0 ? Math.round((1 - compactChars / originalChars) * 100) : 0;

      const seededText = `Here is a summary of our previous session ${sessionId}.\n\n${summary}\n\n# User - Let's continue on this:\n\n`;

      // Fork to a fresh session and prefill the editor with the compact text.
      const result = await ctx.newSession({
        parentSession,
        withSession: async (freshCtx) => {
          freshCtx.ui.setEditorText(seededText);
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
