import { type Component, truncateToWidth } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"
import type { DelegateSubEvent } from "@fuck/agent"

// ---- DelegateCard: collapsible live view of delegate sub-agents ----

type Section = {
  index: number
  title: string
  status: "running" | "done" | "error"
  body: string
  result?: string
  error?: string
}

const MAX_BODY = 40_000

export class DelegateCard implements Component {
  private sections = new Map<number, Section>()
  private total = 0
  private theme: FuckTheme
  private _expandedAll = false
  private _expanded = new Set<number>()

  onToggle?: () => void

  constructor(theme: FuckTheme) {
    this.theme = theme
  }

  get expandedAll() {
    return this._expandedAll
  }

  toggleAll() {
    this._expandedAll = !this._expandedAll
  }

  toggle(index: number) {
    if (this._expanded.has(index)) this._expanded.delete(index)
    else this._expanded.add(index)
  }

  isExpanded(index: number): boolean {
    if (!this._expandedAll) return this._expanded.has(index)
    // when expandedAll, individual sections are expanded unless explicitly collapsed
    return !this._expanded.has(index)
  }

  private ensure(index: number): Section {
    let s = this.sections.get(index)
    if (!s) {
      s = { index, title: "", status: "running", body: "" }
      this.sections.set(index, s)
    }
    return s
  }

  apply(e: DelegateSubEvent) {
    switch (e.type) {
      case "task_start": {
        this.total = e.total
        const s = this.ensure(e.index)
        s.title = e.title
        break
      }
      case "task_message": {
        const s = this.ensure(e.index)
        if (s.body.length < MAX_BODY) s.body += e.text
        break
      }
      case "task_tool_start": {
        const s = this.ensure(e.index)
        if (s.body.length < MAX_BODY) s.body += `\n  [tool] ${e.name} ${e.args}\n`
        break
      }
      case "task_tool_delta": {
        const s = this.ensure(e.index)
        if (s.body.length < MAX_BODY) s.body += e.text
        break
      }
      case "task_tool_end": {
        const s = this.ensure(e.index)
        if (s.body.length < MAX_BODY) s.body += "\n  [done]\n"
        break
      }
      case "task_result": {
        const s = this.ensure(e.index)
        s.status = "done"
        s.result = e.result
        break
      }
      case "task_error": {
        const s = this.ensure(e.index)
        s.status = "error"
        s.error = e.message
        break
      }
    }
  }

  markDone() {
    // called on tool_end: any still-running section is finalized
    for (const s of this.sections.values()) {
      if (s.status === "running") {
        s.status = "done"
      }
    }
  }

  invalidate() {}

  render(width: number): string[] {
    const ordered = [...this.sections.values()].sort((a, b) => a.index - b.index)
    const running = ordered.filter((s) => s.status === "running").length
    const head = this.theme.tool(`◌ delegate · ${ordered.length} sub-agent${ordered.length === 1 ? "" : "s"}${running > 0 ? ` · ${running} running` : ""}`)
    const lines: string[] = [head]

    for (const s of ordered) {
      const statusIcon = s.status === "done" ? "✓" : s.status === "error" ? "✗" : "◌"
      const statusColor = s.status === "done" ? this.theme.toolDone : s.status === "error" ? this.theme.role : this.theme.tool
      const marker = this.isExpanded(s.index) ? "▾" : "▸"
      const titleLine = `  ${marker} [${s.index + 1}/${this.total}] ${statusColor(statusIcon)} ${s.title || "(task)"}`
      lines.push(truncateToWidth(titleLine, width - 1))

      if (this.isExpanded(s.index)) {
        if (s.body) {
          const bodyTail = s.body.split("\n").slice(-200)
          for (const l of bodyTail) {
            lines.push(this.theme.dim(truncateToWidth("    " + l, width - 3)))
          }
        }
        if (s.status === "done" && s.result) {
          lines.push(this.theme.toolDone(truncateToWidth("    → " + s.result.split("\n")[0], width - 3)))
        }
        if (s.status === "error" && s.error) {
          lines.push(this.theme.role(truncateToWidth("    ✗ " + s.error, width - 3)))
        }
      } else {
        // collapsed: simple — status + result only (full transcript lives in the right sidebar)
        if (s.status === "done" && s.result) {
          lines.push(this.theme.toolDone(truncateToWidth("      → " + s.result.split("\n")[0], width - 3)))
        } else if (s.status === "error" && s.error) {
          lines.push(this.theme.role(truncateToWidth("      ✗ " + s.error, width - 3)))
        }
      }
    }

    return lines
  }
}
