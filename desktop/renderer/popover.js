"use strict"

const api = window.aftertraceDesktop
const view = window.popoverView || {}

function el(id) {
  return document.getElementById(id)
}

function renderGlance(g) {
  const fresh = el("fresh")
  const kind = view.freshnessKind ? view.freshnessKind(g) : !g || !g.ok ? (g && g.error ? "offline" : "loading") : g.stale ? "stale" : "live"
  fresh.dataset.kind = kind
  fresh.textContent = (g && g.freshness) || (kind === "offline" ? "Engine offline" : "Starting…")

  const box = el("sessions")
  const sliced = view.sessionSlice ? view.sessionSlice((g && g.sessions) || []) : { shown: ((g && g.sessions) || []).slice(0, 3), more: 0, idle: !g || !(g.sessions || []).length }
  box.innerHTML = ""
  if (!g || !g.ok) {
    box.innerHTML = `<div class="empty">${kind === "offline" ? "Engine offline" : "Starting…"}</div>`
  } else if (sliced.idle) {
    box.innerHTML = `<div class="empty">${g.stale ? "Last known state is stale" : "Idle"}</div>`
  } else {
    for (const s of sliced.shown) {
      const row = document.createElement("div")
      row.className = "lane"
      const doing = document.createElement("div")
      doing.className = "doing"
      doing.textContent = s.doing || s.title || "Running"
      row.appendChild(doing)
      if (s.title && s.doing && s.title !== s.doing) {
        const t = document.createElement("div")
        t.className = "title"
        t.textContent = s.title
        row.appendChild(t)
      }
      box.appendChild(row)
    }
    if (sliced.more) {
      const more = document.createElement("div")
      more.className = "more"
      more.textContent = `+${sliced.more} more`
      box.appendChild(more)
    }
  }

  const spendRow = el("spend-row")
  const spend = el("spend")
  if (g && g.ok && g.todayLabel) {
    spendRow.hidden = false
    spend.textContent = g.todayLabel
  } else {
    spendRow.hidden = true
  }

  const finding = el("finding")
  if (g && g.ok && g.topFinding) {
    finding.hidden = false
    finding.textContent = g.topFinding
    finding.dataset.id = g.topFindingId || ""
  } else {
    finding.hidden = true
    finding.dataset.id = ""
  }
}

function renderUpdate(u) {
  const updates = el("updates")
  const restart = el("restart")
  const foot = view.updateFooter ? view.updateFooter(u) : { restart: false, label: "Check for updates", disabled: false }
  restart.hidden = !foot.restart
  if (foot.restart) {
    updates.hidden = true
    restart.textContent = foot.label
  } else {
    updates.hidden = false
    updates.disabled = Boolean(foot.disabled)
    updates.textContent = foot.label
  }
}

async function boot() {
  if (!api) return
  el("open").addEventListener("click", () => api.openDashboard("/"))
  el("settings").addEventListener("click", () => api.openDashboard("/settings"))
  el("finding").addEventListener("click", () => {
    const id = el("finding").dataset.id
    api.openDashboard(id ? `/findings?focus=${encodeURIComponent(id)}` : "/findings")
  })
  el("updates").addEventListener("click", () => api.checkUpdates())
  el("restart").addEventListener("click", () => api.restartToUpdate())
  el("quit").addEventListener("click", () => api.quitApp())
  const login = el("login")
  login.checked = await api.getOpenAtLogin()
  login.addEventListener("change", () => api.setOpenAtLogin(login.checked))
  api.onGlance(renderGlance)
  api.onUpdate(renderUpdate)
  const g = await api.getGlance()
  renderGlance(g)
  renderUpdate(await api.getUpdate())
}

window.aftertracePopover = { renderGlance, renderUpdate }
boot()
