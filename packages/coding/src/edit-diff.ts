import * as Diff from "diff"

// ---- line ending handling ----

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlf = content.indexOf("\r\n")
  const lf = content.indexOf("\n")
  if (lf === -1) return "\n"
  if (crlf === -1) return "\n"
  return crlf < lf ? "\r\n" : "\n"
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text
}

// ---- fuzzy match normalization ----

export function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
  )
}

export interface FuzzyMatch {
  found: boolean
  index: number
  matchLength: number
  usedFuzzyMatch: boolean
  contentForReplacement: string
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatch {
  const exactIndex = content.indexOf(oldText)
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    }
  }
  const fuzzyContent = normalizeForFuzzyMatch(content)
  const fuzzyOldText = normalizeForFuzzyMatch(oldText)
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText)
  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content }
  }
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent,
  }
}

// ---- exact text replacement ----

export type Edit = { oldText: string; newText: string }

type MatchedEdit = { editIndex: number; matchIndex: number; matchLength: number; newText: string }

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? []
}

interface LineSpan {
  start: number
  end: number
}

function getLineSpans(content: string): LineSpan[] {
  let offset = 0
  return splitLinesWithEndings(content).map((line) => {
    const span = { start: offset, end: offset + line.length }
    offset = span.end
    return span
  })
}

function applyReplacements(content: string, replacements: MatchedEdit[], offset = 0): string {
  let result = content
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]
    const idx = r.matchIndex - offset
    result = result.substring(0, idx) + r.newText + result.substring(idx + r.matchLength)
  }
  return result
}

function countOccurrences(content: string, oldText: string): number {
  const fc = normalizeForFuzzyMatch(content)
  const ft = normalizeForFuzzyMatch(oldText)
  return fc.split(ft).length - 1
}

export interface AppliedEditsResult {
  baseContent: string
  newContent: string
}

export function applyEdits(content: string, edits: Edit[], path: string): AppliedEditsResult {
  const normEdits = edits.map((e) => ({ oldText: normalizeToLF(e.oldText), newText: normalizeToLF(e.newText) }))

  for (let i = 0; i < normEdits.length; i++) {
    if (normEdits[i].oldText.length === 0) {
      throw new Error(`edits[${i}].oldText must not be empty (${path})`)
    }
  }

  const initialMatches = normEdits.map((e) => fuzzyFindText(content, e.oldText))
  const usedFuzzy = initialMatches.some((m) => m.usedFuzzyMatch)
  const base = usedFuzzy ? normalizeForFuzzyMatch(content) : content

  const matched: MatchedEdit[] = []
  for (let i = 0; i < normEdits.length; i++) {
    const e = normEdits[i]
    const m = fuzzyFindText(base, e.oldText)
    if (!m.found) {
      throw new Error(`edits[${i}].oldText not found (${path}). The original text must match exactly (including spaces and newlines).`)
    }
    const occ = countOccurrences(base, e.oldText)
    if (occ > 1) {
      throw new Error(`edits[${i}].oldText appears ${occ} times, not unique (${path}). Provide more context to make it unique.`)
    }
    matched.push({ editIndex: i, matchIndex: m.index, matchLength: m.matchLength, newText: e.newText })
  }

  matched.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1]
    const cur = matched[i]
    if (prev.matchIndex + prev.matchLength > cur.matchIndex) {
      throw new Error(`edits[${prev.editIndex}] and edits[${cur.editIndex}] overlap (${path}); merge them or make them disjoint.`)
    }
  }

  // on fuzzy match, paste changes back line-by-line, preserving original bytes of unchanged lines
  let newContent: string
  if (usedFuzzy) {
    newContent = applyReplacementsPreservingUnchangedLines(content, base, matched)
  } else {
    newContent = applyReplacements(base, matched)
  }

  if (content === newContent) {
    throw new Error(`no changes produced (${path}). The result is identical to the original.`)
  }

  return { baseContent: content, newContent }
}

function getReplacementLineRange(lines: LineSpan[], r: MatchedEdit) {
  const start = r.matchIndex
  const end = r.matchIndex + r.matchLength
  let startLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (start >= lines[i].start && start < lines[i].end) {
      startLine = i
      break
    }
  }
  if (startLine === -1) throw new Error("replacement range exceeds content")
  let endLine = startLine
  while (endLine < lines.length && lines[endLine].end < end) endLine++
  return { startLine, endLine: endLine + 1 }
}

function applyReplacementsPreservingUnchangedLines(
  original: string,
  base: string,
  replacements: MatchedEdit[],
): string {
  const originalLines = splitLinesWithEndings(original)
  const baseLines = getLineSpans(base)
  if (originalLines.length !== baseLines.length) {
    throw new Error("line count mismatch after fuzzy match; cannot preserve unchanged lines")
  }

  const groups: Array<{ startLine: number; endLine: number; replacements: MatchedEdit[] }> = []
  const sorted = [...replacements].sort((a, b) => a.matchIndex - b.matchIndex)
  for (const r of sorted) {
    const range = getReplacementLineRange(baseLines, r)
    const last = groups[groups.length - 1]
    if (last && range.startLine < last.endLine) {
      last.endLine = Math.max(last.endLine, range.endLine)
      last.replacements.push(r)
      continue
    }
    groups.push({ ...range, replacements: [r] })
  }

  let lineIdx = 0
  let result = ""
  for (const g of groups) {
    result += originalLines.slice(lineIdx, g.startLine).join("")
    const groupStart = baseLines[g.startLine].start
    const groupEnd = baseLines[g.endLine - 1].end
    result += applyReplacements(base.slice(groupStart, groupEnd), g.replacements, groupStart)
    lineIdx = g.endLine
  }
  result += originalLines.slice(lineIdx).join("")
  return result
}

// ---- patch and display diff ----

export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, context = 3): string {
  return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  })
}

export function generateDisplayDiff(oldContent: string, newContent: string): string {
  const parts = Diff.diffLines(oldContent, newContent)
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const maxLine = Math.max(oldLines.length, newLines.length)
  const width = String(maxLine).length

  let oldNum = 1
  let newNum = 1
  const out: string[] = []

  for (const part of parts) {
    const raw = part.value.split("\n")
    if (raw[raw.length - 1] === "") raw.pop()
    if (part.added || part.removed) {
      for (const line of raw) {
        if (part.added) {
          out.push(`+${String(newNum).padStart(width, " ")} ${line}`)
          newNum++
        } else {
          out.push(`-${String(oldNum).padStart(width, " ")} ${line}`)
          oldNum++
        }
      }
    } else {
      oldNum += raw.length
      newNum += raw.length
    }
  }
  return out.join("\n")
}
