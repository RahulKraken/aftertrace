"use strict"

function parse(s) {
  const m = String(s || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { raw: `${m[1]}.${m[2]}.${m[3]}`, major: +m[1], minor: +m[2], patch: +m[3] }
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function gt(next, current) {
  const a = parse(next)
  const b = parse(current)
  if (!a || !b) return false
  return cmp(a, b) > 0
}

function eq(a, b) {
  const x = parse(a)
  const y = parse(b)
  return Boolean(x && y && x.raw === y.raw)
}

module.exports = { parse, cmp, gt, eq }
