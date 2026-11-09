"use strict"

const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const http = require("http")
const os = require("os")
const path = require("path")
const { createEngine, backoffDelay, lockError } = require("../src/engine")

function listen(handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({
        server,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

function refSleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fakeServeScript() {
  return `
    const http = require("http")
    const port = Number(process.env.FAKE_PORT)
    const crash = process.env.FAKE_CRASH === "1"
    const server = http.createServer((req, res) => {
      if (req.url === "/api/status" || req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
        if (crash) setTimeout(() => process.exit(2), 80)
        return
      }
      res.end("ok")
    })
    server.listen(port, "127.0.0.1")
    process.on("SIGTERM", () => { server.close(() => process.exit(0)) })
  `
}

test("lockError names the conflicting PID", () => {
  const msg = lockError("IO Error: Could not set lock on file \"/Users/rahul/.aftertrace/aftertrace.duckdb\": Conflicting lock is held in /Users/rahul/.aftertrace/bin/aftertrace (PID 1786)")
  assert.match(msg, /PID 1786/)
  assert.match(msg, /database/)
  assert.equal(lockError("listen tcp already in use"), "")
})

test("backoff grows then caps", () => {
  assert.equal(backoffDelay(0), 1000)
  assert.equal(backoffDelay(1), 2000)
  assert.equal(backoffDelay(5), 30000)
  assert.equal(backoffDelay(99), 30000)
})

test("reuses an engine that is already healthy", async () => {
  const svc = await listen((_req, res) => {
    res.writeHead(200)
    res.end("ok")
  })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-engine-"))
  let spawned = 0
  const engine = createEngine({
    origin: svc.origin,
    bin: path.join(tmp, "missing-on-purpose"),
    logFile: path.join(tmp, "log.txt"),
    readyTimeoutMs: 2000,
    spawn: () => {
      spawned += 1
      throw new Error("should not spawn")
    },
  })
  try {
    engine.start()
    const okReady = await engine.waitUntilHealthy(2000)
    assert.equal(okReady, true)
    assert.equal(engine.status().state, "reused")
    assert.equal(engine.status().startedByUs, false)
    assert.equal(spawned, 0)
    await engine.stop()
    assert.equal(engine.status().state, "idle")
    const still = await new Promise((resolve) => {
      http.get(svc.origin + "/api/status", (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }).on("error", () => resolve(false))
    })
    assert.equal(still, true, "reused engine must keep running after the shell quits")
  } finally {
    await engine.stop()
    await svc.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("packaged app displaces a v0.4.2 occupant instead of reusing it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-engine-"))
  const script = path.join(tmp, "fake-serve.js")
  fs.writeFileSync(script, fakeServeScript())
  const old = await listen((req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ version: "v0.4.2", service: "launchd", pid: 1786, bin: "/Users/rahul/.aftertrace/bin/aftertrace" }))
      return
    }
    if (req.url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ info: { version: "v0.4.2", service: "launchd" } }))
      return
    }
    res.end("ok")
  })
  const port = new URL(old.origin).port
  let displaced = 0
  let spawned = 0
  const engine = createEngine({
    origin: old.origin,
    bin: process.execPath,
    args: [script],
    logFile: path.join(tmp, "log.txt"),
    readyTimeoutMs: 4000,
    sleep: refSleep,
    isPackaged: true,
    expectedVersion: "v0.5.5",
    displace: async () => {
      displaced += 1
      await old.close()
      return { ok: true, migrated: "launchd" }
    },
    spawn: (bin, args, opts) => {
      spawned += 1
      return require("child_process").spawn(bin, args, {
        ...opts,
        env: { ...opts.env, FAKE_PORT: port },
      })
    },
  })
  try {
    engine.start()
    const ok = await engine.waitUntilHealthy(6000)
    assert.equal(ok, true)
    assert.ok(displaced >= 1, "legacy launchd occupant must be displaced")
    assert.ok(spawned >= 1, "bundled sidecar must start after displace")
    assert.equal(engine.status().state, "healthy")
    assert.equal(engine.status().startedByUs, true)
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(engine.status().state, "healthy", "must not treat our own sidecar as a foreign occupant")
  } finally {
    await engine.stop()
    await old.close().catch(() => {})
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("starts a sidecar, waits until healthy, stops it", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-engine-"))
  const script = path.join(tmp, "fake-serve.js")
  fs.writeFileSync(script, fakeServeScript())
  const probe = await listen((_req, res) => {
    res.statusCode = 404
    res.end()
  })
  const port = new URL(probe.origin).port
  await probe.close()
  const origin = `http://127.0.0.1:${port}`
  const engine = createEngine({
    origin,
    bin: process.execPath,
    args: [script],
    logFile: path.join(tmp, "log.txt"),
    readyTimeoutMs: 4000,
    sleep: refSleep,
    spawn: (bin, args, opts) =>
      require("child_process").spawn(bin, args, {
        ...opts,
        env: { ...opts.env, FAKE_PORT: port },
      }),
  })
  try {
    engine.start()
    const ok = await engine.waitUntilHealthy(4000)
    assert.equal(ok, true)
    assert.equal(["healthy", "reused"].includes(engine.status().state), true)
    await engine.stop()
    assert.equal(engine.status().state, "idle")
    const still = await new Promise((resolve) => {
      const req = http.get(origin + "/api/status", () => resolve(true))
      req.on("error", () => resolve(false))
      req.setTimeout(400, () => {
        req.destroy()
        resolve(false)
      })
    })
    assert.equal(still, false, "engine we started must stop on quit")
  } finally {
    await engine.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test("restarts a crashing sidecar with backoff", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aftertrace-engine-"))
  const script = path.join(tmp, "fake-serve.js")
  fs.writeFileSync(script, fakeServeScript())
  const probe = await listen((_req, res) => {
    res.statusCode = 404
    res.end()
  })
  const port = new URL(probe.origin).port
  await probe.close()
  const origin = `http://127.0.0.1:${port}`
  let starts = 0
  const engine = createEngine({
    origin,
    bin: process.execPath,
    args: [script],
    logFile: path.join(tmp, "log.txt"),
    readyTimeoutMs: 3000,
    sleep: refSleep,
    spawn: (bin, args, opts) => {
      starts += 1
      return require("child_process").spawn(bin, args, {
        ...opts,
        env: { ...opts.env, FAKE_PORT: port, FAKE_CRASH: starts === 1 ? "1" : "0" },
      })
    },
  })
  try {
    engine.start()
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (starts >= 2 && (await engine.healthy())) break
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.ok(starts >= 2, `expected a restart, got ${starts} starts`)
    assert.equal(await engine.healthy(), true)
  } finally {
    await engine.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
