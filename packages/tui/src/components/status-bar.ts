import { type Component, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// bottom status bar: model name + running spinner
export class StatusBar implements Component {
  model: string
  running: boolean
  frame: number
  private theme: FuckTheme

  constructor(model: string, theme: FuckTheme) {
    this.model = model
    this.running = false
    this.frame = 0
    this.theme = theme
  }

  invalidate() {}

  render(width: number): string[] {
    const spinner = this.running ? SPINNER[this.frame % SPINNER.length] + " " : ""
    const text = `${spinner}${this.running ? "Thinking..." : "Ready"} · ${this.model}`
    const styled = this.theme.statusText(text)
    return [truncateToWidth(styled, width)]
  }
}
