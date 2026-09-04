# FUCK Desktop — Plan

> Status: planning (revised)
> Goal: a **downloadable desktop app** — like opencode-desktop. Download an installer / `.exe` / `.dmg`, double-click it, and get a native window. Not a terminal+webview hybrid.

## 1. What "desktop" means here

| | Terminal edition | Desktop edition |
|---|---|---|
| Start | `fuck` in a terminal | double-click `fuck-desktop.exe` |
| UI | TUI (terminal) | native window (GUI) |
| Download | npm / single exe | installer / standalone app binary |

Same core (`packages/agent` / `coding` / `config` / `persona`) drives both. The desktop edition is a **new frontend + shell**, not a fork of the engine.

## 2. Key design points

1. **Backend = existing Agent, unchanged.** Add a headless `--serve` mode to the core exposing the agent over local HTTP+WebSocket. `createRuntime` already returns `{ agent, store, extensions }`; the server subscribes to `agent.events` and forwards events. Zero new agent logic.

2. **Renderer = web UI**, statically bundled via electron-vite, no CDN. It never talks to the LLM directly — everything goes through the core over IPC/WS.

3. **Packaging.** The Bun binary ships as an `extraResource`; main process resolves and spawns it at runtime. `electron-builder` produces the installers.

4. **Local server security.** Core binds `127.0.0.1`, random port, one-time token handshake, so arbitrary local webpages can't drive the agent.

## 3. Downloadable artifacts (M4+)

| Platform | Artifact |
|---|---|
| Windows | `fuck-desktop-windows-x64.exe` (NSIS) |
| macOS (Apple Silicon) | `fuck-desktop-mac-arm64.dmg` |
| macOS (Intel) | `fuck-desktop-mac-x64.dmg` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

Published on the GitHub Releases page, same place as the terminal binary.

## 4. Milestones

| Phase | Content | Acceptance |
|-------|---------|------------|
| **M1: headless serve mode** | `--serve` flag on the core: local HTTP+WS around `createRuntime` | drive a full agent turn via curl; events stream over WS |
| **M2: web UI** | static chat UI: streaming markdown, tool cards, input, model picker, session sidebar, todo/findings | usable in a browser at localhost |
| **M3: Electron shell** | main process: window, spawn sidecar core, handshake, close lifecycle | double-click dev build boots the agent |
| **M4: bundle + installers** | embed web UI + package Bun binary as extraResource; electron-builder NSIS/dmg/deb | downloadable installer produces a working double-click app |
| **M5: parity + polish** | session delete UX, findings detail, theme sync, shortcuts, tray, auto-update | desktop ≈ terminal feature parity |

## 5. Open questions (resolve in M1)

1. Renderer framework: vanilla TS + tiny reactive helper (keep zero-dep) vs a minimal framework (React/Vue/Svelte). opencode-desktop uses React — lean that way for ecosystem, but flag the bundle size.
2. Sidecar (Bun binary as extraResource) vs reimplementing the core in the Electron main process — sidecar is simpler and reuses the existing single-file compile.
3. Platform order: Windows first (matches npm `os: win32`), then macOS, then Linux.

## 6. Non-goals (v1)

- Remote/cloud sync, hosted web
- Multi-window / workspaces
- Code signing (defer; opencode signs, FUCK can later)

## 7. Decisions

- [x] Downloadable native app (like opencode-desktop), not terminal+webview hybrid
- [x] Electron shell (matches opencode-desktop) + FUCK core sidecar + web UI
- [ ] Renderer framework (M1)
- [ ] Local server security model (M1)
- [ ] Platform order: Windows → macOS → Linux
