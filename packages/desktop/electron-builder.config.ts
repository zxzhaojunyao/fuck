import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Configuration } from "electron-builder"

const packageDir = join(fileURLToPath(new URL(".", import.meta.url)))
// 指向 monorepo 根，用于定位 fuck.exe（tui 包的构建产物）
const rootDir = join(packageDir, "..", "..")
const fuckBinary = join(rootDir, "packages", "tui", "fuck.exe")

const config: Configuration = {
  appId: "ai.fuck.desktop",
  productName: "FUCK",
  artifactName: "fuck-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "package.json"],
  extraResources: [
    {
      from: fuckBinary,
      to: "fuck.exe",
    },
  ],
  win: {
    target: ["nsis"],
    icon: "resources/icon.ico",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: "resources/icon.ico",
    installerHeaderIcon: "resources/icon.ico",
  },
  mac: {
    target: ["dmg"],
    icon: "resources/icon.png",
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Development",
    icon: "resources/icon.png",
  },
}

export default config
