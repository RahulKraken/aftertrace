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
  parseNotarizeArches,
  collectAppBundles,
  notarytoolSubmitArgs,
  notarytoolWaitArgs,
  notarizeFiles,
  parseNotaryId,
  isNotaryWaitTimeout,
  requireMacNotarize,
  NOTARY_WAIT_SECONDS,
  stapleFile,
  isStaplerTransient,
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
    const got = collectNotarizeTargets(
      [
        "/out/Aftertrace-mac-x64.dmg",
        "/out/Aftertrace-mac-arm64.dmg",
        "/out/Aftertrace-mac-arm64.zip",
        "/out/Aftertrace-mac-x64.zip",
        "/out/Aftertrace-mac-arm64.zip.blockmap",
        "/out/Aftertrace-mac.dmg",
        "/out/Aftertrace-mac.zip",
        "/out/latest-mac.yml",
      ],
      ["arm64", "x64"],
    )
    assert.deepEqual(
      got.map((p) => path.basename(p)),
      ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
    )
  })

  it("dedupes by basename", () => {
    const got = collectNotarizeTargets(
      ["/a/Aftertrace-mac-arm64.dmg", "/b/Aftertrace-mac-arm64.dmg"],
      ["arm64"],
    )
    assert.equal(got.length, 1)
  })

  it("defaults to arm64 when NOTARIZE_MAC_ARCHES is unset", () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    delete process.env.NOTARIZE_MAC_ARCHES
    try {
      const got = collectNotarizeTargets([
        "/out/Aftertrace-mac-arm64.dmg",
        "/out/Aftertrace-mac-x64.dmg",
      ])
      assert.deepEqual(
        got.map((p) => path.basename(p)),
        ["Aftertrace-mac-arm64.dmg"],
      )
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
  })

  it("empty NOTARIZE_MAC_ARCHES skips every DMG (CI fixture)", () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    process.env.NOTARIZE_MAC_ARCHES = ""
    try {
      assert.deepEqual(parseNotarizeArches(""), [])
      const got = collectNotarizeTargets([
        "/out/Aftertrace-mac-arm64.dmg",
        "/out/Aftertrace-mac-x64.dmg",
      ])
      assert.deepEqual(got, [])
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
  })

  it("NOTARIZE_MAC_ARCHES=arm64 drops the x64 DMG", () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    try {
      const got = collectNotarizeTargets([
        "/out/Aftertrace-mac-arm64.dmg",
        "/out/Aftertrace-mac-x64.dmg",
      ])
      assert.deepEqual(
        got.map((p) => path.basename(p)),
        ["Aftertrace-mac-arm64.dmg"],
      )
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
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
    assert.ok(NOTARY_WAIT_SECONDS >= 5400)
  })
})

describe("parseNotaryId", () => {
  it("reads id from notarytool JSON", () => {
    assert.equal(parseNotaryId('{"id":"abc-123","status":"Accepted"}\n'), "abc-123")
  })
})

