import { expect, test, type Page } from "@playwright/test"

declare global {
  interface Window {
    aftertracePopover: {
      renderGlance: (g: unknown) => void
      renderUpdate: (u: unknown) => void
    }
    aftertraceDesktop?: {
      platform: string
      getUpdate: () => Promise<unknown>
      checkUpdates: () => Promise<unknown>
      restartToUpdate: () => Promise<boolean>
      onUpdate: (fn: (state: unknown) => void) => () => void
    }
  }
}
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../screenshots")
const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots")
mkdirSync(outDir, { recursive: true })
mkdirSync(docsDir, { recursive: true })

const HERO_TRACE = "509cb3acac23db7c6e9b7d180a474268"

const READY_UPDATE = {
  status: "ready",
  version: "0.5.7",
  current: "0.5.6",
  error: null,
  checkedAt: Date.now() - 90_000,
}

async function mockDesktop(page: Page, state = READY_UPDATE) {
  await page.addInitScript((st) => {
    window.aftertraceDesktop = {
      platform: "darwin",
      getUpdate: async () => st,
      checkUpdates: async () => st,
      restartToUpdate: async () => true,
      onUpdate: (fn) => {
        fn(st)
        return () => {}
      },
    }
  }, state)
}

async function waitFonts(page: Page) {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('600 28px "Inter"')
    await document.fonts.load('500 28px "Inter"')
    await document.fonts.load('600 20px "Newsreader"')
    await document.fonts.load('500 22px "Geist Mono"')
    return document.fonts.check('600 28px "Inter"')
  })
  expect(loaded).toBe(true)
}

async function shot(page: Page, name: string, theme: "light" | "dark", keepHover = false) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
    localStorage.setItem("aftertrace-theme", t)
  }, theme)
  await waitFonts(page)
  if (!keepHover) {
    await page.mouse.move(0, 0)
    if (await page.locator(".wf-body").count()) {
      await page.locator(".wf-body").dispatchEvent("mouseleave")
    }
  }
  await page.waitForTimeout(120)
  const file = `${name}-${theme}.png`
  await page.screenshot({ path: resolve(outDir, file), fullPage: false })
  const docs = ["home", "home-history", "findings", "sessions", "recap", "recap-empty", "recap-long", "tray", "popover"]
  if (docs.includes(name)) {
    await page.screenshot({ path: resolve(docsDir, file), fullPage: false })
  }
}

// The timeline opens on closed steps; open them all to reach individual calls.
// Expanding a step inserts nested is-step rows (subagents), so nth(i) after a
// click points at a different row and can collapse one that was just opened.
async function openSteps(page: Page) {
  await expect(page.locator(".row.is-step").first()).toBeVisible()
  for (let guard = 0; guard < 40; guard++) {
    const closed = page.locator(".row.is-step").filter({ has: page.locator(".caret[aria-expanded='false']") })
    if ((await closed.count()) === 0) return
    const row = closed.first()
    const id = await row.getAttribute("data-span")
    await row.dispatchEvent("click")
    if (id) {
      await expect(page.locator(`.row[data-span="${id}"] .caret`)).toHaveAttribute("aria-expanded", "true")
    }
  }
  throw new Error("openSteps: steps still closed")
}

test.beforeEach(async ({ page }) => {
  // Screenshots show the settled page: counts finished, bars grown.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    if (!localStorage.getItem("aftertrace-resolved")) {
      localStorage.setItem("aftertrace-resolved", JSON.stringify(["permission.allow_rule_candidate:# permission prompts for Bash(git commit:*), all approved"]))
    }
    // documentElement can be null this early; theme.ts applies the stored theme anyway.
    if (document.documentElement) document.documentElement.dataset.theme = "light"
  })
})

test("sessions list", async ({ page }) => {
  await page.goto("/#/sessions")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
  await expect(page.locator(".v4-rr")).toHaveCount(6)
  await expect(page.locator(".v4-rr .v4-st").filter({ hasText: "Running" })).toHaveCount(1)
  await page.locator(".v4-rr").nth(1).click()
  await expect(page.locator(".v4-pane .v4-st")).toContainText("Done")
  await expect(page.locator(".v4-pane h2")).not.toHaveText("")
  await shot(page, "sessions", "light")
  await shot(page, "sessions", "dark")
})

