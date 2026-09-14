import { hyperlink, truncateToWidth, type Component } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

// ---- subagent registry records + sidebar sections (todo / list / detail) ----

export type SubagentRecord = {
  key: string
  title: string
  status: "running" | "done" | "error"
  body: string
  result?: string
  error?: string
  order: number
}

export type TodoLine = {
  status: "pending" | "in_progress" | "completed" | "cancelled"
  content: string
}

function todoMarker(status: TodoLine["status"]): string {
  switch (status) {
    case "completed": return "[✓]"
    case "in_progress": return "[•]"
    case "cancelled": return "[×]"
    default: return "[ ]"
  }
}

function statusIcon(status: SubagentRecord["status"]): string {
  switch (status) {
    case "done": return "✓"
    case "error": return "✗"
    default: return "◌"
  }
}

// todo section (top of sidebar)
export class TodoSection implements Component {
  private theme: FuckTheme
  private getTodos: () => TodoLine[]

  constructor(theme: FuckTheme, getTodos: () => TodoLine[]) {
    this.theme = theme
    this.getTodos = getTodos
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.max(1, width - 2)
    const lines: string[] = [this.theme.role("Todo")]
    const todos = this.getTodos()
    if (todos.length === 0) {
      lines.push(this.theme.dim("  (empty)"))
    } else {
      for (const t of todos.slice(0, 20)) {
        const color = t.status === "completed" ? this.theme.toolDone : t.status === "in_progress" ? this.theme.user : this.theme.assistant
        lines.push(truncateToWidth(`  ${todoMarker(t.status)} ` + color(t.content), w))
      }
      if (todos.length > 20) lines.push(this.theme.dim(`  … ${todos.length - 20} more`))
    }
    return lines
  }
}

// sub-agent list (clickable rows). Only running sub-agents are listed; finished
// ones are removed (their result lives in the main body).
export class SubagentListSection implements Component {
  private theme: FuckTheme
  private getSubagents: () => SubagentRecord[]

  constructor(theme: FuckTheme, getSubagents: () => SubagentRecord[]) {
    this.theme = theme
    this.getSubagents = getSubagents
  }

  invalidate() {}

  render(width: number): string[] {
    const w = Math.max(1, width - 2)
    const lines: string[] = [this.theme.role("Subagents")]
    const subs = this.getSubagents()
    if (subs.length === 0) {
      lines.push(this.theme.dim("  (none running)"))
    } else {
      for (const s of subs) {
        const icon = statusIcon(s.status)
        const iconColor = s.status === "done" ? this.theme.toolDone : s.status === "error" ? this.theme.role : this.theme.tool
        const label = `  ${iconColor(icon)} ${s.title || "(task)"}`
        // OSC 8 hyperlink: left-click opens the detail view below (scrollable)
        lines.push(hyperlink(truncateToWidth(label, w), `fuck://subagent/${encodeURIComponent(s.key)}`))
      }
    }
    return lines
  }
}

// full-transcript detail view for a single sub-agent (live-refreshing)
export class SubagentDetail implements Component {
  private theme: FuckTheme
  private getRecord: () => SubagentRecord | undefined

  constructor(theme: FuckTheme, getRecord: () => SubagentRecord | undefined) {
    this.theme = theme
    this.getRecord = getRecord
  }

  invalidate() {}

  render(width: number): string[] {
    const rec = this.getRecord()
    if (!rec) return [this.theme.dim("(select a sub-agent)")]
    const w = Math.max(1, width - 3)
    const status = rec.status === "done" ? "✓" : rec.status === "error" ? "✗" : "◌"
    const lines: string[] = [
      this.theme.role(`Subagent ${status}`),
      this.theme.assistant(truncateToWidth(rec.title, w)),
      this.theme.dim("─".repeat(Math.max(1, w))),
    ]
    const body = (rec.body || "(no output yet)").split("\n")
    for (const l of body.slice(-2000)) {
      lines.push(this.theme.assistant(truncateToWidth(l, w)))
    }
    if (rec.result) {
      lines.push("")
      lines.push(this.theme.user(truncateToWidth("→ " + rec.result, w)))
    }
    if (rec.error) {
      lines.push(this.theme.role(truncateToWidth("✗ " + rec.error, w)))
    }
    return lines
  }
}
