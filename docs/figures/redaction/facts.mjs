// Facts only this figure needs, read from the repo so they cannot drift.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MODEL } from "../model.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

// The source-side switches, from the "Opting into content" table in the
// Claude Code setup doc: every row that starts with an OTEL_LOG_* flag.
const setup = readFileSync(join(ROOT, "docs/claude-code-setup.md"), "utf8")
export const SOURCE_GATES = [...setup.matchAll(/^\| `(OTEL_LOG_[A-Z_]+)=/gm)].map((m) => m[1])
for (const want of ["OTEL_LOG_USER_PROMPTS", "OTEL_LOG_TOOL_DETAILS"]) {
  if (!SOURCE_GATES.includes(want)) throw new Error(`facts: ${want} missing from claude-code-setup.md`)
}

// What redact.Attrs does to one key, by the same lists the Go code uses.
export function classOf(key) {
  if (MODEL.identityKeys.includes(key)) return "identity"
  if (MODEL.contentKeys.includes(key) || MODEL.contentPrefixes.some((p) => key.startsWith(p))) return "content"
  return "kept"
}

// redact.Attrs runs on these maps, one call each (internal/otlp/convert.go).
const convert = readFileSync(join(ROOT, "internal/otlp/convert.go"), "utf8")
export const REDACT_CALLS = (convert.match(/redact\.Attrs\(/g) || []).length
