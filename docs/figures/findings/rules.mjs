// The facts Fig 5 states about the rules, read from the rule files and the
// store's views at build time. A rule added, removed or retitled in
// internal/rules/files changes the figure on the next build, and a rule this
// figure has no words for stops the build instead of being drawn wrong.
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MODEL } from "../model.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const RULES_DIR = join(ROOT, "internal/rules/files")
const views = readFileSync(join(ROOT, "internal/store/views.sql"), "utf8")

// What each view reads, resolved down to the four stored tables.
const VIEW_SRC = {}
for (const m of views.matchAll(/CREATE OR REPLACE VIEW (\w+) AS([\s\S]*?)(?=CREATE OR REPLACE|$)/g)) VIEW_SRC[m[1]] = m[2]
const refsIn = (sql) => [...new Set([...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map((m) => m[1]))]
function baseOf(name, seen = new Set()) {
  if (MODEL.tables.includes(name)) return [name]
  if (!VIEW_SRC[name] || seen.has(name)) return []
  seen.add(name)
  return [...new Set(refsIn(VIEW_SRC[name]).flatMap((r) => baseOf(r, seen)))]
}

// Words the source does not hold: one line on what each rule looks for, the
// source switch it leans on, and the synthetic ticket the figure prints for it
// (null: the rule finds nothing on this run, which is the common case).
const WORDS = {
  "app.errors": { detects: "an app where 3+ model calls, and 5%+ of them, failed", needs: "", sample: { severity: "medium", value: 12, headline: "checkout-api · 12 of 140 calls failed (rate_limit_error)" } },
  "app.model_downgrade": { detects: "a big model giving short answers (90% under 60 tokens)", needs: "", sample: { severity: "medium", value: 3.2, headline: "router · classify sends 410 calls to Sonnet for one-word answers" } },
  "app.no_prompt_cache": { detects: "10+ long Anthropic calls with no cache reads or writes", needs: "", sample: { severity: "low", value: 1.85, headline: "summarizer · resends ~4,000 input tokens per call with no prompt caching" } },
  "cache.drop_after_compaction": { detects: "a compaction, then a cache hit rate 30+ points lower", needs: "", sample: { severity: "medium", value: 0.42, headline: "Compaction rewrote 180k tokens of cache" } },
  "hook.overhead": { detects: "a hook averaging 1 s or more per run", needs: "", sample: null },
  "mcp.large_results": { detects: "MCP tool results over 10,000 tokens", needs: "OTEL_LOG_TOOL_DETAILS for server names", sample: { severity: "medium", value: 0.96, headline: "mcp__docs__search returned 38k tokens, 4 times" } },
  "model.switch_cache_rebuild": { detects: "a model switch that rebuilt the prompt cache", needs: "", sample: null },
  "permission.allow_rule_candidate": { detects: "the same permission approved 3+ times", needs: "OTEL_LOG_TOOL_DETAILS for exact Bash patterns", sample: { severity: "high", value: 84, headline: "Bash(npm test:*) approved 7 times" } },
  "plugin.skills_unused": { detects: "a plugin's skills loaded in 3+ sessions, never used", needs: "OTEL_LOG_TOOL_DETAILS for plugin names", sample: null },
  "retry.exhausted": { detects: "a request that ran out of retries", needs: "", sample: { severity: "high", value: 41, headline: "Request failed after 10 attempts (overloaded)" } },
  "retry.waste": { detects: "successful requests that needed more than one attempt", needs: "", sample: { severity: "medium", value: 23, headline: "6 requests retried, 23 s before they got through" } },
  "skill.cost": { detects: "a skill that is 25%+ of cost, or $1+ per use", needs: "OTEL_LOG_TOOL_DETAILS for skill names", sample: { severity: "medium", value: 4.1, headline: "Skill pdf-report is 31% of spend" } },
  "tool.repeated_errors": { detects: "the same tool failing the same way twice in a session", needs: "OTEL_LOG_TOOL_DETAILS for the full command", sample: { severity: "medium", value: 19, headline: "Bash failed 3 times with exit_code in one session" } },
}

const head = (src, key) => (src.match(new RegExp(`^-- @${key} (.+)$`, "m")) || [])[1]?.trim() || ""

export const RULES = readdirSync(RULES_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((file) => {
    const src = readFileSync(join(RULES_DIR, file), "utf8")
    const id = head(src, "id")
    const body = src.replace(/^--.*$/gm, "")
    const sevLine = body.split("\n").find((l) => /AS severity/.test(l)) || ""
    const severities = [...new Set([...sevLine.matchAll(/'(high|medium|low)'/g)].map((m) => m[1]))]
    const unit = (body.match(/'([^']*)'\s+AS impact_unit/) || [])[1] || ""
    const reads = refsIn(body).filter((r) => MODEL.tables.includes(r) || VIEW_SRC[r] || r === "prices")
    const tables = [...new Set(reads.flatMap((r) => baseOf(r)))]
    const words = WORDS[id]
    if (!words) throw new Error(`findings figure: no words for rule ${id} (${file})`)
    if (words.sample && !severities.includes(words.sample.severity)) throw new Error(`findings figure: ${id} cannot be ${words.sample.severity}`)
    return { id, title: head(src, "title"), pillar: head(src, "pillar"), minVersion: head(src, "min_version"), file, severities, unit, reads, tables, ...words }
  })
  // The engine loads the rules sorted by id; that is the order they run in.
  .sort((a, b) => (a.id < b.id ? -1 : 1))

for (const id of Object.keys(WORDS)) if (!RULES.some((r) => r.id === id)) throw new Error(`findings figure: rule ${id} is gone from internal/rules/files`)

export const PILLARS = [...new Set(RULES.map((r) => r.pillar))]
export const SEVERITIES = ["high", "medium", "low", "error"] // the engine's sort order

if (process.argv[1] === fileURLToPath(import.meta.url)) for (const r of RULES) console.log(r.id.padEnd(32), r.pillar.padEnd(10), r.severities.join("/").padEnd(18), r.unit.padEnd(36), r.reads.join(","), "→", r.tables.join(","))
