export function FindingsSkeleton() {
  return (
    <>
      <div className="tb">
        <h1>Findings</h1>
      </div>
      <div className="body fsplit skel-page" aria-busy="true" aria-label="Loading findings">
        <div className="fcol">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="fr" key={i}>
              <span className="skel sk-line" style={{ width: 12, height: 12, borderRadius: 2 }} />
              <span className="skel sk-line" style={{ width: 140 + (i % 3) * 28 }} />
            </div>
          ))}
        </div>
        <div className="pad">
          <div className="skel sk-line" style={{ width: 280, height: 22 }} />
          <div className="skel" style={{ width: 120, height: 36, marginTop: 20 }} />
        </div>
      </div>
    </>
  )
}

export function HomeSkeleton() {
  return (
    <>
      <div className="tb">
        <h1>Today</h1>
      </div>
      <div className="body today skel-page" aria-busy="true" aria-label="Loading today">
        <div className="pad">
          <div className="skel sk-line" style={{ width: 88 }} />
          <div className="skel" style={{ height: 64, marginTop: 12 }} />
          <div className="skel" style={{ height: 10, marginTop: 24 }} />
        </div>
      </div>
    </>
  )
}

export function SessionsSkeleton() {
  return (
    <>
      <div className="tb">
        <h1>Sessions</h1>
      </div>
      <div className="body split skel-page" aria-busy="true" aria-label="Loading sessions">
        <div className="pad">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel sk-line" key={i} style={{ width: 220 + (i % 4) * 20, marginBottom: 14 }} />
          ))}
        </div>
      </div>
    </>
  )
}
