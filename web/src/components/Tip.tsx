export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="tip" tabIndex={0}>
      {children}
      <span className="tip-bubble" role="tooltip">
        {label}
      </span>
    </span>
  )
}

export const EFFORT_TIP =
  "Effort is Claude’s thinking budget: none / low / medium / high / xhigh / max. Higher effort usually means more tokens and a longer TTFT."

export const CACHE_TIP =
  "Cache hit is cache-read tokens ÷ (input + cache-read + cache-write). A drop to 0% after compaction or a model switch is expected once."
