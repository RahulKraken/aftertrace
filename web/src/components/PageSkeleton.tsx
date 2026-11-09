/** First-paint placeholders. Never the word “Loading…”. */

export function FindingsSkeleton() {
  const rows = [72, 54, 88, 40, 63, 31, 77, 48]
  return (
    <div className="v4 split findings v4-skel" aria-busy="true" aria-label="Loading findings">
      <div className="col">
        <div className="v4-ph">
          <h1>Findings</h1>
        </div>
        <div className="v4-dh">Money</div>
        {rows.map((w, i) => (
          <div className="v4-fr" key={i}>
            <i className="v4-mq" />
            <span className="sk sk-line" style={{ width: 110 + (i % 4) * 22 }} />
            <span className="sk sk-line" style={{ width: 44, justifySelf: "end" }} />
            <span className="trk">
              <i style={{ width: `${w}%` }} />
            </span>
            <span />
          </div>
        ))}
      </div>
      <aside className="v4-pane">
        <div className="v4-lbl">This</div>
        <div className="sk" style={{ height: 36, width: 128, marginTop: 10 }} />
        <div className="v4-strip" aria-hidden="true">
          <i style={{ height: 10 }} />
          <i style={{ height: 16 }} />
          <i style={{ height: 7 }} />
        </div>
        <div className="sk sk-line" style={{ width: "70%", marginTop: 28 }} />
        <div className="sk sk-line" style={{ width: "52%", marginTop: 10 }} />
      </aside>
    </div>
  )
}

export function HomeSkeleton() {
  return (
    <div className="v4 v4-skel" aria-busy="true" aria-label="Loading overview">
      <div className="v4-ph">
        <h1>Overview</h1>
      </div>
      <section className="v4-card" style={{ padding: 20 }}>
        <div className="sk sk-line" style={{ width: 88 }} />
        <div className="sk" style={{ height: 36, width: 160, marginTop: 12 }} />
        <div className="v4-strip" aria-hidden="true" style={{ marginTop: 20 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} style={{ height: 6 + ((i * 5) % 14) }} />
          ))}
        </div>
      </section>
    </div>
  )
}

export function SessionsSkeleton() {
  const rows = [8, 7, 6, 8, 5, 7, 4, 6]
  return (
    <div className="v4 split sessions v4-skel" aria-busy="true" aria-label="Loading sessions">
      <div className="col">
        <div className="v4-ph">
          <h1>Sessions</h1>
        </div>
        {rows.map((n, i) => (
          <div className="v4-rr" key={i}>
            <i className="v4-mq" />
            <span className="sk sk-line" style={{ width: 52 }} />
            <span className="sk sk-line" style={{ width: 36 }} />
            <span className="sk sk-line" style={{ width: 90 + n * 8 }} />
            <span />
            <span />
            <span className="sk sk-line" style={{ width: 40 }} />
            <span />
          </div>
        ))}
      </div>
      <aside className="v4-pane">
        <div className="sk sk-line" style={{ width: 160 }} />
        <div className="sk sk-line" style={{ width: "64%", marginTop: 14 }} />
        <div className="sk sk-line" style={{ width: "48%", marginTop: 10 }} />
      </aside>
    </div>
  )
}
