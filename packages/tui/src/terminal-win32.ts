import { dlopen } from "bun:ffi"

const CP_UTF8 = 65001

const kernel = () =>
  dlopen("kernel32.dll", {
    SetConsoleOutputCP: { args: ["u32"], returns: "i32" },
    SetConsoleCP: { args: ["u32"], returns: "i32" },
  })

// ProcessTerminal handles raw mode / VT input itself; here we only
// force the UTF-8 codepage so CJK/box-drawing chars don't garble as GBK on Windows.
export function win32InstallUtf8() {
  if (process.platform !== "win32") return
  try {
    const k32 = kernel()
    k32.symbols.SetConsoleOutputCP(CP_UTF8)
    k32.symbols.SetConsoleCP(CP_UTF8)
  } catch {}
}
