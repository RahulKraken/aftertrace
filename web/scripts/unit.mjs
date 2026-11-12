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

const { dur, durHead, tok, usd, sayDur, sayUsd, sayTok, moneyParts, pct, runCost } = await vite.ssrLoadModule("/src/lib/format.ts")
const { barBox, placeBarLabel, spanExtent, MIN_BAR_PX } = await vite.ssrLoadModule("/src/lib/barLayout.ts")
const { turnStory } = await vite.ssrLoadModule("/src/lib/story.ts")
const { wideTurn } = await vite.ssrLoadModule("/src/mock/wideTurn.ts")
const { actionSentence, moneyLabel, monthlyUSD, homeSavings, homeHeadline, cardMoney, shortTitle } = await vite.ssrLoadModule("/src/lib/welcome.ts")
const { barSlot, labelDays, niceAxis } = await vite.ssrLoadModule("/src/lib/chart.ts")
const { usageWindow, modelSlug } = await vite.ssrLoadModule("/src/lib/model.ts")
const { recapLead, recapShipped } = await vite.ssrLoadModule("/src/lib/recapStory.ts")
const { spendLead } = await vite.ssrLoadModule("/src/lib/spendInsight.ts")
const { sessions } = await vite.ssrLoadModule("/src/mock/load.ts")
const { mockOverview, projectsInWindow } = await vite.ssrLoadModule("/src/mock/overview.ts")
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
eq(sayUsd(0.41), "$0.41", "sayUsd 41 cents")
eq(sayUsd(0.41, true), "$0.41", "sayUsd 41 cents whole")
eq(sayUsd(12.4, true), "$12.40", "sayUsd $12.40 whole")
eq(sayUsd(38.4, true), "$38.40", "sayUsd $38.40")
eq(sayUsd(12.4), "$12.40", "sayUsd $12.40")
eq(sayUsd(0.004), "<$0.01", "sayUsd tiny")
eq(sayUsd(100), "$100", "sayUsd drops cents at 100")
eq(sayUsd(0.968), "$0.97", "sayUsd two decimals")
eq(sayTok(12_400_000), "12M", "sayTok 12M")
eq(tok(12_400_000), "12.4M", "tok table compact")
eq(sayTok(1_400_000), "1.4M", "sayTok 1.4M")
eq(usd(0.41), "$0.41", "usd two decimals")
eq(usd(0.968), "$0.97", "usd never three decimals")
eq(dur(49 * 60_000), "49m", "dur omits 0s")
eq(durHead(49 * 60_000 + 8000), "49m", "durHead drops seconds")
eq(durHead(134_000), "2m", "durHead 2m")
eq(pct(0.91), "91%", "pct fraction")
eq(pct(0.003), "<1%", "pct under one")

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
eq(moneyLabel(opus, ""), "Saves about $12.40 a month", "moneyLabel $12.40")
eq(moneyLabel({ ...opus, impact_value: 0.41 }, ""), "Saves about $0.41 a month", "moneyLabel $0.41")

const month = 30 * 86400e9
eq(monthlyUSD(opus), 12.4, "monthlyUSD full month")
eq(monthlyUSD({ ...opus, last_ns: 1 + month / 2 }), 12.4, "monthlyUSD does not invent days")
eq(monthlyUSD({ ...opus, impact_value: 0.016, last_ns: 1 + 86400e9 }) <= 0.016, true, "1-day span not inflated")
eq(homeHeadline(0), "Your setup looks lean. Here's what we saw this month.", "headline zero")
eq(homeHeadline(0.41), "Your setup looks lean. Here's what we saw this month.", "headline tiny")
eq(homeHeadline(12.4), "About $12.40/month you could save", "headline $12.40")
eq(cardMoney(12.4), "~$12.40/month", "cardMoney $12.40")
eq(cardMoney(0.41), "~$0.41/month", "cardMoney $0.41")

const ranked = homeSavings([
  { ...opus, id: 1, rule_id: "long", impact_value: 2, first_ns: 1, last_ns: 1 + month, estimated: true },
  { ...opus, id: 2, rule_id: "week", impact_value: 1.5, first_ns: 1, last_ns: 1 + month / 4, estimated: true },
], { history_only: true })
eq(ranked.shown[0]?.rule_id, "long", "rank by honest dollars, not inflated span")
eq(ranked.shown.length, 2, "both above $1 shown")

