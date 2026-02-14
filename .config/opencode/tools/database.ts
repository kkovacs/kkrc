import { tool } from "@opencode-ai/plugin"
import path from "path"

export default tool({
  description: "Run an SQL using DuckDB",
  args: {
    sql: tool.schema.string().describe("SQL command"),
  },
  async execute(args, context) {
    const result = await Bun.$`duckdb -c "${args.sql}" opencode-test.ddb`.text()
    return result.trim()
  },
})
