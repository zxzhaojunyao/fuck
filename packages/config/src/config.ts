import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function configDir() {
  return process.env.FUCK_HOME ?? join(homedir(), ".fuck")
}

export function readConfig(): Record<string, unknown> {
  const file = join(configDir(), "config.json")
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

// NOTE: never write config into process.env. FUCK reads all config from ~/.fuck/config.json,
// and never injects or borrows generic env vars like OPENAI_API_KEY / OPENAI_BASE_URL / MODEL,
// staying fully isolated from other AI tools.
export function loadConfig(): Record<string, unknown> {
  return readConfig()
}

export function saveConfig(patch: Record<string, unknown>) {
  const dir = configDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, "config.json")
  const next = { ...readConfig(), ...patch }
  writeFileSync(file, JSON.stringify(next, null, 2))
  return next
}

// 保存/更新一个 provider（新格式：baseUrl / apiKey / api / models）
export function saveProvider(name: string, opts: { baseUrl: string; apiKey: string; api?: string }) {
  const cfg = readConfig()
  const providers = (cfg.provider ?? {}) as Record<string, Record<string, unknown>>
  const prev = providers[name] ?? {}
  providers[name] = {
    ...prev,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    api: opts.api ?? prev.api ?? "openai-completions",
  }
  return saveConfig({ provider: providers })
}
