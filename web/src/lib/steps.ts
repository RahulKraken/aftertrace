// A turn as a story: what Claude said it was doing, the actions under each
// of those steps in plain words, and the moments it stopped to wait for you.
// The waterfall shows spans; this shows work.
import type { Content, ContentIndex } from "./content"
import { spanKind, waitChild, type SpanNode } from "./span"

export type ActionCat = "explore" | "edit" | "run" | "web" | "agent" | "ask" | "mcp" | "skill" | "other"

export type Action = {
  span: SpanNode
  cat: ActionCat
  verb: string
  object: string
  // object is a command or a path, shown in mono.
  code: boolean
  // The raw command or path behind a described action, shown faint.
  detail: string
  ms: number
  // Time Claude Code held the call for a person (an approval or an answer).
  waitMs: number
  error: boolean
  file: string | null
  kids: Action[]
}

export type Chapter = {
  kind: "chapter"
  id: string
  title: string | null
  startNs: number
  endNs: number
  thinkMs: number
  cost: number
  actions: Action[]
  errors: number
  // The model call that wrote the title, for linking to its detail.
  titleSpan: string | null
}

export type Pause = {
  kind: "pause"
  id: string
  reason: "question" | "approval"
  ms: number
  startNs: number
  action: Action
  qa: { q: string; a: string }[]
}

export type StoryItem = Chapter | Pause

export type TurnStoryModel = {
  items: StoryItem[]
  final: Content | null
  filesChanged: { path: string; n: number; created: boolean }[]
  actions: number
  errors: number
  questionWaitMs: number
  questions: number
  approvalWaitMs: number
  narrated: boolean
}

// A person waiting this long is a moment in the story, not a detail of a step.
export const PAUSE_MS = 60_000

const INJECTED = /<(system-reminder|task-notification|side-sessions-event|ci-monitor-event|local-command-caveat)\b[^>]*>[\s\S]*?<\/\1>/g
const TAG = /<\/?[A-Za-z_][\w-]*(\s[^<>]*)?>/g

