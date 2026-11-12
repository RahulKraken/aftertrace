import { expect, test, type Page } from "@playwright/test"

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1280", width: 1280, height: 800 },
  { name: "1024", width: 1024, height: 720 },
  { name: "960", width: 960, height: 700 },
  { name: "768", width: 768, height: 900 },
  { name: "390", width: 390, height: 844 },
]

const ROUTES = [
  "/",
  "/findings",
  "/sessions",
  "/spend",
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

  test("Today week stats stay on one line from 960 to 1440", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("aftertrace-theme", "light")
      if (document.documentElement) document.documentElement.dataset.theme = "light"
    })
    for (const width of [960, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto("/#/")
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
      await expect(page.locator(".skel-page")).toHaveCount(0)
      const valueLines = await page.locator(".hero .big").evaluateAll((els) => els.map((el) => el.getClientRects().length))
      expect(valueLines, `hero values wrap at ${width}`).toEqual(valueLines.map(() => 1))
      const capLines = await page.locator(".hero .cap").evaluateAll((els) => els.map((el) => el.getClientRects().length))
      expect(capLines, `hero captions wrap at ${width}`).toEqual(capLines.map(() => 1))
      const factLines = await page.locator(".hero .facts div").evaluateAll((els) => els.map((el) => el.getClientRects().length))
      expect(factLines, `hero facts wrap at ${width}`).toEqual(factLines.map(() => 1))
      const extra = await pageOverflow(page)
      expect(extra, `Today overflow at ${width}`).toBeLessThanOrEqual(1)
      if (width >= 1024) {
        await expect(page.locator(".today > .insp"), `Worth changing hidden at ${width}`).toBeVisible()
        const titleWidth = await page.locator(".lane .lt").first().evaluate((el) => el.clientWidth)
        expect(titleWidth, `running title cramped at ${width}`).toBeGreaterThan(280)
        const tokens = page.locator(".lane-doing .lane-tokens")
        await expect(tokens).toHaveText(/tokens/)
        const tokenBox = await tokens.evaluate((el) => ({
          lines: el.getClientRects().length,
          text: (el.textContent || "").trim(),
          sw: el.scrollWidth,
          cw: el.clientWidth,
        }))
        expect(tokenBox.lines, `running tokens wrap at ${width}`).toBe(1)
        expect(tokenBox.text, `running tokens clipped at ${width}`).toMatch(/\d/)
        expect(tokenBox.text.includes("…") || tokenBox.text.endsWith("..."), `running tokens ellipsized at ${width}`).toBe(false)
        expect(tokenBox.sw, `running tokens overflow at ${width}`).toBeLessThanOrEqual(tokenBox.cw + 1)
      } else {
        await expect(page.locator(".today > .insp")).toBeHidden()
      }

      await page.goto("/#/sessions")
      await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
      expect(await pageOverflow(page), `Sessions overflow at ${width}`).toBeLessThanOrEqual(1)
      if (width <= 1024) {
        await expect(page.locator(".sess thead th.c-shape")).toBeHidden()
        const titleW = await page.locator(".sess td.c-title").first().evaluate((el) => el.clientWidth)
        expect(titleW, `session title col at ${width}`).toBeGreaterThanOrEqual(200)
        const titles = page.locator(".sess td.c-title .title")
        const n = await titles.count()
        expect(n, `session title count at ${width}`).toBeGreaterThan(1)
        for (let i = 0; i < n; i++) {
          const text = (await titles.nth(i).innerText()).trim()
          const box = await titles.nth(i).boundingBox()
          expect(text.length, `session title ${i} at ${width}`).toBeGreaterThan(8)
          expect(box?.height || 0, `session title height ${i} at ${width}`).toBeGreaterThan(10)
        }
      }
      if (width === 960 || width === 1024) {
        const box = await page.locator(".tblwrap").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
        expect(box.sw, `sessions list wider than pane at ${width}`).toBeLessThanOrEqual(box.cw)
      }

      await page.goto("/#/findings")
      await expect(page.locator("button.fr").first()).toBeVisible()
      expect(await pageOverflow(page), `Findings overflow at ${width}`).toBeLessThanOrEqual(1)
    }
  })

  test("Today, Sessions and Findings keep the native instrument grid at 1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem("aftertrace-theme", "light")
      if (document.documentElement) document.documentElement.dataset.theme = "light"
    })
    await page.goto("/#/")
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
    await expect(page.locator(".skel-page")).toHaveCount(0)
    await expect(page.locator(".nav", { hasText: "Today" })).toBeVisible()
    await expect(page.locator(".nav", { hasText: "Sessions" })).toBeVisible()
    await expect(page.locator(".nav", { hasText: "Findings" })).toBeVisible()
    await expect(page.locator(".nav", { hasText: "Spend" })).toBeVisible()
    await expect(page.getByText("Running now")).toBeVisible()
    await expect(page.locator(".dayrow")).not.toHaveCount(0)
    await expect(page.locator(".week-stack")).toHaveCount(0)

    await page.goto("/#/sessions")
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
    await expect(page.locator(".tbl.sess tbody tr").first()).toBeVisible()
    const titles = await page.locator(".sess .title").allTextContents()
    expect(titles.some((t) => /[a-f0-9]{8}-[a-f0-9]{4}/.test(t))).toBe(false)
    const repos = await page.locator(".sess .meta").allTextContents()
    expect(repos.some((t) => t.includes("…") || t.includes("acme-..."))).toBe(false)
    expect(repos.some((t) => /acme|aftertrace|dotfiles/i.test(t))).toBe(true)
    await expect(page.getByText("Turns", { exact: true })).toBeVisible()
    await expect(page.locator(".insp .list").first().locator(".li .t div").first()).not.toHaveText(/^Turn \d+$/)

    await page.goto("/#/findings")
    await expect(page.locator("button.fr").first()).toBeVisible()
    const findingTitles = (await page.locator("button.fr .t").allTextContents()).map((t) => t.trim())
    expect(findingTitles.every((t) => t.length > 10)).toBe(true)
    await expect(page.locator("button.fr", { hasText: /PDF report/i })).toHaveCount(1)
    await expect(page.locator(".fdet .big")).toBeVisible()
    await expect(page.getByRole("button", { name: "Copy fix" })).toBeVisible()
    await expect(page.locator(".nav", { hasText: "Findings" }).locator(".ct")).toHaveText(/^\d+$/)
    const badge = (await page.locator(".nav", { hasText: "Findings" }).locator(".ct").textContent())?.trim()
    await expect(page.locator(".tb .sub")).toHaveText(`${badge} open`)
    await expect(page.locator(".fdet .list .li").first()).toBeVisible()
    await expect(page.locator(".fdet .list .li .t div").first()).not.toHaveText(/^\$\d/)
  })

  test("session rows wrap repo under the title and settings keep the page gutter", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 620 })
    await page.addInitScript(() => {
      localStorage.setItem("aftertrace-theme", "light")
      if (document.documentElement) document.documentElement.dataset.theme = "light"
    })
    await page.goto("/#/sessions")
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible()
    const row = page.locator(".sess tbody tr.run, .sess tbody tr").filter({ has: page.locator(".c-title") }).first()
    await expect(row.locator(".meta").first()).toBeVisible()

    await page.goto("/#/findings")
    await page.locator(".fr").filter({ hasText: "PDF report" }).click()
    await expect(page.getByRole("button", { name: "Copy fix" })).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0)

    await page.goto("/#/")
    const homeHeading = page.getByRole("heading", { name: "Today" })
    await expect(homeHeading).toBeVisible()
    await expect.poll(async () => homeHeading.evaluate((el) => el.getBoundingClientRect().x)).toBeGreaterThan(100)
    const homeX = await homeHeading.evaluate((el) => el.getBoundingClientRect().x)
    await page.goto("/#/settings")
    const setHeading = page.getByRole("heading", { name: "Settings" })
    await expect(setHeading).toBeVisible()
    await expect.poll(async () => setHeading.evaluate((el) => el.getBoundingClientRect().x)).toBeGreaterThan(100)
    const setX = await setHeading.evaluate((el) => el.getBoundingClientRect().x)
    expect(Math.abs(homeX - setX)).toBeLessThan(24)
    const budget = page.locator(".budget-field")
    await expect(budget).toBeVisible()
    const suffixLines = await budget.locator(".budget-suffix").evaluate((el) => el.getClientRects().length)
    expect(suffixLines).toBe(1)
  })

  test("Spend long numerals stay on the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/#/spend")
    await expect(page.getByRole("heading", { name: "Spend" })).toBeVisible()
    const extra = await pageOverflow(page)
    expect(extra).toBeLessThanOrEqual(1)
  })

  test("findings uses skeleton or cache, never Loading…", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/#/findings?skeleton=1")
    await expect(page.locator(".skel-page")).toBeVisible()
    await expect(page.getByText("Loading…")).toHaveCount(0)

    await page.goto("/#/findings")
    await expect(page.locator(".fr .t").first()).toBeVisible()
    const cached = await page.evaluate(() => sessionStorage.getItem("aftertrace.findings"))
    expect(cached).toBeTruthy()
    expect(JSON.parse(cached || "[]").length).toBeGreaterThan(0)
    await expect(page.getByText("Loading…")).toHaveCount(0)
  })
})

