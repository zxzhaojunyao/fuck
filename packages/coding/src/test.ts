import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCodingTools } from "./index"

const dir = mkdtempSync(join(tmpdir(), "fuck-coding-"))
const tools = createCodingTools({ cwd: dir })
const byName = new Map(tools.map((t) => [t.name, t]))

writeFileSync(join(dir, "a.ts"), "function add(a,b){return a-b}\nconst N = 1\n")
mkdirSync(join(dir, "sub"))
writeFileSync(join(dir, "sub", "b.txt"), "hello world\n")

// read
const readOut = (await byName.get("read")!.execute({ path: "a.ts" })) as string
console.assert(readOut.includes("add") && readOut.includes("1 |"), "read includes line numbers")
console.log("read: OK")

// write
await byName.get("write")!.execute({ path: "new.txt", content: "created" })
console.assert(readFileSync(join(dir, "new.txt"), "utf8") === "created", "write creates")
console.log("write: OK")

// edit (unique replace + diff return)
const editOut = (await byName.get("edit")!.execute({ path: "a.ts", edits: [{ oldText: "a-b", newText: "a+b" }] })) as string
console.assert(readFileSync(join(dir, "a.ts"), "utf8").includes("a+b"), "edit replaces")
console.assert(editOut.includes("+"), "edit should return a diff (with + lines)")
console.log("edit: OK")

// edit non-unique should reject (throw)
writeFileSync(join(dir, "dup.txt"), "foo foo foo\n")
let editAmbErr = ""
try {
  await byName.get("edit")!.execute({ path: "dup.txt", edits: [{ oldText: "foo", newText: "bar" }] })
} catch (err) {
  editAmbErr = err instanceof Error ? err.message : String(err)
}
console.assert(editAmbErr.includes("not unique"), `edit non-unique should throw, got: ${editAmbErr}`)
  console.log("edit uniqueness: OK")

// edit: multiple edits in one call
writeFileSync(join(dir, "multi.txt"), "a=1\nb=2\nc=3\n")
await byName.get("edit")!.execute({
  path: "multi.txt",
  edits: [
    { oldText: "a=1", newText: "a=10" },
    { oldText: "c=3", newText: "c=30" },
  ],
})
const multi = readFileSync(join(dir, "multi.txt"), "utf8")
console.assert(multi.includes("a=10") && multi.includes("c=30") && multi.includes("b=2"), "edit multi-segment replace")
  console.log("edit multi-segment: OK")

// bash
const bashOut = (await byName.get("bash")!.execute({ command: "echo ok" })) as string
console.assert(bashOut.includes("ok") && bashOut.includes("exit=0"), "bash executes")
console.log("bash: OK")

// powershell
const psOut = (await byName.get("powershell")!.execute({ command: "Write-Output 'ps-ok'" })) as string
console.assert(psOut.includes("ps-ok"), `powershell executes, got: ${psOut}`)
console.log("powershell: OK")

// grep
const grepOut = (await byName.get("grep")!.execute({ pattern: "hello" })) as string
console.assert(grepOut.includes("b.txt"), "grep matches")
console.log("grep: OK")

// find（glob）
const findOut = (await byName.get("find")!.execute({ pattern: "**/*.ts" })) as string
console.assert(findOut.includes("a.ts"), "find glob")
console.log("find: OK")

// ls
const lsOut = (await byName.get("ls")!.execute({}) ) as string
console.assert(lsOut.includes("a.ts") && lsOut.includes("sub/"), "ls directory tree")
console.log("ls: OK")

rmSync(dir, { recursive: true, force: true })
console.log("\ncoding tools offline tests passed")
