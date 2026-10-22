import { AnimatePresence, motion } from "motion/react"
import { Check, ChevronRight, CircleAlert, MessageCircleQuestion, ShieldQuestion, Sparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "wouter"
import { dur, usd } from "../../lib/format"
import { indexContent } from "../../lib/content"
import { buildForest } from "../../lib/span"
import { buildStory, cleanPrompt, relPaths, summarize, type Action, type Chapter, type Pause, type StoryItem } from "../../lib/steps"
import { turnStory } from "../../lib/story"
import type { Breakdown, Finding, Trace } from "../../lib/types"
import { glyphClass, SpanIcon } from "../SpanIcon"
import { DetailPane } from "../waterfall/DetailPane"
import { PaneColumn } from "../waterfall/PaneColumn"
import { Markdown, MarkdownInline } from "./Markdown"
import { TraceViewSwitch } from "./TraceViewSwitch"
import type { TraceView } from "../../lib/traceView"

// Short waits still show on the step; longer ones become a Pause card.
const SHOW_WAIT_MS = 5_000

export function TurnStory({
  trace,
  findings,
  view,
  onView,
}: {
  trace: Trace
  findings: Finding[]
  view: TraceView
  onView: (v: TraceView) => void
}) {
  const { root, byId } = useMemo(() => buildForest(trace.spans), [trace])
  const content = useMemo(() => indexContent(trace), [trace])
  const story = useMemo(() => buildStory(root, content), [root, content])
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [sel, setSel] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const running = Boolean(trace.in_progress)
  const prompt = content.prompt ? cleanPrompt(content.prompt.text) : ""
  const selected = sel ? byId.get(sel) : undefined
  const rel = useMemo(() => relPaths(story.filesChanged.map((f) => f.path)), [story.filesChanged])
  const chapters = story.items.filter((i): i is Chapter => i.kind === "chapter")
  const allOpen = chapters.length > 0 && chapters.every((c) => open.has(c.id))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (e.key === "Escape") setSel(null)
      else if (e.key === "[" && trace.prev) location.hash = `#/trace/${trace.prev}`
      else if (e.key === "]" && trace.next) location.hash = `#/trace/${trace.next}`
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [trace.prev, trace.next])

  const toggle = (id: string) =>
    setOpen((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const reveal = (pred: (it: StoryItem) => boolean) => {
    const it = story.items.find(pred)
    if (!it) return
    if (it.kind === "chapter") setOpen((p) => new Set(p).add(it.id))
    window.requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-item="${it.id}"]`)
      el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" })
    })
  }

  const totalMs = root.duration_ms
  const cost = trace.spans.reduce((n, s) => n + (s.joined?.cost_usd || 0), 0)

  return (
    <div className={`wf story-mode ${selected ? "has-pane" : ""}`}>
      <div className="wf-main">
        <div className="st-scroll">
          <div className="st-wrap">
            <div className="crumbs">
              <Link href="/sessions">Sessions</Link> ›{" "}
              <Link href={`/session/${trace.session_id}`} className="mono">
                {trace.session_id.slice(0, 8)}
              </Link>{" "}
              › Turn {trace.turn_index} of {trace.turn_count}
              <span className="spacer" />
              <span className={`live-badge ${running ? "is-live" : "is-done"}`}>
                {running ? <i className="live-dot" /> : null}
                {running ? "Running" : "Done"}
              </span>
              <TraceViewSwitch view={view} onChange={onView} />
              <button className="navbtn" disabled={!trace.prev} onClick={() => (location.hash = `#/trace/${trace.prev}`)} title="Previous turn ([)">
                ‹
              </button>
              <button className="navbtn" disabled={!trace.next} onClick={() => (location.hash = `#/trace/${trace.next}`)} title="Next turn (])">
                ›
              </button>
            </div>

            {prompt ? (
              <div className={`st-prompt ${promptOpen ? "is-open" : ""}`}>
                <div className="st-label">You asked</div>
                <div className="st-prompt-text">{prompt}</div>
                {prompt.length > 280 ? (
                  <button type="button" className="st-more" onClick={() => setPromptOpen((v) => !v)}>
                    {promptOpen ? "Show less" : "Show all"}
                  </button>
                ) : null}
              </div>
            ) : null}

            <h1 className="st-head">{turnStory(trace)}</h1>
            <div className="st-meta">
              {dur(totalMs)} · {usd(cost)} · {story.actions} {story.actions === 1 ? "action" : "actions"}
              {story.errors > 0 ? (
                <>
                  {" · "}
                  <button type="button" className="sum-err" onClick={() => reveal((i) => i.kind === "chapter" && i.errors > 0)}>
                    {story.errors} failed
                  </button>
                </>
              ) : null}
            </div>

            <TimeBar bd={trace.breakdown} totalMs={totalMs} onWait={() => reveal((i) => i.kind === "pause")} hasPause={story.items.some((i) => i.kind === "pause")} />

            {story.final || story.filesChanged.length ? (
              <section className={`st-outcome ${story.final ? "" : "is-bare"}`}>
                {story.final ? (
                  <>
                    <div className="st-label">{running ? "Latest from Claude" : "Where it ended"}</div>
                    <Clamp text={story.final.text} lines={6} />
                  </>
                ) : null}
                {story.filesChanged.length ? (
                  <div className="st-files">
                    <span className="st-label">{story.filesChanged.length === 1 ? "1 file changed" : `${story.filesChanged.length} files changed`}</span>
                    {story.filesChanged.map((f) => (
                      <span key={f.path} className="st-file mono" title={f.path}>
                        {rel.get(f.path)}
                        {f.created ? <em>new</em> : f.n > 1 ? <em>×{f.n}</em> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="st-steps-head">
              <h2>{story.narrated ? "What Claude did, in its words" : "What Claude did"}</h2>
              {chapters.length > 1 ? (
                <button type="button" className="st-more" onClick={() => setOpen(allOpen ? new Set() : new Set(chapters.map((c) => c.id)))}>
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              ) : null}
            </div>

            <ol className="st-steps stagger" ref={listRef}>
              {story.items.map((it, i) =>
                it.kind === "pause" ? (
                  <PauseCard key={it.id} p={it} t0={root.start_ns} onOpen={setSel} selected={sel} />
                ) : (
                  <ChapterRow
                    key={it.id}
                    c={it}
                    t0={root.start_ns}
                    wallMs={chapterWall(it, story.items[i + 1])}
                    open={open.has(it.id)}
                    onToggle={() => toggle(it.id)}
                    onOpen={setSel}
                    selected={sel}
                  />
                ),
              )}
              <li className={`st-end ${running ? "is-running" : ""}`}>
                <span className="st-rail">
                  <span className="st-node">{running ? <i className="live-dot" /> : <Check size={12} strokeWidth={2.5} />}</span>
                </span>
                <span className="st-time">{clock(totalMs)}</span>
                <span className="st-end-text">{running ? "Still working" : "Done"}</span>
              </li>
            </ol>
            {!content.any ? (
              <p className="st-hint">
                Steps are grouped by the kind of work. Turn on content capture to see Claude's own words for each step, the questions it
                asked and its final reply. <Link href="/settings">How</Link>
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {selected ? (
          <PaneColumn key="pane">
            <DetailPane node={selected} trace={trace} findings={findings} content={content} onSelect={setSel} onClose={() => setSel(null)} />
          </PaneColumn>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

// Time into the turn as a clock: 0:19, 34:36, 1:02:05.
function clock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

function chapterWall(c: Chapter, next: StoryItem | undefined): number {
  const pause = next?.kind === "pause" ? next.ms : 0
  return Math.max((c.endNs - c.startNs) / 1e6 - pause, 0)
}

const SEGS: { key: string; label: string; cls: string; pick: (b: Breakdown) => number }[] = [
  { key: "wait", label: "Waiting on you", cls: "seg-wait", pick: (b) => b.permission_wait || 0 },
  { key: "model", label: "Claude thinking", cls: "seg-model", pick: (b) => (b.model || 0) + (b.retry || 0) },
  { key: "tool", label: "Running tools", cls: "seg-tool", pick: (b) => b.tool || 0 },
  { key: "other", label: "Other", cls: "seg-other", pick: (b) => (b.hook || 0) + (b.other || 0) + (b.permission_check || 0) },
]

function TimeBar({ bd, totalMs, onWait, hasPause }: { bd: Breakdown | null; totalMs: number; onWait: () => void; hasPause: boolean }) {
  if (!bd) return null
  const vals = SEGS.map((s) => ({ ...s, ms: s.pick(bd) })).filter((s) => s.ms > 0)
  const sum = vals.reduce((n, s) => n + s.ms, 0) || totalMs || 1
  return (
    <div className="st-time-bar" aria-label="Where the time went">
      <div className="st-bar">
        {vals.map((s) => (
          <i key={s.key} className={s.cls} style={{ width: `${(s.ms / sum) * 100}%` }} title={`${s.label}: ${dur(s.ms)}`} />
        ))}
      </div>
      <div className="st-legend">
        {vals.map((s) =>
          s.key === "wait" && hasPause ? (
            <button type="button" key={s.key} className="st-leg is-link" onClick={onWait}>
              <i className={s.cls} />
              {s.label} <b>{dur(s.ms)}</b>
            </button>
          ) : (
            <span key={s.key} className="st-leg">
              <i className={s.cls} />
              {s.label} <b>{dur(s.ms)}</b>
            </span>
          ),
        )}
      </div>
    </div>
  )
}

function ChapterRow({
  c,
  t0,
  wallMs,
  open,
  onToggle,
  onOpen,
  selected,
}: {
  c: Chapter
  t0: number
  wallMs: number
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  selected: string | null
}) {
  const summary = summarize(c.actions)
  const hasActs = c.actions.length > 0
  return (
    <li className={`st-ch ${open ? "is-open" : ""} ${c.errors ? "has-err" : ""}`} data-item={c.id}>
      <span className="st-rail">
        <span className="st-node">{c.errors ? <CircleAlert size={12} strokeWidth={2.5} /> : null}</span>
      </span>
      <span className="st-time">{clock((c.startNs - t0) / 1e6)}</span>
      <div className="st-ch-body">
        <button type="button" className="st-ch-head" onClick={hasActs ? onToggle : () => c.titleSpan && onOpen(c.titleSpan)} aria-expanded={hasActs ? open : undefined}>
          <span className={`st-title ${c.title ? "" : "is-auto"}`}>{c.title ? <MarkdownInline text={c.title} /> : summary || "Thinking"}</span>
          <span className="st-ch-meta">
            {dur(wallMs)}
            {c.cost >= 0.005 ? <> · {usd(c.cost)}</> : null}
          </span>
          {hasActs ? <ChevronRight size={14} className="st-caret" /> : <span className="st-caret" />}
        </button>
        {hasActs && !open ? (
          <div className="st-sub">
            {c.title ? summary : previewOf(c.actions)}
            {c.errors ? <span className="st-err-chip">{c.errors} failed</span> : null}
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {open ? (
            <motion.ul
              className="st-acts"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, visualDuration: 0.28 }}
            >
              {c.actions.map((a) => (
                <ActionRow key={a.span.span_id} a={a} onOpen={onOpen} selected={selected} depth={0} />
              ))}
              {c.thinkMs >= 1000 ? (
                <li className="st-think">
                  <Sparkles size={12} /> Claude spent {dur(c.thinkMs)} thinking in this step
                  {c.cost >= 0.005 ? <> · {usd(c.cost)}</> : null}
                </li>
              ) : null}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      </div>
    </li>
  )
}

function previewOf(actions: Action[]): string {
  const objs = actions.slice(0, 3).map((a) => a.object || a.verb)
  return objs.join(", ") + (actions.length > 3 ? ` and ${actions.length - 3} more` : "")
}

function ActionRow({ a, onOpen, selected, depth }: { a: Action; onOpen: (id: string) => void; selected: string | null; depth: number }) {
  return (
    <li>
      <button
        type="button"
        className={`st-act ${a.error ? "is-err" : ""} ${selected === a.span.span_id ? "is-sel" : ""}`}
        style={depth ? { paddingLeft: 10 + depth * 18 } : undefined}
        onClick={() => onOpen(a.span.span_id)}
      >
        <span className={`glyph st-glyph ${glyphClass(a.span)}`}>
          <SpanIcon span={a.span} />
        </span>
        <span className="st-act-text">
          <span className="st-verb">{a.verb}</span>
          {a.object ? <span className={a.code ? "st-obj mono" : "st-obj"}> {a.object}</span> : null}
          {a.detail ? <span className="st-detail mono"> {a.detail}</span> : null}
        </span>
        {a.waitMs >= SHOW_WAIT_MS ? <span className="st-wait-chip">waited {dur(a.waitMs)} for you</span> : null}
        {a.error ? <span className="st-err-chip">failed</span> : null}
        <span className="st-act-dur">{dur(a.ms - a.waitMs)}</span>
      </button>
      {a.kids.length ? (
        <ul className="st-acts st-acts-nested">
          {a.kids.map((k) => (
            <ActionRow key={k.span.span_id} a={k} onOpen={onOpen} selected={selected} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function PauseCard({ p, t0, onOpen, selected }: { p: Pause; t0: number; onOpen: (id: string) => void; selected: string | null }) {
  const q = p.reason === "question"
  const Icon = q ? MessageCircleQuestion : ShieldQuestion
  const title = q
    ? `Claude waited ${dur(p.ms)} for ${p.qa.length > 1 ? "your answers" : "your answer"}`
    : `Claude waited ${dur(p.ms)} for you to approve ${p.action.verb.toLowerCase()} ${p.action.object}`
  return (
    <li className="st-pause" data-item={p.id}>
      <span className="st-rail">
        <span className="st-node">
          <Icon size={13} strokeWidth={2.25} />
        </span>
      </span>
      <span className="st-time">{clock((p.startNs - t0) / 1e6)}</span>
      <button type="button" className={`st-pause-card ${selected === p.action.span.span_id ? "is-sel" : ""}`} onClick={() => onOpen(p.action.span.span_id)}>
        <span className="st-pause-title">{title}</span>
        {p.qa.length ? (
          <dl className="st-qa">
            {p.qa.map(({ q: qq, a }) => (
              <div key={qq}>
                <dt>
                  <MarkdownInline text={qq} />
                </dt>
                {a ? (
                  <dd>
                    <MarkdownInline text={a} />
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        ) : (
          <span className="st-pause-sub">
            {q ? "Claude asked you a question and stopped until you answered." : "Nothing ran until you decided."}
          </span>
        )}
      </button>
    </li>
  )
}

function Clamp({ text, lines }: { text: string; lines: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > lines * 90 || text.split("\n").length > lines
  return (
    <div className="st-clamp">
      <div className={`st-reply ${open || !long ? "" : "is-clamped"}`} style={{ ["--lines" as string]: lines }}>
        <Markdown text={text} />
      </div>
      {long ? (
        <button type="button" className="st-more" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  )
}

