import chalk from "chalk"
import type { MarkdownTheme, EditorTheme, SelectListTheme } from "@earendil-works/pi-tui"

// ---- palette ----

export type Palette = {
  primary: string
  accent: string
  error: string
  warning: string
  success: string
  text: string
  textMuted: string
  background: string
  backgroundElement: string
  border: string
  syntaxKeyword: string
  syntaxString: string
  syntaxNumber: string
  syntaxComment: string
  syntaxFunction: string
}

const PALETTES: Record<string, Palette> = {
  tokyo: {
    primary: "#82aaff",
    accent: "#ff966c",
    error: "#ff757f",
    warning: "#ffc777",
    success: "#c3e88d",
    text: "#c8d3f5",
    textMuted: "#828bb8",
    background: "#1a1b26",
    backgroundElement: "#222436",
    border: "#3b4261",
    syntaxKeyword: "#c099ff",
    syntaxString: "#c3e88d",
    syntaxNumber: "#ffc777",
    syntaxComment: "#565f89",
    syntaxFunction: "#82aaff",
  },
  onedark: {
    primary: "#61afef",
    accent: "#d19a66",
    error: "#e06c75",
    warning: "#e5c07b",
    success: "#98c379",
    text: "#abb2bf",
    textMuted: "#5c6370",
    background: "#1e2127",
    backgroundElement: "#282c34",
    border: "#3e4451",
    syntaxKeyword: "#c678dd",
    syntaxString: "#98c379",
    syntaxNumber: "#d19a66",
    syntaxComment: "#5c6370",
    syntaxFunction: "#61afef",
  },
  dracula: {
    primary: "#bd93f9",
    accent: "#ffb86c",
    error: "#ff5555",
    warning: "#f1fa8c",
    success: "#50fa7b",
    text: "#f8f8f2",
    textMuted: "#6272a4",
    background: "#141414",
    backgroundElement: "#21222c",
    border: "#44475a",
    syntaxKeyword: "#ff79c6",
    syntaxString: "#f1fa8c",
    syntaxNumber: "#bd93f9",
    syntaxComment: "#6272a4",
    syntaxFunction: "#50fa7b",
  },
}

// ---- syntax highlighting (regex highlighter, returns ANSI lines) ----

const KW =
  /\b(?:const|let|var|function|return|if|else|for|while|class|import|export|from|new|async|await|try|catch|throw|switch|case|break|continue|def|elif|print|lambda|with|as|pass|go|func|package|type|struct|range|select|use|fn|pub|impl|match|where|true|false|null|undefined|None|self|this)\b/

function highlightCode(code: string, _lang?: string): string[] {
  const out: string[] = []
  for (const line of code.split("\n")) {
    let result = ""
    let i = 0
    while (i < line.length) {
      const rest = line.slice(i)
      const cm = /^(\/\/|#|--\s).*$/.exec(rest)
      if (cm) {
        result += chalk.hex(p.syntaxComment)(cm[0])
        break
      }
      const st = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/.exec(rest)
      if (st) {
        result += chalk.hex(p.syntaxString)(st[1])
        i += st[1].length
        continue
      }
      const nm = /^\b(\d+(?:\.\d+)?)\b/.exec(rest)
      if (nm) {
        result += chalk.hex(p.syntaxNumber)(nm[1])
        i += nm[1].length
        continue
      }
      const kw = /^\b([A-Za-z_][A-Za-z0-9_]*)\b/.exec(rest)
      if (kw && KW.test(kw[1])) {
        result += chalk.hex(p.syntaxKeyword)(kw[1])
        i += kw[1].length
        continue
      }
      result += line[i]
      i++
    }
    out.push(result)
  }
  return out
}

// ---- theme construction ----

let p: Palette = PALETTES.tokyo!

export type FuckTheme = {
  palette: Palette
  markdown: MarkdownTheme
  editor: EditorTheme
  selectList: SelectListTheme
  user: (text: string) => string
  assistant: (text: string) => string
  role: (text: string) => string
  dim: (text: string) => string
  statusText: (text: string) => string
  tool: (text: string) => string
  toolDone: (text: string) => string
}

function selectListTheme(): SelectListTheme {
  return {
    selectedPrefix: (t) => chalk.hex(p.primary)(t),
    selectedText: (t) => chalk.hex(p.primary)(t),
    description: (t) => chalk.hex(p.textMuted)(t),
    scrollInfo: (t) => chalk.hex(p.textMuted)(t),
    noMatch: (t) => chalk.hex(p.textMuted)(t),
  }
}

export function buildTheme(paletteName: string): FuckTheme {
  p = PALETTES[paletteName] ?? PALETTES.tokyo!
  return {
    palette: p,
    markdown: {
      heading: (t) => chalk.bold(chalk.hex(p.primary)(t)),
      link: (t) => chalk.hex(p.primary)(t),
      linkUrl: (t) => chalk.hex(p.textMuted)(t),
      code: (t) => chalk.hex(p.warning)(t),
      codeBlock: (t) => chalk.hex(p.text)(t),
      codeBlockBorder: (t) => chalk.hex(p.border)(t),
      quote: (t) => chalk.hex(p.textMuted)(t),
      quoteBorder: (t) => chalk.hex(p.border)(t),
      hr: (t) => chalk.hex(p.border)(t),
      listBullet: (t) => chalk.hex(p.primary)(t),
      bold: (t) => chalk.bold(t),
      italic: (t) => chalk.italic(t),
      strikethrough: (t) => chalk.strikethrough(t),
      underline: (t) => chalk.underline(t),
      highlightCode,
    },
    editor: {
      borderColor: (t) => chalk.hex(p.primary)(t),
      selectList: selectListTheme(),
    },
    selectList: selectListTheme(),
    user: (t) => chalk.hex(p.success)(t),
    assistant: (t) => chalk.hex(p.text)(t),
    role: (t) => chalk.bold(chalk.hex(p.accent)(t)),
    dim: (t) => chalk.hex(p.textMuted)(t),
    statusText: (t) => chalk.hex(p.textMuted)(t),
    tool: (t) => chalk.hex(p.warning)(t),
    toolDone: (t) => chalk.hex(p.textMuted)(t),
  }
}

export function themeNames(): string[] {
  return Object.keys(PALETTES)
}
