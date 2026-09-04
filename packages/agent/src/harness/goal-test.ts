import type { AgentMessage } from "../types"
import type { GoalTestResult } from "../agent-loop"

// ---- per-scene goal-test injection ----
// The goal-test is the "is it actually done?" gate, and "done" is domain-specific.
// A scene is declared via config.GOAL_MODE and selects the right completion check.

export type GoalScene = "none" | "ctf" | "coding" | (string & {})

// explicit success signal: a tool result marked terminate, or content that confirms
// verification passed (flag accepted / exploit verified / tests green / etc.)
const SUCCESS_RE =
  /(accepted|correct|flag\{[^}]+\}|solved|pwned|verified|验证通过|已确认|匹配成功|登录成功|拿到\s*flag|tests?\s+(pass|passed|green|全部通过))/i

// completion + error markers
const ERROR_RE = /(error|failed|exception|timed?\s*out|报错|失败|超时)/i

export function createGoalTest(scene: GoalScene): ((messages: AgentMessage[]) => Promise<GoalTestResult>) | undefined {
  switch (scene) {
    case "none":
      return undefined
    case "ctf":
      return ctfGoalTest
    case "coding":
      return codingGoalTest
    default:
      return undefined
  }
}

// CTF / pentest: only a verified success signal counts as done. No signal -> keep going,
// forcing the model to actually probe/verify instead of declaring victory from assumptions.
async function ctfGoalTest(produced: AgentMessage[]): Promise<GoalTestResult> {
  const success = produced.some(
    (m) => m.role === "tool" && (m.terminate === true || SUCCESS_RE.test(m.content)),
  )
  if (success) return { done: true }

  const hadTool = produced.some((m) => m.role === "tool")
  return {
    done: false,
    continue: hadTool
      ? "You haven't verified a flag/exploit yet. Keep working: actually probe, exploit, and submit until a tool confirms success. Do not stop on an unverified guess."
      : "The task is not verified yet. Use tools to actually probe the target instead of stopping on assumptions.",
  }
}

// coding: only keep going when the last tool call errored (fix-then-verify). Otherwise
// let the model stop normally — this avoids false "keep going" on plain Q&A or summaries.
async function codingGoalTest(produced: AgentMessage[]): Promise<GoalTestResult> {
  const lastError = [...produced].reverse().find((m) => m.role === "tool" && m.isError)
  if (lastError) {
    return {
      done: false,
      continue: "Your last tool call failed, so the task is not done. Fix the error and verify with a tool before stopping.",
    }
  }
  return { done: true }
}
