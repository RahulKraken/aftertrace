// Web unit tests. Loads TS through Vite (already a dependency) so we do not
// add a test runner. Covers spoken formatters and first-open copy.
import { createServer } from "vite"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const vite = await createServer({
  root,
  configFile: resolve(root, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "custom",
})

const { dur, tok, usd, sayDur, sayUsd, sayTok } = await vite.ssrLoadModule("/src/lib/format.ts")
const { actionSentence, moneyLabel } = await vite.ssrLoadModule("/src/lib/welcome.ts")
const { sessions } = await vite.ssrLoadModule("/src/mock/load.ts")
const { projectsInWindow } = await vite.ssrLoadModule("/src/mock/overview.ts")
await vite.close()

let failed = 0
function eq(got, want, label) {
  if (got !== want) {
    console.error(`fail ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
    failed++
  }
}

eq(sayDur(49 * 60_000), "49 min", "sayDur 49 min")
eq(sayDur(88_890), "1 min", "sayDur 89s")
eq(sayDur(12_000), "12s", "sayDur 12s")
eq(sayDur(3 * 3_600_000), "3h", "sayDur 3h")
eq(sayDur(3 * 3_600_000 + 12 * 60_000), "3h 12 min", "sayDur 3h 12 min")
eq(sayUsd(0.41), "41¢", "sayUsd 41¢")
eq(sayUsd(0.41, true), "41¢", "sayUsd 41¢ whole")
eq(sayUsd(12.4, true), "$12", "sayUsd $12")
eq(sayUsd(38.4, true), "$38", "sayUsd $38")
eq(sayUsd(12.4), "$12.40", "sayUsd $12.40")
eq(sayTok(12_400_000), "12M", "sayTok 12M")
eq(tok(12_400_000), "12.40M", "tok table still 12.40M")
eq(sayTok(1_400_000), "1.4M", "sayTok 1.4M")
eq(usd(0.41), "$0.410", "usd table exact")
eq(dur(49 * 60_000), "49m 0s", "dur table exact")

const opus = {
  id: 1,
  rule_id: "model.opus_downgrade",
  pillar: "cost",
  severity: "medium",
  headline: "aftertrace uses claude-opus-4-6 for 28-token turns with no tools",
  impact_value: 12.4,
  impact_unit: "USD",
  detail: "",
  recommendation: "",
  evidence: [],
  sessions: [],
  project: "aftertrace",
  first_ns: 1,
  last_ns: 1 + 30 * 86400e9,
}
eq(actionSentence(opus), "Use Sonnet for quick replies in aftertrace.", "actionSentence opus")
eq(moneyLabel(opus, ""), "Saves about $12 a month", "moneyLabel $12")
eq(moneyLabel({ ...opus, impact_value: 0.41 }, ""), "Saves about 41¢ a month", "moneyLabel 41¢")

const DAY = 86400e9
const hi = Math.max(...sessions.map((s) => s.end_ns)) + 1
const lo = hi - 7 * DAY
const weekProjects = projectsInWindow(sessions, lo, hi)
const weekSpend = sessions.filter((s) => s.start_ns >= lo && s.start_ns < hi).reduce((a, s) => a + (s.cost_usd || 0), 0)
const projSpend = weekProjects.reduce((a, p) => a + p.cost_usd, 0)
if (Math.abs(projSpend - weekSpend) > 1e-6) {
  console.error(`fail project rows sum to headline: got ${projSpend} want ${weekSpend}`)
  failed++
}
if (weekProjects.length < 2) {
  console.error(`fail week projects: ${weekProjects.length}`)
  failed++
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log("ok")