test("story default: a turn reads as steps", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  await expect(page.locator(".seg-view button.on")).toHaveText("Story")
  await expect(page.getByRole("heading", { name: /approving tool calls/ })).toBeVisible()
  await expect(page.locator(".st-bar i")).not.toHaveCount(0)
  await expect(page.locator(".st-ch")).not.toHaveCount(0)
  await expect(page.locator(".st-end")).toContainText("Done")
  // The showcase session carries synthetic prompts and narration.
  await expect(page.locator(".st-prompt")).toContainText("charged twice")
  await expect(page.locator(".st-title").first()).toContainText("Reproducing it first")
  await expect(page.locator(".st-outcome")).toContainText("idempotency key")
  await shot(page, "story", "light")
  await shot(page, "story", "dark")
})

test("story step opens the inspector, and Timeline keeps the choice", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  // Pin the step by id: its summary line goes away once it opens.
  const id = await page.locator(".st-ch").filter({ hasText: "subagent" }).first().getAttribute("data-item")
  const step = page.locator(`.st-ch[data-item="${id}"]`)
  await step.locator(".st-ch-head").click()
  await expect(step.locator(".st-act").first()).toBeVisible()
  await expect(step.locator(".st-acts-nested .st-act").first()).toBeVisible()
  await step.locator(".st-act").first().click()
  await expect(page.locator(".pane-col")).toBeVisible()
  await shot(page, "story-open", "light")
  await page.keyboard.press("Escape")
  await expect(page.locator(".pane-col")).toHaveCount(0)
  await page.locator(".seg-view").getByRole("tab", { name: "Timeline" }).click()
  await expect(page.locator(".wf-body")).toBeVisible()
  await page.reload()
  await expect(page.locator(".seg-view button.on")).toHaveText("Timeline")
})

test("waterfall default: bars own the page", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?view=timeline`)
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: /approving tool calls/ })).toBeVisible()
  await expect(page.locator(".pane")).toHaveCount(0)
  await expect(page.locator(".minimap")).toHaveCount(0)
  await expect(page.locator(".chips")).toHaveCount(0)
  await expect(page.locator(".wf-stats")).toBeVisible()
  await expect(page.locator(".kpis")).toHaveCount(0)
  await expect(page.locator(".live-badge")).toContainText("Done")
  // Calls are grouped into steps, closed by default, each saying how many calls it holds.
  await expect(page.locator(".row.is-step").first()).toBeVisible()
  await expect(page.locator(".row.is-step .n-pill").first()).toContainText("call")
  await shot(page, "waterfall", "light")
  await shot(page, "waterfall", "dark")
})

test("waterfall click card", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?view=timeline`)
  await waitFonts(page)
  await openSteps(page)
  // Model calls are named by what Claude said, with the model beside it.
  const model = page.locator(".row").filter({ has: page.locator(".name", { hasText: "Opus" }) }).first()
  await page.waitForTimeout(400)
  await model.dispatchEvent("click")
  await expect(page.locator(".span-card")).toBeVisible()
  await expect(page.locator(".span-card")).toContainText("Duration")
  await expect(page.locator(".span-card")).toContainText("LLM call")
  await expect(page.locator(".span-card .sc-status")).toHaveText("Done")
  await shot(page, "waterfall-card", "light", true)
  await shot(page, "waterfall-card", "dark", true)
  await page.keyboard.press("Escape")
  await expect(page.locator(".span-card")).toHaveCount(0)
})

test("waterfall collapsed +N pill", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?view=timeline`)
  await waitFonts(page)
  await page.locator(".row").first().locator(".caret").click()
  await expect(page.locator(".n-pill").first()).toBeVisible()
  await expect(page.locator(".n-pill").first()).toContainText("in all")
  await page.waitForTimeout(400)
  await shot(page, "waterfall-collapsed", "light")
  await shot(page, "waterfall-collapsed", "dark")
})

test("waterfall numbers sit beside their bars", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?view=timeline`)
  await waitFonts(page)
  await expect(page.locator(".wf-stat").filter({ hasText: "Cost" })).toContainText("$")
  await expect(page.locator(".wf-stat").filter({ hasText: "LLM calls" })).toBeVisible()
  await expect(page.locator(".row.is-step .bar-lab").first()).toContainText("$")
  await openSteps(page)
  await expect(page.locator(".slowest")).toHaveCount(1)
  await page.waitForTimeout(600)
  await shot(page, "waterfall-open", "light")
  await shot(page, "waterfall-open", "dark")
})

