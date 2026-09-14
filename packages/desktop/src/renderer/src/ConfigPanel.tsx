import { useState } from "react"
import { useApp } from "./store"

// 配置面板：手动输入 provider / baseUrl / apiKey / model。
// 用作首次启动 onboarding（未配置时）和常驻设置页（齿轮图标打开）。
export function ConfigPanel({ onDone }: { onDone?: () => void }) {
  const configured = useApp((s) => s.configured)
  const saveConfig = useApp((s) => s.saveConfig)
  const models = useApp((s) => s.models)

  const [name, setName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSaving(true)
    try {
      await saveConfig({
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        model: model.trim() || undefined,
      })
      setSaving(false)
      onDone?.()
    } catch {
      setError("Failed to save config")
      setSaving(false)
    }
  }

  const inputCls =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-cyan-500"

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-md">
        {!configured && (
          <div className="mb-6 text-center">
            <div className="gradient-text mb-2 font-mono text-3xl font-black tracking-widest">FUCK</div>
            <p className="text-sm text-zinc-500">Configure your model provider to get started.</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Provider name
            </label>
            <input
              className={inputCls}
              placeholder="e.g. tokenhub / openai / deepseek"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Base URL
            </label>
            <input
              className={inputCls}
              placeholder="https://tokenhub.tencentmaas.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              API key
            </label>
            <input
              className={inputCls}
              type="password"
              placeholder="sk-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Model
            </label>
            <input
              className={inputCls}
              placeholder="provider/model-id (e.g. tokenhub/deepseek-v4-pro)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="model-options"
            />
            {models.length > 0 && (
              <datalist id="model-options">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
            <p className="mt-1 text-xs text-zinc-600">Leave blank to keep the current value.</p>
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gradient-to-r from-cyan-600 to-violet-600 py-2 text-sm font-semibold text-white transition hover:from-cyan-500 hover:to-violet-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : configured ? "Save" : "Get started"}
          </button>
        </form>
      </div>
    </div>
  )
}
