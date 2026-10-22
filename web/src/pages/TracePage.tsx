import { useEffect, useState } from "react"
import { useParams } from "wouter"
import { api } from "../lib/api"
import { hashFlag } from "../lib/replay"
import type { Finding, Trace } from "../lib/types"
import { Waterfall } from "../components/waterfall/Waterfall"
import { WaterfallSkeleton } from "../components/WaterfallSkeleton"
import { TurnStory } from "../components/story/TurnStory"
import { savedView, saveView, type TraceView } from "../lib/traceView"
import { isAppTrace } from "../lib/span"

function spanFromHash(): string | null {
  const h = window.location.hash || ""
  const hashQuery = h.includes("?") ? h.slice(h.indexOf("?") + 1) : ""
  const search = (window.location.search || "").replace(/^\?/, "")
  return new URLSearchParams(hashQuery || search).get("span")
}

function viewFromHash(): TraceView | null {
  const h = window.location.hash || ""
  const v = new URLSearchParams(h.includes("?") ? h.slice(h.indexOf("?") + 1) : "").get("view")
  return v === "story" || v === "timeline" ? v : null
}

export function TracePage() {
  const params = useParams<{ id: string }>()
  const [trace, setTrace] = useState<Trace | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [span, setSpan] = useState<string | null>(spanFromHash())
  const [view, setView] = useState<TraceView>(() => viewFromHash() ?? savedView())
  const skeleton = /(?:\?|&)skeleton=1/.test(window.location.hash) || window.location.search.includes("skeleton=1")

  useEffect(() => {
    const sync = () => setSpan(spanFromHash())
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [params.id])

  useEffect(() => {
    if (!params.id) return
    setTrace(null)
    setErr(null)
    Promise.all([api.trace(params.id), api.findings()])
      .then(([t, f]) => {
        if (!t.spans?.length) throw new Error("No spans for this trace yet.")
        setTrace(t)
        setFindings(f)
      })
      .catch((e: Error) => setErr(e.message))
  }, [params.id])

  // A running turn grows as spans arrive. Re-fetch it until Claude Code sends the turn's root span.
  const running = Boolean(trace?.in_progress)
  useEffect(() => {
    if (!running || !params.id) return
    const id = params.id
    const t = window.setInterval(() => {
      api.trace(id).then(setTrace).catch(() => {})
    }, 3000)
    return () => window.clearInterval(t)
  }, [running, params.id])

  if (err) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Go back to Sessions and pick another turn, or paste a known trace id after #/trace/.</div>
      </div>
    )
  }
  if (skeleton || !trace) return <WaterfallSkeleton />
  const replay = hashFlag("replay")
  const changeView = (v: TraceView) => {
    saveView(v)
    setView(v)
  }
  // A link to a span (finding evidence, an error) or a replay wants the time axis.
  // App traces are short and have no narration, so they open on it too.
  const story = view === "story" && !span && !replay && !isAppTrace(trace.service)
  if (story) return <TurnStory trace={trace} findings={findings} view="story" onView={changeView} />
  return (
    <Waterfall
      traceView={isAppTrace(trace.service) ? undefined : "timeline"}
      onView={changeView}
      key={`${trace.trace_id}:${span || ""}:${replay ? "r" : ""}`}
      trace={trace}
      findings={findings}
      initialSpan={span}
      replay={replay}
    />
  )
}