test("waterfall selected: pane takes the budget", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?view=timeline`)
  await openSteps(page)
  const bash = page.locator(".row").filter({ has: page.locator(".glyph.g-bash") }).first()
  // A tool's wait and run phases are in its bar; opening it lists them as rows.
  // Bottleneck evidence on this fixture already expands the wait's parent bash.
  // Toggling that caret collapses it; the wait row exits AnimatePresence and
  // the next click waits forever. Only expand when it is still closed.
  await expect(bash.locator(".n-pill")).toHaveCount(0)
  const waitRow = page.locator(".row").filter({ has: page.locator(".name", { hasText: "waiting on you" }) }).first()
  for (let i = 0; i < 8 && (await waitRow.count()) === 0; i++) {
    const closedBash = page.locator(".row").filter({ has: page.locator(".glyph.g-bash") }).filter({ has: page.locator("button.caret[aria-expanded='false']") }).first()
    if ((await closedBash.count()) === 0) break
    await closedBash.locator("button.caret").dispatchEvent("click")
  }
  await expect(waitRow).toBeVisible()
  await waitRow.dispatchEvent("click")
  // A click opens the card; its link opens the full inspector.
  await expect(page.locator(".span-card")).toBeVisible()
  await page.locator(".span-card .sc-more").click()
  await expect(page.locator(".pane")).toBeVisible()
  await expect(page.locator(".wf")).toHaveClass(/has-pane/)
  await expect(page.locator(".pane")).toContainText("waiting on you")

  for (let i = 0; i < 2; i++) {
    const agent = page.locator(".row").filter({ has: page.locator(".glyph.g-agent") }).filter({ has: page.locator(".n-pill") }).first()
    if (await agent.count()) await agent.locator(".caret").dispatchEvent("click")
    await page.waitForTimeout(300)
  }
  await expect(page.locator(".row").filter({ has: page.locator(".glyph.g-agent") }).nth(1)).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, "waterfall-selected", "light")
  await shot(page, "waterfall-selected", "dark")
})

test("session detail", async ({ page }) => {
  await page.goto("/#/session/e61c32c0-0193-4bab-9096-4e952c6c8a0c")
  await expect(page.locator(".session-title")).toContainText("charged twice")
  await expect(page.locator(".session-story")).toBeVisible()
  await expect(page.locator(".kpis")).toHaveCount(0)
  await expect(page.locator("table.grid tbody tr").first()).toBeVisible()
  await shot(page, "session", "light")
  await shot(page, "session", "dark")
})

test("findings", async ({ page }) => {
  await page.goto("/#/findings")
  await waitFonts(page)
  await expect(page.locator(".v4-pane .frow.hero")).toBeVisible()
  await expect(page.locator(".v4-pane .frow.hero")).toContainText("permission prompts")
  await expect(page.locator(".v4-pane .fix-btn")).toBeVisible()
  await expect(page.locator(".frow.hero .pill")).toHaveCount(0)
  await expect(page.locator(".pillar")).toHaveCount(0)
  await expect(page.locator(".hero-imp")).toHaveCount(0)
  await expect(page.locator(".frow.quiet").first()).toBeVisible()
  await expect(page.locator(".frow.resolved")).toContainText("git commit")
  await expect(page.locator(".celebrate")).toHaveCount(0)
  const titles = (await page.locator(".v4-fr .nm").allTextContents()).map((t) => t.trim())
  expect(titles.some((t) => /pdf-report/i.test(t))).toBe(false)
  expect(titles.some((t) => /PDF report/i.test(t))).toBe(true)
  const counts = new Map<string, number>()
  for (const t of titles) counts.set(t, (counts.get(t) || 0) + 1)
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t)
  expect(dupes, `duplicate finding titles: ${dupes.join(", ")}`).toEqual([])
  await page.locator(".v4-fr").filter({ hasText: "PDF report" }).click()
  await expect(page.locator(".v4-pane .v4-lbl")).toHaveText("This")
  await expect(page.locator(".v4-pane .v4-big")).toContainText("/mo")
  await expect(page.locator(".v4-pane").getByRole("button", { name: "Done" })).toHaveCount(1)
  await expect(page.locator(".v4-pane .done-btn")).toBeVisible()
  await expect(page.locator(".v4-strip i").first()).toBeVisible()
  const stripH = await page.locator(".v4-strip").evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
  expect(stripH).toBeGreaterThanOrEqual(16)
  await expect(page.getByText("Loading…")).toHaveCount(0)
  await shot(page, "findings", "light")
  await shot(page, "findings", "dark")
})

test("findings skeleton", async ({ page }) => {
  await page.goto("/#/findings?skeleton=1")
  await waitFonts(page)
  await expect(page.locator(".v4-skel")).toBeVisible()
  await expect(page.getByText("Loading…")).toHaveCount(0)
  await shot(page, "findings-skeleton", "light")
  await shot(page, "findings-skeleton", "dark")
})

async function openPermissionWin(page: Page) {
  await page.goto("/#/findings")
  await page.evaluate(() => localStorage.setItem("aftertrace-resolved", JSON.stringify(["permission.allow_rule_candidate:# permission prompts for Bash(git commit:*), all approved"])))
  await page.reload()
  await expect(page.locator(".v4-pane .frow.hero")).toContainText("permission prompts")
  await page.locator(".v4-pane .fix-btn").click()
  await expect(page.locator(".win-stage")).toBeVisible()
  await expect(page.locator(".win-figure")).toHaveText("6")
  await expect(page.locator(".win-label")).toContainText("prompts removed")
  await expect(page.locator(".win-aside")).toContainText("1 min saved")
}

test("findings win state", async ({ page }) => {
  await openPermissionWin(page)
  await shot(page, "findings-win", "light")
  await openPermissionWin(page)
  await shot(page, "findings-win", "dark")
  await expect(page.locator(".win-stage")).toHaveCount(0, { timeout: 2500 })
  await expect(page.locator(".frow.resolved").filter({ hasText: "npm test" })).toBeVisible()
  await shot(page, "findings-resolved", "dark")
  await shot(page, "findings-resolved", "light")
})

test("cost", async ({ page }) => {
  await page.goto("/#/cost")
  await expect(page.getByRole("heading", { name: "Cost" })).toBeVisible()
  await expect(page.locator(".sub")).toContainText("drove most of this period's spend")
  await expect(page.locator(".sub")).not.toContainText("cost_usd")
  await expect(page.locator(".ribbon-read")).not.toContainText("Point at a slice")
  await expect(page.locator("table.grid tbody tr").first()).toBeVisible()
  await shot(page, "cost", "light")
  await shot(page, "cost", "dark")
})

test("query builder", async ({ page }) => {
  await page.goto("/#/query")
  await expect(page.getByRole("heading", { name: "Query" })).toBeVisible()
  await page.getByRole("button", { name: "Run query" }).click()
  await expect(page.locator("main svg").first()).toBeVisible()
  await shot(page, "query-builder", "light")
  await shot(page, "query-builder", "dark")
})

test("query ask", async ({ page }) => {
  await page.goto("/#/query")
  await page.getByRole("button", { name: "Ask", exact: true }).first().click()
  await page.getByRole("button", { name: "Which skill costs the most per activation?" }).click()
  await expect(page.locator(".answer")).toBeVisible()
  await shot(page, "query-ask", "light")
  await shot(page, "query-ask", "dark")
})

test("empty state", async ({ page }) => {
  await page.goto("/#/empty")
  await expect(page.getByRole("heading", { name: "No Claude Code sessions on this machine" })).toBeVisible()
  await expect(page.locator(".code pre")).toContainText("CLAUDE_CODE_ENABLE_TELEMETRY")
  await page.waitForTimeout(500)
  await shot(page, "empty", "light")
  await shot(page, "empty", "dark")
})

test("first-run connect: history found", async ({ page }) => {
  await page.goto("/#/connect?welcome=found")
  await expect(page.locator(".found-kicker")).toContainText(/Found \d+ days of Claude Code sessions/)
  await expect(page.locator(".found-spend")).toContainText("$")
  await expect(page.getByRole("heading", { name: "Use Sonnet for quick replies in aftertrace." })).toBeVisible()
  await expect(page.locator(".found-save")).toHaveText(/Saves about \$\d+ a month/)
  await expect(page.locator(".found-one")).toContainText("aftertrace")
  await expect(page.locator(".found-dollars")).toHaveCount(0)
  await expect(page.locator(".found-est")).toHaveText("estimated from session files")
  await expect(page.getByRole("button", { name: "Show me" })).toBeVisible()
  await expect(page.getByRole("link", { name: "See all findings" })).toBeVisible()
  await expect(page.locator(".found-nudge")).toContainText("slow hooks and retry waste")
  await expect(page.locator(".found-proj")).toHaveCount(0)
  await expect(page.locator(".found-one .pill")).toHaveCount(0)
  await page.waitForTimeout(500)
  await shot(page, "connect-found", "light")
  await shot(page, "connect-found", "dark")
})

test("first-run connect: nothing found", async ({ page }) => {
  await page.goto("/#/connect?welcome=empty")
  await expect(page.getByRole("heading", { name: "No Claude Code sessions on this machine" })).toBeVisible()
  await expect(page.locator(".code pre")).toContainText("CLAUDE_CODE_ENABLE_TELEMETRY")
  await page.waitForTimeout(500)
  await shot(page, "connect-empty", "light")
  await shot(page, "connect-empty", "dark")
})

test("query sql is read-only", async ({ page }) => {
  await page.goto("/#/query")
  await page.getByRole("button", { name: "SQL" }).click()
  await expect(page.locator(".sql-banner")).toContainText("Read-only")
  await shot(page, "query-sql", "light")
  await shot(page, "query-sql", "dark")
})

test("waterfall skeleton", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}?skeleton=1`)
  await expect(page.locator(".skel")).toBeVisible()
  await shot(page, "skeleton", "light")
  await shot(page, "skeleton", "dark")
})

