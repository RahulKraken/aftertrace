import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(here, "..", "public", "styles.css"), "utf8")
const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8")

describe("site shared content grid", () => {
  it("declares one 1120px site measure and inset used by header, docs and footer", () => {
    assert.match(css, /--site:\s*1120px/)
    assert.match(css, /--site-inset:/)
    assert.match(css, /\.top[^}]*padding:\s*0 var\(--site-inset\)/)
    assert.match(css, /\.foot[^}]*padding:\s*28px var\(--site-inset\)/)
    assert.match(css, /\.docs[^}]*padding:\s*32px var\(--site-inset\)/)
    assert.doesNotMatch(css, /\.foot[^}]*max-width:\s*1120px/)
  })

  it("lets the How-it-works figure share the band width instead of a 980px cap", () => {
    assert.doesNotMatch(css, /max-width:\s*980px/)
    assert.match(css, /\.band\.how \.figure-embed[^}]*max-width:\s*none/)
    assert.match(css, /\.band\.how \.figure-embed[^}]*width:\s*100%/)
  })

  it("lets Start-in-a-minute cards share the band instead of a 760px cap", () => {
    assert.doesNotMatch(css, /\.steps[^}]*max-width:\s*760px/)
    assert.match(css, /\.steps[^}]*minmax\(0,\s*1fr\)/)
  })

  it("wraps long commands inside cards instead of masking overflow", () => {
    assert.match(css, /\.ps code \{[^}]*white-space:\s*nowrap/)
    assert.match(css, /\.steps pre code[^}]*overflow-wrap:\s*anywhere/)
    assert.match(css, /\.steps pre code[^}]*white-space:\s*pre-wrap/)
    assert.doesNotMatch(css, /html\s*\{[^}]*overflow:\s*hidden/)
    assert.doesNotMatch(css, /body\s*\{[^}]*overflow:\s*hidden/)
  })
})

describe("site download stays on the signed latest Mac DMG", () => {
  it("hero, start card and chip keep Aftertrace-mac.dmg", () => {
    assert.match(html, /id="mac-download"[^>]*Aftertrace-mac\.dmg/)
    assert.match(html, /id="mac-start"[^>]*Aftertrace-mac\.dmg/)
    assert.match(html, /id="mac-download-other"[^>]*Aftertrace-mac\.dmg/)
    assert.match(html, /<pre><code>curl -fsSL https:\/\/rahulkraken\.github\.io\/aftertrace\/install\.sh \| sh<\/code><\/pre>/)
  })
})
