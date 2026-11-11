import { expect, test } from "@playwright/test"

test.use({
  video: { mode: "on", size: { width: 1440, height: 900 } },
})

test("delight demo under 30s", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    if (document.documentElement) document.documentElement.dataset.theme = "light"
    localStorage.setItem("aftertrace-resolved", JSON.stringify(["permission.allow_rule_candidate:# permission prompts for Bash(git commit:*), all approved"]))
  })

  await page.goto("/#/findings")
  const hero = page.locator(".fr.sel")
  await expect(hero).toBeVisible()
  await page.waitForTimeout(600)

  await page.getByRole("button", { name: "Copy fix" }).click()
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible()
  await page.waitForTimeout(900)

  await page.goto("/#/")
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await page.waitForTimeout(400)
})
