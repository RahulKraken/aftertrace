// One Claude Code turn, made up for the figure (synthetic: no real session),
// shaped like what Claude Code exports, plus the app's time accounting for it.
// The accounting is a port of Breakdown and paint in internal/analysis/analysis.go:
// every moment of the turn goes to the highest-priority span running then.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

// Paint priority, highest first, read from the Go source so the figure follows it.
const goCats = read("internal/analysis/analysis.go").match(/var cats = \[\]string\{([^}]*)\}/)
if (!goCats) throw new Error("turn: cats not found in analysis.go")
export const PRIORITY = [...goCats[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])

// The story view's time bar: which categories it adds into each segment
// (SEGS in web/src/components/story/TurnStory.tsx).
const story = read("web/src/components/story/TurnStory.tsx")
const segs = [...story.matchAll(/\{ key: "(\w+)", label: "([^"]+)", cls: "[^"]+", pick: \(b\) => ([^}]+) \}/g)]
if (segs.length !== 4) throw new Error("turn: story SEGS not found")
export const SEGMENTS = segs.map(([, key, label, pick]) => ({ key, label, cats: [...pick.matchAll(/b\.(\w+)/g)].map((m) => m[1]) }))

// Opus 5.5 list prices per million tokens (internal/pricing/pricing.go):
// input, cache write, cache read, output. Claude Code reports its own cost_usd
// on the api_request event; these only keep the made-up numbers plausible.
const price = read("internal/pricing/pricing.go").match(/\{"claude-opus-5-5", ([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\}/)
const [pin, pcw, pcr, pout] = price.slice(1).map(Number)
const cost = (u) => (u.input_tokens * pin + u.cache_creation_tokens * pcw + u.cache_read_tokens * pcr + u.output_tokens * pout) / 1e6

const model = (id, t0, t1, attempts, u) => ({
  id,
  name: "claude_code.llm_request",
  t0,
  t1,
  attempts,
  attrs: { model: "claude-opus-5-5", ...u, attempt: attempts.length, success: "true", request_id: `req_${id}` },
  joined: { cost_usd: Math.round(cost(u) * 1000) / 1000 },
})

// Milliseconds from the start of the turn.
export const TURN = {
  prompt: "Run the tests and fix what fails",
  spans: [
    { id: "turn", name: "claude_code.interaction", t0: 0, t1: 47800, attrs: { "interaction.sequence": 3, user_prompt_length: 33 } },
    model("m1", 300, 6200, [300, 2400], { ttft_ms: 1840, input_tokens: 4, output_tokens: 412, cache_read_tokens: 38114, cache_creation_tokens: 2206, stop_reason: "tool_use" }),
    { id: "t1", name: "claude_code.tool", t0: 6400, t1: 7300, attrs: { tool_name: "Grep", result_tokens: 1260 } },
    { id: "w1", parent: "t1", name: "claude_code.tool.blocked_on_user", t0: 6400, t1: 6450, attrs: { decision: "accept", source: "config" } },
    { id: "x1", parent: "t1", name: "claude_code.tool.execution", t0: 6450, t1: 7300, attrs: { success: "true" } },
    model("m2", 7500, 12000, [7500], { ttft_ms: 1310, input_tokens: 6, output_tokens: 236, cache_read_tokens: 40412, cache_creation_tokens: 1180, stop_reason: "tool_use" }),
    { id: "t2", name: "claude_code.tool", t0: 12200, t1: 41000, attrs: { tool_name: "Bash", bash_argv0: "npm", result_tokens: 3480 } },
    { id: "w2", parent: "t2", name: "claude_code.tool.blocked_on_user", t0: 12200, t1: 30000, attrs: { decision: "accept", source: "user_temporary" } },
    { id: "x2", parent: "t2", name: "claude_code.tool.execution", t0: 30000, t1: 41000, attrs: { success: "true" } },
    model("m3", 41200, 47500, [41200], { ttft_ms: 1520, input_tokens: 5, output_tokens: 690, cache_read_tokens: 41790, cache_creation_tokens: 3420, stop_reason: "end_turn" }),
  ],
}

// HumanDecision in analysis.go: a user_* source, or none at all, means a person answered.
const human = (src) => !src || src === "unknown" || src.startsWith("user_")

// The spans' claims on the clock, as [category, from, to, span id] in ms.
export function intervals(spans) {
  const out = []
  for (const s of spans) {
    if (s.name === "claude_code.tool.blocked_on_user") out.push([human(s.attrs.source) ? "permission_wait" : "permission_check", s.t0, s.t1, s.id])
    else if (s.name === "claude_code.tool.execution") out.push(["tool", s.t0, s.t1, s.id])
    else if (s.name === "claude_code.hook") out.push(["hook", s.t0, s.t1, s.id])
    else if (s.name === "claude_code.llm_request") {
      const last = s.attempts.length > 1 ? s.attempts[s.attempts.length - 1] : null
      if (last != null) out.push(["retry", s.t0, last, s.id], ["model", last, s.t1, s.id])
      else out.push(["model", s.t0, s.t1, s.id])
    }
  }
  return out
}

// Who owns the moment t: the highest-priority interval covering it, else "other".
export function ownerAt(ivs, t) {
  let best = -1
  for (const [cat, a, b] of ivs) {
    const p = PRIORITY.indexOf(cat)
    if (a <= t && t < b && (best < 0 || p < best)) best = p
  }
  return best < 0 ? "other" : PRIORITY[best]
}

// The story segment a category lands in.
export const segmentOf = (cat) => SEGMENTS.find((s) => s.cats.includes(cat))?.key ?? "other"

// The whole turn painted: ms per category, then per story segment.
export function breakdown(turn) {
  const root = turn.spans.find((s) => s.name === "claude_code.interaction")
  const ivs = intervals(turn.spans)
  const cuts = [...new Set([root.t0, root.t1, ...ivs.flatMap(([, a, b]) => [a, b]).filter((x) => x >= root.t0 && x <= root.t1)])].sort((a, b) => a - b)
  const cats = Object.fromEntries([...PRIORITY, "other"].map((c) => [c, 0]))
  for (let i = 0; i + 1 < cuts.length; i++) cats[ownerAt(ivs, (cuts[i] + cuts[i + 1]) / 2)] += cuts[i + 1] - cuts[i]
  const segments = Object.fromEntries(SEGMENTS.map((s) => [s.key, 0]))
  for (const [c, ms] of Object.entries(cats)) segments[segmentOf(c)] += ms
  return { cats, segments, ivs }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify({ PRIORITY, SEGMENTS, ...breakdown(TURN), costs: TURN.spans.filter((s) => s.joined).map((s) => s.joined.cost_usd) }, null, 2))
