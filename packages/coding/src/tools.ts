import { z } from "zod"
import type { ToolDefinition } from "@fuck/agent"
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { isAbsolute, join, relative, basename, dirname } from "node:path"
import { runBash, runShell } from "./bash-executor"
import {
  applyEdits,
  detectLineEnding,
  generateDisplayDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
} from "./edit-diff"

// strip BOM (the model won't include the invisible BOM in oldText)
function splitBom(content: string): { bom: string; text: string } {
  return content.charCodeAt(0) === 0xfeff ? { bom: "\ufeff", text: content.slice(1) } : { bom: "", text: content }
}

export type CodingToolsOptions = {
  cwd: string
}

// factory: bind tools to the working directory
export function createCodingTools(opts: CodingToolsOptions): ToolDefinition[] {
  const cwd = opts.cwd

  const resolve = (p: string) => (isAbsolute(p) ? p : join(cwd, p))

  // ---- read ----
  const read: ToolDefinition = {
    name: "read",
    description: "Read a file with line numbers. Supports an offset/limit window to avoid dumping huge files at once.",
    schema: z.object({
      path: z.string().describe("file path relative to cwd"),
      offset: z.number().int().min(1).optional().describe("start line (1-based)"),
      limit: z.number().int().min(1).max(2000).optional().describe("max lines to read"),
    }),
    execute: async (args) => {
      const lines = readFileSync(resolve(String(args.path)), "utf8").split("\n")
      const start = (args.offset as number) ?? 1
      const end = Math.min(start + ((args.limit as number) ?? 200) - 1, lines.length)
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(4)} | ${l}`)
        .join("\n")
      return `file ${args.path} (${lines.length} lines, showing ${start}-${end}):\n${body}`
    },
  }

  // ---- write ----
  const write: ToolDefinition = {
    name: "write",
    description: "Write a whole file (overwrite). Use for creating or fully replacing a file.",
    schema: z.object({
      path: z.string().describe("file path relative to cwd"),
      content: z.string().describe("complete file content"),
    }),
    execute: async (args) => {
      const abs = resolve(String(args.path))
      const existed = existsSync(abs)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, String(args.content), "utf8")
      return `wrote ${args.path} (${String(args.content).length} chars)${existed ? " (overwritten)" : " (new)"}`
    },
  }

  // ---- edit: exact text replacement + diff ----
  const edit: ToolDefinition = {
    name: "edit",
    description:
      "Perform exact text replacements on a single file. Each edits[].oldText must match the original file uniquely and without overlap (not incremental). Merge adjacent or overlapping edits into one. Keep oldText small but unique.",
    schema: z.object({
      path: z.string().describe("file path to edit (relative or absolute)"),
      edits: z
        .array(
          z.object({
            oldText: z.string().describe("original text to replace; must match exactly (including spaces and newlines)"),
            newText: z.string().describe("replacement content"),
          })
        )
        .describe("one or more exact replacements. All match the original file; do not overlap."),
    }),
    execute: async (args) => {
      const abs = resolve(String(args.path))
      const rawContent = readFileSync(abs, "utf8")
      const { bom, text: content } = splitBom(rawContent)
      const originalEnding = detectLineEnding(content)
      const normalized = normalizeToLF(content)
      const edits = (args.edits as { oldText: string; newText: string }[]).map((e) => ({
        oldText: String(e.oldText),
        newText: String(e.newText),
      }))

      const { baseContent, newContent } = applyEdits(normalized, edits, String(args.path))
      const finalContent = bom + restoreLineEndings(newContent, originalEnding)
      writeFileSync(abs, finalContent, "utf8")

      const diff = generateDisplayDiff(baseContent, newContent)
      const patch = generateUnifiedPatch(String(args.path), baseContent, newContent)
      return `replaced ${edits.length} location(s) (${args.path})\n\n${diff}\n\n--- patch ---\n${patch}`
    },
  }

  // ---- powershell：Windows PowerShell----
  const powershell: ToolDefinition = {
    name: "powershell",
    description: "Run a PowerShell command, returning stdout/stderr. Output is forced to UTF-8. Supports streaming and timeout.",
    schema: z.object({
      command: z.string().describe("PowerShell command to run"),
      timeoutMs: z.number().int().positive().max(300_000).optional().describe("timeout in ms, default 30000"),
    }),
    execute: async (args, signal, onUpdate) => {
      const r = await runShell(String(args.command), "powershell", {
        cwd,
        timeoutMs: args.timeoutMs as number | undefined,
        signal,
        onUpdate,
      })
      const head = r.timedOut ? `TIMEOUT: command exceeded ${args.timeoutMs ?? 30000}ms and was killed\n` : `exit=${r.exitCode}\n`
      const tail = r.truncated ? `\n... (output truncated)` : ""
      return head + (r.output.trim() || "(no output)") + tail
    },
  }

  // ---- bash ----
  const bash: ToolDefinition = {
    name: "bash",
    description: "Run a bash shell command (Git Bash on Windows, bash elsewhere), returning stdout/stderr. Output is forced to UTF-8. Use Unix syntax (head, &&, |, grep). Supports streaming and timeout.",
    schema: z.object({
      command: z.string().describe("command to run"),
      timeoutMs: z.number().int().positive().max(300_000).optional().describe("timeout in ms, default 30000"),
    }),
    execute: async (args, signal, onUpdate) => {
      const r = await runBash(String(args.command), {
        cwd,
        timeoutMs: args.timeoutMs as number | undefined,
        signal,
        onUpdate,
      })
      const head = r.timedOut ? `TIMEOUT: command exceeded ${args.timeoutMs ?? 30000}ms and was killed\n` : `exit=${r.exitCode}\n`
      const tail = r.truncated ? `\n... (output truncated)` : ""
      return head + (r.output.trim() || "(no output)") + tail
    },
  }

  // ---- grep ----
  const grep: ToolDefinition = {
    name: "grep",
    description: "Recursively search file contents (regex), returning file:line:content.",
    schema: z.object({
      pattern: z.string().describe("regular expression"),
      path: z.string().optional().describe("search root (default cwd)"),
      include: z.string().optional().describe("filename filter, e.g. *.ts"),
    }),
    execute: async (args) => {
      const root = resolve(args.path ? String(args.path) : cwd)
      const re = new RegExp(String(args.pattern))
      const includeRe = args.include ? new RegExp("^" + String(args.include).replace(/\./g, "\\.").replace(/\*/g, ".*") + "$") : null
      const EXCLUDE = new Set(["node_modules", ".git", "dist", ".venv", ".build", ".next"])
      const files: string[] = []
      const walk = (dir: string, depth: number) => {
        if (depth > 8) return
        let items: string[]
        try {
          items = readdirSync(dir)
        } catch {
          return
        }
        for (const name of items) {
          if (EXCLUDE.has(name)) continue
          const abs = join(dir, name)
          let st
          try {
            st = statSync(abs)
          } catch {
            continue
          }
          if (st.isDirectory()) walk(abs, depth + 1)
          else if (st.isFile() && (!includeRe || includeRe.test(name))) files.push(abs)
        }
      }
      walk(root, 0)
      const results: string[] = []
      for (const f of files) {
        let lines: string[]
        try {
          lines = readFileSync(f, "utf8").split("\n")
        } catch {
          continue
        }
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${relative(cwd, f)}:${i + 1}:${lines[i].slice(0, 300)}`)
            if (results.length >= 200) return results.join("\n") + "\n...(truncated)"
          }
        }
      }
      return results.length ? results.join("\n") : "(no match)"
    },
  }

  // ---- find: glob file listing ----
  const find: ToolDefinition = {
    name: "find",
    description: "List file paths by glob pattern. Use it to explore the repo structure.",
    schema: z.object({
      pattern: z.string().describe("glob pattern, e.g. **/*.ts"),
      path: z.string().optional().describe("search root (default cwd)"),
    }),
    execute: async (args) => {
      const target = resolve(args.path ? String(args.path) : cwd)
      const files = new Bun.Glob(String(args.pattern)).scanSync({ cwd: target, onlyFiles: true })
      const out = [...files]
        .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
        .slice(0, 500)
      return out.length ? out.join("\n") : "(no match)"
    },
  }

  // ---- ls: directory tree ----
  const ls: ToolDefinition = {
    name: "ls",
    description: "List the directory structure (recursive, with depth and entry limits).",
    schema: z.object({
      path: z.string().optional().describe("directory (default cwd)"),
      depth: z.number().int().min(1).max(6).optional().describe("recursion depth, default 2"),
    }),
    execute: async (args) => {
      const root = resolve(args.path ? String(args.path) : cwd)
      const depth = (args.depth as number) ?? 2
      const EXCLUDE = new Set(["node_modules", ".git", "dist", ".venv", ".build", ".next", ".bun"])
      const lines: string[] = [basename(root) + "/"]
      let count = 0
      const walk = (dir: string, prefix: string, d: number) => {
        if (d > depth || count > 300) return
        let items: string[]
        try {
          items = readdirSync(dir)
        } catch {
          return
        }
        items = items.filter((n) => !EXCLUDE.has(n)).sort()
        items.forEach((name, i) => {
          if (count > 300) return
          const last = i === items.length - 1
          const abs = join(dir, name)
          let isDir = false
          try {
            isDir = statSync(abs).isDirectory()
          } catch {
            return
          }
          lines.push(prefix + (last ? "└── " : "├── ") + name + (isDir ? "/" : ""))
          count++
          if (isDir) walk(abs, prefix + (last ? "    " : "│   "), d + 1)
        })
      }
      walk(root, "", 1)
      return lines.join("\n")
    },
  }

  return [read, write, edit, bash, powershell, grep, find, ls]
}
