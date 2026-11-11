#!/usr/bin/env node
// Fail if CSS outside tokens.css uses raw font-size, radius, or ms values.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("../src", import.meta.url).pathname
const hits = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue
      walk(p)
      continue
    }
    if (!p.endsWith(".css")) continue
    if (p.endsWith("/tokens.css") || p.endsWith("\\tokens.css")) continue
    const text = readFileSync(p, "utf8")
    const rel = relative(root, p)
    const lines = text.split("\n")
    lines.forEach((line, i) => {
      if (/font-size:\s*[\d.]+px/.test(line)) hits.push(`${rel}:${i + 1}: raw font-size`)
      if (/border-radius:\s*[\d.]+px/.test(line)) hits.push(`${rel}:${i + 1}: raw border-radius`)
      if (/(?<![\w-])\d+(?:\.\d+)?ms/.test(line)) hits.push(`${rel}:${i + 1}: raw ms duration`)
    })
  }
}

walk(root)
if (hits.length) {
  console.error(`token-lint: ${hits.length} raw value(s) outside tokens.css`)
  for (const h of hits.slice(0, 40)) console.error("  " + h)
  if (hits.length > 40) console.error(`  … ${hits.length - 40} more`)
  process.exit(1)
}
console.log("token-lint: ok")
