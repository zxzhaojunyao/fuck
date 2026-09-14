import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { TurnHook } from "../hooks"
import type { AgentMessage } from "../types"

export type Skill = {
  name: string
  description: string
  content: string
}

function skillDirs(cwd: string): string[] {
  return [join(homedir(), ".fuck", "skills"), join(cwd, ".fuck", "skills")]
}

export function listSkills(cwd: string): Skill[] {
  const out: Skill[] = []
  for (const dir of skillDirs(cwd)) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const f = join(dir, name, "SKILL.md")
      if (!existsSync(f)) continue
      const raw = readFileSync(f, "utf8")
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      const meta = fm ? fm[1] : ""
      const body = fm ? fm[2] : raw
      const nameMatch = meta.match(/name:\s*(.+)/)
      const descMatch = meta.match(/description:\s*(.+)/)
      out.push({
        name: nameMatch?.[1]?.trim() ?? name,
        description: descMatch?.[1]?.trim() ?? "",
        content: body.trim(),
      })
    }
  }
  return out
}

export function matchSkills(skills: Skill[], userText: string): Skill[] {
  if (!userText) return []
  const text = userText.toLowerCase()
  return skills.filter((s) => {
    const words = `${s.name} ${s.description}`.toLowerCase().split(/[，,、\s]+/)
    return words.some((w) => w.length > 1 && text.includes(w))
  })
}

// load skills on demand: each turn, match the latest user message against the skill
// list and inject ONLY the matching skill bodies. This keeps the base system prompt
// tiny (just a skill catalog) instead of bloating every request with all skill text.
export function createSkillHook(skills: Skill[]): TurnHook {
  const latestUserText = (messages: AgentMessage[]): string => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "user") return m.content
    }
    return ""
  }
  return {
    beforeTurn({ messages }) {
      const userText = latestUserText(messages)
      const matched = matchSkills(skills, userText)
      if (!matched.length) return null
      return matched
        .map((s) => `<skill:${s.name}>\n${s.content}\n</skill:${s.name}>`)
        .join("\n\n")
    },
  }
}
