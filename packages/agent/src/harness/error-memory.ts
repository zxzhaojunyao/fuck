import type { TurnHook } from "../hooks"
import type { ToolResultMessage } from "../types"

// error-memory injection: distill recent tool errors into
// a "don't repeat this" context injected into the system prompt before the next turn, so the model stops making the same mistakes.
export function createErrorMemoryHook(maxErrors = 6): TurnHook {
  return {
    beforeTurn({ toolErrors }) {
      if (!toolErrors.length) return null
      const recent = toolErrors.slice(-maxErrors)
      const lines = recent.map((e) => `- tool ${e.toolName} previously failed: ${e.content.slice(0, 200)}`)
      return (
        "[error memory] previous tool calls failed with these errors; avoid repeating them:\n" +
        lines.join("\n") +
        "\nIf the previous approach did not work, try a different one (different command/args/file) instead of mechanically retrying."
      )
    },
  }
}