const folded = homeSavings([
  { ...opus, id: 1, impact_value: 12, estimated: true },
  { ...opus, id: 2, rule_id: "tiny-a", impact_value: 0.02, estimated: true },
  { ...opus, id: 3, rule_id: "tiny-b", impact_value: 0.4, estimated: true },
], { history_only: true })
eq(folded.shown.length, 1, "threshold hides sub-$1 when a big card exists")
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
eq(allSmall.shown.length, 3, "money headline shows top 3 even when each is under $1")
eq(allSmall.folded, 7, "rest folded")
eq(allSmall.fold_kind, "smaller", "folded are sub-threshold")
eq(allSmall.headline.includes("you could save"), true, "sum over $1 still a savings headline")
eq(homeSavings([], { history_only: true }).headline, "Your setup looks lean. Here's what we saw this month.", "empty lean")

function assertMoneyHasCards(s, label) {
  if (s.headline.includes("you could save") && s.shown.length === 0) {
    console.error(`fail ${label}: money headline with zero cards`)
    failed++
  }
}
assertMoneyHasCards(ranked, "ranked")
assertMoneyHasCards(folded, "folded")
assertMoneyHasCards(capped, "capped")
assertMoneyHasCards(allSmall, "allSmall")

const spendCap = homeSavings(
  [12, 10, 8].map((v, i) => ({ ...opus, id: i, rule_id: "s" + i, impact_value: v, estimated: true })),
  { history_only: true, observed_spend: 5, window_days: 30 },
)
eq(Math.abs(spendCap.total_monthly - 5) < 0.01, true, "headline capped at observed spend")
eq(spendCap.total_monthly <= spendCap.observed_monthly + 1e-9, true, "headline <= observed monthly")
assertMoneyHasCards(spendCap, "spendCap")
const shownFolded = spendCap.shown.reduce((a, f) => a + (f.monthly_usd || 0), 0) + spendCap.folded_monthly
if (Math.abs(shownFolded - spendCap.total_monthly) > 0.01) {
  console.error(`fail shown+folded ${shownFolded} != total ${spendCap.total_monthly}`)
  failed++
}

const tiny66 = homeSavings(
  Array.from({ length: 66 }, (_, i) => ({
    ...opus,
    id: i,
    rule_id: "cache.drop_after_compaction",
    impact_value: 0.012,
    first_ns: (i + 1) * 86400e9,
    last_ns: (i + 2) * 86400e9,
    estimated: true,
  })),
  { history_only: true, observed_spend: 0.82, window_days: 22 },
)
eq(tiny66.headline.includes("lean"), true, "66 tiny findings stay lean")
eq(tiny66.shown.length, 0, "lean has no cards")
eq(tiny66.folded, 66, "66 smaller tweaks")
eq(tiny66.fold_kind, "smaller", "folded are sub-threshold")
eq(tiny66.total_monthly <= 0.82 + 1e-9, true, "savings <= window spend")
eq(tiny66.observed_monthly > 0 && tiny66.total_monthly <= tiny66.observed_monthly + 1e-9, true, "headline <= observed")

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

eq(shortTitle(opus), "Sonnet for quick turns", "shortTitle opus")
eq(
  shortTitle({
    ...opus,
    rule_id: "skill.cost",
    headline: "Skill pdf-report drove 30% of spend",
    detail: "16 requests, 1 activations, $6.48 per activation. Mostly claude-opus-5 at effort max.",
  }),
  "PDF report runs on Opus at max effort",
  "shortTitle skill pdf-report",
)
const mcpGet = {
  ...opus,
  rule_id: "mcp.large_results",
  headline: "mcp__linear__get_issue returned 28,608 tokens over 2 calls",
}
const mcpList = {
  ...opus,
  rule_id: "mcp.large_results",
  headline: "mcp__linear__list_issues returned 22,222 tokens over 1 calls",
}
eq(shortTitle(mcpGet), "Cap Linear get_issue", "shortTitle mcp get_issue")
eq(shortTitle(mcpList), "Cap Linear list_issues", "shortTitle mcp list_issues")
eq(shortTitle(mcpGet) === shortTitle(mcpList), false, "mcp titles unique")
eq(
  shortTitle({
    ...opus,
    rule_id: "permission.allow_rule_candidate",
    headline: "6 permission prompts for Bash(npm test:*), all approved",
  }).includes("permission prompts"),
  true,
  "permission keeps prompts",
)

