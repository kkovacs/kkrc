import { tool } from "@opencode-ai/plugin"
import path from "path"

export default tool({
  description: "Run an SQL using DuckDB",
  args: {
    sql: tool.schema.string().describe("SQL command"),
  },
  async execute(args, context) {
    let result = "";

    try {
      result = await Bun.$`duckdb -c "${args.sql}" opencode-test.ddb`.text()
    } catch (err) {
      // For now, opencode didn't see the ShellError exception, so let's handle this for it.
      // XXX Check https://opencode.ai/docs/custom-tools/ to see if they added error handling.
      const stdout = err.stdout.toString();
      const stderr = err.stderr.toString();

      result = `Failed with code ${err.exitCode}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`;
    }

    return result.trim()
  },
})
