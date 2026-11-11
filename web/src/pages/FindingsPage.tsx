import { useCallback, useEffect, useState } from "react"
import { CaretRight, Copy } from "@phosphor-icons/react"
import { Link } from "wouter"
import { api, emptyMode } from "../lib/api"
import { readCached, writeCached } from "../lib/poll"
import { previewSkeleton } from "../lib/cache"
import { FindingsSkeleton } from "../components/PageSkeleton"
import { EmptyState } from "../components/EmptyState"
import { SearchField, Segmented, Toolbar } from "../lib/chrome"
import { useShell } from "../components/Shell"
import { dur, usd } from "../lib/format"
import { hashParam } from "../lib/hash"
import { fixFor, rankHero } from "../lib/fixes"
import { shortTitle } from "../lib/welcome"
import { monthlyUSD } from "../lib/welcome"
import type { Finding, Session } from "../lib/types"
import { findingKey, onWins, resolveFinding, resolvedKeys } from "../lib/wins"

type Tab = "open" | "resolved"

export function FindingsPage() {
  const { openCommand } = useShell()
  const [fs, setFs] = useState<Finding[] | null>(() => readCached<Finding[]>("aftertrace.findings"))
  const [sessions, setSessions] = useState<Session[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [resolved, setResolved] = useState(() => resolvedKeys())
  const [tab, setTab] = useState<Tab>("open")
  const [copied, setCopied] = useState(false)
  const [listFocus, setListFocus] = useState(true)
  const [focus, setFocus] = useState<number | null>(() => {
    const n = hashParam("focus")
    return n ? Number(n) : null
  })

  useEffect(() => {
    api.findings().then((rows) => {
      setFs(rows)
      writeCached("aftertrace.findings", rows)
      setErr(null)
    }).catch((e: Error) => {
      if (!fs) setErr(e.message)
    })
    api.sessions().then(setSessions).catch(() => undefined)
  }, [])

  useEffect(() => onWins(() => setResolved(resolvedKeys())), [])

  const copyFix = useCallback(async (f: Finding) => {
    const fx = fixFor(f)
    if (!fx) return
    try {
      await navigator.clipboard.writeText(fx.snippet)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = fx.snippet
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => {
      setCopied(false)
      resolveFinding(f)
      setFocus(null)
    }, 700)
  }, [])

  if (err && !fs) {
    return (
      <>
        <Toolbar title="Findings" />
        <EmptyState line="Aftertrace can't reach its engine. Restart it?" action="Reload" onClick={() => window.location.reload()} />
      </>
    )
  }
  if (previewSkeleton() || !fs) return <FindingsSkeleton />
  if (emptyMode() || !fs.length) {
    return (
      <>
        <Toolbar title="Findings">
          <SearchField onClick={openCommand} />
        </Toolbar>
        <EmptyState line="Nothing to change yet. Findings appear after a few sessions." action="Open Sessions" href="/sessions" />
      </>
    )
  }

  const open = fs.filter((f) => !resolved.has(findingKey(f)))
  const done = fs.filter((f) => resolved.has(findingKey(f)))
  const money = open.filter((f) => f.impact_unit.startsWith("USD")).sort((a, b) => monthlyUSD(b) - monthlyUSD(a))
  const time = open.filter((f) => isTime(f))
  const setup = open.filter((f) => !f.impact_unit.startsWith("USD") && !isTime(f))
  const list = tab === "open" ? open : done
  const hero = list.find((f) => f.id === focus) || (tab === "open" ? rankHero(open) : done[0])
  const moneyTotal = money.reduce((a, f) => a + monthlyUSD(f), 0)
  const timeTotal = time.reduce((a, f) => a + f.impact_value, 0)

  return (
    <>
      <Toolbar title="Findings" sub={`${open.length} open`}>
        <Segmented
          ariaLabel="Status"
          value={tab}
          options={[
            { id: "open", label: "Open" },
            { id: "resolved", label: "Resolved" },
          ]}
          onChange={setTab}
        />
        <SearchField onClick={openCommand} />
      </Toolbar>
      <div className="body fsplit">
        <div
          className="fcol"
          onFocus={() => setListFocus(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setListFocus(false)
          }}
        >
          {tab === "open" ? (
            <>
              <Group label="Money" value={usd(moneyTotal) + " a month"} rows={money} hero={hero} focus={listFocus} onFocus={setFocus} />
              <Group label="Your time" value={dur(timeTotal * 1000)} rows={time} hero={hero} focus={listFocus} onFocus={setFocus} />
              <Group label="Setup" value="" rows={setup} hero={hero} focus={listFocus} onFocus={setFocus} />
            </>
          ) : done.length ? (
            <Group label="Resolved" value="" rows={done} hero={hero} focus={listFocus} onFocus={setFocus} resolved />
          ) : (
            <p className="l2" style={{ padding: 12 }}>
              Nothing resolved yet. Copy a fix to move it here.
            </p>
          )}
        </div>
        <div className="pad">
          <FindingDetail f={hero} sessions={sessions} copied={copied} onCopy={() => hero && copyFix(hero)} />
        </div>
      </div>
    </>
  )
}

function Group({
  label,
  value,
  rows,
  hero,
  focus,
  onFocus,
  resolved,
}: {
  label: string
  value: string
  rows: Finding[]
  hero?: Finding | null
  focus: boolean
  onFocus: (id: number) => void
  resolved?: boolean
}) {
  if (!rows.length) return null
  return (
    <>
      <div className="fg-h">
        <span>{label}</span>
        <span className={`n${label === "Money" ? " amb" : ""}`}>{value}</span>
      </div>
      {rows.map((f) => {
        const on = hero?.id === f.id
        return (
          <button
            type="button"
            key={f.id}
            className={`fr${on ? (focus ? " sel" : " sel-quiet") : ""}${resolved ? " resolved" : ""}`}
            data-finding={f.id}
            onClick={() => onFocus(f.id)}
          >
            <span className={`sw ${swatch(f)}`} />
            <span className="t">{titleOf(f)}</span>
            <span className={`v n${f.impact_unit.startsWith("USD") ? " amb" : ""}`}>{valueOf(f)}</span>
          </button>
        )
      })}
    </>
  )
}

function FindingDetail({
  f,
  sessions,
  copied,
  onCopy,
}: {
  f?: Finding | null
  sessions: Session[]
  copied: boolean
  onCopy: () => void
}) {
  if (!f) {
    return <div className="fdet l2">Pick a finding.</div>
  }
  const fx = fixFor(f)
  const money = f.impact_unit.startsWith("USD")
  const waits = waitBars(f)
  const seen = f.sessions
    .map((id) => sessions.find((s) => s.session_id === id))
    .filter(Boolean) as Session[]
  return (
    <div className="fdet">
      <h2>
        {titleHead(f)}
        {monoBit(f) ? (
          <>
            {" "}
            <span className="mono-h">{monoBit(f)}</span>
          </>
        ) : null}
      </h2>
      <div className="l2">{f.detail}</div>
      <div className="impact">
        <span className={`big n${money || /wait/i.test(f.impact_unit) ? " amb" : ""}`}>
          {money ? usd(monthlyUSD(f) || f.impact_value) : dur(f.impact_value * 1000)}
        </span>
        <span className="l2">{money ? "a month" : impactCaption(f)}</span>
      </div>
      {waits.length > 0 && (
        <>
          <div className="label">Each wait</div>
          <div className="waits">
            {waits.map((w) => (
              <div className="wrow" key={w.label}>
                <span className="wl">{w.label}</span>
                <div className="wbar">
                  {w.parts.map((p, i) => (
                    <i key={i} style={{ flex: `${p.share} 0 0` }}>
                      <em className="n">{dur(p.ms)}</em>
                    </i>
                  ))}
                  {w.rest > 0 ? <b style={{ flex: `${w.rest} 0 0` }} /> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {fx ? (
        <>
          <div className="label" style={{ marginTop: 22 }}>
            {f.recommendation.split(".")[0]}.
          </div>
          <div className="code">{fx.snippet}</div>
          <div className="fact2">
            <button type="button" className={`btn pri copy-fix fix-btn${copied ? " is-copied" : ""}`} onClick={onCopy}>
              <Copy size={14} weight="regular" />
              {copied ? "Copied" : "Copy fix"}
            </button>
            <span className="l2 small">Restart Claude Code after saving.</span>
          </div>
        </>
      ) : (
        <p className="l2" style={{ marginTop: 18 }}>
          {f.recommendation}
        </p>
      )}
      <div className="label" style={{ marginTop: 24 }}>
        Seen in
      </div>
      <div className="list">
        {(seen.length
          ? seen.map((s) => ({
              key: s.session_id,
              href: `/session/${s.session_id}`,
              title: s.title || s.session_id,
              when: s.start_ns ? shortDate(s.start_ns) : "",
            }))
          : f.evidence.slice(0, 4).map((e, i) => ({
              key: `${e.trace_id}:${e.span_id || i}`,
              href: `/trace/${e.trace_id}`,
              title: evidenceTitle(e.label),
              when: "",
            }))
        ).map((s) => (
          <Link key={s.key} href={s.href} className="li">
            <span className="dot idle" />
            <div className="t">
              <div>{s.title}</div>
            </div>
            <span className="l2 small n">{s.when}</span>
            <CaretRight className="chev" />
          </Link>
        ))}
      </div>
    </div>
  )
}

function isTime(f: Finding) {
  return f.impact_unit.startsWith("s ") || /wait|stall|retry|lost/i.test(f.impact_unit)
}

function titleOf(f: Finding) {
  return shortTitle(f)
}

function titleHead(f: Finding) {
  if (f.rule_id === "permission.allow_rule_candidate") {
    const h = f.headline.replace(/, all approved$/, "")
    return h.replace(/\s*Bash\([^)]+\)/, "").trim()
  }
  return titleOf(f)
}

function monoBit(f: Finding) {
  const m = f.headline.match(/Bash\([^)]+\)/)
  return m ? m[0] : ""
}

function valueOf(f: Finding) {
  if (f.impact_unit.startsWith("USD")) return usd(monthlyUSD(f) || f.impact_value)
  if (isTime(f)) return dur(f.impact_value * 1000)
  if (f.sessions.length) return `${f.sessions.length} session${f.sessions.length === 1 ? "" : "s"}`
  return String(f.impact_value)
}

function impactCaption(f: Finding) {
  if (/wait/i.test(f.impact_unit)) return "spent waiting on you"
  if (/retry|stall/i.test(f.impact_unit)) return f.impact_unit.replace(/^s\s*/, "")
  return f.impact_unit
}

function swatch(f: Finding) {
  if (f.impact_unit.startsWith("USD")) return "money"
  if (/wait/i.test(f.impact_unit) || f.rule_id.includes("permission")) return "t-wait"
  if (/retry/i.test(f.rule_id) || /retry/i.test(f.impact_unit)) return "t-retry"
  if (f.rule_id.includes("hook")) return "t-hook"
  return "t-other"
}

function waitBars(f: Finding) {
  if (!/wait/i.test(f.impact_unit) || !f.evidence.length) return []
  const evidenceMs = (e: { label: string }) => Number((e.label.match(/([\d.]+)/) || [])[1] || 0) * 1000
  const sess = f.sessions
  const tot = Math.max(f.evidence.reduce((a, e) => a + evidenceMs(e), 0), 1)
  if (sess.length <= 1) {
    const ms = f.evidence.map(evidenceMs)
    return [{ label: titleOf(f), parts: ms.map((n) => ({ ms: n, share: n / tot })), rest: 0 }]
  }
  const per = Math.ceil(f.evidence.length / sess.length)
  return sess.map((id, i) => {
    const slice = f.evidence.slice(i * per, (i + 1) * per)
    const ms = slice.map(evidenceMs)
    const sum = ms.reduce((a, b) => a + b, 0)
    return {
      label: slice[0]?.label.replace(/waited\s+/i, "") || id,
      parts: ms.map((n) => ({ ms: n, share: n / tot })),
      rest: Math.max(0, 1 - sum / tot),
    }
  })
}

function shortDate(ns: number) {
  return new Date(ns / 1e6).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

function evidenceTitle(label: string) {
  const m = label.match(/\$([0-9.]+)/)
  if (m) return usd(Number(m[1]))
  return label
}