test("home: story, stats, live lane, next finding", async ({ page }) => {
  await page.goto("/#/")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
  await expect(page.locator(".hero-mark")).toHaveCount(0)
  await expect(page.locator(".v4-tabs")).toContainText("Spend")
  await expect(page.locator(".v4-st").filter({ hasText: "Running" })).toBeVisible()
  await expect(page.locator(".next-card").first()).toBeVisible()
  await expect(page.locator(".v4-sv .next-card")).toHaveCount(2)
  await expect(page.locator(".v4-chart svg")).toBeVisible()
  const savable = page.locator(".v4-sv .v4-li.next-card").first()
  const nm = await savable.locator(".nm").boundingBox()
  const amt = await savable.locator(".v").boundingBox()
  expect(nm && amt).toBeTruthy()
  expect(amt!.x).toBeGreaterThan(nm!.x + nm!.width)
  const homeCost = (await page.locator(".v4-now .v4-tk b").last().textContent())?.trim()
  await page.goto("/#/sessions")
  await expect(page.locator(".v4-rr .v4-st").filter({ hasText: "Running" })).toBeVisible()
  const listCost = (await page.locator(".v4-rr").filter({ has: page.locator(".v4-st", { hasText: "Running" }) }).locator(".v.num").textContent())?.trim()
  expect(homeCost).toBe(listCost)
  expect(homeCost).toMatch(/^\$0\.\d{3}$/)
  await page.goto("/#/")
  await waitFonts(page)
  await shot(page, "home", "light")
  await shot(page, "home", "dark")
})