eq(runCost({ cost_usd: 0.049875 }, { cost_usd: 0.41 }), 0.049875, "runCost prefers session")
eq(runCost(null, { cost_usd: 0.41 }), 0.41, "runCost falls back to live")
eq(runCost({ cost_usd: 0 }, { cost_usd: 0.41 }), 0, "runCost keeps a zero session")
eq(runCost(undefined, undefined), 0, "runCost empty")

const thirty = Array.from({ length: 30 }, (_, i) => ({ start_ns: (Date.UTC(2026, 8, 19) + i * 86400000) * 1e6 }))
const ticks = labelDays(thirty)
eq(ticks[0].i, 0, "labelDays keeps first")
eq(ticks[ticks.length - 1].i, 29, "labelDays keeps last")
for (let k = 1; k < ticks.length; k++) {
  if (ticks[k].i - ticks[k - 1].i < 2) {
    console.error(`fail labelDays collision: ${ticks[k - 1].i} then ${ticks[k].i}`)
    failed++
  }
}
eq(ticks.some((t) => t.i === 28) && ticks.some((t) => t.i === 29), false, "labelDays drops last-adjacent tick")

eq(barSlot(340, 7, 0, 14, 8) > 8, true, "barSlot first bar inside left pad")
eq(barSlot(340, 7, 6, 14, 8) + 14 < 340 - 8 + 0.01, true, "barSlot last bar inside right pad")
const slot0 = barSlot(340, 7, 0, 14, 8)
const slot1 = barSlot(340, 7, 1, 14, 8)
eq(Math.abs(slot1 - slot0 - (340 - 16) / 7) < 0.01, true, "barSlot equal slots")
const mid0 = slot0 + 7
const mid6 = barSlot(340, 7, 6, 14, 8) + 7
eq(Math.abs(mid0 - 8 - (340 - 8 - mid6)) < 0.2, true, "barSlot first/last labels symmetric")
eq(niceAxis(9.1).at(-1) >= 9.1, true, "niceAxis last tick covers $9.10")
eq(niceAxis(21.81).at(-1) >= 21.81, true, "niceAxis last tick covers $21.81")
eq(niceAxis(12e6, true).at(-1) >= 12e6, true, "niceAxis last tick covers 12M tokens")

eq(modelSlug("claude-opus-5"), "opus", "modelSlug opus")
eq(modelSlug("claude-sonnet-5-5"), "sonnet", "modelSlug sonnet")
eq(moneyParts(186.4).whole, "$186", "moneyParts whole")
eq(moneyParts(186.4).cents, "", "moneyParts no raised cents")

const now = 10 * 3600e9
eq(usageWindow(now, []) == null, true, "usageWindow empty")
eq(usageWindow(now, [now - 6 * 3600e9]) == null, true, "usageWindow older than 5h")
const w = usageWindow(now, [now - 1 * 3600e9, now - 2 * 3600e9])
eq(Boolean(w), true, "usageWindow current")
eq(w.start_ns, now - 2 * 3600e9, "usageWindow earliest in burst")
eq(w.end_ns - w.start_ns, 5 * 3600e9, "usageWindow is 5h")

