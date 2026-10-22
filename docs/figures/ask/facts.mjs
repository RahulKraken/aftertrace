// What Fig 7 states about Ask, read from the source at build time so the
// figure cannot drift from the code.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

function constant(src, name, file) {
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*("?)([^"\\n]+)\\1`))
  if (!m) throw new Error(`ask facts: ${name} not found in ${file}`)
  return m[1] ? m[2] : Number(m[2])
}
function match(src, re, what) {
  const m = src.match(re)
  if (!m) throw new Error(`ask facts: ${what} not found`)
  return m[1]
}

const agent = read("internal/ask/ask.go")
const api = read("internal/api/ask.go")
const query = read("internal/query/query.go")
const main = read("cmd/aftertrace/main.go")

export const ASK = {
  model: constant(agent, "DefaultModel", "ask.go"),
  maxSteps: constant(agent, "maxSteps", "ask.go"),
  rowsToModel: constant(agent, "maxRowsToModel", "ask.go"),
  cellToModel: constant(agent, "maxCellToModel", "ask.go"),
  rowsShown: constant(agent, "maxRowsReturned", "ask.go"),
  // The local run's own row cap, and the time one question may take.
  rowsLocal: Number(match(api, /query\.RunSQL\(s\.db\(\), q, (\d+)\)/, "local row limit")),
  timeoutMin: Number(match(api, /context\.WithTimeout\(r\.Context\(\), (\d+)\*time\.Minute\)/, "ask timeout")),
  keyEnv: match(agent, /os\.Getenv\("(ANTHROPIC_API_KEY)"\)/, "key env"),
  modelEnv: match(agent, /os\.Getenv\("(AFTERTRACE_ASK_MODEL)"\)/, "model env"),
  flag: match(main, /fs\.Bool\("(ask)", false/, "--ask flag"),
  readOnly: match(query, /errReadOnly = errors\.New\("([^"]+)"\)/, "read-only error"),
  tools: [...agent.matchAll(/Name:\s+"(\w+)",/g)].map((m) => m[1]),
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(ASK, null, 2))
