// A small line over the last N days. The last point is dotted so "today" is
// findable. Pure SVG, no axes: the number beside it carries the value.
export function Sparkline({ values, width = 96, height = 26, tone = "ink" }: { values: number[]; width?: number; height?: number; tone?: "ink" | "wait" | "model" }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 0)
  const pad = 2
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => (max <= 0 ? height - pad : height - pad - (v / max) * (height - pad * 2))
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
  const area = `${d} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`
  const last = values.length - 1
  return (
    <svg className={`spark spark-${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} className="spark-area" />
      <path d={d} className="spark-line" />
      <circle cx={x(last)} cy={y(values[last])} r="2.2" className="spark-dot" />
    </svg>
  )
}
