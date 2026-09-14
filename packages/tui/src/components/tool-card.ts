import { type Component } from "@earendil-works/pi-tui"
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

// tool call card: shows name+args while running, then the result
export class ToolCard implements Component {
  name: string
  args: string
  status: "running" | "done"
  result: string
  private theme: FuckTheme

  constructor(name: string, args: string, theme: FuckTheme) {
    this.name = name
    this.args = args
    this.status = "running"
    this.result = ""
    this.theme = theme
  }

  setResult(result: string) {
    this.status = "done"
    this.result = result
  }

  invalidate() {}

  render(width: number): string[] {
    const color = this.status === "running" ? this.theme.tool : this.theme.toolDone
    const head = this.status === "running" ? "◌" : "✓"
    const line1 = color(`${head} ${this.name}`)
    const lines: string[] = [line1]
    if (this.args) {
      lines.push(this.theme.dim(truncateToWidth(this.args, width - 1)))
    }
    if (this.result) {
      if (this.status === "running") {
        // streaming progress: show the tail of the accumulated output
        const tail = this.result.split("\n").filter((l) => l.trim()).slice(-6)
        for (const l of tail) {
          lines.push(this.theme.dim(truncateToWidth(l, width - 3)))
        }
      } else {
        const preview = truncateToWidth(this.result.split("\n")[0] ?? "", width - 3)
        lines.push(this.theme.toolDone(`  → ${preview}`))
      }
    }
    return lines.map((l) => (visibleWidth(l) > width ? truncateToWidth(l, width) : l))
  }
}
