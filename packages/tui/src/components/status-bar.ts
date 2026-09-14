import { type Component, truncateToWidth } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

// bottom status bar: model name + running spinner + live context token count
export class StatusBar implements Component {
  model: string
  running: boolean
  frame: number
  tokens: number
  private theme: FuckTheme

  constructor(model: string, theme: FuckTheme) {
    this.model = model
    this.running = false
    this.frame = 0
    this.tokens = 0
    this.theme = theme
  }

  invalidate() {}

  render(width: number): string[] {
    const spinner = this.running ? SPINNER[this.frame % SPINNER.length] + " " : ""
    const text = `${spinner}${this.running ? "Thinking..." : "Ready"} · ${this.model} · ctx ${fmtTokens(this.tokens)}`
    const styled = this.theme.statusText(text)
    return [truncateToWidth(styled, width)]
  }
}
