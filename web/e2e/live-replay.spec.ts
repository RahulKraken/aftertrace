import { expect, test } from "@playwright/test"
import { copyFileSync, globSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERO_TRACE = "509cb3acac23db7c6e9b7d180a474268"
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../screenshots")

test.use({
  video: { mode: "on", size: { width: 1440, height: 900 } },
})

test("live replay at 4x", async ({ page }) => {
  mkdirSync(outDir, { recursive: true })
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    document.documentElement.dataset.theme = "light"
  })
  await page.goto(`/#/trace/${HERO_TRACE}?replay=1`)
  await expect(page.locator(".wf")).toBeVisible()
  await expect(page.locator(".live-badge")).toContainText("Live")
  await expect(page.locator(".playhead").first()).toBeVisible()
  // 4×: 20s axis at ~5s wall, 30s at ~7.5s, 1m at ~15s.
  await page.waitForTimeout(16_000)
  await expect(page.locator(".tick").last()).toContainText(/m|s/)
})

test.afterAll(() => {
  mkdirSync(outDir, { recursive: true })
  const hits = globSync("test-results/**/video.webm", {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  })
  const live = hits.find((h) => h.includes("live-replay")) || hits[0]
  if (live) {
    copyFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", live), resolve(outDir, "waterfall-live-replay.webm"))
  }
})
