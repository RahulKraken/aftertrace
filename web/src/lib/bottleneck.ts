import { dur } from "./format"
import type { Finding, Span, Trace } from "./types"

export type BottleneckMark = {
  spanId: string
  label: string
  finding: Finding
}

function evidenceOnTrace(f: Finding, traceId: string) {
  return f.evidence.find((e) => e.trace_id === traceId)
}

function labelFor(f: Finding, span: Span | undefined): string {
  const waitMs = span?.duration_ms ?? f.impact_value * 1000
  if (f.rule_id === "permission.allow_rule_candidate") {
    return `waited ${dur(waitMs).replace(/\.0s$/, "s")} on approval`
  }
  if (f.rule_id.startsWith("retry.")) {
    return `${dur(waitMs)} lost to retries`
  }
  if (f.rule_id === "tool.repeated_errors") {
    return `${dur(waitMs)} on a failing run`
  }
  if (f.rule_id === "hook.overhead") {
    return `${dur(waitMs)} in hooks`
  }
  return f.headline
}

/** Biggest bottleneck finding that cites this turn, pinned to its evidence span. */
export function bottleneckFor(trace: Trace, findings: Finding[]): BottleneckMark | null {
  const cited = findings.filter((f) => f.pillar === "bottleneck" && evidenceOnTrace(f, trace.trace_id))
  if (!cited.length) return null
  cited.sort((a, b) => b.impact_value - a.impact_value)
  const finding = cited[0]
  const ev = evidenceOnTrace(finding, trace.trace_id)
  if (!ev) return null
  const span = trace.spans.find((s) => s.span_id === ev.span_id)
  return { spanId: ev.span_id, label: labelFor(finding, span), finding }
}
