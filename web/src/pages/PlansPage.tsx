import { useEffect, useMemo, useState } from "react"
import { siAnthropic, siCursor, siGithub, siGooglegemini, siPerplexity, siX } from "simple-icons"
import type { SimpleIcon } from "simple-icons"
import { BrandIcon } from "../components/BrandIcon"
import { Num } from "../components/Num"
import { api } from "../lib/api"
import { usd } from "../lib/format"
import { useToast } from "../lib/toast"
import type { BillingPeriod, CatalogPlan, PlansLedger, Subscription } from "../lib/types"

const ICONS: Record<string, SimpleIcon> = {
  anthropic: siAnthropic,
  google: siGooglegemini,
  xai: siX,
  perplexity: siPerplexity,
  github: siGithub,
  cursor: siCursor,
}

type Mode = "list" | "pick" | "confirm" | "custom" | "edit"

export function PlansPage() {
  const [d, setD] = useState<PlansLedger | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("list")
  const [vendor, setVendor] = useState<string | null>(null)
  const [picked, setPicked] = useState<CatalogPlan | null>(null)
  const [editing, setEditing] = useState<Subscription | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const toast = useToast()

  const load = () =>
    api
      .subscriptions()
      .then((x) => {
        setD(x)
        setErr(null)
      })
      .catch((e: Error) => setErr(e.message))

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (mode !== "list") {
        setMode("list")
        setPicked(null)
        setEditing(null)
        e.preventDefault()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode])

  const vendors = useVendors(d?.catalog ?? [])

  if (err && !d) {
    return (
      <div className="page">
        {err}
        <div className="err-next">Reload. Plans live in the same DuckDB file as your traces.</div>
      </div>
    )
  }
  if (!d) return <div className="page mute">Loading what you pay for…</div>

  const active = d.subscriptions.filter((s) => s.status === "active")
  const cancelled = d.subscriptions.filter((s) => s.status === "cancelled")
  const sum = d.summary

  const addFromCatalog = async (plan: CatalogPlan, price: number | null, renewal: number | null, start: string) => {
    try {
      await api.addSubscription({
        catalog_id: plan.id,
        price,
        renewal_day: renewal,
        start_date: start || undefined,
      })
      toast(`Added ${plan.plan_name}`)
      setMode("list")
      setPicked(null)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add")
      throw e
    }
  }

  return (
    <div className="page plans">
      <h1>Plans</h1>
      <div className="sub">Everything you pay for AI. Stays on this machine.</div>

      <div className="plans-hero">
        <div className="stat-label">This month</div>
        <div className="plans-total" aria-live="polite">
          <Num value={sum.total_usd} format={usd} />
        </div>
        <div className="plans-hero-sub">
          {sum.usage_usd > 0 ? (
            <span>
              {usd(sum.monthly_usd)} in plans
              {sum.usage.map((u) => (
                <span key={u.kind}>
                  {" "}
                  · {usd(u.usd)} {u.label}
                </span>
              ))}
            </span>
          ) : sum.unpriced > 0 ? (
            <span>{sum.unpriced === 1 ? "One plan has no price yet." : `${sum.unpriced} plans have no price yet.`}</span>
          ) : active.length === 0 ? (
            <span>Nothing listed. Tick a plan you pay for.</span>
          ) : (
            <span>
              {active.length} {active.length === 1 ? "plan" : "plans"}
              {sum.usage_based ? ` · ${sum.usage_based} usage-based` : ""}
            </span>
          )}
        </div>
        {sum.next_renewal && (
          <div className="plans-next">
            Next: {sum.next_renewal.plan_name} on {fmtDay(sum.next_renewal.on)}
            {sum.next_renewal.in_days === 0 ? " · today" : sum.next_renewal.in_days === 1 ? " · tomorrow" : ` · in ${sum.next_renewal.in_days} days`}
          </div>
        )}
      </div>

      {mode === "list" && (
        <>
          <div className="plans-actions">
            <button type="button" className="btn" onClick={() => setMode("pick")}>
              Add a plan
            </button>
          </div>
          {active.length > 0 && (
            <ul className="plans-list">
              {active.map((s) => (
                <li key={s.id}>
                  <button type="button" className="plans-row" onClick={() => { setEditing(s); setMode("edit") }}>
                    <VendorMark brand={s.brand || ""} />
                    <span className="plans-row-main">
                      <span className="plans-row-name">{s.plan_name}</span>
                      <span className="mute">{s.vendor}{s.billing_period === "usage" ? " · usage" : s.billing_period === "yearly" ? " · yearly" : ""}</span>
                    </span>
                    <span className="plans-row-amt num">{s.billing_period === "usage" ? "usage" : s.monthly_usd != null ? `${usd(s.monthly_usd)}/mo` : "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {cancelled.length > 0 && (
            <div className="plans-cancelled">
              <div className="stat-label">Cancelled</div>
              {cancelled.map((s) => (
                <div key={s.id} className="plans-row is-quiet">
                  <VendorMark brand={s.brand || ""} />
                  <span className="plans-row-main">
                    <span className="plans-row-name">{s.plan_name}</span>
                    <span className="mute">{s.cancelled_at ? `ended ${fmtDay(s.cancelled_at)}` : "cancelled"}</span>
                  </span>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    onClick={async () => {
                      try {
                        await api.restoreSubscription(s.id)
                        toast(`Restored ${s.plan_name}`)
                        await load()
                      } catch (e) {
                        toast(e instanceof Error ? e.message : "Could not restore")
                      }
                    }}
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "pick" && (
        <PickCatalog
          vendors={vendors}
          vendor={vendor}
          onVendor={setVendor}
          onPick={(p) => {
            setPicked(p)
            setMode("confirm")
          }}
          onCustom={() => setMode("custom")}
          onBack={() => setMode("list")}
        />
      )}

      {mode === "confirm" && picked && (
        <ConfirmPlan
          plan={picked}
          onBack={() => setMode("pick")}
          onAdd={addFromCatalog}
        />
      )}

      {mode === "custom" && (
        <CustomPlan
          onBack={() => setMode("pick")}
          onAdd={async (body) => {
            try {
              await api.addSubscription(body)
              toast("Added")
              setMode("list")
              await load()
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not add")
              throw e
            }
          }}
        />
      )}

      {mode === "edit" && editing && (
        <EditPlan
          sub={editing}
          confirming={confirming === editing.id}
          onConfirming={setConfirming}
          onBack={() => {
            setMode("list")
            setEditing(null)
            setConfirming(null)
          }}
          onSave={async (body) => {
            try {
              await api.updateSubscription(editing.id, body)
              toast("Saved")
              setMode("list")
              setEditing(null)
              await load()
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not save")
              throw e
            }
          }}
          onCancel={async () => {
            try {
              await api.cancelSubscription(editing.id)
              toast(`${editing.plan_name} cancelled`)
              setMode("list")
              setEditing(null)
              setConfirming(null)
              await load()
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not cancel")
              throw e
            }
          }}
        />
      )}
    </div>
  )
}

function useVendors(catalog: CatalogPlan[]) {
  return useMemo(() => {
    const order: string[] = []
    const map = new Map<string, CatalogPlan[]>()
    for (const p of catalog) {
      if (!map.has(p.vendor)) {
        order.push(p.vendor)
        map.set(p.vendor, [])
      }
      map.get(p.vendor)!.push(p)
    }
    return order.map((v) => ({ vendor: v, brand: map.get(v)![0].brand, plans: map.get(v)! }))
  }, [catalog])
}

function PickCatalog({
  vendors,
  vendor,
  onVendor,
  onPick,
  onCustom,
  onBack,
}: {
  vendors: { vendor: string; brand: string; plans: CatalogPlan[] }[]
  vendor: string | null
  onVendor: (v: string) => void
  onPick: (p: CatalogPlan) => void
  onCustom: () => void
  onBack: () => void
}) {
  const group = vendors.find((v) => v.vendor === vendor)
  return (
    <div className="plans-pick">
      <div className="sec-hd">
        <h2>Tick what you pay for</h2>
        <button type="button" className="sec-link" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="plans-vendors" role="listbox" aria-label="Vendors">
        {vendors.map((v) => (
          <button
            type="button"
            key={v.vendor}
            role="option"
            aria-selected={vendor === v.vendor}
            className={`plans-vendor${vendor === v.vendor ? " on" : ""}`}
            onClick={() => onVendor(v.vendor)}
          >
            <VendorMark brand={v.brand} size={18} />
            {v.vendor}
          </button>
        ))}
      </div>
      {group && (
        <ul className="plans-list">
          {group.plans.map((p) => (
            <li key={p.id}>
              <button type="button" className="plans-row is-plain" onClick={() => onPick(p)}>
                <span className="plans-row-main">
                  <span className="plans-row-name">{p.plan_name}</span>
                  <span className="mute">{periodLabel(p)}</span>
                </span>
                <span className="plans-row-amt num">{priceLabel(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="plans-custom" onClick={onCustom}>
        Something else
      </button>
    </div>
  )
}

function ConfirmPlan({
  plan,
  onBack,
  onAdd,
}: {
  plan: CatalogPlan
  onBack: () => void
  onAdd: (p: CatalogPlan, price: number | null, renewal: number | null, start: string) => Promise<void>
}) {
  const [price, setPrice] = useState(plan.price == null ? "" : String(plan.price))
  const [renewal, setRenewal] = useState("")
  const [start, setStart] = useState("")
  const [busy, setBusy] = useState(false)
  const unverified = plan.price == null
  return (
    <form
      className="plans-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const p = price.trim() === "" ? null : Number(price)
          await onAdd(plan, p != null && Number.isFinite(p) ? p : null, numOrNull(renewal) ?? todayDay(), start)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="sec-hd">
        <h2>Confirm the price</h2>
        <button type="button" className="sec-link" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="plans-confirm-name">
        <VendorMark brand={plan.brand} size={18} />
        {plan.vendor} · {plan.plan_name}
      </div>
      {unverified ? (
        <p className="mute">The official page we checked does not list a price. Enter what you pay, or leave it blank.</p>
      ) : (
        <p className="mute">
          Listed {priceLabel(plan)}. Change it if yours is different.{" "}
          <a href={plan.source_url} target="_blank" rel="noreferrer">
            Source
          </a>
          , checked {fmtDay(plan.sourced_at)}.
        </p>
      )}
      {plan.notes && <p className="mute">{plan.notes}</p>}
      <label className="plans-field">
        Price ({plan.currency})
        <input className="txt" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus />
      </label>
      {plan.billing_period !== "usage" && (
        <label className="plans-field">
          Renews on day
          <input className="txt" inputMode="numeric" min={1} max={31} placeholder="today" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </label>
      )}
      <label className="plans-field">
        Started (optional)
        <input className="txt" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <button type="submit" className="btn" disabled={busy}>
        Add
      </button>
    </form>
  )
}

function CustomPlan({ onBack, onAdd }: { onBack: () => void; onAdd: (body: Record<string, unknown>) => Promise<void> }) {
  const [vendor, setVendor] = useState("")
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")
  const [period, setPeriod] = useState<BillingPeriod>("monthly")
  const [renewal, setRenewal] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="plans-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onAdd({
            vendor,
            plan_name: name,
            price: price.trim() === "" ? null : Number(price),
            billing_period: period,
            renewal_day: period === "usage" ? null : (numOrNull(renewal) ?? todayDay()),
            currency: "USD",
            usage_kind: "none",
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="sec-hd">
        <h2>Something else</h2>
        <button type="button" className="sec-link" onClick={onBack}>
          Back
        </button>
      </div>
      <label className="plans-field">
        Vendor
        <input className="txt" value={vendor} onChange={(e) => setVendor(e.target.value)} required autoFocus />
      </label>
      <label className="plans-field">
        Plan
        <input className="txt" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="plans-field">
        Price (USD)
        <input className="txt" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="plans-field">
        Billing
        <select value={period} onChange={(e) => setPeriod(e.target.value as BillingPeriod)}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="usage">Usage-based</option>
        </select>
      </label>
      {period !== "usage" && (
        <label className="plans-field">
          Renews on day
          <input className="txt" inputMode="numeric" placeholder="today" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </label>
      )}
      <button type="submit" className="btn" disabled={busy || !vendor.trim() || !name.trim()}>
        Add
      </button>
    </form>
  )
}

function EditPlan({
  sub,
  confirming,
  onConfirming,
  onBack,
  onSave,
  onCancel,
}: {
  sub: Subscription
  confirming: boolean
  onConfirming: (id: string | null) => void
  onBack: () => void
  onSave: (body: Record<string, unknown>) => Promise<void>
  onCancel: () => Promise<void>
}) {
  const [price, setPrice] = useState(sub.price == null ? "" : String(sub.price))
  const [name, setName] = useState(sub.plan_name)
  const [renewal, setRenewal] = useState(sub.renewal_day == null ? "" : String(sub.renewal_day))
  const [notes, setNotes] = useState(sub.notes || "")
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="plans-form"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSave({
            plan_name: name,
            price: price.trim() === "" ? null : Number(price),
            renewal_day: numOrNull(renewal),
            notes,
            billing_period: sub.billing_period,
            vendor: sub.vendor,
          })
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="sec-hd">
        <h2>Edit</h2>
        <button type="button" className="sec-link" onClick={onBack}>
          Back
        </button>
      </div>
      <div className="plans-confirm-name">
        <VendorMark brand={sub.brand || ""} size={18} />
        {sub.vendor} · {sub.plan_name}
      </div>
      <label className="plans-field">
        Plan name
        <input className="txt" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="plans-field">
        Price ({sub.currency})
        <input className="txt" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {sub.billing_period !== "usage" && (
        <label className="plans-field">
          Renews on day
          <input className="txt" inputMode="numeric" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </label>
      )}
      <label className="plans-field">
        Notes
        <input className="txt" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="plans-form-actions">
        <button type="submit" className="btn" disabled={busy}>
          Save
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn ghost" onClick={onCancel}>
              Confirm cancel
            </button>
            <button type="button" className="sec-link" onClick={() => onConfirming(null)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost" onClick={() => onConfirming(sub.id)}>
            Cancel plan
          </button>
        )}
      </div>
    </form>
  )
}

function VendorMark({ brand, size = 16 }: { brand: string; size?: number }) {
  const icon = ICONS[brand]
  return (
    <span className="plans-mark" aria-hidden="true">
      {icon ? <BrandIcon icon={icon} size={size} /> : <span className="plans-letter">{(brand || "?").slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}

function periodLabel(p: CatalogPlan): string {
  if (p.billing_period === "yearly") return "yearly"
  if (p.billing_period === "usage") return "usage"
  return "monthly"
}

function priceLabel(p: CatalogPlan): string {
  if (p.price == null) return "enter price"
  if (p.billing_period === "yearly") return `${usd(p.price)}/yr`
  if (p.billing_period === "usage") return "usage"
  return `${usd(p.price)}/mo`
}

function fmtDay(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""))
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function numOrNull(s: string): number | null {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

function todayDay(): number {
  return new Date().getDate()
}
