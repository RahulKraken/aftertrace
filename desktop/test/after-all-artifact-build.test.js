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
  notarytoolWaitArgs,
  notarizeFiles,
  parseNotaryId,
  NOTARY_WAIT_SECONDS,
} = require("../scripts/after-all-artifact-build.cjs")

function childWithStdout(text, delay = 0) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setTimeout(() => {
    child.stdout.emit("data", text)
    child.emit("close", 0)
  }, delay)
  return child
}

describe("collectNotarizeTargets", () => {
  it("takes per-chip DMGs only — zips, aliases, yml, and blockmaps stay out", () => {
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
      ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
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

describe("notarytool args", () => {
  it("submit uploads without --wait and prints JSON", () => {
    const args = notarytoolSubmitArgs("/out/Aftertrace-mac-arm64.dmg")
    assert.equal(args[0], "notarytool")
    assert.equal(args[1], "submit")
    assert.equal(args[2], "/out/Aftertrace-mac-arm64.dmg")
    assert.ok(args.includes("--output-format"))
    assert.ok(args.includes("json"))
    assert.ok(!args.includes("--wait"))
  })

  it("wait uses a timeout so a hung Apple poll fails the job instead of GitHub cancelling it", () => {
    const args = notarytoolWaitArgs("sub-id")
    assert.equal(args[0], "notarytool")
    assert.equal(args[1], "wait")
    assert.equal(args[2], "sub-id")
    const i = args.indexOf("--timeout")
    assert.ok(i >= 0)
    assert.equal(args[i + 1], String(NOTARY_WAIT_SECONDS))
    assert.ok(NOTARY_WAIT_SECONDS >= 3600)
  })
})

describe("parseNotaryId", () => {
  it("reads id from notarytool JSON", () => {
    assert.equal(parseNotaryId('{"id":"abc-123","status":"Accepted"}\n'), "abc-123")
  })
})

describe("notarizeFiles", () => {
  it("uploads both DMGs before waiting on either submission", async () => {
    let inFlightSubmit = 0
    let maxSubmit = 0
    let waits = 0
    const spawnFn = (_cmd, args) => {
      if (args[1] === "submit") {
        inFlightSubmit += 1
        maxSubmit = Math.max(maxSubmit, inFlightSubmit)
        const id = path.basename(args[2]).includes("arm64") ? "id-arm" : "id-x64"
        return childWithStdout(JSON.stringify({ id }), 40)
      }
      waits += 1
      return childWithStdout("", 5)
    }
    await notarizeFiles(
      ["/out/Aftertrace-mac-arm64.dmg", "/out/Aftertrace-mac-x64.dmg"],
      spawnFn,
    )
    assert.equal(maxSubmit, 2)
    assert.equal(waits, 2)
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
    const apps = collectAppBundles(dir)
      .map((p) => path.relative(dir, p).split(path.sep).join("/"))
      .sort()
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
          return childWithStdout("")
        },
      },
    )
    assert.deepEqual(extra, [])
    assert.deepEqual(spawned, [])
  })

  it("submits only the two DMGs, waits, then staples DMGs (not zips)", async () => {
    const submitted = []
    const waited = []
    const stapled = []
    const written = []
    const spawnFn = (_cmd, args) => {
      if (args[1] === "submit") {
        submitted.push(args[2])
        return childWithStdout(JSON.stringify({ id: `id-${path.basename(args[2])}` }))
      }
      waited.push(args[2])
      return childWithStdout("")
    }
    const extra = await afterAllArtifactBuild(
      { artifactPaths, outDir: "/out" },
      {
        platform: "darwin",
        canNotarize: () => true,
        spawn: spawnFn,
        spawnSync: (_cmd, args) => {
          stapled.push(args[args.length - 1])
          return { status: 0, stdout: "", stderr: "" }
        },
        writeFileSync: (p, body) => written.push({ p, body }),
      },
    )
    assert.deepEqual(
      submitted.map((p) => path.basename(p)).sort(),
      ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
    )
    assert.deepEqual(waited.sort(), ["id-Aftertrace-mac-arm64.dmg", "id-Aftertrace-mac-x64.dmg"])
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
