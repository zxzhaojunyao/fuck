#!/usr/bin/env node
// postinstall: download the platform binary from GitHub Releases into ~/.fuck/bin
// Version-aware: skip when the installed version matches the target, otherwise update.
const { execSync } = require("node:child_process")
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs")
const { homedir } = require("node:os")
const { join } = require("node:path")

// Override with FUCK_REPO env if you host the binaries elsewhere.
const REPO = process.env.FUCK_REPO || "zxzhaojunyao/fuck"
const VERSION = "v1.1.5"

// node platform/arch -> release artifact. Linux ships tar.gz (GNU tar cannot read zip).
const TARGETS = {
  "win32:x64": { file: "fuck-windows-x64.zip", bin: "fuck.exe", kind: "zip" },
  "linux:x64": { file: "fuck-linux-x64.tar.gz", bin: "fuck", kind: "tar.gz" },
  "linux:arm64": { file: "fuck-linux-arm64.tar.gz", bin: "fuck", kind: "tar.gz" },
  "darwin:x64": { file: "fuck-darwin-x64.tar.gz", bin: "fuck", kind: "tar.gz" },
  "darwin:arm64": { file: "fuck-darwin-arm64.tar.gz", bin: "fuck", kind: "tar.gz" },
}

const platform = process.platform
const arch = process.arch
const target = TARGETS[`${platform}:${arch}`]

const binDir = join(homedir(), ".fuck", "bin")
const outBin = join(binDir, target ? target.bin : "fuck")
const cache = join(binDir, target ? target.file : "")
const versionFile = join(binDir, ".version")

function installedVersion() {
  try {
    return readFileSync(versionFile, "utf8").trim()
  } catch {
    return ""
  }
}

async function main() {
  if (!target) {
    console.error(`f-ai-cli: unsupported platform ${platform}/${arch}. Supported: win32/x64, linux/x64, linux/arm64, darwin/x64, darwin/arm64.`)
    process.exit(0)
  }

  const url = `https://github.com/${REPO}/releases/download/${VERSION}/${target.file}`

  // Skip if the same version is already installed; otherwise (first install / upgrade) re-download.
  const current = installedVersion()
  if (existsSync(outBin) && current === VERSION) {
    console.log(`FUCK ${VERSION} already installed.`)
    return
  }

  mkdirSync(binDir, { recursive: true })
  if (current) console.log(`Updating FUCK ${current} -> ${VERSION} ...`)
  else console.log(`Downloading FUCK ${VERSION} (${target.file})...`)

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`Download failed (HTTP ${res.status}). Release not published yet?`)
    console.error(`  ${url}`)
    console.error("After publishing the GitHub release, re-run: npm rebuild f-ai-cli")
    process.exit(0) // don't fail npm install; user can rebuild later
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(cache, buf)

  // tar 解压：Windows 10 1803+ 自带 bsdtar（可读 zip）；Linux tar 读 tar.gz，无需额外依赖。
  if (target.kind === "zip") execSync(`tar -xf "${cache}" -C "${binDir}"`)
  else execSync(`tar -xzf "${cache}" -C "${binDir}"`)

  // Executables on POSIX need the +x bit.
  if (platform !== "win32") {
    try {
      execSync(`chmod 755 "${outBin}"`)
    } catch {
      // non-fatal; user can chmod manually
    }
  }

  // Version marker: next install decides whether to update based on this.
  writeFileSync(versionFile, VERSION, "utf8")
  if (current) console.log(`FUCK updated to ${VERSION}: ${outBin}`)
  else console.log(`FUCK installed: ${outBin}`)
  console.log("Open a NEW terminal and type: fuck")
}

main()
