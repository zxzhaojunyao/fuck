// ---- build ----

const targets = (process.env.FUCK_TARGETS ?? "bun-windows-x64").split(",")

for (const target of targets) {
  await Bun.build({
    conditions: ["bun", "node"],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    splitting: true,
    entrypoints: ["./bin/fuck.ts"],
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target,
      outfile: target.includes("windows") ? "fuck.exe" : "fuck",
      windows: {},
    },
  })
  console.log(`built ${target}`)
}