describe("notarizeFiles", () => {
  it("waits for each submit before starting the next", async () => {
    const events = []
    const spawnFn = (_cmd, args) => {
      if (args[1] === "submit") {
        events.push(`submit:${path.basename(args[2])}`)
        return childWithStdout(JSON.stringify({ id: `id-${path.basename(args[2])}` }), 15)
      }
      events.push(`wait:${args[2]}`)
      return childWithStdout("", 15)
    }
    await notarizeFiles(
      ["/out/Aftertrace-mac-x64.dmg", "/out/Aftertrace-mac-arm64.dmg"],
      spawnFn,
    )
    assert.deepEqual(events, [
      "submit:Aftertrace-mac-x64.dmg",
      "wait:id-Aftertrace-mac-x64.dmg",
      "submit:Aftertrace-mac-arm64.dmg",
      "wait:id-Aftertrace-mac-arm64.dmg",
    ])
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
    const prev = process.env.NOTARIZE_MAC_ARCHES
    process.env.NOTARIZE_MAC_ARCHES = "arm64,x64"
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
    try {
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
        submitted.map((p) => path.basename(p)),
        ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
      )
      assert.deepEqual(waited, ["id-Aftertrace-mac-arm64.dmg", "id-Aftertrace-mac-x64.dmg"])
      assert.deepEqual(
        stapled.map((p) => path.basename(p)),
        ["Aftertrace-mac-arm64.dmg", "Aftertrace-mac-x64.dmg"],
      )
      assert.equal(written.length, 1)
      assert.equal(path.basename(written[0].p), "Aftertrace-mac-notarized.json")
      assert.deepEqual(extra, [written[0].p])
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
  })

  it("still fails the pack when notarytool rejects", async () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    try {
      await assert.rejects(
        () =>
          afterAllArtifactBuild(
            { artifactPaths, outDir: "/out" },
            {
              platform: "darwin",
              canNotarize: () => true,
              spawn: (_cmd, args) => {
                if (args[1] === "submit") {
                  return childWithStdout(JSON.stringify({ id: "id-arm" }))
                }
                const child = new EventEmitter()
                child.stdout = new EventEmitter()
                child.stderr = new EventEmitter()
                queueMicrotask(() => child.emit("close", 1))
                return child
              },
            },
          ),
        /notarytool wait failed/,
      )
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
  })

  it("REQUIRE_MAC_NOTARIZE fails closed on a wait timeout (no marker)", async () => {
    const prevReq = process.env.REQUIRE_MAC_NOTARIZE
    const prevArch = process.env.NOTARIZE_MAC_ARCHES
    process.env.REQUIRE_MAC_NOTARIZE = "true"
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    const written = []
    try {
      await assert.rejects(
        () =>
          afterAllArtifactBuild(
            { artifactPaths, outDir: "/out" },
            {
              platform: "darwin",
              canNotarize: () => true,
              spawn: (_cmd, args) => {
                if (args[1] === "submit") {
                  return childWithStdout(JSON.stringify({ id: "id-arm" }))
                }
                const child = new EventEmitter()
                child.stdout = new EventEmitter()
                child.stderr = new EventEmitter()
                queueMicrotask(() => child.emit("close", 124))
                return child
              },
              writeFileSync: (p, body) => written.push({ p, body }),
            },
          ),
        /notarytool wait failed/,
      )
      assert.deepEqual(written, [])
    } finally {
      if (prevReq === undefined) delete process.env.REQUIRE_MAC_NOTARIZE
      else process.env.REQUIRE_MAC_NOTARIZE = prevReq
      if (prevArch === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prevArch
    }
  })

  it("wait timeout keeps signed DMGs and does not write the notarized marker", async () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    const prevReq = process.env.REQUIRE_MAC_NOTARIZE
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    delete process.env.REQUIRE_MAC_NOTARIZE
    const written = []
    try {
      const extra = await afterAllArtifactBuild(
        { artifactPaths, outDir: "/out" },
        {
          platform: "darwin",
          canNotarize: () => true,
          spawn: (_cmd, args) => {
            if (args[1] === "submit") {
              return childWithStdout(JSON.stringify({ id: "id-arm" }))
            }
            const child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            queueMicrotask(() => child.emit("close", 124))
            return child
          },
          spawnSync: () => {
            throw new Error("stapler should not run after a wait timeout")
          },
          writeFileSync: (p, body) => written.push({ p, body }),
        },
      )
      assert.deepEqual(extra, [])
      assert.deepEqual(written, [])
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
      if (prevReq === undefined) delete process.env.REQUIRE_MAC_NOTARIZE
      else process.env.REQUIRE_MAC_NOTARIZE = prevReq
    }
  })

  it("Apple 504 on wait keeps signed DMGs on a PR", async () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    const prevReq = process.env.REQUIRE_MAC_NOTARIZE
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    delete process.env.REQUIRE_MAC_NOTARIZE
    const written = []
    try {
      const extra = await afterAllArtifactBuild(
        { artifactPaths, outDir: "/out" },
        {
          platform: "darwin",
          canNotarize: () => true,
          spawn: (_cmd, args) => {
            if (args[1] === "submit") {
              return childWithStdout(JSON.stringify({ id: "id-arm" }))
            }
            const child = new EventEmitter()
            child.stdout = new EventEmitter()
            child.stderr = new EventEmitter()
            queueMicrotask(() => {
              child.stderr.emit(
                "data",
                'Error: gatewayTimeout(statusCode: Optional(504), strData: Optional("Gateway Timeout"))\n',
              )
              child.emit("close", 1)
            })
            return child
          },
          spawnSync: () => {
            throw new Error("stapler should not run after a wait timeout")
          },
          writeFileSync: (p, body) => written.push({ p, body }),
        },
      )
      assert.deepEqual(extra, [])
      assert.deepEqual(written, [])
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
      if (prevReq === undefined) delete process.env.REQUIRE_MAC_NOTARIZE
      else process.env.REQUIRE_MAC_NOTARIZE = prevReq
    }
  })

  it("PR arm64-only skips the x64 DMG", async () => {
    const prev = process.env.NOTARIZE_MAC_ARCHES
    process.env.NOTARIZE_MAC_ARCHES = "arm64"
    const submitted = []
    try {
      await afterAllArtifactBuild(
        { artifactPaths, outDir: "/out" },
        {
          platform: "darwin",
          canNotarize: () => true,
          spawn: (_cmd, args) => {
            if (args[1] === "submit") submitted.push(path.basename(args[2]))
            return childWithStdout(
              args[1] === "submit" ? JSON.stringify({ id: "id-arm" }) : "",
            )
          },
          spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
          writeFileSync: () => {},
        },
      )
      assert.deepEqual(submitted, ["Aftertrace-mac-arm64.dmg"])
    } finally {
      if (prev === undefined) delete process.env.NOTARIZE_MAC_ARCHES
      else process.env.NOTARIZE_MAC_ARCHES = prev
    }
  })
})

