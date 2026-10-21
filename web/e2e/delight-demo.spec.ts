import { expect, test } from "@playwright/test"

test.use({
  video: { mode: "on", size: { width: 1440, height: 900 } },
})

test("delight demo under 30s", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    if (document.documentElement) document.documentElement.dataset.theme = "light"
    localStorage.setItem("aftertrace-resolved", JSON.stringify([4]))
  })

  await page.goto("/#/findings")
  const hero = page.locator(".frow.hero")
  await expect(hero).toBeVisible()
  await page.waitForTimeout(600)

  await hero.locator(".ev").first().click()
  await expect(page.locator(".wf")).toBeVisible()
  await expect(page.locator(".pane")).toBeVisible()
  await page.waitForTimeout(700)

  const ruler = page.locator(".ruler .trk")
  const box = await ruler.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.mouse.move(box.x + box.width * 0.36, box.y + 80)
  }
  await expect(page.locator(".minimap")).toBeVisible()
  await page.waitForTimeout(600)

  await page.keyboard.press("j")
  await page.waitForTimeout(250)
  await page.keyboard.press("j")
  await page.waitForTimeout(400)

  await page.goto("/#/findings")
  await expect(page.locator(".frow.hero .fix-btn")).toBeVisible()
  await expect(page.locator(".frow.hero")).toContainText("permission prompts")
  await page.locator(".frow.hero .fix-btn").click()
  await expect(page.locator(".win-stage")).toBeVisible()
  await expect(page.locator(".win-figure")).toHaveText("6")
  await expect(page.locator(".win-label")).toContainText("prompts removed")
  await page.waitForTimeout(1600)
  await expect(page.locator(".win-stage")).toHaveCount(0)
  await expect(page.locator(".frow.resolved").filter({ hasText: "npm test" })).toBeVisible()

  await page.keyboard.press("Control+k")
  await expect(page.locator(".cmd")).toBeVisible()
  await page.waitForTimeout(350)
  await page.locator(".cmd input").fill("sessions")
  await page.waitForTimeout(350)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("heading", { name: /waiting on approvals/ })).toBeVisible()
  await page.waitForTimeout(500)
})
