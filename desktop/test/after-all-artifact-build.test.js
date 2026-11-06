"use strict"

const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  afterAllArtifactBuild,
  collectNotarizeTargets,
  collectAppBundles,
  notarytoolSubmitArgs,
  notarizeFiles,
  NOTARY_WAIT_SECONDS,
} = require("../scripts/after-all-artifact-build.cjs")

describe("collectNotarizeTargets", () => {
  it("takes per-chip DMGs and zips and ignores aliases, yml, and blockmaps", () => {
    const got = collectNotarizeTargets([
      "/out/Aftertrace-mac-arm64.dmg",
      "/out/Aftertrace-mac-x64.dmg",
      "/out/Aftertrace-mac-arm64.zip",
      "/out/Aftertrace-mac-x64.zip",
      "/out/Aftertrace-mac-arm64.zip.blockmap",
      "/out/Aftertrace-mac.dmg",
      "/out/Aftertrace-mac.zip",
      "/out/latest-mac.yml",
    ])
    assert.deepEqual(
      got.map((p) => path.basename(p)),
      [
        "Aftertrace-mac-arm64.dmg",
        "Aftertrace-mac-x64.dmg",
        "Aftertrace-mac-arm64.zip",
        "Aftertrace-mac-x64.zip",
      ],
    )
  })

  it("dedupes by basename", () => {
    const got = collectNotarizeTargets([
      "/a/Aftertrace-mac-arm64.dmg",
      "/b/Aftertrace-mac-arm64.dmg",
    ])
    assert.equal(got.length, 1)
  })
})

describe("notarytoolSubmitArgs", () => {
  it("always --wait with a timeout so a hung Apple poll fails the job instead of GitHub cancelling it", () => {
    const args = notarytoolSubmitArgs("/out/Aftertrace-mac-arm64.dmg")
    assert.equal(args[0], "notarytool")
    assert.equal(args[1], "submit")
    assert.equal(args[2], "/out/Aftertrace-mac-arm64.dmg")
    assert.ok(args.includes("--wait"))
    const i = args.indexOf("--timeout")
    assert.ok(i >= 0)
    assert.equal(args[i + 1], String(NOTARY_WAIT_SECONDS))
    assert.ok(NOTARY_WAIT_SECONDS >= 1800)
  })
})

describe("notarizeFiles", () => {
  it("starts every notarytool submit before any of them finishes", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const spawnFn = () => {
      const child = new EventEmitter()
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      setTimeout(() => {
        inFlight -= 1
        child.emit("close", 0)
      }, 40)
      return child
    }
    const files = [
      "/out/Aftertrace-mac-arm64.dmg",
      "/out/Aftertrace-mac-x64.dmg",
      "/out/Aftertrace-mac-arm64.zip",
      "/out/Aftertrace-mac-x64.zip",
    ]
    await notarizeFiles(files, spawnFn)
    assert.equal(maxInFlight, 4)
  })
})

describe("collectAppBundles", () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-apps-"))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("finds Aftertrace.app under each dist/mac* tree", () => {
    for (const name of ["mac-arm64", "mac-x64"]) {
      fs.mkdirSync(path.join(dir, name, "Aftertrace.app", "Contents"), { recursive: true })
    }
    const apps = collectAppBundles(dir).map((p) => path.relative(dir, p)).sort()
    assert.deepEqual(apps, ["mac-arm64/Aftertrace.app", "mac-x64/Aftertrace.app"])
  })
})

describe("afterAllArtifactBuild", () => {
  const artifactPaths = [
    "/out/Aftertrace-mac-arm64.dmg",
    "/out/Aftertrace-mac-x64.dmg",
    "/out/Aftertrace-mac-arm64.zip",
    "/out/Aftertrace-mac-x64.zip",
    "/out/latest-mac.yml",
  ]

  it("no-ops on non-darwin", async () => {
    const extra = await afterAllArtifactBuild(
      { artifactPaths, outDir: "/out" },
      { platform: "linux", canNotarize: () => true },
    )
    assert.deepEqual(extra, [])
  })

  it("skips when Apple credentials are missing", async () => {
    const spawned = []
    const extra = await afterAllArtifactBuild(
      { artifactPaths, outDir: "/out" },
      {
        platform: "darwin",
        canNotarize: () => false,
        spawn: (...args) => {
          spawned.push(args)
          const child = new EventEmitter()
          queueMicrotask(() => child.emit("close", 0))
          return child
        },
      },
    )
    assert.deepEqual(extra, [])
    assert.deepEqual(spawned, [])
  })

  it("submits DMGs and zips, then staples DMGs (not zips)", async () => {
    const submitted = []
    const stapled = []
    const written = []
    const spawnFn = (cmd, args) => {
      submitted.push({ cmd, file: args[2] })
      const child = new EventEmitter()
      queueMicrotask(() => child.emit("close", 0))
      return child
    }
    const extra = await afterAllArtifactBuild(
      { artifactPaths, outDir: "/out" },
      {
        platform: "darwin",
        canNotarize: () => true,
        spawn: spawnFn,
        spawnSync: (cmd, args) => {
          stapled.push(args[args.length - 1])
          return { status: 0, stdout: "", stderr: "" }
        },
        writeFileSync: (p, body) => written.push({ p, body }),
      },
    )
    assert.deepEqual(
      submitted.map((s) => path.basename(s.file)).sort(),
      [
        "Aftertrace-mac-arm64.dmg",
        "Aftertrace-mac-arm64.zip",
        "Aftertrace-mac-x64.dmg",
        "Aftertrace-mac-x64.zip",
      ],
    )
    assert.ok(submitted.every((s) => s.cmd === "xcrun"))
    assert.deepEqual(
      stapled.map((p) => path.basename(p)).sort(),
      ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
    )
    assert.equal(written.length, 1)
    assert.equal(path.basename(written[0].p), "Aftertrace-mac-notarized.json")
    assert.deepEqual(extra, [written[0].p])
  })
})

describe("ci-pack.sh", () => {
  it("never enables electron-builder mac.notarize (sequential app --wait)", () => {
    const sh = fs.readFileSync(path.join(__dirname, "..", "scripts", "ci-pack.sh"), "utf8")
    assert.match(sh, /mac\.notarize=false/)
    assert.doesNotMatch(sh, /mac\.notarize=true/)
  })
})
