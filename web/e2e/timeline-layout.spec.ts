import { expect, test, type Page } from "@playwright/test"

const WIDE = "wide-turn"
const WIDTHS = [960, 1024, 1440] as const

async function openTimeline(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    localStorage.setItem("aftertrace-trace-view", "timeline")
    if (document.documentElement) document.documentElement.dataset.theme = "light"
  })
  await page.goto(`/#/trace/${WIDE}?view=timeline`)
  await expect(page.locator(".wf-body")).toBeVisible()
  await expect(page.locator(".row [data-bar]").first()).toBeVisible()
  await expect.poll(async () => page.locator(".row [data-bar]").first().evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(2)
}

async function openAllSteps(page: Page) {
  for (let guard = 0; guard < 50; guard++) {
    const closed = page.locator(".row").filter({ has: page.locator("button.caret[aria-expanded='false']") })
    if ((await closed.count()) === 0) return
    const id = await closed.first().getAttribute("data-span")
    await closed.first().locator("button.caret").dispatchEvent("click")
    if (id) await expect(page.locator(`.row[data-span="${id}"] button.caret`)).toHaveAttribute("aria-expanded", "true")
  }
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, slack = 0.75) {
  return a.x + slack < b.x + b.w && b.x + slack < a.x + a.w && a.y + slack < b.y + b.h && b.y + slack < a.y + a.h
}