describe("desktop.yml", () => {
  it("runs unit tests under Release REQUIRE_MAC_NOTARIZE; fail-closed stays on Package", () => {
    const yml = fs
      .readFileSync(path.join(__dirname, "..", "..", ".github/workflows/desktop.yml"), "utf8")
      .replace(/\r\n/g, "\n")
    const unitBlocks = [...yml.matchAll(/name: Desktop unit tests\n[\s\S]*?run: npm ci && npm test/g)]
    assert.equal(unitBlocks.length, 3)
    for (const m of unitBlocks) {
      assert.match(m[0], /REQUIRE_MAC_NOTARIZE: "true"/)
    }
    const mac = yml.slice(yml.indexOf("    name: macOS"))
    assert.doesNotMatch(mac.slice(0, mac.indexOf("steps:")), /REQUIRE_MAC_NOTARIZE/)
    assert.match(
      mac.slice(mac.indexOf("name: Package")),
      /REQUIRE_MAC_NOTARIZE: \$\{\{ github\.event_name == 'workflow_call'/,
    )
    assert.match(mac, /artifact-feed-smoke\.sh/)
    assert.match(mac, /runs-on: macos-15/)
    assert.match(mac, /macos-session-probe\.sh/)
    assert.match(mac, /pack-ci-fixture\.sh/)
    assert.match(mac, /signed-upgrade-smoke\.sh/)
  })
})

describe("pack-ci-fixture.sh", () => {
  it("signs a 0.5.8 fixture into dist-fixture without notarize or shipping dist", () => {
    const sh = fs.readFileSync(path.join(__dirname, "..", "scripts", "pack-ci-fixture.sh"), "utf8")
    assert.match(sh, /0\.5\.8/)
    assert.match(sh, /dist-fixture/)
    assert.match(sh, /mac\.notarize=false/)
    assert.match(sh, /NOTARIZE_MAC_ARCHES=""/)
    assert.match(sh, /engine-stamp/)
    assert.doesNotMatch(sh, /codesign --force/)
    assert.doesNotMatch(sh, /git tag/)
  })
})

describe("signed-upgrade-smoke.sh", () => {
  it("uses a writable temp copy, local 127.0.0.1 feed, and does not resign or touch TCC", () => {
    const sh = fs.readFileSync(path.join(__dirname, "..", "scripts", "signed-upgrade-smoke.sh"), "utf8")
    assert.match(sh, /GITHUB_ACTIONS/)
    assert.match(sh, /AFTERTRACE_HOME/)
    assert.match(sh, /AFTERTRACE_USER_DATA_DIR/)
    assert.match(sh, /AFTERTRACE_UPDATE_FEED_URL="http:\/\/127\.0\.0\.1:\$\{port\}\/"/)
    assert.match(sh, /ditto/)
    assert.match(sh, /echo restart/)
    assert.match(sh, /echo quit/)
    assert.match(sh, /wait_new_app_pid/)
    assert.match(sh, /quit-to-install/)
    assert.match(sh, /auto-relaunch/)
    assert.match(sh, /dev.aftertrace/)
    assert.match(sh, /launchctl bootstrap/)
    assert.match(sh, /wait_engine_version/)
    assert.match(sh, /legacy-keep/)
    assert.doesNotMatch(sh, /Relaunch the replacement ourselves/)
    assert.match(sh, /\breap\(\)/)
    assert.match(sh, /kill -9/)
    assert.match(sh, /--max-time/)
    assert.match(sh, /retain-054/)
    assert.match(sh, /ShipIt relaunch wrote login-home \.aftertrace/)
    assert.match(sh, /shipit-done/)
    assert.match(sh, /echo close/)
    assert.match(sh, /echo menu/)
    assert.match(sh, /echo hide-menu/)
    assert.match(sh, /echo refresh/)
    assert.match(sh, /menuOpen/)
    assert.match(sh, /otlp-menu-fixture/)
    assert.match(sh, /aftertrace\.synthetic/)
    assert.match(sh, /40k/)
    assert.match(sh, /menuLabels/)
    assert.match(sh, /variant identity/)
    assert.match(sh, /variant activity/)
    assert.match(sh, /menuSublabelSupported/)
    assert.match(sh, /native-menu-activity/)
    assert.match(sh, /menu capture=fullscreen/)
    assert.match(sh, /native-menu-dark/)
    assert.match(sh, /GITHUB_SHA/)
    assert.match(sh, /Aftertrace-mac-notarized\.json/)
    assert.match(sh, /Engine offline is not success/)
    assert.match(sh, /wait_gui_ready/)
    assert.match(sh, /UI elements of list 1/)
    assert.match(sh, /background only is false/)
    assert.match(sh, /native-menu/)
    assert.match(sh, /native-menu-keyboard/)
    assert.match(sh, /native-glyph/)
    assert.match(sh, /tray extra is not icon-only/)
    assert.match(sh, /AppleInterfaceStyle/)
    assert.doesNotMatch(sh, /echo popover/)
    assert.doesNotMatch(sh, /native-popover/)
    assert.doesNotMatch(sh, /codesign --force --/)
    assert.doesNotMatch(sh, /sqlite3 .*(TCC|tcc)/)
    assert.doesNotMatch(sh, /npx playwright|electron\.launch/)
  })
})

describe("ci-pack.sh", () => {
  it("never enables electron-builder mac.notarize (sequential app --wait)", () => {
    const sh = fs.readFileSync(path.join(__dirname, "..", "scripts", "ci-pack.sh"), "utf8")
    assert.match(sh, /mac\.notarize=false/)
    assert.doesNotMatch(sh, /mac\.notarize=true/)
    assert.match(sh, /electron-builder --mac --arm64 --publish/)
    assert.doesNotMatch(sh, /electron-builder --mac --arm64 --x64/)
  })
})

describe("isNotaryWaitTimeout", () => {
  it("matches notarytool exit 124", () => {
    assert.equal(isNotaryWaitTimeout(new Error("notarytool wait failed: xcrun notarytool exit 124")), true)
    assert.equal(isNotaryWaitTimeout(new Error("Invalid")), false)
  })

  it("matches Apple gatewayTimeout 504 on wait", () => {
    assert.equal(
      isNotaryWaitTimeout(
        new Error("notarytool wait failed: xcrun notarytool exit 1: Error: gatewayTimeout(statusCode: Optional(504)"),
      ),
      true,
    )
    assert.equal(isNotaryWaitTimeout(new Error("Gateway Timeout")), true)
    assert.equal(isNotaryWaitTimeout(new Error("xcrun notarytool exit 1")), false)
  })
})

describe("requireMacNotarize", () => {
  it("is off unless REQUIRE_MAC_NOTARIZE is true/1", () => {
    const prev = process.env.REQUIRE_MAC_NOTARIZE
    try {
      delete process.env.REQUIRE_MAC_NOTARIZE
      assert.equal(requireMacNotarize(), false)
      process.env.REQUIRE_MAC_NOTARIZE = "false"
      assert.equal(requireMacNotarize(), false)
      process.env.REQUIRE_MAC_NOTARIZE = "true"
      assert.equal(requireMacNotarize(), true)
    } finally {
      if (prev === undefined) delete process.env.REQUIRE_MAC_NOTARIZE
      else process.env.REQUIRE_MAC_NOTARIZE = prev
    }
  })
})

describe("stapler staple", () => {
  it("retries CloudKit NSURLError -1005 then succeeds", () => {
    const calls = []
    const sleeps = []
    const drop =
      'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\nThe staple and validate action failed! Error 68.\n'
    assert.equal(isStaplerTransient(drop), true)
    stapleFile("/out/Aftertrace-mac-arm64.dmg", (_cmd, args) => {
      calls.push(args)
      if (calls.length === 1) return { status: 1, stdout: drop, stderr: "" }
      return { status: 0, stdout: "", stderr: "" }
    }, { retries: 5, sleep: (ms) => sleeps.push(ms) })
    assert.equal(calls.length, 2)
    assert.deepEqual(sleeps, [2000])
  })

  it("does not retry a real staple failure", () => {
    assert.throws(
      () =>
        stapleFile("/out/Aftertrace-mac-arm64.dmg", () => ({
          status: 1,
          stdout: "The staple and validate action failed! Error 65.\n",
          stderr: "",
        }), { retries: 5, sleep: () => assert.fail("sleep") }),
      /Error 65/,
    )
  })
})

describe("ci-verify-mac.sh", () => {
  it("requires Developer ID when CSC_LINK is set and stapler only with the notarized marker", () => {
    const sh = fs.readFileSync(path.join(__dirname, "..", "scripts", "ci-verify-mac.sh"), "utf8")
    assert.match(sh, /Developer ID Application/)
    assert.match(sh, /Aftertrace-mac-notarized\.json/)
    assert.match(sh, /NOTARIZE_MAC_ARCHES/)
    assert.match(sh, /informational/)
    assert.match(sh, /Notarized Developer ID/)
    assert.match(sh, /must not list Aftertrace-mac-x64\.zip/)
    assert.match(sh, /CFBundleShortVersionString/)
    assert.match(sh, /PlistBuddy/)
    assert.match(sh, /The validate action worked/)
    assert.match(sh, /recopy/)
    assert.match(sh, /Error 68/)
    assert.match(sh, /Aftertrace-mac\.dmg recopy/)
    assert.match(sh, /bundled engine version/)
    assert.match(sh, /"\$eng" version/)
  })
})
