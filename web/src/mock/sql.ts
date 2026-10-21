import { getAsk, tableRows, tables } from "./load"
import type { SqlResult } from "../lib/types"

function tokenize(sql: string): string[] {
  const s = sql.trim().replace(/;+$/, "")
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let buf = ""
      while (j < s.length && s[j] !== c) {
        if (s[j] === "\\") {
          buf += s[j + 1] || ""
          j += 2
          continue
        }
        buf += s[j]
        j++
      }
      out.push(JSON.stringify(buf))
      i = j + 1
      continue
    }
    if ("(),.*".includes(c)) {
      out.push(c)
      i++
      continue
    }
    let j = i
    while (j < s.length && /[A-Za-z0-9_$.]/.test(s[j])) j++
    if (j === i) {
      out.push(c)
      i++
      continue
    }
    out.push(s.slice(i, j))
    i = j
  }
  return out
}

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function getCol(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const attrs = row.attrs as Record<string, unknown> | undefined
  if (attrs && name in attrs) return attrs[name]
  return undefined
}

type Sel =
  | { kind: "col"; name: string; alias: string }
  | { kind: "agg"; fn: string; name: string; alias: string; round?: number }

export function runSql(sql: string): SqlResult {
  const raw = sql.trim()
  if (!/^\s*(with|select)\b/i.test(raw) || raw.includes(";")) {
    return {
      columns: [],
      rows: [],
      error:
        "Only a single SELECT or WITH statement is allowed. Drop extra statements and the trailing semicolon, then run again.",
    }
  }
  const canned = matchCannedSql(raw)
  if (canned) return canned

  try {
    return runSimple(raw)
  } catch (e) {
    return {
      columns: [],
      rows: [],
      error: `${e instanceof Error ? e.message : String(e)}. Try a single SELECT from llm, tools, q_spans or spans — or open the suggested Ask questions. The Go API runs full DuckDB.`,
    }
  }
}

function matchCannedSql(sql: string): SqlResult | null {
  const norm = sql.replace(/\s+/g, " ").trim().toLowerCase()
  const questions = [
    "Why was my slowest session slow?",
    "Which skill costs the most per activation?",
    "Where do I wait on permission prompts the most?",
    "How much time did API retries cost me?",
  ]
  for (const q of questions) {
    const a = getAsk(q)
    if (!a?.sql || !a.result) continue
    if (a.sql.replace(/\s+/g, " ").trim().toLowerCase() === norm) return a.result
  }
  return null
}

function runSimple(sql: string): SqlResult {
  const t = tokenize(sql)
  const low = t.map((x) => x.toLowerCase())
  const fromi = low.indexOf("from")
  if (fromi < 0) throw new Error("missing FROM")
  const table = t[fromi + 1]
  if (!tables[table] && !tables[table.toLowerCase()]) throw new Error(`unknown table ${table}`)
  const tableName = tables[table] ? table : table.toLowerCase()
  const rows = tableRows(tableName)

  const wherei = low.indexOf("where")
  const groupi = low.indexOf("group")
  const orderi = low.indexOf("order")
  const limiti = low.indexOf("limit")

  const selToks = t.slice(1, fromi)
  const selects = parseSelect(selToks)

  let filtered = rows
  if (wherei >= 0) {
    const end = [groupi, orderi, limiti].filter((i) => i > wherei).sort((a, b) => a - b)[0] ?? t.length
    filtered = rows.filter((r) => evalWhere(t.slice(wherei + 1, end), r))
  }

  let grouped: { key: string[]; rows: Record<string, unknown>[] }[]
  const hasAgg = selects.some((s) => s.kind === "agg")
  if (groupi >= 0) {
    const end = [orderi, limiti].filter((i) => i > groupi).sort((a, b) => a - b)[0] ?? t.length
    const gtoks = t.slice(groupi + 1, end).filter((x) => x.toLowerCase() !== "by" && x !== ",")
    const gcols = gtoks.filter((x) => x.toLowerCase() !== "all")
    if (gtoks.some((x) => x.toLowerCase() === "all")) {
      // GROUP BY ALL: every non-agg select
      const cols = selects.filter((s) => s.kind === "col").map((s) => s.name)
      grouped = groupBy(filtered, cols)
    } else {
      grouped = groupBy(filtered, gcols)
    }
  } else if (hasAgg) {
    grouped = [{ key: [], rows: filtered }]
  } else {
    grouped = filtered.map((r) => ({ key: [], rows: [r] }))
  }

  let outRows: unknown[][] = grouped.map((g) =>
    selects.map((s) => {
      if (s.kind === "col") {
        if (g.key.length) {
          const idx = selects.filter((x) => x.kind === "col").findIndex((x) => x.name === s.name)
          if (idx >= 0 && idx < g.key.length) return g.key[idx]
        }
        return getCol(g.rows[0] || {}, s.name)
      }
      const vals = g.rows.map((r) => (s.name === "*" ? 1 : getCol(r, s.name)))
      let v: number | null = null
      const nums = vals.map(asNum).filter((n): n is number => n != null)
      if (s.fn === "count") v = s.name === "*" ? g.rows.length : vals.filter((x) => x != null && x !== "").length
      else if (s.fn === "sum") v = nums.reduce((a, b) => a + b, 0)
      else if (s.fn === "avg") v = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      else if (s.fn === "min") v = nums.length ? Math.min(...nums) : null
      else if (s.fn === "max") v = nums.length ? Math.max(...nums) : null
      if (s.round != null && v != null) {
        const p = 10 ** s.round
        v = Math.round(v * p) / p
      }
      return v
    }),
  )

  if (orderi >= 0) {
    const end = limiti >= 0 ? limiti : t.length
    const ot = t.slice(orderi + 1, end).filter((x) => x.toLowerCase() !== "by")
    const col = ot[0]
    const dir = (ot[1] || "asc").toLowerCase()
    const idx = selects.findIndex((s) => s.alias === col || s.name === col)
    const i = idx >= 0 ? idx : selects.length - 1
    outRows.sort((a, b) => {
      const av = a[i]
      const bv = b[i]
      const an = asNum(av)
      const bn = asNum(bv)
      let cmp = 0
      if (an != null && bn != null) cmp = an - bn
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""))
      return dir.startsWith("desc") ? -cmp : cmp
    })
  }

  if (limiti >= 0) {
    const n = Number(t[limiti + 1] || 500)
    outRows = outRows.slice(0, n)
  }

  return { columns: selects.map((s) => s.alias), rows: outRows }
}

