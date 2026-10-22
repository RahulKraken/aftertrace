import { expect, test, type Page } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../screenshots")
mkdirSync(outDir, { recursive: true })

const HERO_TRACE = "509cb3acac23db7c6e9b7d180a474268"

async function waitFonts(page: Page) {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('600 28px "Inter"')
    await document.fonts.load('500 28px "Inter"')
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
  await page.screenshot({
    path: resolve(outDir, `${name}-${theme}.png`),
    fullPage: false,
  })
}

// The timeline opens on closed steps; open them all to reach individual calls.
async function openSteps(page: Page) {
  await expect(page.locator(".row.is-step").first()).toBeVisible()
  const n = await page.locator(".row.is-step").count()
  for (let i = 0; i < n; i++) {
    const caret = page.locator(".row.is-step").nth(i).locator(".caret")
    if ((await caret.textContent()) === "▸") await page.locator(".row.is-step").nth(i).dispatchEvent("click")
    await expect(caret).toHaveText("▾")
  }
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
  await expect(page.locator(".sessions-grid tbody tr:not(.day-row)")).toHaveCount(6)
  await page.getByRole("tab", { name: /With findings/ }).click()
  const withFindings = await page.locator(".sessions-grid tbody tr:not(.day-row)").count()
  expect(withFindings).toBeLessThan(6)
  await page.getByRole("tab", { name: /^All/ }).click()
  await page.getByPlaceholder("Search prompts, repos, models").fill("zsh")
  await expect(page.locator(".sessions-grid tbody tr:not(.day-row)")).toHaveCount(1)
  await page.getByPlaceholder("Search prompts, repos, models").fill("")
  // A day on the activity chart filters the list to it, and clicking again clears it.
  await page.locator(".act-col:not(.is-empty)").last().click()
  await expect(page.locator(".sessions-grid tbody tr:not(.day-row)")).toHaveCount(1)
  await page.locator(".act-col.is-on").click()
  await expect(page.locator(".sessions-grid tbody tr:not(.day-row)")).toHaveCount(6)
  await expect(page.locator(".story-card")).toHaveCount(0)
  await expect(page.locator(".kpis")).toHaveCount(0)
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
  await expect(page.locator(".n-pill").first()).toContainText("+")
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
  await expect(bash.locator(".n-pill")).toHaveCount(0)
  await bash.locator(".caret").dispatchEvent("click")
  const waitRow = page.locator(".row").filter({ hasText: "waiting on you" }).first()
  await expect(waitRow).toBeVisible()
  // Rows spring into place after each expand; click once they settle.
  await page.waitForTimeout(500)
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
  await expect(page.locator(".frow.hero")).toBeVisible()
  await expect(page.locator(".frow.hero")).toContainText("permission prompts")
  await expect(page.locator(".frow.hero .fix-btn")).toBeVisible()
  await expect(page.locator(".frow.quiet").first()).toBeVisible()
  await expect(page.locator(".frow.resolved")).toContainText("git commit")
  await expect(page.locator(".celebrate")).toHaveCount(0)
  await shot(page, "findings", "light")
  await shot(page, "findings", "dark")
})

async function openPermissionWin(page: Page) {
  await page.goto("/#/findings")
  await page.evaluate(() => localStorage.setItem("aftertrace-resolved", JSON.stringify(["permission.allow_rule_candidate:# permission prompts for Bash(git commit:*), all approved"])))
  await page.reload()
  await expect(page.locator(".frow.hero")).toContainText("permission prompts")
  await page.locator(".frow.hero .fix-btn").click()
  await expect(page.locator(".win-stage")).toBeVisible()
  await expect(page.locator(".win-figure")).toHaveText("6")
  await expect(page.locator(".win-label")).toContainText("prompts removed")
  await expect(page.locator(".win-aside")).toContainText("1m 29s saved")
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
  await expect(page.getByRole("heading", { name: "Welcome to Aftertrace" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Connect Claude Code/ })).toBeVisible()
  await expect(page.locator(".welcome-demo code")).toHaveText("aftertrace demo")
  await page.waitForTimeout(500)
  await shot(page, "empty", "light")
  await shot(page, "empty", "dark")
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
  await expect(page.locator(".home-story")).toContainText("Your agents worked")
  await expect(page.locator(".stat")).toHaveCount(5)
  await expect(page.locator(".lane").first()).toBeVisible()
  await expect(page.locator(".next-card")).toBeVisible()
  await expect(page.locator(".list-row").first()).toBeVisible()
  await shot(page, "home", "light")
  await shot(page, "home", "dark")
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
  await expect(page.locator(".home-story")).toBeVisible()
  await page.keyboard.press("g")
  await page.keyboard.press("f")
  await expect(page).toHaveURL(/#\/findings/)
  await page.keyboard.press("Meta+k")
  await page.keyboard.type("zsh")
  await expect(page.locator(".cmd-list button").first()).toContainText("zsh")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#\/session\//)
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
  await expect(page.locator(".side-item.on")).toContainText("Apps")
  await page.waitForTimeout(400)
  await shot(page, "app-trace", "light")
  await shot(page, "app-trace", "dark")
})

test("recap: story, lanes, receipt, week switch", async ({ page }) => {
  await page.goto("/#/recap")
  await waitFonts(page)
  await expect(page.locator(".recap-story")).toContainText("Your agents put in")
  await expect(page.locator(".receipt")).toContainText("AFTERTRACE")
  await expect(page.locator(".receipt")).toContainText("API value")
  await expect(page.locator(".dl-row").first()).toBeVisible()
  await shot(page, "recap", "light")
  await shot(page, "recap", "dark")
  const label = await page.locator(".recap-nav .num").textContent()
  await page.getByRole("button", { name: "Previous week" }).click()
  await expect(page.locator(".recap-nav .num")).not.toHaveText(label || "")
})
