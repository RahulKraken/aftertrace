"use strict"

const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { stageEngine, selectEngine } = require("../scripts/before-pack.cjs")
const { archName } = require("../scripts/mac-arch.cjs")
const { assertEngineArch } = require("../scripts/after-pack.cjs")

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-pack-"))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeEngine(rel, body) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

describe("mac-arch", () => {
  it("maps electron-builder Arch enum values", () => {
    assert.equal(archName(1), "x64")
    assert.equal(archName(3), "arm64")
    assert.equal(archName("amd64"), "x64")
    assert.equal(archName("aarch64"), "arm64")
  })
})

describe("before-pack", () => {
  it("stages the matching chip's engine and leaves the other one out", () => {
    writeEngine("resources/engine-arch/darwin-arm64/aftertrace", "arm-engine")
    writeEngine("resources/engine-arch/darwin-x64/aftertrace", "x64-engine")
    const dest = stageEngine(root, "darwin", "arm64")
    assert.equal(fs.readFileSync(dest, "utf8"), "arm-engine")
    stageEngine(root, "darwin", 1)
    assert.equal(fs.readFileSync(path.join(root, "resources", "engine", "aftertrace"), "utf8"), "x64-engine")
  })

  it("rejects universal packs", () => {
    writeEngine("resources/engine/aftertrace", "fat")
    assert.throws(() => selectEngine(root, "darwin", "universal"), /Universal Mac builds are disabled/)
  })

  it("falls back to resources/engine for Windows", () => {
    writeEngine("resources/engine/aftertrace.exe", "win-engine")
    const dest = stageEngine(root, "win32", "x64")
    assert.equal(fs.readFileSync(dest, "utf8"), "win-engine")
  })
})

describe("after-pack engine arch", () => {
  it("rejects a fat binary", () => {
    const bin = writeEngine("aftertrace", "x")
    assert.throws(
      () =>
        assertEngineArch(bin, "arm64", {
          file: "Mach-O universal binary with 2 architectures",
          lipo: "Architectures in the fat file: aftertrace are: x86_64 arm64",
        }),
      /fat\/universal/,
    )
  })

  it("rejects a x86_64 engine in an arm64 pack", () => {
    const bin = writeEngine("aftertrace", "x")
    assert.throws(
      () => assertEngineArch(bin, "arm64", { file: "Mach-O 64-bit executable x86_64", lipo: "Non-fat file: aftertrace is architecture: x86_64" }),
      /not arm64/,
    )
  })

  it("accepts a matching non-fat engine", () => {
    const bin = writeEngine("aftertrace", "x")
    assertEngineArch(bin, "x64", { file: "Mach-O 64-bit executable x86_64", lipo: "Non-fat file: aftertrace is architecture: x86_64" })
    assertEngineArch(bin, 3, { file: "Mach-O 64-bit executable arm64", lipo: "Non-fat file: aftertrace is architecture: arm64" })
  })
})
