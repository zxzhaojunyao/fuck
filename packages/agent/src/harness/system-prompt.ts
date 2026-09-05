import { BASE_PERSONA } from "@fuck/persona"
import type { Skill } from "./skills"

// system prompt builder: persona injection is the only customization point
export function buildSystemPrompt(opts: {
  cwd: string
  skills?: Skill[]
  base?: string
}): string {
  const sections: string[] = []

  // 1. persona (the only retained FUCK content)
  sections.push(BASE_PERSONA)

  // 2. base agent instructions
  sections.push(
    opts.base ??
      [
        "You are FUCK, an AI coding agent running in a terminal.",
        "Use tools to read/write files, search code, and run shell commands.",
        "Inspect before acting; verify code changes by running tests or commands.",
        "Keep replies short and direct.",
        "Answer plain questions directly with text; only call tools when the task needs file access, code search, or shell execution.",
        "Never finish early: verify the task is fully done with tools. If a step fails or is wrong, fix it and continue.",
        "Anti-hallucination discipline: a hypothesis (what you think) is NOT a fact (what a tool confirmed). Only state a result as done when a tool output actually proves it. If a tool result contradicts your assumption, drop the assumption instead of explaining it away. Before declaring success, run the verifier (test / submit / inspect) and cite the output.",
      ].join("\n")
  )

  // 2.5 anti-tunnel-vision discipline (stops the agent from looping on one dead end)
  sections.push(
    [
      "Anti-tunnel-vision discipline:",
      "- If the same action fails 2 times, STOP repeating it. Switch approach, not a slightly-tweaked retry.",
      "- If you are stuck on one sub-problem for more than ~8 tool calls, pause and re-plan at the goal level: is there an easier untouched target? State what you have and move on.",
      "- Do not re-derive facts you already established. Trust earlier confirmed results instead of re-checking them.",
      "- When many independent targets remain, prioritize breadth (touch each once) over depth (grind one into the ground).",
      "- Track open targets explicitly (todo or graph); when one stalls, drop it and pick the next unvisited one.",
    ].join("\n")
  )

  // 3. loaded skills: catalog only (name + description). The full skill bodies are
  // loaded on demand via the skill turn hook (matchSkills) to keep this prompt small.
  if (opts.skills?.length) {
    sections.push(formatSkillCatalog(opts.skills))
  }

  return sections.join("\n\n")
}

function formatSkillCatalog(skills: Skill[]): string {
  return (
    "## Available Skills (bodies are auto-loaded when relevant; do not guess their contents)\n" +
    skills
      .map((s) => `- ${s.name}: ${s.description.split("\n")[0]}`)
      .join("\n")
  )
}
