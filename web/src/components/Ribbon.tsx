import { dur } from "../lib/format"
import { partsList, partsTotal, type RibbonParts } from "../lib/ribbon"

export function Ribbon({
  parts,
  length,
  live,
  tall,
  className = "",
}: {
  parts: RibbonParts
  length?: number
  live?: boolean
  tall?: boolean
  className?: string
}) {
  const total = partsTotal(parts)
  const items = partsList(parts)
  const width = length != null ? `${Math.max(2.8, Math.min(100, length * 100))}%` : undefined
  return (
    <div className={`lane-rib${live ? " is-live" : ""}`} style={width ? { width } : undefined}>
      <div className={`rib${tall ? " tall" : ""} ${className}`.trim()} role="img" aria-label="Where time went">
        {items.length ? (
          items.map((x) => <i key={x.key} className={x.cls} style={{ flex: `${total ? x.ms / total : 0} 0 0` }} />)
        ) : (
          <i className="t-other" style={{ flex: "1 0 0" }} />
        )}
      </div>
      {live ? <span className="head" /> : null}
    </div>
  )
}

export function RibbonKey({ parts }: { parts: RibbonParts }) {
  const items = partsList(parts)
  if (!items.length) return null
  return (
    <div className="key">
      {items.map((x) => (
        <span key={x.key}>
          <i className={x.cls} />
          {x.label} <b>{dur(x.ms)}</b>
        </span>
      ))}
    </div>
  )
}