test.describe("timeline layout hotfix", () => {
  for (const width of WIDTHS) {
    test(`labels, bars and overflow at ${width}`, async ({ page }) => {
      await openTimeline(page, width)
      await expect(page.locator(".tb .sub")).toHaveText("Turn 1 of 293")
      await expect(page.locator(".tb .sub")).not.toContainText("wall clock")
      await expect(page.locator(".story-line")).toHaveCount(0)
      await expect(page.locator(".live-badge.is-done")).toHaveCount(0)
      await expect(page.locator(".wf-stat").filter({ hasText: "Duration" }).locator(".v")).toHaveText("2m 23s")
      await expect(page.locator(".caret.count")).toHaveCount(0)
      const caretText = await page.locator("button.caret").evaluateAll((els) => els.map((el) => (el.textContent || "").replace(/\s+/g, "").trim()))
      expect(caretText.every((t) => !/^\d+$/.test(t)), `caret badges at ${width}: ${caretText.join(",")}`).toBe(true)

      const header = await page.locator(".tb").evaluate((el) => {
        const title = el.querySelector("h1")
        const sub = el.querySelector(".sub")
        return {
          height: el.getBoundingClientRect().height,
          titleLines: title ? title.getClientRects().length : 0,
          subLines: sub ? sub.getClientRects().length : 0,
        }
      })
      expect(header.height, `header wraps at ${width}`).toBeLessThanOrEqual(56)
      expect(header.titleLines, `session title wraps at ${width}`).toBe(1)
      expect(header.subLines, `turn sub wraps at ${width}`).toBe(1)

      await openAllSteps(page)
      await expect(page.locator(".row [data-bar]").first()).toBeVisible()
      await expect(page.locator(".bar-lab").filter({ hasText: "$1.45" }).first()).toBeVisible()
      await expect(page.locator(".bar-lab").filter({ hasText: "1m 27s" }).first()).toBeVisible()

      const measured = await page.evaluate(() => {
        const trk = document.querySelector(".ruler .trk") as HTMLElement | null
        const rowsEl = document.querySelector(".rows") as HTMLElement | null
        const body = document.querySelector(".wf-body") as HTMLElement | null
        const names = [...document.querySelectorAll(".row .name")].map((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height, text: (el.textContent || "").trim() }
        })
        const rows = [...document.querySelectorAll(".row[data-ms]")].map((el) => {
          const html = el as HTMLElement
          const bar = html.querySelector("[data-bar]") as HTMLElement | null
          const br = bar?.getBoundingClientRect()
          return {
            id: html.dataset.span || "",
            ms: Number(html.dataset.ms || 0),
            isTurn: Boolean(html.querySelector(".glyph.g-turn")),
            bar: br ? { x: br.x, y: br.y, w: br.width, h: br.height } : null,
          }
        })
        const labs = [...document.querySelectorAll(".row .bar-lab")].map((el) => {
          const html = el as HTMLElement
          const r = html.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            text: (html.textContent || "").trim(),
            scrollW: html.scrollWidth,
            clientW: html.clientWidth,
          }
        })
        return {
          trackRight: trk?.getBoundingClientRect().right ?? 0,
          viewRight: document.documentElement.clientWidth,
          names,
          rows,
          labs,
          rowsOverflow: rowsEl ? rowsEl.scrollWidth - rowsEl.clientWidth : 0,
          bodyOverflow: body ? body.scrollWidth - body.clientWidth : 0,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })

      const timed = measured.rows.filter((r) => r.ms > 0)
      expect(timed.length, `timed rows at ${width}`).toBeGreaterThan(4)
      expect(measured.names.some((n) => n.text.length > 40), `long name visible at ${width}`).toBe(true)
      for (const row of timed) {
        expect(row.bar, `missing bar for timed row at ${width}: ${row.id}`).toBeTruthy()
        expect(row.bar!.w, `bar width at ${width}: ${row.id}`).toBeGreaterThanOrEqual(2)
      }

      const turn = measured.rows.find((r) => r.isTurn)
      const kids = measured.rows.filter((r) => !r.isTurn && r.bar)
      expect(turn?.bar, `parent turn bar at ${width}`).toBeTruthy()
      expect(kids.length, `child bars at ${width}`).toBeGreaterThan(1)
      const kidLeft = Math.min(...kids.map((k) => k.bar!.x))
      const kidRight = Math.max(...kids.map((k) => k.bar!.x + k.bar!.w))
      expect(Math.abs(turn!.bar!.x - kidLeft), `parent bar start at ${width}`).toBeLessThanOrEqual(1)
      expect(Math.abs(turn!.bar!.x + turn!.bar!.w - kidRight), `parent bar end at ${width}`).toBeLessThanOrEqual(1)

      const bars = timed.map((r) => r.bar!).filter(Boolean)
      for (const name of measured.names) {
        for (const bar of bars) {
          expect(overlap(name, bar), `name overlaps bar at ${width}: "${name.text.slice(0, 40)}"`).toBe(false)
        }
        for (const lab of measured.labs) {
          expect(overlap(name, lab), `name overlaps bar label at ${width}: "${name.text.slice(0, 40)}" vs "${lab.text}"`).toBe(false)
        }
      }
      for (const lab of measured.labs) {
        expect(lab.scrollW, `label text clipped at ${width}: "${lab.text}"`).toBeLessThanOrEqual(lab.clientW + 1)
        expect(lab.x + lab.w, `bar label past track at ${width}: "${lab.text}"`).toBeLessThanOrEqual(measured.trackRight + 1)
        expect(lab.x + lab.w, `bar label past viewport at ${width}: "${lab.text}"`).toBeLessThanOrEqual(measured.viewRight + 1)
      }
      expect(measured.rowsOverflow, `rows overflow at ${width}`).toBeLessThanOrEqual(1)
      expect(measured.bodyOverflow, `timeline overflow at ${width}`).toBeLessThanOrEqual(1)
      expect(measured.pageOverflow, `page overflow at ${width}`).toBeLessThanOrEqual(1)
    })
  }

  test("cursor chip is the offset from turn start", async ({ page }) => {
    await openTimeline(page, 1024)
    const trk = page.locator(".ruler .trk")
    const box = await trk.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.move((box?.x || 0) + (box?.width || 0) * 0.35, (box?.y || 0) + 8)
    const chip = page.locator(".crosshair-label")
    await expect(chip).toBeVisible()
    const text = ((await chip.textContent()) || "").trim()
    expect(text).toMatch(/^\d+(\.\d)?(ms|s)|^\d+m( \d+s)?$/)
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/)
    expect(text).not.toContain("·")
  })

  test("sidebar badges stay inside the sidebar at 1024 and 1280", async ({ page }) => {
    for (const width of [1024, 1280]) {
      await openTimeline(page, width)
      const side = page.locator(".side")
      await expect(side).toBeVisible()
      const sideBox = await side.boundingBox()
      expect(sideBox?.width || 0, `sidebar width at ${width}`).toBeGreaterThanOrEqual(200)
      const badges = page.locator(".side .nav .ct, .side .nav .live, .side .foot .dot")
      const n = await badges.count()
      expect(n, `sidebar marks at ${width}`).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) {
        const b = await badges.nth(i).boundingBox()
        if (!b || !sideBox) continue
        expect(b.x, `badge left at ${width}`).toBeGreaterThanOrEqual(sideBox.x - 1)
        expect(b.x + b.width, `badge right at ${width}`).toBeLessThanOrEqual(sideBox.x + sideBox.width + 1)
      }
    }
  })
})
