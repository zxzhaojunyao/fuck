import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import type { ExtensionFactory } from "./types"

// ---- extension discovery + dynamic loading ----

// built-in deps available to extensions: bare imports of these are rewritten as global injection,
// because data-URL modules cannot resolve from node_modules. zod is the only thing extensions need for tool schemas.
const PROVIDED_DEPS: Record<string, unknown> = {
  zod: z,
}

// rewrite `import { z } from "zod"` / `import * as z from "zod"` as global injection.
// declare a globalThis namespace to avoid polluting top-level globalThis keys.
const NS = "__fuckExtDeps"

declare global {
  // eslint-disable-next-line no-var
  var __fuckExtDeps: Record<string, unknown> | undefined
}

function injectProvidedDeps() {
  globalThis[NS] = PROVIDED_DEPS
}

function rewriteBareImports(source: string): string {
  return source
    .replace(/import\s*\{([^}]+)\}\s*from\s*["']zod["']/g, (_, names: string) => {
      // `import { z } from "zod"` -> each imported name points to the whole zod namespace object
      const vars = names
        .split(",")
        .map((n) => {
          const trimmed = n.trim()
          const alias = trimmed.includes(" as ") ? trimmed.split(" as ")[1].trim() : trimmed
          return `const ${alias} = globalThis.${NS}.zod`
        })
        .join("; ")
      return vars
    })
    .replace(/import\s*\*\s*as\s+(\w+)\s+from\s*["']zod["']/g, (_, alias: string) => `const ${alias} = globalThis.${NS}.zod`)
}

function extensionDirs(cwd: string): string[] {
  const dirs: string[] = []
  const global = process.env.FUCK_HOME ?? join(homedir(), ".fuck")
  dirs.push(join(global, "extensions"))
  dirs.push(join(cwd, ".fuck", "extensions"))
  return dirs
}

// discover entrypoints: a direct *.ts file, or index.ts / package.json entry inside a subdirectory
function discoverInDir(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".js"))) {
      out.push(p)
    } else if (e.isDirectory()) {
      const indexTs = join(p, "index.ts")
      const indexJs = join(p, "index.js")
      if (existsSync(indexTs)) out.push(indexTs)
      else if (existsSync(indexJs)) out.push(indexJs)
      else {
        const pkg = join(p, "package.json")
        if (existsSync(pkg)) {
          try {
            const manifest = JSON.parse(readFileSync(pkg, "utf8")) as { pi?: { extensions?: string[] } }
            for (const ext of manifest.pi?.extensions ?? []) {
              const resolved = join(p, ext)
              if (existsSync(resolved)) out.push(resolved)
            }
          } catch {}
        }
      }
    }
  }
  return out
}

export function discoverExtensions(cwd: string): string[] {
  const out: string[] = []
  for (const dir of extensionDirs(cwd)) {
    out.push(...discoverInDir(dir))
  }
  return out
}

// dynamically load an extension module as a factory function.
// compiled binaries can't import arbitrary paths, so use Bun.Transpiler -> data-URL import.
// bare zod imports are rewritten as global injection (data URLs can't resolve node_modules).
async function importModule(path: string): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error(`extension path must be absolute: ${path}`)
  const source = rewriteBareImports(readFileSync(path, "utf8"))
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" })
  const js = transpiler.transformSync(source)
  const url = "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  const mod = await import(url)
  return mod.default
}

export async function loadExtensionFactories(cwd: string): Promise<Array<() => Promise<ExtensionFactory | undefined>>> {
  injectProvidedDeps()
  const paths = discoverExtensions(cwd)
  return paths.map((p) => async () => {
    const mod = await importModule(p)
    if (typeof mod !== "function") return undefined
    return mod as ExtensionFactory
  })
}
