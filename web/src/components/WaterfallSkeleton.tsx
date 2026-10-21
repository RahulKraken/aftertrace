export function WaterfallSkeleton() {
  const rows = [100, 42, 28, 55, 18, 70, 22, 48, 12, 36, 8, 24]
  return (
    <div className="wf skel" aria-busy="true" aria-label="Loading waterfall">
      <div className="wf-main">
        <div className="wf-head">
          <div className="sk sk-line" style={{ width: 220 }} />
          <div className="sk sk-title" />
          <div className="sk sk-line" style={{ width: 220, marginTop: 10 }} />
        </div>
        <div className="wf-body">
          <div className="ruler">
            <div className="lab">span</div>
            <div className="trk" />
          </div>
          <div className="rows">
            {rows.map((w, i) => (
              <div className="row" key={i} style={{ position: "relative" }}>
                <div className="lab">
                  <span className="sk sk-chip" />
                  <span className="sk sk-name" style={{ width: 80 + (i % 5) * 18 }} />
                </div>
                <div className="trk">
                  <span className="sk sk-bar" style={{ left: `${8 + (i % 6) * 7}%`, width: `${w * 0.4}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <aside className="pane">
        <div className="sk sk-title" />
        <div className="sk sk-line" style={{ width: "80%", marginTop: 12 }} />
        <div className="sk sk-line" style={{ width: "60%", marginTop: 8 }} />
      </aside>
    </div>
  )
}
