import type { TraceView } from "../../lib/traceView"

export function TraceViewSwitch({ view, onChange }: { view: TraceView; onChange: (v: TraceView) => void }) {
  return (
    <div className="seg seg-view" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={view === "story"} className={view === "story" ? "on" : ""} onClick={() => onChange("story")} title="What happened, step by step">
        Story
      </button>
      <button type="button" role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "on" : ""} onClick={() => onChange("timeline")} title="Every span on one time axis">
        Timeline
      </button>
    </div>
  )
}
