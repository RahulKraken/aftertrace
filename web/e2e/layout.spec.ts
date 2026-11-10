import { expect, test, type Page } from "@playwright/test"

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 620 },
  { name: "768", width: 768, height: 900 },
  { name: "390", width: 390, height: 844 },
]

const ROUTES = [
  "/",
  "/findings",
  "/sessions",
  "/recap",
  "/settings",
  "/connect",
  "/query",
  "/cost",
  "/apps",
  "/apps/nightly-digest",
]

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

test.describe("shared app layout", () => {
  for (const view of VIEWPORTS) {
    test(`no horizontal page overflow at ${view.name}`, async ({ page }) => {
      await page.setViewportSize({ width: view.width, height: view.height })
      await page.addInitScript(() => {
        localStorage.setItem("aftertrace-theme", "light")
        if (document.documentElement) document.documentElement.dataset.theme = "light"
      })
      for (const route of ROUTES) {
        await page.goto(`/#${route}`)
        await page.waitForTimeout(route === "/" ? 800 : 400)
        const extra = await pageOverflow(page)
        expect(extra, `${route} at ${view.name}`).toBeLessThanOrEqual(1)
      }
    })
  }

  test("Overview gutter, week ticks and session rows stay on the grid at 1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem("aftertrace-theme", "light")
      if (document.documentElement) document.documentElement.dataset.theme = "light"
    })
    await page.goto("/#/")
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible()
    await expect(page.locator(".v4-skel")).toHaveCount(0)
    const edges = await page.evaluate(() => {
      const v4 = document.querySelector(".v4") as HTMLElement | null
      const h1 = document.querySelector(".v4-ph h1")
      const spend = document.querySelector(".v4-g .v4-card")
      const week = document.querySelector(".v4-bud")
      const now = document.querySelector(".v4-now")
      const savable = document.querySelector(".v4-sv")
      const box = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, r: r.x + r.width }
      }
      const ticks = [...document.querySelectorAll(".v4-bud .v4-tick")].map((t) => t.textContent?.trim())
      const pad = v4 ? getComputedStyle(v4).paddingLeft : ""
      return { pad, h1: box(h1), spend: box(spend), week: box(week), now: box(now), savable: box(savable), ticks }
    })
    expect(edges.pad).toBe("40px")
    expect(edges.h1 && edges.spend && Math.abs(edges.h1.x - edges.spend.x)).toBeLessThan(1)
    expect(edges.spend && edges.now && Math.abs(edges.spend.x - edges.now.x)).toBeLessThan(1)
    expect(edges.week && edges.savable && Math.abs(edges.week.x - edges.savable.x)).toBeLessThan(1)
    expect(edges.week && edges.spend && edges.week.r - edges.spend.r).toBeGreaterThan(8)
    expect(edges.ticks).toHaveLength(7)

    const chartClip = await page.evaluate(() => {
      const svg = document.querySelector(".v4-chart svg") as SVGSVGElement | null
      if (!svg) return { ok: false, over: 0 }
      const box = svg.getBoundingClientRect()
      let over = 0
      for (const r of svg.querySelectorAll("rect")) {
        const b = r.getBoundingClientRect()
        if (b.height < 1) continue
        over = Math.max(over, box.top - b.top, b.bottom - box.bottom)
      }
      return { ok: true, over }
    })
    expect(chartClip.ok).toBe(true)
    expect(chartClip.over).toBeLessThan(2)

    await page.goto("/#/sessions")
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
    await expect(page.locator(".v4-skel")).toHaveCount(0)
    const rowH = await page.locator(".v4-rr").first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(rowH).toBeLessThan(50)
  })

  test("session rows keep one line at 1024 and settings share the page gutter", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 620 })
    await page.addInitScript(() => {
      localStorage.setItem("aftertrace-theme", "light")
      if (document.documentElement) document.documentElement.dataset.theme = "light"
    })
    await page.goto("/#/sessions")
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
    await expect(page.locator(".v4-skel")).toHaveCount(0)
    const rowH = await page.locator(".v4-rr").first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(rowH).toBeLessThan(50)

    await page.goto("/#/findings")
    await expect(page.locator(".v4-skel")).toHaveCount(0)
    const track = page.locator(".v4-fr .trk").first()
    await expect(track).toBeVisible()
    const trackW = await track.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width)
    expect(trackW).toBeGreaterThan(40)
    const findRowH = await page.locator(".v4-fr").first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(findRowH).toBeGreaterThanOrEqual(54)
    expect(findRowH).toBeLessThanOrEqual(58)
    const nm = await page.locator(".v4-fr .nm").first().evaluate((el) => getComputedStyle(el).whiteSpace)
    expect(nm).toBe("nowrap")
    const paneOverflow = await page.locator(".v4-pane").evaluate((el) => getComputedStyle(el).overflowY)
    expect(paneOverflow).toBe("visible")
    const stripH = await page.locator(".v4-strip").evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(stripH).toBeGreaterThanOrEqual(16)

    await page.locator(".v4-fr").filter({ hasText: "PDF report" }).click()
    await expect(page.locator(".v4-pane").getByRole("button", { name: "Done" })).toHaveCount(1)
    await expect(page.locator(".v4-pane .done-btn")).toBeVisible()
    await expect(page.locator(".v4-pane .frow.hero").getByRole("button", { name: "Done" })).toHaveCount(0)

    await page.goto("/#/")
    await expect(page.locator(".v4-skel")).toHaveCount(0)
    const homeX = await page.locator(".v4-ph h1").evaluate((el) => el.getBoundingClientRect().x)
    await page.goto("/#/settings")
    const setX = await page.locator("h1").evaluate((el) => el.getBoundingClientRect().x)
    expect(Math.abs(homeX - setX)).toBeLessThan(2)
    const budget = page.locator(".budget-field")
    await expect(budget).toBeVisible()
    const budgetH = await budget.evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(budgetH).toBeLessThanOrEqual(34)
    const suffixLines = await budget.locator(".budget-suffix").evaluate((el) => el.getClientRects().length)
    expect(suffixLines).toBe(1)
  })

  test("recap long numerals wrap instead of overflowing the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/#/recap")
    await page.getByRole("button", { name: "Previous week" }).click()
    await page.getByRole("button", { name: "Previous week" }).click()
    await page.getByRole("button", { name: "Previous week" }).click()
    await expect(page.locator(".recap-primary").filter({ hasText: "$12345.67" })).toBeVisible()
    const extra = await pageOverflow(page)
    expect(extra).toBeLessThanOrEqual(1)
  })

  test("findings uses skeleton or cache, never Loading…", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/#/findings?skeleton=1")
    await expect(page.locator(".v4-skel")).toBeVisible()
    await expect(page.locator(".v4-skel .v4-fr").first()).toBeVisible()
    await expect(page.locator(".v4-skel .v4-strip i").first()).toBeVisible()
    await expect(page.getByText("Loading…")).toHaveCount(0)

    await page.goto("/#/findings")
    await expect(page.locator(".v4-fr .nm").first()).toBeVisible()
    const cached = await page.evaluate(() => sessionStorage.getItem("aftertrace.findings"))
    expect(cached).toBeTruthy()
    expect(JSON.parse(cached || "[]").length).toBeGreaterThan(0)
    await expect(page.getByText("Loading…")).toHaveCount(0)
  })
})

test("sidebar shows one Restart to update when the desktop update is ready", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    const state = {
      status: "ready",
      version: "0.5.7",
      current: "0.5.6",
      error: null,
      checkedAt: Date.now(),
    }
    window.aftertraceDesktop = {
      platform: "darwin",
      getUpdate: async () => state,
      checkUpdates: async () => state,
      restartToUpdate: async () => true,
      onUpdate: (fn) => {
        fn(state)
        return () => {}
      },
    }
  })
  await page.goto("/#/")
  await expect(page.locator(".side-update")).toHaveCount(1)
  await expect(page.locator(".side-update")).toHaveText("Restart to update · v0.5.7")
  await expect(page.locator(".recv")).toBeVisible()
  await expect(page.locator("[data-update=ready]")).toHaveCount(1)
})
