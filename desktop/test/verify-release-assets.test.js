"use strict"

const { it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-rel-"))
  const touch = (name, body = "x") => fs.writeFileSync(path.join(dir, name), body)
  touch("aftertrace_v0.5.0_darwin_arm64.tar.gz")
  touch("aftertrace_v0.5.0_darwin_amd64.tar.gz")
  touch("aftertrace_v0.5.0_linux_amd64.tar.gz")
  touch("aftertrace_v0.5.0_linux_arm64.tar.gz")
  touch("Aftertrace-mac-arm64.dmg", "arm")
  touch("Aftertrace-mac.dmg", "arm")
  touch("Aftertrace-mac-arm64.zip")
  touch("Aftertrace-mac.zip")
  touch("Aftertrace-win.exe")
  touch("Aftertrace-linux.AppImage")
  touch("Aftertrace-linux.deb")
  touch(
    "latest-mac.yml",
    "version: 0.5.0\nfiles:\n  - url: Aftertrace-mac-arm64.zip\npath: Aftertrace-mac-arm64.zip\n",
  )
  touch("latest.yml", "version: 0.5.0\n")
  return dir
}

it("verify-release-assets accepts Apple-silicon Mac files with an arm64 alias", () => {
  const dir = fixtureDir()
  const script = path.join(__dirname, "..", "..", "scripts", "verify-release-assets.sh")
  const r = spawnSync("sh", [script, dir], { encoding: "utf8" })
  fs.rmSync(dir, { recursive: true, force: true })
  assert.equal(r.status, 0, r.stderr || r.stdout)
})

it("rejects latest-mac.yml that lists the Intel zip", () => {
  const dir = fixtureDir()
  fs.writeFileSync(
    path.join(dir, "latest-mac.yml"),
    "version: 0.5.0\nfiles:\n  - url: Aftertrace-mac-arm64.zip\n  - url: Aftertrace-mac-x64.zip\npath: Aftertrace-mac-arm64.zip\n",
  )
  const script = path.join(__dirname, "..", "..", "scripts", "verify-release-assets.sh")
  const r = spawnSync("sh", [script, dir], { encoding: "utf8" })
  fs.rmSync(dir, { recursive: true, force: true })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr || "", /x64/)
})

it("consumer release requires Aftertrace-mac-notarized.json when REQUIRE_MAC_NOTARIZE is set", () => {
  const dir = fixtureDir()
  const script = path.join(__dirname, "..", "..", "scripts", "verify-release-assets.sh")
  const missing = spawnSync("sh", [script, dir], {
    encoding: "utf8",
    env: { ...process.env, REQUIRE_MAC_NOTARIZE: "true" },
  })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr || "", /Aftertrace-mac-notarized\.json/)
  fs.writeFileSync(path.join(dir, "Aftertrace-mac-notarized.json"), '{"notarized":true}\n')
  const ok = spawnSync("sh", [script, dir], {
    encoding: "utf8",
    env: { ...process.env, REQUIRE_MAC_NOTARIZE: "true" },
  })
  fs.rmSync(dir, { recursive: true, force: true })
  assert.equal(ok.status, 0, ok.stderr || ok.stdout)
})
