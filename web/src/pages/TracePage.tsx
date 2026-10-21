import { useEffect, useState } from "react"
import { useParams } from "wouter"
import { api } from "../lib/api"
import { hashFlag } from "../lib/replay"
import type { Finding, Trace } from "../lib/types"
import { Waterfall } from "../components/waterfall/Waterfall"
import { WaterfallSkeleton } from "../components/WaterfallSkeleton"

function spanFromHash(): string | null {
  const h = window.location.hash || ""
  const hashQuery = h.includes("?") ? h.slice(h.indexOf("?") + 1) : ""
  const search = (window.location.search || "").replace(/^\?/, "")
  return new URLSearchParams(hashQuery || search).get("span")
}

export function TracePage() {
  const params = useParams<{ id: string }>()
  const [trace, setTrace] = useState<Trace | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [span, setSpan] = useState<string | null>(spanFromHash())
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
    Promise.all([api.trace(params.id), api.findings()])
      .then(([t, f]) => {
        setTrace(t)
        setFindings(f)
      })
      .catch((e: Error) => setErr(e.message))
  }, [params.id])

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
  return (
    <Waterfall
      key={`${trace.trace_id}:${span || ""}:${replay ? "r" : ""}`}
      trace={trace}
      findings={findings}
      initialSpan={span}
      replay={replay}
    />
  )
}
