import { contextBridge } from "electron"

// Minimal preload: exposes a narrow desktop API surface to the renderer.
// The renderer talks to the FUCK core over localhost HTTP+WS, not via IPC —
// preload only carries window/native concerns (empty for M2).
contextBridge.exposeInMainWorld("fuck", {
  platform: process.platform,
})
