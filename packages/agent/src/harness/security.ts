import type { ToolHook, BeforeToolCallResult } from "../hooks"
import type { ToolCall } from "../types"

// ---- dangerous command interception ----

const DANGEROUS_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-rf?\b|\brm\s+-r\s+\//, reason: "recursive force delete" },
  { re: /\bsudo\b/, reason: "sudo privilege escalation" },
  { re: /\bgit\s+push\s+(--force|-f)\b/, reason: "force push" },
  { re: /\bgit\s+reset\s+--hard\b/, reason: "hard reset (discards working tree)" },
  { re: /\b(mkfs|dd)\b/, reason: "disk write/format" },
  { re: /\bshutdown\b|\breboot\b/, reason: "shutdown/reboot" },
  { re: /\bchmod\s+-R\s+777\b/, reason: "recursive world-writable permissions" },
  { re: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: "drop database table/schema" },
  { re: /\b(mv|cp)\s+.*\s+\/etc\//, reason: "modify system config directory" },
]

export function createPermissionGateHook(): ToolHook {
  return {
    beforeToolCall(call: ToolCall): BeforeToolCallResult {
      if (call.name !== "bash" && call.name !== "powershell") return {}
      const command = String((call.arguments as { command?: unknown }).command ?? "")
      for (const { re, reason } of DANGEROUS_PATTERNS) {
        if (re.test(command)) {
          return { block: true, reason: `dangerous command (${reason}): ${command.slice(0, 120)}` }
        }
      }
      return {}
    },
  }
}

// ---- sandbox routing ----
// wrap bash commands in an isolated environment. No sandbox by default (pass-through).
// the upper layer injects the sandboxPrefix resolver to avoid a reverse dependency on config.

export function createSandboxHook(
  getSandboxPrefix: (cwd: string) => string | undefined,
  getCwd: () => string,
): ToolHook {
  return {
    beforeToolCall(call: ToolCall): BeforeToolCallResult {
      if (call.name !== "bash" && call.name !== "powershell") return {}
      const prefix = getSandboxPrefix(getCwd())
      if (!prefix) return {}
      const command = String((call.arguments as { command?: unknown }).command ?? "")
      return { input: { command: prefix + command } }
    },
  }
}

// read the SANDBOX_CMD prefix from config (%CWD% replaced with the cwd)
export function sandboxPrefixFromConfig(readCfg: () => Record<string, unknown>): (cwd: string) => string | undefined {
  return (cwd: string) => {
    const cfg = readCfg()
    const raw = cfg.SANDBOX_CMD as string | undefined
    if (!raw) return undefined
    return raw.replace(/%CWD%/g, cwd) + " "
  }
}