test("search hint is the Mac glyph when the desktop shell is darwin", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    window.aftertraceDesktop = {
      platform: "darwin",
      getUpdate: async () => ({ status: "idle", version: null, current: "0.5.7", error: null }),
      checkUpdates: async () => ({ status: "idle" }),
      restartToUpdate: async () => true,
      onUpdate: () => () => {},
    }
  })
  await page.goto("/#/")
  await expect(page.locator(".search kbd")).toHaveText("⌘K")
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

test("long turn expands without scrolling the window", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 })
  await page.goto("/#/trace/509cb3acac23db7c6e9b7d180a474268?long=1")
  await expect(page.locator(".step-group")).toContainText("more steps")
  await page.locator(".step-group .link").click()
  await expect(page.locator(".step-group")).toHaveCount(0)
  const pane = page.locator(".st-scroll")
  await expect.poll(async () => pane.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40)
  await pane.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const scrolled = await pane.evaluate((el) => ({ top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }))
  expect(scrolled.top, "turn pane did not scroll to the end").toBeGreaterThan(40)
  expect(scrolled.top + scrolled.ch, "turn pane not at end").toBeGreaterThanOrEqual(scrolled.sh - 2)
  const docTop = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)
  expect(docTop, "document scrolled after expanding a long turn").toBe(0)
  await expect(page.locator(".nav", { hasText: "Today" })).toBeVisible()
  const side = await page.locator(".side").boundingBox()
  expect(side?.x ?? 99).toBeLessThan(8)
  await expect(page.locator(".st-end")).toBeVisible()
  const times = await page.locator(".st-time").allTextContents()
  const toSec = (s: string) => {
    const p = s.trim().split(":").map(Number)
    if (p.some((n) => Number.isNaN(n))) return 0
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
    if (p.length === 2) return p[0] * 60 + p[1]
    return p[0] || 0
  }
  const stepTimes = times.slice(0, -1).map(toSec)
  const done = toSec(times[times.length - 1] || "0")
  expect(stepTimes.length, "expanded long turn has steps").toBeGreaterThan(10)
  expect(done, "Done clock behind a later step").toBeGreaterThanOrEqual(Math.max(...stepTimes))
})
