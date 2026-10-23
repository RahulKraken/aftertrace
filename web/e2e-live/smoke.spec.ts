import { expect, test } from "@playwright/test"

// The real server on demo data. Catches what the mock suite cannot: API
// shapes, handler deadlocks, embedded assets, views that fail on real SQL.
test("every page renders against the real server", async ({ page, request }) => {
  const status = await request.get("/api/status")
  expect(status.ok()).toBeTruthy()
  expect((await status.json()).sessions).toBeGreaterThan(0)

  await page.goto("/#/")
  await expect(page.locator(".home-story")).toContainText("Your agents worked")
  await expect(page.locator(".stat")).toHaveCount(5)

  await page.goto("/#/sessions")
  await expect(page.locator(".sessions-grid tbody tr:not(.day-row)").first()).toBeVisible()
  await page.locator(".sessions-grid tbody tr:not(.day-row)").first().click()
  await expect(page).toHaveURL(/#\/session\//)
  await page.locator("table.grid tbody tr").first().click()
  // A turn opens as a story: steps that open into actions, each with an inspector.
  await expect(page.locator(".st-ch").first()).toBeVisible()
  await page.locator(".st-ch").filter({ has: page.locator(".st-sub") }).first().locator(".st-ch-head").click()
  await page.locator(".st-act").first().click()
  await expect(page.locator("#pane")).toBeVisible()
  await page.getByRole("button", { name: "Close panel" }).click()
  await expect(page.locator("#pane")).toHaveCount(0)
  await page.locator(".seg-view").getByRole("tab", { name: "Timeline" }).click()
  await expect(page.locator(".wf .row[data-span]").first()).toBeVisible()

  await page.goto("/#/findings")
  await expect(page.locator(".frow.hero")).toBeVisible()

  await page.goto("/#/apps")
  await expect(page.locator(".app-card")).toHaveCount(3)
  await page.locator(".app-card", { hasText: "support-bot" }).click()
  await expect(page.locator(".app-story")).toContainText("model calls")
  await page.locator(".req-row").first().click()
  await expect(page.locator(".wf .row[data-span]").first()).toBeVisible()

  await page.goto("/#/cost")
  await expect(page.locator("table.grid tbody tr").first()).toBeVisible()

  await page.goto("/#/plans")
  await expect(page.locator(".plans-total")).toBeVisible()
  await expect(page.locator(".plans-row").first()).toBeVisible()

  await page.goto("/#/connect")
  await expect(page.locator(".code pre")).toContainText(/http:\/\/127\.0\.0\.1:\d+/)

  await page.goto("/#/settings")
  await expect(page.locator(".kv")).toContainText("dev")
})
