// The facts every figure states, read from the source at build time so a
// figure can never drift from the product it explains.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

function goList(src, name) {
  const m = src.match(new RegExp(`var ${name} = \\[\\]string\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`model: ${name} not found`)
  // Comments can quote key names too; only the list's own strings count.
  const body = m[1].replace(/\/\/.*$/gm, "")
  return [...body.matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

function flagDefault(src, name) {
  const m = src.match(new RegExp(`fs\\.Int\\("${name}", (\\d+)`))
  if (!m) throw new Error(`model: flag ${name} not found`)
  return Number(m[1])
}

const redact = read("internal/redact/redact.go")
const main = read("cmd/aftertrace/main.go")
const schema = read("internal/store/schema.sql")
const views = read("internal/store/views.sql")

// Import bookkeeping lives in schema.sql but is not a signal table: views,
// the UI and the figures do not read it. History still writes spans and
// events; this table is only which files have already been looked at.
export const BOOKKEEPING_TABLES = ["history_files"]
for (const name of BOOKKEEPING_TABLES) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`).test(schema)) throw new Error(`model: bookkeeping table ${name} not in schema.sql`)
}

export const MODEL = {
  ports: { grpc: flagDefault(main, "grpc-port"), http: flagDefault(main, "http-port"), ui: flagDefault(main, "ui-port") },
  identityKeys: goList(redact, "IdentityKeys"),
  contentKeys: goList(redact, "ContentKeys"),
  contentPrefixes: goList(redact, "ContentPrefixes"),
  tables: [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).filter((n) => !BOOKKEEPING_TABLES.includes(n)),
  views: [...views.matchAll(/CREATE OR REPLACE VIEW (\w+)/g)].map((m) => m[1]),
  rules: readdirSync(join(ROOT, "internal/rules/files")).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")),
  // The three OpenTelemetry signals a source sends, and what each becomes.
  signals: [
    { name: "traces", becomes: "spans and span events", hue: "model" },
    { name: "logs", becomes: "events", hue: "tool" },
    { name: "metrics", becomes: "metric points", hue: "wait" },
  ],
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(MODEL, null, 2))
