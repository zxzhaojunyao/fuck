import { Input, fuzzyFilter, matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui"
import type { FuckTheme } from "../theme"

// ---- ModelPicker: search box + fuzzy filter + provider grouping + keyboard nav ----

type Row =
  | { kind: "header"; provider: string }
  | { kind: "item"; spec: string; provider: string; model: string }

function parseSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf("/")
  return i === -1 ? { provider: "default", model: spec } : { provider: spec.slice(0, i), model: spec.slice(i + 1) }
}

export class ModelPicker implements Component {
  private searchInput = new Input()
  private items: string[]
  private rows: Row[] = []
  private itemRows: string[] = [] // selectable spec list aligned with selectedIndex
  private selectedIndex = 0
  private maxVisible = 16
  private theme: FuckTheme
  private current: string

  onSelect?: (spec: string) => void
  onCancel?: () => void

  constructor(models: string[], current: string, theme: FuckTheme) {
    this.items = models
    this.current = current
    this.theme = theme
    this.applyFilter("")
  }

  private applyFilter(query: string) {
    const needle = query.trim()
    // fuzzy-match on the model name (without provider) for more hits
    const filtered = needle
      ? fuzzyFilter(this.items, needle, (spec) => parseSpec(spec).model + " " + spec)
      : this.items

    // group by provider: current provider first, sorted by name within a group
    const groups = new Map<string, string[]>()
    for (const spec of filtered) {
      const { provider, model } = parseSpec(spec)
      const list = groups.get(provider) ?? []
      list.push(model)
      groups.set(provider, list)
    }
    const curProvider = parseSpec(this.current).provider
    const orderedProviders = [...groups.keys()].sort((a, b) => {
      if (a === curProvider) return -1
      if (b === curProvider) return 1
      return a.localeCompare(b)
    })

    const rows: Row[] = []
    const itemRows: string[] = []
    for (const provider of orderedProviders) {
      rows.push({ kind: "header", provider })
      for (const model of groups.get(provider)!.sort()) {
        rows.push({ kind: "item", spec: `${provider}/${model}`, provider, model })
        itemRows.push(`${provider}/${model}`)
      }
    }
    this.rows = rows
    this.itemRows = itemRows
    this.selectedIndex = 0
  }

  getSelectedSpec(): string | undefined {
    return this.itemRows[this.selectedIndex]
  }

  invalidate() {}

  render(width: number): string[] {
    const lines: string[] = []
    // search box
    const prefix = this.theme.dim("🔍 ")
    const inputLines = this.searchInput.render(Math.max(1, width - visibleWidth(prefix)))
    lines.push(prefix + inputLines[0])
    lines.push(this.theme.dim("─".repeat(width - 2)))

    if (this.itemRows.length === 0) {
      lines.push(this.theme.dim("  no matching model"))
      lines.push("")
      lines.push(this.theme.dim("  type to search · Enter select · Esc cancel"))
      return lines
    }

    // compute the scroll window: keep selectedIndex centered
    const itemCount = this.itemRows.length
    const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), itemCount - this.maxVisible))
    const end = Math.min(start + this.maxVisible, itemCount)

    // flatten header and item rows; render only items in the window plus their leading header
    let renderedItems = 0
    let lastHeader = ""
    for (const row of this.rows) {
      if (row.kind === "header") {
        lastHeader = row.provider
        continue
      }
      const idx = this.itemRows.indexOf(row.spec)
      if (idx < start || idx >= end) continue
      const isSelected = idx === this.selectedIndex
      const isCurrent = row.spec === this.current
      const marker = isSelected ? "› " : "  "
      const modelText = isSelected
        ? this.theme.role(row.model)
        : this.theme.assistant(row.model)
      const currentTag = isCurrent ? " " + this.theme.dim("(current)") : ""
      // show the header before the first item of a group
      const isFirstInGroup = this.itemRows[idx - 1] === undefined || parseSpec(this.itemRows[idx - 1]).provider !== row.provider
      if (isFirstInGroup || lastHeader !== row.provider) {
        lines.push(this.theme.dim(`  ${row.provider}`))
      }
      lastHeader = row.provider
      lines.push(truncateToWidth(`${marker}${modelText}${currentTag}`, width - 2))
      renderedItems++
    }

    lines.push("")
    lines.push(this.theme.dim(`  ${this.selectedIndex + 1}/${itemCount} · type to search · Enter select · Esc cancel`))
    return lines
  }

  handleInput(data: string): void {
    if (matchesKey(data, "up")) {
      if (this.itemRows.length === 0) return
      this.selectedIndex = this.selectedIndex === 0 ? this.itemRows.length - 1 : this.selectedIndex - 1
      return
    }
    if (matchesKey(data, "down")) {
      if (this.itemRows.length === 0) return
      this.selectedIndex = this.selectedIndex === this.itemRows.length - 1 ? 0 : this.selectedIndex + 1
      return
    }
    if (matchesKey(data, "enter")) {
      const spec = this.getSelectedSpec()
      if (spec && this.onSelect) this.onSelect(spec)
      return
    }
    if (matchesKey(data, "escape")) {
      this.onCancel?.()
      return
    }
    // other characters go to the search box
    this.searchInput.handleInput(data)
    this.applyFilter(this.searchInput.getValue())
  }
}