const recap = {
  stats: { turn_ms: (8 * 60 + 41) * 60_000, sessions: 8, cost_usd: 243.41, lines_added: 10321, commits: 49 },
}
const lead = recapLead(recap)
eq(lead.some((p) => p.kind === "primary" && p.text === "8h 41 min"), true, "recapLead primary time")
eq(lead.some((p) => p.kind === "primary" && p.text === "$243"), true, "recapLead primary spend")
eq(lead.some((p) => p.kind === "secondary" && p.text.includes("8 sessions")), true, "recapLead sessions secondary")
eq(lead.every((p) => p.kind !== "prose" || !/\$/.test(p.text)), true, "recapLead prose has no dollars")
const shipped = recapShipped(recap)
eq(shipped.some((p) => p.kind === "secondary" && p.text.includes("10,321")), true, "recapShipped lines")
eq(shipped.some((p) => p.kind === "secondary" && /49 commits/.test(p.text)), true, "recapShipped commits")
eq(recapLead({ stats: {} }).some((p) => p.text === "Nothing ran this week."), true, "recapLead empty")
const longLead = recapLead({ stats: { turn_ms: 23 * 3_600_000 + 59 * 60_000, sessions: 128, cost_usd: 12345.67 } })
eq(longLead.some((p) => p.kind === "primary" && p.text === "$12346"), true, "recapLead long spend")
eq(longLead.some((p) => p.kind === "primary" && p.text === "23h 59 min"), true, "recapLead long duration")
eq(recapLead({ stats: { turn_ms: 460980000, sessions: 128, cost_usd: 12345.67 } }).some((p) => p.kind === "primary" && p.text === "5d 8h"), true, "recapLead multi-day duration")
eq(recapShipped({ stats: { lines_added: 1234567, commits: 2048 } }).some((p) => p.text.includes("1,234,567")), true, "recapShipped long lines")

const ov = mockOverview()
const weekSess = sessions.filter((s) => s.start_ns >= ov.lo && s.start_ns < ov.hi)
eq(spendLead(weekSess, ov.week.cost_usd), "Two sessions made 71% of your spend.", "demo spend lead")

const tinyBar = barBox(99.9, 0.001, 600)
eq(tinyBar.widthPx >= MIN_BAR_PX, true, "barBox min width")
eq(tinyBar.leftPx + tinyBar.widthPx <= 600 + 1e-6, true, "barBox stays in track")
const after = placeBarLabel({ barLeft: 10, barWidth: 40, trackW: 400, labelW: 50 })
eq(after.mode, "after", "label after when there is room")
const inside = placeBarLabel({ barLeft: 10, barWidth: 380, trackW: 400, labelW: 50 })
eq(inside.mode, "inside", "label inside a wide bar at the edge")
eq(inside.left + 50 <= 400 + 1e-6, true, "inside label does not pass the edge")
const before = placeBarLabel({ barLeft: 360, barWidth: 20, trackW: 400, labelW: 50 })
eq(before.mode, "before", "label before a short bar at the edge")
eq(before.left + 50 <= 400 + 1e-6, true, "before label does not pass the edge")
const ext = spanExtent({
  start_ns: 10,
  end_ns: 20,
  kids: [{ start_ns: 8, end_ns: 40, kids: [{ start_ns: 12, end_ns: 50 }] }],
})
eq(ext.start_ns, 8, "spanExtent includes earlier child")
eq(ext.end_ns, 50, "spanExtent includes later grandchild")

const quietTurn = turnStory({
  turn_index: 1,
  turn_count: 293,
  spans: [{ name: "claude_code.interaction", duration_ms: 83_000, attrs: {} }],
  breakdown: { model: 10, tool: 10, permission_wait: 0, retry: 0, hook: 0, other: 0 },
})
eq(quietTurn, "Turn 1 of 293", "turnStory fallback has no duration")
eq(quietTurn.includes("wall clock"), false, "turnStory fallback has no wall clock")

const wide = wideTurn()
eq(wide.turn_count, 293, "wideTurn 293 turns")
eq(wide.spans[0].duration_ms > 60_000, true, "wideTurn longer than a minute")
eq(
  wide.events.some((e) => String(e.attrs.response || "").length > 100),
  true,
  "wideTurn has 100+ character titles",
)
eq(
  wide.spans.some((s) => s.duration_ms > 0 && s.duration_ms < 10) && wide.spans.some((s) => s.duration_ms > 20_000),
  true,
  "wideTurn mixes millisecond and long spans",
)
eq(
  wide.spans.some((s) => s.kids?.length > 0) || wide.spans.filter((s) => s.parent_span_id && s.parent_span_id !== wide.spans[0].span_id).length > 2,
  true,
  "wideTurn has nested spans",
)
eq(spendLead([{ cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }, { cost_usd: 1 }], 5), null, "equal five sessions fall back")
eq(spendLead([{ cost_usd: 8 }, { cost_usd: 1 }], 9), "One session made 89% of your spend.", "one session dominates")

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log("ok")
