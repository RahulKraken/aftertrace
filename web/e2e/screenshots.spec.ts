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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    document.documentElement.dataset.theme = "light"
    if (!localStorage.getItem("aftertrace-resolved")) {
      localStorage.setItem("aftertrace-resolved", JSON.stringify([4]))
    }
  })
})

test("sessions list", async ({ page }) => {
  await page.goto("/#/")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: /waiting on approvals/ })).toBeVisible()
  await expect(page.locator(".week-pct")).toContainText("5%")
  await expect(page.locator("table.grid tbody tr").first()).toBeVisible()
  await expect(page.locator(".story-card")).toHaveCount(0)
  await expect(page.locator(".kpis")).toHaveCount(0)
  await shot(page, "sessions", "light")
  await shot(page, "sessions", "dark")
})

test("waterfall default: bars own the page", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: /waiting on approvals/ })).toBeVisible()
  await expect(page.locator(".pane")).toHaveCount(0)
  await expect(page.locator(".minimap")).toHaveCount(0)
  await expect(page.locator(".chips")).toHaveCount(0)
  await expect(page.locator(".wf-sum")).toBeVisible()
  await expect(page.locator(".kpis")).toHaveCount(0)
  await expect(page.locator(".live-badge")).toContainText("Done")
  await shot(page, "waterfall", "light")
  await shot(page, "waterfall", "dark")
})

test("waterfall hover popover", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  const model = page.locator(".row").filter({ has: page.locator(".name", { hasText: "opus" }) }).first()
  await model.hover()
  await expect(page.locator(".span-pop")).toBeVisible()
  await expect(page.locator(".span-pop")).toContainText("content hidden")
  await expect(page.locator(".span-pop")).toContainText("Duration")
  await shot(page, "waterfall-hover", "light", true)
  await model.hover()
  await expect(page.locator(".span-pop")).toBeVisible()
  await shot(page, "waterfall-hover", "dark", true)
})

test("waterfall collapsed +N pill", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  await page.locator(".row").first().locator(".caret").click()
  await expect(page.locator(".n-pill").first()).toBeVisible()
  await expect(page.locator(".n-pill").first()).toContainText("+")
  await page.waitForTimeout(400)
  await shot(page, "waterfall-collapsed", "light")
  await shot(page, "waterfall-collapsed", "dark")
})

test("waterfall cost toggle", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  await waitFonts(page)
  await page.locator(".seg-metric").getByRole("tab", { name: "Cost" }).click()
  await expect(page.locator(".seg-metric button.on")).toHaveText("Cost")
  await expect(page.locator(".row").first().locator(".met")).toContainText("$")
  await shot(page, "waterfall-cost", "light")
  await shot(page, "waterfall-cost", "dark")
})

test("waterfall selected: pane takes the budget", async ({ page }) => {
  await page.goto(`/#/trace/${HERO_TRACE}`)
  const bash = page.locator(".row").filter({ has: page.locator(".name", { hasText: "Bash" }) }).first()
  if (await bash.locator(".n-pill").count()) await bash.locator(".caret").click()
  const waitRow = page.locator(".row").filter({ hasText: "waiting on you" }).first()
  await expect(waitRow).toBeVisible()
  await expect(bash).not.toContainText("blocked")

  for (let i = 0; i < 2; i++) {
    const agent = page
      .locator(".row")
      .filter({ has: page.locator(".name", { hasText: "Agent" }) })
      .filter({ has: page.locator(".n-pill") })
      .first()
    if (await agent.count()) await agent.locator(".caret").click()
  }

  await waitRow.click()
  await expect(page.locator(".pane")).toBeVisible()
  await expect(page.locator(".wf")).toHaveClass(/has-pane/)
  await expect(page.locator(".pane")).toContainText("waiting on you")
  await expect(page.locator(".row").filter({ has: page.locator(".name", { hasText: "Agent" }) }).nth(1)).toBeVisible()
  await page.waitForTimeout(400)
  await shot(page, "waterfall-selected", "light")
  await shot(page, "waterfall-selected", "dark")
})

test("session detail", async ({ page }) => {
  await page.goto("/#/session/e61c32c0-0193-4bab-9096-4e952c6c8a0c")
  await expect(page.locator(".story-line")).toBeVisible()
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
  await page.evaluate(() => localStorage.setItem("aftertrace-resolved", JSON.stringify([4])))
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
  await expect(page.locator("svg")).toBeVisible()
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
  await expect(page.getByRole("heading", { name: "Nothing on the wire yet" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy settings.json" })).toBeVisible()
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
