import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, "..", "public", "mac-download.js"), "utf8")

function load() {
  const ctx = { globalThis: {} }
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  return ctx.AftertraceMacDownload
}

describe("mac-download", () => {
  it("defaults to Apple silicon", () => {
    const m = load()
    assert.equal(m.detectMacChip({}), "arm64")
    assert.equal(m.detectMacChip({ platform: "MacIntel", userAgent: "Macintosh; Intel Mac OS X 10_15_7" }), "arm64")
  })

  it("honours high-entropy architecture and GPU hints", () => {
    const m = load()
    assert.equal(m.detectMacChip({ __architecture: "arm" }), "arm64")
    assert.equal(m.detectMacChip({ __architecture: "x86" }), "x64")
    assert.equal(m.detectMacChip({ __gpuRenderer: "Apple M3 Pro" }), "arm64")
    assert.equal(m.detectMacChip({ __gpuRenderer: "Intel Iris Plus Graphics" }), "x64")
    assert.equal(m.detectMacChip({ __gpuRenderer: "AMD Radeon Pro 5500M" }), "x64")
  })

  it("points the primary button at the detected chip and the secondary at the other", () => {
    const m = load()
    const ids = {}
    const doc = {
      getElementById(id) {
        if (!ids[id]) ids[id] = { href: "", textContent: "", setAttribute(k, v) { this[k] = v } }
        return ids[id]
      },
    }
    m.apply(doc, "x64")
    assert.equal(ids["mac-download"].href, m.RELEASE + "/Aftertrace-mac-x64.dmg")
    assert.equal(ids["mac-download-other"].href, m.RELEASE + "/Aftertrace-mac-arm64.dmg")
    assert.equal(ids["mac-download-other"].textContent, "Download for Apple silicon")
    m.apply(doc, "arm64")
    assert.equal(ids["mac-download"].href, m.RELEASE + "/Aftertrace-mac-arm64.dmg")
    assert.equal(ids["mac-download-other"].textContent, "Download for Intel Mac")
  })

  it("hides open-notes only when the latest release has the notarized marker", async () => {
    const m = load()
    const notes = [{ hidden: false }]
    const doc = { querySelectorAll: () => notes }
    const unsigned = await m.hideOpenNotesIfNotarized(doc, async () => ({
      ok: true,
      json: async () => ({ assets: [{ name: "Aftertrace-mac-arm64.dmg" }] }),
    }))
    assert.equal(unsigned, false)
    assert.equal(notes[0].hidden, false)
    const signed = await m.hideOpenNotesIfNotarized(doc, async () => ({
      ok: true,
      json: async () => ({ assets: [{ name: m.NOTARIZED_ASSET }] }),
    }))
    assert.equal(signed, true)
    assert.equal(notes[0].hidden, true)
  })
})

describe("site landing page", () => {
  it("wires the chip script and keeps the no-JS href on the arm64 alias", () => {
    const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8")
    assert.match(html, /id="mac-download"/)
    assert.match(html, /id="mac-download-other"/)
    assert.match(html, /mac-download\.js/)
    assert.match(html, /Aftertrace-mac\.dmg/)
    assert.match(html, /class="open-note"/)
  })
})
