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
const { actionSentence, moneyLabel, monthlyUSD, homeSavings, homeHeadline, cardMoney } = await vite.ssrLoadModule("/src/lib/welcome.ts")
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

const month = 30 * 86400e9
eq(monthlyUSD(opus), 12.4, "monthlyUSD full month")
eq(Math.round(monthlyUSD({ ...opus, last_ns: 1 + month / 2 }) * 10) / 10, 24.8, "monthlyUSD half month")
eq(homeHeadline(0), "Your setup looks lean. Here's what we saw this month.", "headline zero")
eq(homeHeadline(0.41), "Your setup looks lean. Here's what we saw this month.", "headline tiny")
eq(homeHeadline(12.4), "About $12/month you could save", "headline $12")
eq(cardMoney(12.4), "~$12/month", "cardMoney $12")
eq(cardMoney(0.41), "~41¢/month", "cardMoney 41¢")

const ranked = homeSavings([
  { ...opus, id: 1, rule_id: "long", impact_value: 2, first_ns: 1, last_ns: 1 + month, estimated: true },
  { ...opus, id: 2, rule_id: "week", impact_value: 1.5, first_ns: 1, last_ns: 1 + month / 4, estimated: true },
], { history_only: true })
eq(ranked.shown[0]?.rule_id, "week", "rank by monthly not raw")
eq(ranked.shown.length, 2, "both above $1 shown")

const folded = homeSavings([
  { ...opus, id: 1, impact_value: 12, estimated: true },
  { ...opus, id: 2, rule_id: "tiny-a", impact_value: 0.02, estimated: true },
  { ...opus, id: 3, rule_id: "tiny-b", impact_value: 0.4, estimated: true },
], { history_only: true })
eq(folded.shown.length, 1, "threshold hides sub-$1")
eq(folded.folded, 2, "fold count")
eq(folded.fold_kind, "smaller", "fold kind smaller")

const capped = homeSavings(
  [12, 10, 8, 5, 3].map((v, i) => ({ ...opus, id: i, rule_id: "r" + i, impact_value: v, estimated: true })),
  { history_only: true },
)
eq(capped.shown.length, 3, "cap at 3")
eq(capped.folded, 2, "rest folded")
eq(capped.fold_kind, "more", "fold kind more")

const allSmall = homeSavings(
  Array.from({ length: 10 }, (_, i) => ({ ...opus, id: i, rule_id: "t" + i, impact_value: 0.3, estimated: true })),
  { history_only: true },
)
eq(allSmall.shown.length, 0, "all sub-$1 hidden")
eq(allSmall.folded, 10, "all folded")
eq(allSmall.headline.includes("you could save"), true, "sum over $1 still a savings headline")
eq(homeSavings([], { history_only: true }).headline, "Your setup looks lean. Here's what we saw this month.", "empty lean")

const skipLive = homeSavings(
  [{ ...opus, id: 1, estimated: false, impact_value: 9 }],
  { history_only: true },
)
eq(skipLive.shown.length, 0, "history-only skips live findings")

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
