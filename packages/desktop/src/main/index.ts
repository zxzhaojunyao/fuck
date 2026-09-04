import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { app, BrowserWindow } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { join } from "node:path"

// The FUCK core runs as a Bun binary (fuck.exe), spawned as a sidecar child
// process. Electron (Node) cannot run Bun APIs (bun:sqlite, Bun.*), so unlike
// opencode — which bundles its Node server into a utilityProcess — we spawn
// the compiled binary and talk to it over localhost HTTP+WS.

let sidecar: ChildProcess | null = null

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (typeof addr === "object" && addr) {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error("no port")))
      }
    })
    srv.on("error", reject)
  })
}

function resolveBinary(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "fuck.exe")
  }
  // dev：electron-vite 下 app.getAppPath() 的基准不确定，逐个候选找存在的
  const candidates = [
    join(app.getAppPath(), "..", "tui", "fuck.exe"),
    join(app.getAppPath(), "..", "..", "tui", "fuck.exe"),
    join(process.cwd(), "..", "tui", "fuck.exe"),
    join(process.cwd(), "packages", "tui", "fuck.exe"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error(`fuck.exe not found. tried: ${candidates.join(", ")}`)
}

async function spawnSidecar(): Promise<{ url: string; password: string }> {
  const port = await findFreePort()
  const password = randomUUID()
  const binary = resolveBinary()
  console.log("[fuck] binary:", binary)
  sidecar = spawn(binary, ["--serve", "--port", String(port), "--password", password], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  sidecar.on("error", (err) => console.error("[fuck] spawn error:", err.message))
  sidecar.stdout?.on("data", (d) => console.log("[fuck]", d.toString().trim()))
  sidecar.stderr?.on("data", (d) => console.error("[fuck]", d.toString().trim()))

  // wait for /health
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${url}/health`)
      if (r.ok) return { url, password }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("sidecar failed to start")
}

function killSidecar() {
  if (sidecar) {
    sidecar.kill()
    sidecar = null
  }
}

async function createWindow(url: string, password: string) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0f1117",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const query = `?url=${encodeURIComponent(url)}&token=${encodeURIComponent(password)}`
  if (process.env.ELECTRON_RENDERER_URL) {
    // dev：electron-vite 起的热更服务
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
  } else {
    // prod：打包后的静态文件
    win.loadURL(`file://${join(app.getAppPath(), "out/renderer/index.html")}${query}`)
  }
}

app.whenReady().then(async () => {
  try {
    const { url, password } = await spawnSidecar()
    await createWindow(url, password)
  } catch (err) {
    console.error("failed to start", err)
    app.quit()
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", killSidecar)
app.on("will-quit", killSidecar)
