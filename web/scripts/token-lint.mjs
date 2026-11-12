#!/usr/bin/env node
// Fail if CSS outside tokens.css uses raw font-size, radius, or ms values,
// leftover --fs-* type tokens, or a font shorthand with a raw px size.
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
      if (/--fs-/.test(line)) hits.push(`${rel}:${i + 1}: leftover --fs-* type token`)
      const fontDecl = line.match(/font:\s*([^;]+)/)
      if (fontDecl && /\d+(?:\.\d+)?px/.test(fontDecl[1]) && !/var\(--t-/.test(fontDecl[1])) {
        hits.push(`${rel}:${i + 1}: raw font size in font shorthand`)
      }
    })
  }
}

walk(root)
if (hits.length) {
  console.error(`token-lint: ${hits.length} raw value(s) outside tokens.css`)
  for (const h of hits.slice(0, 80)) console.error("  " + h)
  if (hits.length > 80) console.error(`  … ${hits.length - 80} more`)
  process.exit(1)
}
console.log("token-lint: ok")