test("home: history-only", async ({ page }) => {
  await page.goto("/#/?history=1")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
  await expect(page.locator(".v4-sv")).toContainText("Savable")
  await expect(page.locator(".v4-sv .next-card")).toHaveCount(1)
  await expect(page.locator(".hero-mark")).toHaveCount(0)
  await expect(page.locator(".stat")).toHaveCount(0)
  await expect(page.locator(".v4-st").filter({ hasText: "Running" })).toHaveCount(0)
  await expect(page.locator(".v4-now")).toContainText("Last session")
  await expect(page.locator(".v4-now .t")).not.toHaveText("History only.")
  await expect(page.locator(".next-card .nm")).toContainText("Sonnet")
  await expect(page.getByText(/\d+ findings/)).toHaveCount(0)
  await shot(page, "home-history", "light")
  await shot(page, "home-history", "dark")
})

test("connect: snippet, prompt copy, live verification", async ({ page }) => {
  await page.goto("/#/connect")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Connect a source" })).toBeVisible()
  await expect(page.locator(".code pre")).toContainText("CLAUDE_CODE_ENABLE_TELEMETRY")
  await page.getByRole("checkbox").check()
  await expect(page.locator(".code pre")).toContainText("OTEL_LOG_USER_PROMPTS")
  await page.getByRole("tab", { name: /App on the Claude SDK/ }).click()
  await expect(page.locator(".code pre")).toContainText("NodeTracerProvider")
  await expect(page.locator(".verify")).toBeVisible()
  await shot(page, "connect", "light")
})

