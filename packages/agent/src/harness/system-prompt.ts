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

  // 3. loaded skills (enabled on demand)
  if (opts.skills?.length) {
    sections.push(formatSkills(opts.skills))
  }

  return sections.join("\n\n")
}

function formatSkills(skills: Skill[]): string {
  return (
    "## Available Skills (use when relevant, ignore otherwise)\n" +
    skills
      .map(
        (s) =>
          `### ${s.name}\n${s.description}\n\n<skill:${s.name}>\n${s.content}\n</skill:${s.name}>`
      )
      .join("\n\n")
  )
}
