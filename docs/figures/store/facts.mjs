// The facts Fig 4 states about the store, read from the source at build time:
// tables with their columns, keys and indexes from schema.sql, the views and
// the tables each one reads from views.sql, the price list from pricing.go,
// and how the file is opened from store.go and main.go.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

const schema = read("internal/store/schema.sql")
const views = read("internal/store/views.sql")
const store = read("internal/store/store.go")
const pricing = read("internal/pricing/pricing.go")
const main = read("cmd/aftertrace/main.go")

const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)].map(([, name, body]) => {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean)
  const key = (lines.find((l) => l.startsWith("PRIMARY KEY")) || "").match(/\(([^)]*)\)/)?.[1].split(",").map((s) => s.trim()) || []
  const columns = lines
    .filter((l) => !l.startsWith("PRIMARY KEY"))
    .map((l) => {
      const [col, type] = l.replace(/,$/, "").split(/\s+/)
      return { name: col, type, json: type === "JSON", key: key.includes(col) }
    })
  return { name, columns, key }
})
for (const t of tables) {
  t.indexes = [...schema.matchAll(new RegExp(`CREATE INDEX IF NOT EXISTS (\\w+) ON ${t.name} \\((\\w+)\\)`, "g"))].map((m) => ({ name: m[1], column: m[2] }))
  // A key means INSERT OR REPLACE in store.go: a row sent again replaces itself.
  const insert = store.match(new RegExp(`INSERT( OR REPLACE)? INTO ${t.name}\\b`))
  if (!insert) throw new Error(`facts: no insert for ${t.name}`)
  t.replaces = Boolean(insert[1])
  if (t.replaces !== t.key.length > 0) throw new Error(`facts: ${t.name} key and insert disagree`)
}

const TABLES = ["spans", "span_events", "events", "metric_points", "prices"]
const viewList = [...views.matchAll(/CREATE OR REPLACE VIEW (\w+) AS([\s\S]*?)(?=\nCREATE OR REPLACE|\n*$)/g)].map(([, name, body]) => {
  const reads = TABLES.filter((t) => new RegExp(`\\b(FROM|JOIN)\\s+${t}\\b`).test(body))
  return { name, reads }
})

const prices = [...pricing.matchAll(/^\s*\{"([^"]+)",/gm)].map((m) => m[1])
const dsn = store.match(/dsnOptions = "\?([^"]+)"/)[1].split("&")
const defaultDir = main.match(/filepath\.Join\(h, "([^"]+)", "([^"]+)"\)/)

export const STORE = {
  tables,
  views: viewList,
  prices: prices.length,
  dsn,
  file: `~/${defaultDir[1]}/${defaultDir[2]}`,
  oneWriter: /wmu\s+sync\.Mutex/.test(store) && /s\.wmu\.Lock\(\)/.test(store),
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(STORE, null, 2))