test("settings: capture gates", async ({ page }) => {
  await page.goto("/#/settings")
  await expect(page.locator(".gate")).toHaveCount(4)
  await page.getByRole("radio", { name: /Max 20x/ }).click()
  await expect(page.getByRole("radio", { name: /Max 20x/ })).toHaveAttribute("aria-checked", "true")
})

test("sidebar: g-shortcuts and command palette", async ({ page }) => {
  await page.goto("/#/")
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
  await page.keyboard.press("g")
  await page.keyboard.press("f")
  await expect(page).toHaveURL(/#\/findings/)
  await page.keyboard.press("Meta+k")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await expect(palette).toBeVisible()
  await page.keyboard.type("zsh")
  // Wait until the selected row is the session whose prompt contains zsh.
  // Findings can match first while sessions are still loading.
  const selected = palette.locator("button.on")
  await expect(selected.locator(".mute")).toHaveText("Sessions")
  await expect(selected).toContainText("zsh")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#\/session\//)
})

test("tray popover", async ({ page }) => {
  await page.goto("/#/tray")
  await waitFonts(page)
  await expect(page.locator(".v4-pop")).toBeVisible()
  await expect(page.locator(".v4-pop")).toContainText("Today")
  const running = page.locator(".v4-pop .v4-st").filter({ hasText: "Running" })
  if (await running.count()) {
    const trayCost = (await page.locator(".v4-pop .v4-tk b").last().textContent())?.trim()
    expect(trayCost).toMatch(/^\$0\.\d{3}$/)
    expect(trayCost).not.toBe("$0.410")
  }
  await shot(page, "tray", "light")
  await shot(page, "tray", "dark")
})

test("menu-bar popover: live, idle, stale, multi-session, update ready", async ({ page }) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../desktop/renderer")
  const html = readFileSync(resolve(root, "popover.html"), "utf8")
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    .replace('<link rel="stylesheet" href="./popover.css" />', `<style>${readFileSync(resolve(root, "popover.css"), "utf8")}</style>`)
    .replace("height: 100vh", "height: 400px")
    .replace('<script src="./popoverView.js"></script>', `<script>${readFileSync(resolve(root, "popoverView.js"), "utf8")}</script>`)
    .replace('<script src="./popover.js"></script>', `<script>${readFileSync(resolve(root, "popover.js"), "utf8")}</script>`)
  await page.setViewportSize({ width: 320, height: 400 })
  await page.setContent(html, { waitUntil: "domcontentloaded" })
  const live = {
    ok: true,
    stale: false,
    freshness: "Updated just now",
    todayLabel: "$12.40",
    topFinding: "Allow npm test",
    topFindingId: "4",
    sessions: [
      { doing: "Running tests", title: "fix the parser" },
      { doing: "Editing main.go", title: "two" },
      { doing: "Reading orders.go", title: "three" },
      { doing: "Searching", title: "four" },
    ],
  }
  await page.evaluate((g) => {
    window.aftertracePopover.renderGlance(g)
    window.aftertracePopover.renderUpdate({ status: "ready", version: "0.5.4" })
  }, live)
  await expect(page.locator("#sessions .lane")).toHaveCount(3)
  await expect(page.locator("#sessions")).toContainText("+1 more")
  await expect(page.locator("#fresh")).toHaveAttribute("data-kind", "live")
  await expect(page.locator("#restart")).toContainText("Restart to update")
  await expect(page.locator("#spend")).toHaveText("$12.40")
  await expect(page.locator("#spend")).toBeInViewport()
  await expect(page.locator("#finding")).toHaveText("Allow npm test")
  await expect(page.locator("#finding")).toBeInViewport()
  await expect(page.locator("#restart")).toBeInViewport()
  await expect(page.locator("#quit")).toBeInViewport()
  const popShot = async (name: string, theme: "light" | "dark") => {
    await page.emulateMedia({ colorScheme: theme })
    const file = `popover-${name}-${theme}.png`
    await page.screenshot({ path: resolve(outDir, file) })
    await page.screenshot({ path: resolve(docsDir, file) })
  }
  await popShot("ready", "light")
  await page.screenshot({ path: resolve(outDir, "popover-light.png") })
  await page.screenshot({ path: resolve(docsDir, "popover-light.png") })
  await popShot("ready", "dark")
  await page.screenshot({ path: resolve(outDir, "popover-dark.png") })
  await page.screenshot({ path: resolve(docsDir, "popover-dark.png") })
  await page.emulateMedia({ colorScheme: "light" })
  await page.evaluate(() => {
    window.aftertracePopover.renderGlance({
      ok: true,
      stale: true,
      freshness: "Engine data is stale",
      sessions: [],
    })
    window.aftertracePopover.renderUpdate({ status: "idle" })
  })
  await expect(page.locator("#fresh")).toHaveAttribute("data-kind", "stale")
  await expect(page.locator("#sessions")).toContainText("stale")
  await popShot("stale", "light")
  await popShot("stale", "dark")
  await page.emulateMedia({ colorScheme: "light" })
  await page.screenshot({ path: resolve(outDir, "popover-stale-light.png") })
  await page.evaluate(() => {
    window.aftertracePopover.renderGlance({ ok: true, stale: false, freshness: "Updated just now", sessions: [] })
    window.aftertracePopover.renderUpdate({ status: "idle" })
  })
  await expect(page.locator("#sessions")).toContainText("Idle")
  await popShot("idle", "light")
  await popShot("idle", "dark")
  await page.emulateMedia({ colorScheme: "light" })
  await page.screenshot({ path: resolve(outDir, "popover-idle-light.png") })
  await page.evaluate(() => {
    window.aftertracePopover.renderUpdate({ status: "error" })
  })
  await expect(page.locator("#updates")).toHaveText("Retry update")
  await popShot("error", "light")
  await popShot("error", "dark")
  await page.emulateMedia({ colorScheme: "light" })
  await page.evaluate(() => {
    window.aftertracePopover.renderUpdate({ status: "downloading", version: "0.5.4" })
  })
  await expect(page.locator("#updates")).toContainText("Downloading")
  await popShot("downloading", "light")
  await popShot("downloading", "dark")
})