function parseSelect(toks: string[]): Sel[] {
  const out: Sel[] = []
  let i = 0
  while (i < toks.length) {
    if (toks[i] === ",") {
      i++
      continue
    }
    const low = toks[i].toLowerCase()
    if (low === "round" && toks[i + 1] === "(") {
      // round(sum(x), n) AS alias
      const innerFn = toks[i + 2].toLowerCase()
      const innerCol = toks[i + 4] === "*" ? "*" : toks[i + 4]
      const n = Number(toks[i + 7] ?? toks[i + 6])
      let j = i
      while (j < toks.length && toks[j] !== "," && toks[j].toLowerCase() !== "as") j++
      let alias = innerCol
      if (toks[j]?.toLowerCase() === "as") {
        alias = toks[j + 1]
        j += 2
      }
      out.push({ kind: "agg", fn: innerFn, name: innerCol, alias, round: Number.isFinite(n) ? n : 2 })
      i = j
      continue
    }
    if (["count", "sum", "avg", "min", "max"].includes(low) && toks[i + 1] === "(") {
      const name = toks[i + 2]
      let j = i + 4
      let alias = `${low}_${name === "*" ? "star" : name}`
      if (toks[j]?.toLowerCase() === "as") {
        alias = toks[j + 1]
        j += 2
      }
      out.push({ kind: "agg", fn: low, name, alias })
      i = j
      continue
    }
    const name = toks[i]
    let alias = name
    let j = i + 1
    if (toks[j]?.toLowerCase() === "as") {
      alias = toks[j + 1]
      j += 2
    }
    out.push({ kind: "col", name, alias })
    i = j
  }
  return out
}

function groupBy(rows: Record<string, unknown>[], cols: string[]) {
  const m = new Map<string, { key: string[]; rows: Record<string, unknown>[] }>()
  for (const r of rows) {
    const key = cols.map((c) => {
      const v = getCol(r, c)
      return v == null ? "(none)" : String(v)
    })
    const k = JSON.stringify(key)
    const g = m.get(k)
    if (g) g.rows.push(r)
    else m.set(k, { key, rows: [r] })
  }
  return [...m.values()]
}

function evalWhere(toks: string[], row: Record<string, unknown>): boolean {
  // very small: col = 'x' AND col IS NOT NULL, joined by AND
  const parts: string[][] = [[]]
  for (const t of toks) {
    if (t.toLowerCase() === "and") parts.push([])
    else parts[parts.length - 1].push(t)
  }
  return parts.every((p) => evalClause(p, row))
}

function evalClause(toks: string[], row: Record<string, unknown>): boolean {
  if (!toks.length) return true
  const col = toks[0]
  const v = getCol(row, col)
  const rest = toks.slice(1).map((x) => x.toLowerCase())
  if (rest[0] === "is" && rest[1] === "not" && rest[2] === "null") return v != null && v !== ""
  if (rest[0] === "is" && rest[1] === "null") return v == null || v === ""
  if (toks[1] === "=") return String(v ?? "") === unquote(toks[2])
  if (toks[1] === "!=") return String(v ?? "") !== unquote(toks[2])
  return true
}

function unquote(t: string): string {
  if (t?.startsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t
    }
  }
  return t
}
