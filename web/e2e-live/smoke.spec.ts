import { expect, test } from "@playwright/test"

// The real server on demo data. Catches what the mock suite cannot: API
// shapes, handler deadlocks, embedded assets, views that fail on real SQL.
test("every page renders against the real server", async ({ page, request }) => {
  const status = await request.get("/api/status")
  expect(status.ok()).toBeTruthy()
  expect((await status.json()).sessions).toBeGreaterThan(0)

  await page.goto("/#/")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await expect(page.locator(".nav", { hasText: "Spend" })).toBeVisible()

  await page.goto("/#/sessions")
  const sessionRows = page.locator(".tbl.sess tbody tr").filter({ has: page.locator(".c-title") })
  await expect(sessionRows.first()).toBeVisible()
  const n = await sessionRows.count()
  let opened = false
  for (let i = 0; i < n; i++) {
    await sessionRows.nth(i).click()
    await expect(page.locator(".insp h2")).toBeVisible()
    await page.getByRole("link", { name: "Open session" }).click()
    await expect(page).toHaveURL(/#\/session\//)
    await page.locator("table.tbl tbody tr").first().click()
    await expect(page.locator(".st-ch").first()).toBeVisible()
    if ((await page.locator(".st-ch").filter({ has: page.locator(".st-sub") }).count()) > 0) {
      opened = true
      break
    }
    await page.goto("/#/sessions")
    await expect(sessionRows.first()).toBeVisible()
  }
  expect(opened).toBeTruthy()
  await page.locator(".st-ch").filter({ has: page.locator(".st-sub") }).first().locator(".st-ch-head").click()
  await page.locator(".st-act").first().click()
  await expect(page.locator("#pane")).toBeVisible()
  await page.getByRole("button", { name: "Close panel" }).click()
  await expect(page.locator("#pane")).toHaveCount(0)
  await page.locator(".seg-view").getByRole("tab", { name: "Timeline" }).click()
  await expect(page.locator(".wf .row[data-span]").first()).toBeVisible()

  await page.goto("/#/findings")
  await expect(page.locator(".fdet .big, .fr.sel")).toBeVisible()

  await page.goto("/#/apps")
  await expect(page.locator(".app-card")).toHaveCount(3)
  await page.locator(".app-card", { hasText: "support-bot" }).click()
  await expect(page.locator(".app-story")).toContainText("model calls")
  await page.locator(".req-row").first().click()
  await expect(page.locator(".wf .row[data-span]").first()).toBeVisible()

  await page.goto("/#/spend")
  await expect(page.locator("table.tbl tbody tr").first()).toBeVisible()

  await page.goto("/#/connect")
  await expect(page.locator(".code pre")).toContainText(/http:\/\/127\.0\.0\.1:\d+/)

  await page.goto("/#/settings")
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
})
