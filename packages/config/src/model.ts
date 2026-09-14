import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { execSync } from "node:child_process"
import { readConfig, saveConfig } from "./config"

// FUCK reads all config from ~/.fuck/config.json; it neither injects nor reads process.env
// generic env vars like OPENAI_API_KEY / OPENAI_BASE_URL / MODEL, fully isolated from other AI tools.
// env is read only when the user explicitly declares { "env": "MY_KEY" } or "$VAR" / "${VAR}" / "!command".

// ---- ProviderConfig / ProviderModelConfig ----

export type ProviderApi =
  | "openai-completions"
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-responses"
  | (string & {})

export type CompatFlags = {
  thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "qwen" | (string & {})
  supportsDeveloperRole?: boolean
  supportsReasoningEffort?: boolean
  maxTokensField?: "max_completion_tokens" | "max_tokens"
  requiresToolResultName?: boolean
  requiresReasoningContentOnAssistantMessages?: boolean
}

export type ProviderModelConfig = {
  id: string
  name?: string
  api?: ProviderApi
  baseUrl?: string
  reasoning?: boolean
  input?: ("text" | "image")[]
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow?: number
  maxTokens?: number
  headers?: Record<string, string>
  compat?: CompatFlags
}

export type ProviderConfig = {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: ProviderApi
  models?: ProviderModelConfig[]
  headers?: Record<string, string>
  authHeader?: boolean
  compat?: CompatFlags
}

// legacy format compat: options.baseURL / options.apiKey
type LegacyProviderDef = {
  options?: { baseURL?: string; apiKey?: string | { env?: string } }
}

// ---- secret resolution ----

function resolveSecretValue(raw: string | { env?: string } | undefined): string | undefined {
  if (raw == null) return undefined
  if (typeof raw === "object") {
    if (raw.env) return process.env[raw.env]
    return undefined
  }
  // syntax: !command runs a command for the value; $VAR / ${VAR} interpolate; $$ is a literal $
  if (raw.startsWith("!") && raw.length > 1) {
    try {
      return execSync(raw.slice(1), { encoding: "utf8" }).trim()
    } catch {
      return undefined
    }
  }
  return raw.replace(/\$\$/, "\0").replace(/\$\{([^}]+)\}/g, (_, n) => process.env[n] ?? "").replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => process.env[n] ?? "").replace(/\0/g, "$")
}

// ---- read providers (new format + legacy compat) ----

export type ResolvedProvider = {
  name: string
  baseUrl: string
  apiKey?: string
  api: ProviderApi
  models?: ProviderModelConfig[]
  headers?: Record<string, string>
  authHeader?: boolean
  compat?: CompatFlags
}

export function getProviders(): Record<string, ResolvedProvider> {
  const cfg = readConfig()
  const out: Record<string, ResolvedProvider> = {}
  const providers = (cfg.provider ?? {}) as Record<string, ProviderConfig | LegacyProviderDef>
  for (const [name, def] of Object.entries(providers)) {
    const isLegacy = (def as LegacyProviderDef).options != null && (def as ProviderConfig).baseUrl == null
    const baseUrl = isLegacy
      ? (def as LegacyProviderDef).options?.baseURL
      : (def as ProviderConfig).baseUrl
    const apiKey = isLegacy
      ? resolveSecretValue((def as LegacyProviderDef).options?.apiKey)
      : resolveSecretValue((def as ProviderConfig).apiKey)
    out[name] = {
      name: (def as ProviderConfig).name ?? name,
      baseUrl: baseUrl ?? "https://api.openai.com/v1",
      apiKey,
      api: (def as ProviderConfig).api ?? "openai-completions",
      models: (def as ProviderConfig).models,
      headers: (def as ProviderConfig).headers,
      authHeader: (def as ProviderConfig).authHeader,
      compat: (def as ProviderConfig).compat,
    }
  }
  return out
}

// ---- model resolution ----

export type ResolvedModel = {
  provider: string
  baseURL: string
  apiKey?: string
  modelId: string
  compat?: CompatFlags
  maxTokens?: number
  contextWindow?: number
}

export function parseModelSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf("/")
  if (i === -1) return { provider: "default", model: spec }
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) }
}

export function resolveModel(spec: string): ResolvedModel {
  const { provider, model } = parseModelSpec(spec)
  const providers = getProviders()
  const p = providers[provider] ?? Object.values(providers)[0]
  const modelEntry = p?.models?.find((m) => m.id === model)
  return {
    provider,
    baseURL: p?.baseUrl ?? "https://api.openai.com/v1",
    apiKey: p?.apiKey,
    modelId: model,
    compat: { ...p?.compat, ...modelEntry?.compat },
    maxTokens: modelEntry?.maxTokens,
    contextWindow: modelEntry?.contextWindow,
  }
}

export function currentModel(): string {
  const cfg = readConfig()
  return (cfg.model as string) ?? ""
}

export function getModel(spec?: string) {
  const r = resolveModel(spec ?? currentModel())
  // openai-compatible: required for third-party OpenAI-compatible gateways (tokenhub, etc.),
  // so reasoning_content is extracted and passed back (the root cause of the deepseek thinking-model + tool-call 400)
  const provider = createOpenAICompatible({
    name: r.provider,
    baseURL: r.baseURL,
    apiKey: r.apiKey,
  })
  const model = provider.chatModel(r.modelId)
  return model
}

// ---- model list: static models table first, otherwise fetch /models ----

const NON_CHAT_RE =
  /(video|image|music|speech|dubbing|embedding|kinfra|pixverse|vidu|kling|seedream|tripo|wand|hi3d|hy-world|hy-video|hy-image|hy-3d|yt-video|minimax-music|minimax-video|minimax-speech|minimax-voice|-mt[0-9]|asr|-role|3d|vision|instruct|vita|gpt-4o-realtime|whisper|tts|rerank|bge-|sd[0-9]|flux|emotion|agent)/i

async function fetchProviderModels(provider: string, p: ResolvedProvider): Promise<string[]> {
  try {
    const res = await fetch(`${p.baseUrl}/models`, {
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : undefined,
    })
    if (!res.ok) return []
    const body = (await res.json()) as { data?: { id: string; status?: string }[] }
    return (body.data ?? [])
      .filter((m) => m.status === "online" && !NON_CHAT_RE.test(m.id))
      .map((m) => `${provider}/${m.id}`)
  } catch {
    return []
  }
}

let cachedModels: string[] | null = null

export async function listModels(): Promise<string[]> {
  if (cachedModels) return cachedModels
  const seen = new Set<string>()
  const out: string[] = []
  const cur = currentModel()
  if (cur) {
    seen.add(cur)
    out.push(cur)
  }
  const providers = getProviders()
  const results = await Promise.all(
    Object.entries(providers).map(async ([name, p]) => {
      // static models table first (offline/private gateways skip /models)
      if (p.models?.length) {
        return p.models
          .filter((m) => !NON_CHAT_RE.test(m.id))
          .map((m) => `${name}/${m.id}`)
      }
      return fetchProviderModels(name, p)
    }),
  )
  for (const list of results) {
    for (const spec of list) {
      if (!seen.has(spec)) {
        seen.add(spec)
        out.push(spec)
      }
    }
  }
  cachedModels = out.length > 1 ? out : [cur]
  return cachedModels
}

export function setModel(spec: string) {
  cachedModels = null
  saveConfig({ model: spec })
}

// the helper model (auto-distill, etc.) is read from config; user may set "CHEAP_MODEL": "provider/model"
export function cheapModel(): string {
  const cfg = readConfig()
  return (cfg.CHEAP_MODEL as string) ?? currentModel()
}