test("apps: list, app page, findings, trace", async ({ page }) => {
  await page.goto("/#/apps")
  await waitFonts(page)
  await expect(page.locator(".app-card")).toHaveCount(3)
  await shot(page, "apps", "light")
  await page.locator(".app-card", { hasText: "support-bot" }).click()
  await expect(page.locator(".app-story")).toContainText("model calls")
  await expect(page.locator(".app-story")).toContainText("rate_limit_error")
  await expect(page.locator(".app-findings .next-card")).toHaveCount(2)
  await expect(page.locator(".app-table").first()).toContainText("POST /api/classify")
  await shot(page, "app", "light")
  await page.locator(".req-row").first().click()
  await expect(page.locator(".crumbs")).toContainText("support-bot")
  await expect(page.locator(".story-line")).toContainText("model call")
  await page.waitForTimeout(400)
  await shot(page, "app-trace", "light")
  await shot(page, "app-trace", "dark")
})

test("recap: story, lanes, receipt, week switch", async ({ page }) => {
  await page.goto("/#/recap")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Recap" })).toBeVisible()
  await expect(page.locator(".recap-lead")).toBeVisible()
  await expect(page.locator(".recap-primary").first()).toBeVisible()
  await expect(page.locator(".v4-hero")).toBeVisible()
  await expect(page.locator(".v4-chip")).toHaveCount(0)
  await expect(page.locator(".receipt")).toContainText("AFTERTRACE")
  await expect(page.locator(".v4-g4")).toBeVisible()
  await shot(page, "recap", "light")
  await shot(page, "recap", "dark")
  const label = await page.locator(".v4-seg button.on").textContent()
  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(page.locator(".v4-seg button.on")).not.toHaveText(label || "")
  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(page.locator(".recap-lead")).toContainText("Nothing ran this week")
  await expect(page.locator(".v4-chip")).toHaveCount(0)
  await shot(page, "recap-empty", "light")
  await shot(page, "recap-empty", "dark")
  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(page.locator(".recap-primary").filter({ hasText: "$12345.67" })).toBeVisible()
  await expect(page.locator(".recap-lead")).toContainText("128")
  await shot(page, "recap-long", "light")
  await shot(page, "recap-long", "dark")
})

