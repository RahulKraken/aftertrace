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
    const rowH = await page.locator(".v4-rr").first().evaluate((el) => (el as HTMLElement).getBoundingClientRect().height)
    expect(rowH).toBeLessThan(50)

    await page.goto("/#/findings")
    const track = page.locator(".v4-fr .trk").first()
    await expect(track).toBeVisible()
    const trackW = await track.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width)
    expect(trackW).toBeGreaterThan(40)

    await page.goto("/#/")
    const homeX = await page.locator(".v4-ph h1").evaluate((el) => el.getBoundingClientRect().x)
    await page.goto("/#/settings")
    const setX = await page.locator("h1").evaluate((el) => el.getBoundingClientRect().x)
    expect(Math.abs(homeX - setX)).toBeLessThan(2)
  })
})
