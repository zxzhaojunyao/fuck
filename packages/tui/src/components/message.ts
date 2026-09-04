import { Markdown, type Component, type MarkdownTheme } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

// a message: role label + body (assistant rendered as Markdown, user as plain text)
export class Message implements Component {
  private md: Markdown
  private isAssistant: boolean
  private theme: FuckTheme

  constructor(role: "user" | "assistant", content: string, theme: FuckTheme) {
    this.theme = theme
    this.isAssistant = role === "assistant"
    this.md = new Markdown(content, 1, 0, theme.markdown, {
      color: role === "assistant" ? theme.assistant : theme.user,
    })
  }

  setContent(content: string) {
    this.md.setText(content)
  }

  invalidate() {
    this.md.invalidate()
  }

  render(width: number): string[] {
    const label = this.isAssistant ? this.theme.role("FUCK") : this.theme.role("You")
    const body = this.md.render(width)
    return [label, ...body, ""]
  }
}