test("in-app Restart to update sits in the sidebar footer", async ({ page }) => {
  await mockDesktop(page)
  await page.goto("/#/")
  await waitFonts(page)
  await expect(page.locator(".side-update")).toHaveText("Restart to update · v0.5.7")
  await expect(page.locator(".recv")).toContainText("Receiving")
  await expect(page.locator("[data-update=ready]")).toHaveCount(1)
  await shot(page, "update-ready", "light")
  await shot(page, "update-ready", "dark")
  await page.locator(".side-update").hover()
  await shot(page, "update-ready-hover", "light", true)
  await page.locator(".side-update").hover()
  await shot(page, "update-ready-hover", "dark", true)
})

test("Settings shows version, last checked, and Check for updates", async ({ page }) => {
  await mockDesktop(page)
  await page.goto("/#/settings")
  await waitFonts(page)
  const updates = page.locator("[data-settings=updates]")
  await expect(updates).toBeVisible()
  await expect(updates).toContainText("v0.5.6")
  await expect(updates.getByRole("button", { name: "Check for updates" })).toBeVisible()
  await expect(updates.getByRole("button", { name: "Restart to update" })).toBeVisible()
  await expect(updates.locator("dd").nth(1)).toContainText("ago")
  await expect(page.locator(".budget-suffix")).toHaveText("/ week")
  const suffixLines = await page.locator(".budget-suffix").evaluate((el) => el.getClientRects().length)
  expect(suffixLines).toBe(1)
  await shot(page, "settings-updates", "light")
  await shot(page, "settings-updates", "dark")
})

test("app menu lists Check for Updates… under About", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 360 })
  await page.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  html, body { margin: 0; height: 100%; }
  body { display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif; }
  html[data-theme="light"] body { background: #d8d8d8; }
  html[data-theme="dark"] body { background: #1c1c1e; }
  .bar { position: absolute; top: 12px; left: 16px; font: 500 13px/1 ui-sans-serif, system-ui; }
  html[data-theme="light"] .bar { color: #111; }
  html[data-theme="dark"] .bar { color: #f2f2f2; }
  .menu {
    width: 240px; border-radius: 8px; padding: 6px 0;
    box-shadow: 0 8px 28px rgba(0,0,0,.22);
  }
  html[data-theme="light"] .menu { background: #f6f6f6; color: #111; }
  html[data-theme="dark"] .menu { background: #2c2c2e; color: #f2f2f2; }
  .item { padding: 5px 14px; font: 13px/1.3 ui-sans-serif, system-ui; display: flex; justify-content: space-between; }
  .item.on { background: #0a84ff; color: #fff; }
  hr { border: 0; height: 1px; margin: 5px 0; }
  html[data-theme="light"] hr { background: #e2e2e2; }
  html[data-theme="dark"] hr { background: #3a3a3c; }
  kbd { font: 12px/1 ui-sans-serif, system-ui; opacity: .55; }
</style>
</head>
<body>
  <div class="bar">Aftertrace</div>
  <div class="menu" role="menu" aria-label="Aftertrace">
    <div class="item">About Aftertrace</div>
    <hr/>
    <div class="item on">Check for Updates…</div>
    <hr/>
    <div class="item">Hide Aftertrace <kbd>⌘H</kbd></div>
    <div class="item">Hide Others <kbd>⌥⌘H</kbd></div>
    <div class="item">Show All</div>
    <hr/>
    <div class="item">Quit Aftertrace <kbd>⌘Q</kbd></div>
  </div>
</body>
</html>`)
  await expect(page.getByRole("menu", { name: "Aftertrace" })).toContainText("Check for Updates…")
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light"
  })
  await page.screenshot({ path: resolve(outDir, "app-menu-light.png"), fullPage: false })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark"
  })
  await page.screenshot({ path: resolve(outDir, "app-menu-dark.png"), fullPage: false })
})
