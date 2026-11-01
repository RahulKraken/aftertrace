export function TraceLine({
  values,
  width = 220,
  height = 20,
  live = false,
  flag = false,
  peak,
  tail = 0.3,
  sw = 1.2,
  r = 2.5,
}: {
  values: number[]
  width?: number
  height?: number
  live?: boolean
  flag?: boolean
  peak?: string
  tail?: number
  sw?: number
  r?: number
}) {
  const v = values.length ? values : [0]
  const max = Math.max(...v, 1e-9)
  const mid = height / 2
  const end = width - r - 1
  const run = end - r * 3
  const step = (run * (1 - tail)) / (v.length + 1)
  let d = `M${sw} ${mid}`
  let pk: [number, number] | null = null
  const peakVal = Math.max(...v)
  v.forEach((x, i) => {
    const a = Math.max(0.5, (x / max) * (mid - sw - 0.5))
    const X = sw + step * (i + 1)
    const Y = mid + (i % 2 ? a : -a)
    d += ` L${X.toFixed(1)} ${Y.toFixed(1)}`
    if (peak && x === peakVal) pk = [X, Y]
  })
  d += ` L${end - r - 2} ${mid}`
  return (
    <svg
      className="v4-tr"
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="var(--t1)" strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" vectorEffect="nonScalingStroke" />
      {live ? <circle cx={end} cy={mid} r={r + 4} fill="var(--t1)" opacity={0.12} /> : null}
      {pk ? (
        <>
          <circle cx={pk[0]} cy={pk[1]} r="3.5" fill="var(--surface)" stroke="var(--t1)" strokeWidth="1.4" />
          <text x={pk[0] + 9} y={pk[1] + 4} className="v4-peak">
            {peak}
          </text>
        </>
      ) : null}
      <circle cx={end} cy={mid} r={r} fill={flag ? "var(--amber)" : "var(--t1)"} />
    </svg>
  )
}
