import { moneyParts } from "../lib/format"

export function Money({
  value,
  className = "",
}: {
  value: number | null | undefined
  className?: string
}) {
  const p = moneyParts(value)
  if (!p) return <span className={className}>—</span>
  return (
    <span className={`v4-money ${className}`.trim()}>
      {p.whole}
      {p.cents ? <span className="v4-cents">{p.cents}</span> : null}
    </span>
  )
}
