export function Meter({
  fill,
  time = false,
  left,
  right,
}: {
  fill: number
  time?: boolean
  left?: string
  right?: React.ReactNode
}) {
  const w = Math.max(0, Math.min(100, fill * 100))
  return (
    <div className="v4-meter">
      <div className={`v4-trk${time ? " time" : ""}`}>
        <i style={{ width: `${w}%` }} />
      </div>
      {(left || right) && (
        <div className="v4-rs">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  )
}
