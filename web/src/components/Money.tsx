import { usd } from "../lib/format"

export function Money({
  value,
  className = "",
}: {
  value: number | null | undefined
  className?: string
}) {
  return <span className={`n ${className}`.trim()}>{usd(value)}</span>
}
