import { expect, test, type Page } from "@playwright/test"

// Off in CI. AFTERTRACE_README_DEMO=1 records docs/images/demo.gif via
// web/scripts/gen-readme-demo.sh. Fixture UI only; the Mac extra is native
// NSMenu and cannot be captured here.
test.use({
  video: { mode: "on", size: { width: 1440, height: 900 } },
})

async function waitFonts(page: Page) {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('600 28px "Inter"')
    await document.fonts.load('500 28px "Inter"')
    await document.fonts.load('600 20px "Newsreader"')
    await document.fonts.load('500 22px "Geist Mono"')
    return document.fonts.check('600 28px "Inter"')
  })
  expect(loaded).toBe(true)
}

test("readme demo under 20s", async ({ page }) => {
  test.skip(process.env.AFTERTRACE_README_DEMO !== "1", "set AFTERTRACE_README_DEMO=1")

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(() => {
    localStorage.setItem("aftertrace-theme", "light")
    if (document.documentElement) document.documentElement.dataset.theme = "light"
    localStorage.setItem("aftertrace-resolved", JSON.stringify(["permission.allow_rule_candidate:# permission prompts for Bash(git commit:*), all approved"]))
  })

  await page.goto("/#/")
  await waitFonts(page)
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  await expect(page.locator(".lane").first()).toBeVisible()
  await expect(page.getByText("Running now")).toBeVisible()
  await page.waitForTimeout(4500)

  await page.getByRole("link", { name: "Findings" }).click()
  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible()
  const hero = page.locator(".fr.sel")
  await expect(hero).toBeVisible()
  await page.waitForTimeout(2800)

  await page.locator(".fr").first().click()
  await expect(page.locator(".fdet .big")).toBeVisible()
  await page.waitForTimeout(4500)

  const ev = page.locator(".fdet .li").first()
  if (await ev.count()) {
    await ev.click()
    await expect(page.locator(".wf")).toBeVisible({ timeout: 8000 })
    await page.waitForTimeout(3500)
  }
})
