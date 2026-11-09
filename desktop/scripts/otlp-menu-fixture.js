#!/usr/bin/env node
"use strict"

// POST synthetic OTLP into a local engine. CI smoke only. Not real usage.
const http = require("http")
const { buildFixture, bumpFixture, expectedLabels } = require("../src/menuFixture")

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const raw = JSON.stringify(body)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) },
        timeout: 5000,
      },
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${url} HTTP ${res.statusCode} ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`))
            return
          }
          resolve()
        })
      },
    )
    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error(`timeout ${url}`))
    })
    req.write(raw)
    req.end()
  })
}

async function main() {
  const args = process.argv.slice(2)
  const origin = args.includes("--otlp") ? args[args.indexOf("--otlp") + 1] : "http://127.0.0.1:4318"
  const bump = args.includes("--bump")
  const payload = bump ? bumpFixture() : buildFixture()
  await post(`${origin.replace(/\/$/, "")}/v1/traces`, payload.traces)
  await post(`${origin.replace(/\/$/, "")}/v1/logs`, payload.logs)
  const expect = expectedLabels()
  process.stdout.write(
    `${JSON.stringify({ synthetic: true, bump, firstSessionId: expect.firstSessionId, fragments: bump ? undefined : expect.fragments }, null, 2)}\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`)
  process.exit(1)
})