// What the person typed: injected blocks dropped, wrapper tags removed.
export function cleanPrompt(s: string): string {
  const out = s.replace(INJECTED, " ").replace(TAG, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
  if (out || !s.trim()) return out
  if (s.includes("<task-notification")) return "Background task finished"
  if (s.includes("<side-sessions-event")) return "Update from a side session"
  if (s.includes("<ci-monitor-event")) return "CI update"
  return "Automated message"
}

function base(p: string): string {
  const parts = p.split("/").filter(Boolean)
  return parts[parts.length - 1] || p
}

// The interesting part of a shell command: no `cd x &&` prefix, first line only.
export function shortCommand(cmd: string): string {
  let c = cmd.trim().split("\n")[0]
  // Setup that says nothing about the work: cd, set -e, VAR=value.
  const noise = /^(cd\s+("[^"]*"|'[^']*'|\S+)|set\s+-\w+|[A-Za-z_]\w*=("[^"]*"|'[^']*'|\S*))\s*(&&|;)\s*/
  while (noise.test(c)) c = c.replace(noise, "")
  const heredoc = c.match(/^(\S+)(\s+-)?\s*<<-?\s*['"]?\w+['"]?/)
  if (heredoc) return `${base(heredoc[1])} script`
  // The first command of a chain; the rest is usually plumbing.
  const first = c.split(/\s*(?:&&|;|\|\|)\s*/)[0]
  if (first && first !== c) c = `${first} …`
  return c.length > 80 ? c.slice(0, 79) + "…" : c
}

// Paths relative to the deepest folder every path shares.
export function relPaths(paths: string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!paths.length) return out
  const split = paths.map((p) => p.split("/"))
  let n = 0
  if (paths.length > 1) {
    const min = Math.min(...split.map((s) => s.length - 1))
    while (n < min && split.every((s) => s[n] === split[0][n])) n++
  } else n = split[0].length - 1
  // Keep the repo-level folder when everything sits in one.
  const wt = paths[0].match(/^(.*\/\.claude\/worktrees\/[^/]+)\//)
  const cut = wt ? Math.min(n, wt[1].split("/").length) : n
  paths.forEach((p, i) => out.set(p, split[i].slice(cut).join("/") || p))
  return out
}

function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function isHumanWait(w: SpanNode | undefined): boolean {
  if (!w) return false
  const src = String(w.attrs.source || "")
  // Config, hooks and auto mode decide on their own; only people make you wait.
  return !src || src.startsWith("user")
}

function inputJson(span: SpanNode, idx: ContentIndex): Record<string, unknown> | null {
  const id = String(span.attrs.tool_use_id || "")
  const c = id ? idx.inputByToolUse.get(id) : undefined
  const j = c?.json
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null
}

const BASH_VERB: Record<string, [string, ActionCat]> = {
  file_search: ["Looked through", "explore"],
  file_read: ["Read", "explore"],
  vcs: ["Git", "run"],
  github_cli: ["GitHub", "run"],
  package_manager: ["Installed", "run"],
  fs_mutation: ["Changed files", "edit"],
}

export function describe(span: SpanNode, idx: ContentIndex): Omit<Action, "span" | "ms" | "waitMs" | "error" | "kids"> {
  const a = span.attrs
  const tool = String(a.tool_name || a["gen_ai.tool.name"] || "")
  const path = String(a.file_path || "")
  const input = inputJson(span, idx)
  const pick = (k: string) => (input && typeof input[k] === "string" ? String(input[k]) : "")
  const d = (verb: string, object: string, cat: ActionCat, code = false, file: string | null = null, detail = "") => ({ verb, object, cat, code, file, detail })

  if (spanKind(span) === "agent" || tool === "Agent" || tool === "Task") {
    const who = String(a.subagent_type || pick("subagent_type") || "a subagent")
    return d("Handed off to", pick("description") ? `${who}: ${pick("description")}` : who, "agent")
  }
  switch (tool) {
    case "Read": {
      const f = path || pick("file_path")
      return d("Read", f ? base(f) : "a file", "explore", Boolean(f))
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit": {
      const f = path || pick("file_path") || pick("notebook_path")
      return d(tool === "Write" ? "Wrote" : "Edited", f ? base(f) : "a file", "edit", Boolean(f), f || null)
    }
    case "Grep":
      return d("Searched for", pick("pattern") || "text", "explore", Boolean(pick("pattern")))
    case "Glob":
      return d("Listed", pick("pattern") || "files", "explore", Boolean(pick("pattern")))
    case "WebSearch":
      return d("Searched the web for", pick("query") || "a query", "web")
    case "WebFetch": {
      const u = pick("url")
      let host = ""
      try {
        host = u ? new URL(u).host : ""
      } catch {
        host = u
      }
      return d("Fetched", host || "a page", "web", Boolean(host))
    }
    case "AskUserQuestion":
      return d("Asked you", "a question", "ask")
    case "Skill":
      return d("Used the skill", String(a.skill_name || pick("skill") || ""), "skill", true)
    case "TodoWrite":
      return d("Updated", "the to-do list", "other")
    case "ToolSearch":
      return d("Loaded", "more tools", "other")
    case "Bash": {
      const cmd = String(a.full_command || pick("command") || "")
      const [verb, cat] = BASH_VERB[String(a.bash_command_class || "")] || ["Ran", "run" as ActionCat]
      // Claude Code asks the model to describe each command; that reads better than the command.
      const why = pick("description")
      if (why) return d(why, "", cat, false, null, cmd ? shortCommand(cmd) : "")
      return d(verb, cmd ? shortCommand(cmd) : "a command", cat, Boolean(cmd))
    }
  }
  if (tool.startsWith("mcp__")) {
    const parts = tool.split("__")
    const server = String(a["anthropic.mcp.server.name"] || span.joined?.["mcp_server.name"] || parts[1] || "")
    return d(humanize(parts.slice(2).join(" ") || tool), `in ${server.replace(/_/g, " ")}`, "mcp")
  }
  return d(humanize(tool || span.name), "", "other")
}

function buildAction(span: SpanNode, idx: ContentIndex): Action {
  const w = waitChild(span)
  const desc = describe(span, idx)
  const kids: Action[] = []
  if (spanKind(span) === "agent") {
    for (const k of span.kids) {
      const kk = spanKind(k)
      if (kk === "tool" || kk === "agent") kids.push(buildAction(k, idx))
    }
  }
  const failed = span.is_error || span.kids.some((k) => spanKind(k) === "run" && k.is_error)
  return {
    span,
    ...desc,
    ms: span.duration_ms,
    waitMs: isHumanWait(w) ? (w?.duration_ms ?? 0) : 0,
    error: failed,
    kids,
  }
}

// Question and answer pairs from AskUserQuestion's input, when content is on.
function questionsOf(span: SpanNode, idx: ContentIndex): { q: string; a: string }[] {
  const j = inputJson(span, idx)
  if (!j) return []
  const out: { q: string; a: string }[] = []
  const answers = j.answers && typeof j.answers === "object" ? (j.answers as Record<string, unknown>) : {}
  for (const [q, a] of Object.entries(answers)) out.push({ q, a: String(a) })
  if (!out.length && Array.isArray(j.questions)) {
    for (const q of j.questions) {
      const text = typeof q === "string" ? q : (q as { question?: string })?.question
      if (text && text !== "<nested>") out.push({ q: text, a: "" })
    }
  }
  return out
}

// Without Claude's own words, steps are runs of the same kind of work.
const PHASE: Record<ActionCat, string> = {
  explore: "explore",
  edit: "edit",
  run: "run",
  web: "explore",
  agent: "agent",
  ask: "ask",
  mcp: "run",
  skill: "run",
  other: "other",
}

export function buildStory(root: SpanNode, idx: ContentIndex): TurnStoryModel {
  const items: StoryItem[] = []
  const narrated = idx.responseByRequest.size > 0
  // Held in an object: the closure below reassigns it, which defeats narrowing.
  const st: { cur: Chapter | null } = { cur: null }
  const open = (id: string, startNs: number, title: string | null, titleSpan: string | null): Chapter => {
    const c: Chapter = { kind: "chapter", id, title, startNs, endNs: startNs, thinkMs: 0, cost: 0, actions: [], errors: 0, titleSpan }
    items.push(c)
    st.cur = c
    return c
  }
  const kids = [...root.kids].sort((x, y) => x.start_ns - y.start_ns)
  let lastPhase = ""
  for (const k of kids) {
    const kind = spanKind(k)
    if (kind === "model") {
      const rid = String(k.attrs.request_id || "")
      const said = rid ? idx.responseByRequest.get(rid) : undefined
      const title = said ? firstLine(said.text) : null
      let c: Chapter | null = st.cur
      if (title && c && (c.actions.length || c.title)) c = open(k.span_id, k.start_ns, title, k.span_id)
      else if (title && c) {
        c.title = title
        c.titleSpan = k.span_id
      } else if (!c) c = open(k.span_id, k.start_ns, title, title ? k.span_id : null)
      c.thinkMs += k.duration_ms
      c.cost += k.joined?.cost_usd || 0
      c.endNs = Math.max(c.endNs, k.end_ns)
      continue
    }
    if (kind !== "tool" && kind !== "agent") continue
    const act = buildAction(k, idx)
    const phase = PHASE[act.cat]
    let c: Chapter | null = st.cur
    if (!c || (!narrated && phase !== lastPhase && c.actions.length)) c = open(k.span_id, k.start_ns, null, null)
    lastPhase = phase
    c.actions.push(act)
    if (act.error) c.errors++
    c.cost += rollCost(k)
    c.endNs = Math.max(c.endNs, k.end_ns)
    if (act.waitMs >= PAUSE_MS) {
      const qa = act.cat === "ask" ? questionsOf(k, idx) : []
      items.push({
        kind: "pause",
        id: `p-${k.span_id}`,
        reason: act.cat === "ask" ? "question" : "approval",
        ms: act.waitMs,
        startNs: k.start_ns,
        action: act,
        qa,
      })
      st.cur = null
      lastPhase = ""
    }
  }

  // Claude's last words are the outcome, not a step.
  const final = idx.finalResponse
  const last = items[items.length - 1]
  if (final && last?.kind === "chapter" && !last.actions.length && last.title === firstLine(final.text)) items.pop()

  const files = new Map<string, { path: string; n: number; created: boolean }>()
  let actions = 0
  let errors = 0
  let questionWaitMs = 0
  let questions = 0
  let approvalWaitMs = 0
  const visit = (a: Action) => {
    actions++
    if (a.error) errors++
    if (a.cat === "ask") {
      questionWaitMs += a.waitMs
      questions++
    } else approvalWaitMs += a.waitMs
    if (a.file) {
      const f = files.get(a.file) || { path: a.file, n: 0, created: false }
      f.n++
      if (a.verb === "Wrote" && f.n === 1) f.created = true
      files.set(a.file, f)
    }
    a.kids.forEach(visit)
  }
  for (const it of items) if (it.kind === "chapter") it.actions.forEach(visit)

  return {
    items,
    final,
    filesChanged: [...files.values()],
    actions,
    errors,
    questionWaitMs,
    questions,
    approvalWaitMs,
    narrated,
  }
}

function rollCost(s: SpanNode): number {
  let c = s.joined?.cost_usd || 0
  for (const k of s.kids) c += rollCost(k)
  return c
}

export function firstLine(t: string): string {
  const line = t.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim()
  return line.length > 220 ? line.slice(0, 219) + "…" : line
}

// "Read 4 files · ran 6 commands · edited 2 files", for a step without words.
export function summarize(actions: Action[]): string {
  const n: Record<string, number> = {}
  for (const a of actions) {
    // Reading a file and searching for one read differently in a summary.
    const key = a.cat === "explore" ? (a.verb === "Read" ? "read" : "search") : a.cat
    n[key] = (n[key] || 0) + 1
  }
  const parts: string[] = []
  const say = (cat: ActionCat | "read" | "search", one: string, many: string) => {
    const v = n[cat]
    if (v) parts.push(v === 1 ? one : many.replace("#", String(v)))
  }
  say("read", "Read 1 file", "Read # files")
  say("search", "1 search", "# searches")
  say("edit", "Changed 1 file", "Changed # files")
  say("run", "Ran 1 command", "Ran # commands")
  say("web", "Went to the web once", "Went to the web # times")
  say("agent", "Handed off to a subagent", "Handed off to # subagents")
  say("ask", "Asked you a question", "Asked you # questions")
  say("mcp", "Used 1 connector tool", "Used # connector tools")
  say("skill", "Used a skill", "Used # skills")
  say("other", "1 other step", "# other steps")
  return parts.join(" · ")
}
