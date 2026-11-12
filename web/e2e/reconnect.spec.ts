import { expect, test } from "@playwright/test"

test("API flap keeps last data and never shows driver errors", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
  })
  await page.goto("/#/")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await expect(page.locator(".body.today")).toBeVisible()
  await expect(page.getByText("Running now")).toBeVisible()
  const before = await page.locator(".body.today").innerText()
  expect(before.length).toBeGreaterThan(40)

  await page.evaluate(() => {
    ;(window as unknown as { __aftertraceFlap: number }).__aftertraceFlap = 6
    window.dispatchEvent(new Event("aftertrace-retry"))
  })
  await expect(page.getByText("Reconnecting…")).toBeVisible()
  await expect(page.locator("[data-reconnect]")).toHaveText("Reconnecting…")
  await expect(page.getByText("Running now")).toBeVisible()
  const during = await page.locator(".body.today").innerText()
  expect(during).not.toMatch(/sql:/i)
  expect(during).not.toMatch(/database is closed/i)
  expect(during).not.toMatch(/Out of Memory/i)
  expect(during.slice(0, 80)).toBe(before.slice(0, 80))

  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("aftertrace-retry")))
    return page.locator("[data-reconnect]").count()
  }, { timeout: 30_000 }).toBe(0)

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await expect(page.locator("body")).not.toContainText("sql: database is closed")
})
