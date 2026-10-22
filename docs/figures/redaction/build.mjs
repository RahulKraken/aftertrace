// Fig 3 · Redaction, as a coin sorter for attributes.
// Every attribute of every record is a token. The source on the left decides
// what it sends at all (its valves are Claude Code's OTEL_LOG_* switches).
// The tokens ride a vibrating deck over two slots, smallest first, as in a
// coin sorter: identity tokens are the smallest and always fall through the
// first slot; content tokens are the next size and fall through the second
// unless its shutter is closed (--store-content). Everything else reaches the
// end of the deck and drops into the store.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { MODEL } from "../model.mjs"
import { SOURCE_GATES, classOf, REDACT_CALLS } from "./facts.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 384

// ── World plan (units ≈ px; x along the deck, y toward the reader, z up) ───
const BENCH = { x: -230, y: -58, w: 452, d: 118, r: 10 }
const BENCH_H = 12
const FOOT_H = 6

const SRC = { x: -214, y: -38, w: 56, d: 66, r: 4 } // Claude Code, the source
const SRC_H = 62
// Valves on its lid: the two that matter here up front, the other three capped behind.
const VALVES = [
  { id: "prompts", flag: "OTEL_LOG_USER_PROMPTS", x: -200, y: 13, big: true, hue: "content" },
  { id: "tools", flag: "OTEL_LOG_TOOL_DETAILS", x: -177, y: 13, big: true, hue: "tool" },
  ...SOURCE_GATES.filter((f) => f !== "OTEL_LOG_USER_PROMPTS" && f !== "OTEL_LOG_TOOL_DETAILS").map((flag, i) => ({ id: "capped", flag, x: -203 + i * 16, y: -21, big: false })),
]
const SPOUT = { x: -160, y: -7, w: 13, d: 14, r: 2 }
const SPOUT_Z = 56

const SUB = { x: -136, y: -28, w: 226, d: 56, r: 3 } // the sorter's base cabinet
const SUB_H = 30
const SPRING_AT = [[-125, -18], [-125, 18], [79, -18], [79, 18]]
const SPRING_R = 3.4
const DECK = { x: -146, y: -15, w: 252, d: 30, r: 2 }
const DECK_Z = 40 // underside
const FLOOR = 48 // top of the floor the tokens ride on
const WALL_H = 14
const LIP_H = 4
const LIP = { x: DECK.x, y: DECK.y + DECK.d - 3, w: DECK.w, d: 3, r: 0.8 }

// The slots, smallest first. Widths follow the token sizes they let through.
const SLOT1 = { x: -88.5, y: -6, w: 10, d: 12, r: 1 }
const SLOT2 = { x: -32.5, y: -7.5, w: 14, d: 15, r: 1 }
const SHUTTER = { x: SLOT2.x - 2, y: SLOT2.y - 2, w: SLOT2.w + 4, d: SLOT2.d + 4, r: 1 }
const SHUTTER_PARK = 22 // how far downstream the shutter rests when the slot is open

const DRAWER = (slot, w) => ({ x: slot.x + slot.w / 2 - w / 2, w })
const BIN1 = DRAWER(SLOT1, 46)
const BIN2 = DRAWER(SLOT2, 52)

const MOTOR = [42, -17]

const CAB = { x: 106, y: -38, w: 84, d: 76, r: 3 } // the store, where what is left goes
const CAB_H = 30
const HOPPER = { x: 109, y: -18, w: 32, d: 36, r: 2 }
const HOPPER_H = 8

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [SRC.x, SRC.y, SRC_H + 12], [DECK.x + DECK.w, DECK.y, FLOOR + WALL_H], [SRC.x + SRC.w, SRC.y + SRC.d, SRC_H + 12]],
  W,
  H,
  { pad: 22, azimuth: 62 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
const halo = (plan, blur) => `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(${blur}px)"/>`
const hole = (plan, z) => `<path class="fig-hole" d="${k.planOutline(plan, z, P, 3)}"/>` + L(k.planOutline(plan, z, P, 3), { tone: "mid" })

// ── Base ───────────────────────────────────────────────────────────────────
function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`]
  for (const [x, y] of byDepth(k.corners(BENCH, 26))) {
    out.push(S(k.cylinder(x, y, 8, -BENCH_H - FOOT_H, 1.8, P, 28), { tone: "lo" }))
    out.push(S(k.cylinder(x, y, 6, -BENCH_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }))
  }
  out.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(BENCH, 6), 0, P), { tone: "lo" }))
  const screws = k.corners(BENCH, 12)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }))
  // A ruler along the front edge, in the direction the tokens travel.
  const strip = { x: BENCH.x + 92, y: BENCH.y + BENCH.d - 16, w: BENCH.w - 124, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  // Label plate at the back right, three rule lines for its printed text.
  const plate = { x: BENCH.x + 18, y: BENCH.y + BENCH.d - 32, w: 46, d: 18, r: 1.5 }
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }))
  out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P), { tone: "faint" }))
  for (const [i, len] of [30, 22, 26].entries()) out.push(L(k.lineOnTop([plate.x + 6, plate.y + 5 + i * 4], [plate.x + 6 + len, plate.y + 5 + i * 4], 0.8, P), { tone: "lo", free: true }))
  out.push(D([at([plate.x + 3, plate.y + 3, 0.8]), at([plate.x + plate.w - 3, plate.y + plate.d - 3, 0.8])], { size: 0.4 }))
  return out.join("")
}

// ── The source: Claude Code, with a valve per OTEL_LOG_* switch ────────────
function source() {
  const out = [halo(k.insetPlan(SRC, 2), 4)]
  out.push(S(k.slabOf(SRC, 0, 6, P, 4, 0.6), { tone: "lo" }))
  const body = k.insetPlan(SRC, 2)
  out.push(S(k.slabOf(body, 6, SRC_H - 6, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, SRC_H - 16, P, 4), { tone: "faint" }) }))
  out.push(L(k.planOutline(k.insetPlan(SRC, 6), SRC_H, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(body, 4)) out.push(D([at([x, y, SRC_H])], { size: 0.45 }))
  // Vents on the near face, low down.
  for (let i = 0; i < 5; i++) {
    const x = SRC.x + 10 + i * 5
    out.push(L(k.segment([x, SRC.y + SRC.d - 2, 14], [x, SRC.y + SRC.d - 2, 26], P), { tone: "lo" }))
  }
  out.push(L(k.segment([SRC.x + 10, SRC.y + SRC.d - 2, 14], [SRC.x + 30, SRC.y + SRC.d - 2, 14], P) + k.segment([SRC.x + 10, SRC.y + SRC.d - 2, 26], [SRC.x + 30, SRC.y + SRC.d - 2, 26], P), { tone: "faint" }))
  // The spout on its right face, over the start of the deck.
  out.push(S(k.slabOf(SPOUT, SPOUT_Z, 10, P, 3, 0.5), { tone: "mid" }))
  const ex = SPOUT.x + SPOUT.w
  const mouth = [[ex, SPOUT.y + 3, SPOUT_Z + 1.6], [ex, SPOUT.y + SPOUT.d - 3, SPOUT_Z + 1.6], [ex, SPOUT.y + SPOUT.d - 3, SPOUT_Z + 7], [ex, SPOUT.y + 3, SPOUT_Z + 7]].map(at)
  out.push(`<path class="fig-hole" d="${k.pathOf(mouth, true)}"/>` + L(k.pathOf(mouth, true), { tone: "mid" }))
  out.push(D([at([SPOUT.x + 4, SPOUT.y + 3, SPOUT_Z + 10]), at([SPOUT.x + 4, SPOUT.y + SPOUT.d - 3, SPOUT_Z + 10])], { size: 0.4 }))
  return out.join("")
}
// A quarter-turn valve: a boss, a stem and a handle. Handle along the flow (x) is open.
function valve(v, open) {
  const r = v.big ? 6.2 : 3.8
  const out = []
  out.push(S(k.cylinder(v.x, v.y, r, SRC_H, 2, P, 28), { tone: "mid" }))
  out.push(L(k.knurl(v.x, v.y, r, SRC_H, SRC_H + 2, 24, P), { tone: "lo" }))
  if (!v.big) {
    // Capped: a cap screwed over the stem, no handle at all.
    out.push(S(k.cylinder(v.x, v.y, 2.6, SRC_H + 2, 3.4, P, 20), { tone: "mid", crease: "none" }))
    out.push(L(k.ring(v.x, v.y, 1.2, SRC_H + 5.4, P, 12), { tone: "lo" }))
    return out.join("")
  }
  out.push(S(k.cylinder(v.x, v.y, 1.8, SRC_H + 2, 4, P, 16), { tone: "mid", crease: "none" }))
  const len = 13
  const handle = open ? { x: v.x - 2, y: v.y - 1.6, w: len, d: 3.2, r: 1.2 } : { x: v.x - 1.6, y: v.y - 2, w: 3.2, d: len, r: 1.2 }
  out.push(S(k.slabOf(handle, SRC_H + 6, 2.2, P, 3, 0.4), { tone: open ? "hi" : "mid", lit: open }))
  out.push(S(k.cylinder(v.x, v.y, 2.2, SRC_H + 6, 2.8, P, 16), { tone: open ? "hi" : "mid", lit: open }))
  return out.join("")
}
const lampAt = (v) => at([v.x, v.y + 10, SRC_H])
const lamp = (v) => `<circle class="fig-lamp" data-part="lamp-${v.id}" data-hue="${v.hue}" cx="${lampAt(v)[0].toFixed(1)}" cy="${lampAt(v)[1].toFixed(1)}" r="1.6"/>`

// ── The sorter's base: a cabinet with a drawer under each slot ─────────────
function base() {
  const out = [halo(k.insetPlan(SUB, 1), 5)]
  out.push(S(k.slabOf(SUB, 0, 5, P, 4, 0.6), { tone: "lo" }))
  const body = k.insetPlan(SUB, 2)
  out.push(S(k.slabOf(body, 5, SUB_H - 5, P, 4, 0.8), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(SUB, 6), SUB_H, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(body, 4)) out.push(D([at([x, y, SUB_H])], { size: 0.45 }))
  // The vibrator: a motor on the base with an eccentric weight, bolted to the deck by a bracket.
  const [mx, my] = MOTOR
  out.push(S(k.slabOf({ x: mx - 9, y: my - 7, w: 18, d: 14, r: 2 }, SUB_H, 2, P, 3), { tone: "lo" }))
  out.push(S(k.cylinder(mx, my, 6, SUB_H + 2, 6, P, 30), { tone: "mid", crease: "lo" }))
  out.push(L(k.knurl(mx, my, 6, SUB_H + 3, SUB_H + 7, 22, P), { tone: "faint" }))
  out.push(D(k.corners({ x: mx - 9, y: my - 7, w: 18, d: 14 }, 1.6).map(([x, y]) => at([x, y, SUB_H + 2])), { size: 0.4 }))
  // The motor's grille on the near face: slots, closed top and bottom by two rails.
  const fy = SUB.y + SUB.d - 2
  const gx = [BIN2.x + BIN2.w + 14, BIN2.x + BIN2.w + 14 + Math.floor((SUB.x + SUB.w - 26 - BIN2.x - BIN2.w) / 4) * 4]
  for (let x = gx[0]; x <= gx[1] + 0.01; x += 4) out.push(L(k.segment([x, fy, 10], [x, fy, 22], P), { tone: "lo" }))
  out.push(L(k.segment([gx[0], fy, 10], [gx[1], fy, 10], P) + k.segment([gx[0], fy, 22], [gx[1], fy, 22], P), { tone: "faint" }))
  out.push(D([at([gx[0] - 3, fy, 16]), at([gx[1] + 3, fy, 16])], { size: 0.42 }))
  return out.join("")
}
// The front of each drawer: a face, a window that shows how full it is, a pull.
const BIN_FACE_Y = SUB.y + SUB.d
const BIN_Z = [7, SUB_H - 3]
function drawer(b, which) {
  const out = []
  out.push(S(k.slabOf({ x: b.x, y: BIN_FACE_Y - 1, w: b.w, d: 2.5, r: 1 }, BIN_Z[0], BIN_Z[1] - BIN_Z[0], P, 3, 0.5), { tone: "mid" }))
  out.push(S(k.slabOf({ x: b.x + b.w / 2 - 7, y: BIN_FACE_Y + 1.5, w: 14, d: 2.2, r: 1 }, BIN_Z[0] + 3, 3, P, 2), { tone: "mid" }))
  return out.join("") + binWindow(b, which)
}
function binWindow(b, which) {
  const y = BIN_FACE_Y + 1.5
  const m = k.sideMatrix([0, y], 0, P, "left")
  const x0 = b.x + 6
  const w = b.w - 12
  const z1 = BIN_Z[1] - 4
  const h = 6
  return `<g transform="${m}"><rect class="fig-glass" x="${x0}" y="${-z1}" width="${w}" height="${h}" rx="1"/><rect class="fig-fill" data-part="fill-${which}" data-hue="${which}" x="${x0 + 1}" y="${-z1 + 1}" width="${w - 2}" height="${h - 2}" rx="0.6"/><rect class="fig-glass-edge" x="${x0}" y="${-z1}" width="${w}" height="${h}" rx="1"/></g>`
}

// ── Springs: the deck rides on four, so the motor can shake it forward ────
function spring([x, y]) {
  const out = []
  out.push(S(k.cylinder(x, y, SPRING_R + 1, SUB_H, 1.6, P, 20), { tone: "mid" }))
  out.push(S(k.cylinder(x, y, SPRING_R + 1, DECK_Z - 1.6, 1.6, P, 20), { tone: "mid" }))
  // The coil, as wire: the far half fainter, both halves ending on the seats.
  const z0 = SUB_H + 1.6
  const z1 = DECK_Z - 1.6
  const turns = 3.5
  const steps = 56
  const back = []
  const front = []
  let run = []
  let near = null
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2
    const p = [x + SPRING_R * Math.cos(a), y + SPRING_R * Math.sin(a), z0 + ((z1 - z0) * i) / steps]
    const facing = k.depthOf([Math.cos(a), Math.sin(a), 0], P) > 0
    if (near === null) near = facing
    if (facing !== near) {
      run.push(at(p))
      ;(near ? front : back).push(k.pathOf(run))
      run = []
      near = facing
    }
    run.push(at(p))
  }
  ;(near ? front : back).push(k.pathOf(run))
  out.push(L(back.join(""), { tone: "faint" }), L(front.join(""), { tone: "mid" }))
  // The wire's cut ends, where it bears on each seat.
  out.push(D([at([x + SPRING_R, y, z0]), at([x + SPRING_R * Math.cos(turns * Math.PI * 2), y + SPRING_R * Math.sin(turns * Math.PI * 2), z1])], { size: 0.45 }))
  return out.join("")
}

// ── The deck: a floor with two slots, a back wall and an end stop ─────────
function deck() {
  const out = []
  // The bracket from the motor up to the deck's underside.
  out.push(S(k.slabOf({ x: MOTOR[0] - 2, y: MOTOR[1] - 2, w: 4, d: 4, r: 1 }, SUB_H + 8, DECK_Z - SUB_H - 8, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf(DECK, DECK_Z, FLOOR - DECK_Z, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(DECK, DECK_Z + 3, P, 4), { tone: "faint" }) }))
  // Slot 1, identity: a fixed frame screwed down around it. Nothing can cover it.
  const f1 = k.insetPlan(SLOT1, -3)
  out.push(S(k.slabOf(f1, FLOOR, 0.6, P, 3), { tone: "mid", crease: "none" }))
  out.push(hole(SLOT1, FLOOR + 0.6))
  out.push(D([at([f1.x + 1.4, f1.y + 1.4, FLOOR + 0.6]), at([f1.x + f1.w - 1.4, f1.y + f1.d - 1.4, FLOOR + 0.6])], { size: 0.4 }))
  // Slot 2, content: two guide rails for its shutter, running downstream.
  out.push(hole(SLOT2, FLOOR))
  for (const y of [SHUTTER.y - 2, SHUTTER.y + SHUTTER.d]) {
    out.push(S(k.slabOf({ x: SHUTTER.x - 3, y, w: SHUTTER.w + SHUTTER_PARK + 6, d: 2, r: 0.5 }, FLOOR, 1.4, P, 2), { tone: "mid" }))
    out.push(D([at([SHUTTER.x - 1.6, y + 1, FLOOR + 1.4]), at([SHUTTER.x + SHUTTER.w + SHUTTER_PARK + 1.6, y + 1, FLOOR + 1.4])], { size: 0.38 }))
  }
  // Ruled marks on the floor between the slots: the deck is lined for grip.
  for (let x = DECK.x + 24; x < DECK.x + DECK.w - 8; x += 12) {
    if (x > SLOT1.x - 8 && x < SLOT1.x + SLOT1.w + 8) continue
    if (x > SHUTTER.x - 6 && x < SHUTTER.x + SHUTTER.w + SHUTTER_PARK + 6) continue
    out.push(L(k.lineOnTop([x, DECK.y + 3], [x, LIP.y], FLOOR, P), { tone: "faint" }))
  }
  // Back wall and the end stop at the spout end.
  out.push(S(k.slabOf({ x: DECK.x, y: DECK.y, w: DECK.w, d: 3, r: 0.8 }, FLOOR, WALL_H, P, 2, 0.4), { tone: "mid" }))
  // A scale along the top of the wall, every 5 units, so the run reads as a measured track.
  const ticks = k.topTicks(DECK.x + 8, DECK.x + DECK.w - 6, 5, 5, DECK.y + 0.6, FLOOR + WALL_H, [0.9, 1.8], P)
  out.push(L(ticks.minor, { tone: "faint" }), L(ticks.major, { tone: "lo" }))
  out.push(S(k.slabOf({ x: DECK.x, y: DECK.y, w: 3, d: DECK.d, r: 0.8 }, FLOOR, LIP_H, P, 2, 0.4), { tone: "mid" }))
  return out.join("")
}
// The shutter: a plate with a knob, sliding on the rails. Over the slot, content rides on.
function shutter() {
  const out = []
  out.push(S(k.slabOf(SHUTTER, FLOOR + 1.4, 1, P, 3, 0.3), { tone: "hi", crease: "lo" }))
  const cx = SHUTTER.x + SHUTTER.w / 2
  // The knob sits at the back edge, out of the tokens' path.
  const cy = SHUTTER.y + 2.8
  out.push(S(k.cylinder(cx, cy, 2.4, FLOOR + 2.4, 4.4, P, 20), { tone: "hi", lit: true }))
  return out.join("")
}
function lipFront() {
  return S(k.slabOf(LIP, FLOOR, LIP_H, P, 2, 0.4), { tone: "mid" })
}

// ── The store: a hopper on a cabinet, where what is left lands ────────────
function cabinet() {
  const out = [halo(k.insetPlan(CAB, 1), 4)]
  out.push(S(k.slabOf(CAB, 0, 5, P, 4, 0.6), { tone: "lo" }))
  const body = k.insetPlan(CAB, 2)
  out.push(S(k.slabOf(body, 5, CAB_H - 5, P, 4, 0.8), { tone: "mid" }))
  for (const [x, y] of k.corners(body, 4)) out.push(D([at([x, y, CAB_H])], { size: 0.45 }))
  out.push(L(k.planOutline(k.insetPlan(CAB, 6), CAB_H, P, 3), { tone: "faint" }))
  // Drawer faces on the near side, as in Fig 1.
  for (const [i, x] of [CAB.x + 6, CAB.x + CAB.w / 2 + 2].entries()) {
    const w = CAB.w / 2 - 8
    out.push(S(k.slabOf({ x, y: CAB.y + CAB.d - 1, w, d: 2.4, r: 1 }, 8, CAB_H - 12, P, 3, 0.5), { tone: "mid" }))
    out.push(S(k.slabOf({ x: x + w / 2 - 6, y: CAB.y + CAB.d + 1.4, w: 12, d: 2, r: 1 }, 11, 2.6, P, 2), { tone: "mid" }))
    if (i === 1) out.push(`<circle class="fig-lamp" data-part="lamp-store" data-hue="kept" cx="${at([x + w - 5, CAB.y + CAB.d + 1.4, CAB_H - 7])[0].toFixed(1)}" cy="${at([x + w - 5, CAB.y + CAB.d + 1.4, CAB_H - 7])[1].toFixed(1)}" r="1.5"/>`)
  }
  // The hopper's walls: back and sides here, the near wall in front of the tokens.
  out.push(S(k.slabOf(HOPPER, CAB_H, 1.6, P, 3), { tone: "mid" }))
  out.push(D([at([HOPPER.x + 1.4, HOPPER.y + HOPPER.d - 1.2, CAB_H + 1.6]), at([HOPPER.x + HOPPER.w - 1.2, HOPPER.y + HOPPER.d - 1.2, CAB_H + 1.6])], { size: 0.4 }))
  out.push(hole(k.insetPlan(HOPPER, 3), CAB_H + 1.6))
  out.push(S(k.slabOf({ x: HOPPER.x, y: HOPPER.y, w: HOPPER.w, d: 2.4, r: 0.6 }, CAB_H + 1.6, HOPPER_H - 1.6, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: HOPPER.x + HOPPER.w - 2.4, y: HOPPER.y, w: 2.4, d: HOPPER.d, r: 0.6 }, CAB_H + 1.6, HOPPER_H - 1.6, P, 2), { tone: "mid" }))
  return out.join("")
}
function hopperFront() {
  return S(k.slabOf({ x: HOPPER.x, y: HOPPER.y + HOPPER.d - 2.4, w: HOPPER.w, d: 2.4, r: 0.6 }, CAB_H + 1.6, HOPPER_H - 1.6, P, 2), { tone: "mid" })
}

// ── Assemble ───────────────────────────────────────────────────────────────
const both = (part, a, b, on = false) => `<g data-part="${part}" data-state="${on ? "on" : "off"}"><g class="st-off">${a}</g><g class="st-on">${b}</g></g>`
const SPOTS = {
  prompts: { x: VALVES[0].x - 12, y: VALVES[0].y - 12, w: 24, d: 30, r: 8 },
  tools: { x: VALVES[1].x - 12, y: VALVES[1].y - 12, w: 24, d: 30, r: 8 },
  capped: { x: SRC.x + 2, y: VALVES[2].y - 10, w: SRC.w - 4, d: 20, r: 8 },
  deck: k.insetPlan(DECK, -6),
  identity: { x: BIN1.x - 4, y: SLOT1.y - 10, w: BIN1.w + 8, d: SUB.y + SUB.d - SLOT1.y + 18, r: 8 },
  content: { x: BIN2.x - 4, y: SLOT2.y - 10, w: BIN2.w + SHUTTER_PARK, d: SUB.y + SUB.d - SLOT2.y + 18, r: 8 },
  store: k.insetPlan(CAB, -6),
}
const spots = Object.entries(SPOTS).map(([id, plan]) => `<path class="fig-spot" data-spot="${id}" d="${k.haloOf(plan, 0, 0.1, P)}"/>`).join("")

const valvesSvg = VALVES.map((v) => (v.big ? both(`valve-${v.id}`, valve(v, false), valve(v, true), v.id === "tools") + lamp(v) : valve(v, false))).join("")

const back = [
  bench(),
  spots,
  `<g data-station="source">${source()}${valvesSvg}</g>`,
  `<g data-station="base">${base()}${drawer(BIN1, "identity")}${drawer(BIN2, "content")}</g>`,
  byDepth(SPRING_AT).map(spring).join(""),
  `<g data-station="deck">${deck()}<g data-part="shutter">${shutter()}</g></g>`,
  `<g data-station="store">${cabinet()}</g>`,
]
// The tokens ride between the deck and its near lip; the lip and the hopper's near wall go over them.
const front = [lipFront(), hopperFront()]

const LABEL =
  "A coin sorter for telemetry attributes. On the left a box stands for Claude Code, with valves on its lid for its OTEL_LOG switches; it pours attribute tokens onto a deck that rides on four springs and is shaken forward by a small motor. The deck has two slots, smallest first: identity tokens are the smallest and always fall through the first, into a drawer; content tokens fall through the second, into a second drawer, unless a shutter is slid over it, which is the --store-content flag. Everything else rides to the end of the deck and drops into a hopper on the store cabinet."

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer fx-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">${front.join("")}</svg>`

// ── The tokens: real attribute keys, sorted by the same lists the Go code uses ──
// A turn's worth of keys as Claude Code sends them: on the interaction span,
// the model request, a tool span and the api_request event.
const STREAM = [
  { key: "session.id" },
  { key: "user.account_uuid" },
  { key: "model" },
  { key: "user.email" },
  { key: "full_command", gate: "tools" },
  { key: "input_tokens" },
  { key: "user_prompt", placeholder: true },
  { key: "organization.id" },
  { key: "cost_usd" },
  { key: "file_path", gate: "tools" },
  { key: "duration_ms" },
  { key: "user_prompt_length" },
].map((t) => ({ ...t, cls: classOf(t.key) }))
const HUE_OF = { identity: 2, content: 0, kept: 3 }
const TOKENS = STREAM.map((t) => ({ ...t, hue: t.gate === "tools" ? 1 : HUE_OF[t.cls], size: t.cls === "identity" ? 0.62 : t.cls === "content" ? 0.82 : 1 }))

const n = (x) => `${x}`
const HOVER = [
  { id: "prompts", read: "OTEL_LOG_USER_PROMPTS · prompt text; off sends user_prompt as <REDACTED>", box: [VALVES[0].x - 7, VALVES[0].y - 7, SRC_H, VALVES[0].x + 7, VALVES[0].y + 12, SRC_H + 10] },
  { id: "tools", read: "OTEL_LOG_TOOL_DETAILS · commands, file paths, skill and MCP names", box: [VALVES[1].x - 7, VALVES[1].y - 7, SRC_H, VALVES[1].x + 12, VALVES[1].y + 12, SRC_H + 10] },
  { id: "capped", read: `${SOURCE_GATES.length - 2} more content switches · off, never needed`, box: [SRC.x + 4, VALVES[2].y - 6, SRC_H, SRC.x + SRC.w - 4, VALVES[2].y + 6, SRC_H + 6] },
  { id: "deck", read: `every key of every record: ${REDACT_CALLS} maps per batch type`, box: [DECK.x + 40, DECK.y, FLOOR, DECK.x + DECK.w - 10, DECK.y + DECK.d, FLOOR + 4] },
  { id: "identity", read: `${MODEL.identityKeys.length} identity keys · always out, even with --store-content`, box: [BIN1.x, SLOT1.y - 3, 0, BIN1.x + BIN1.w, SUB.y + SUB.d + 3, FLOOR + 2] },
  { id: "content", read: `${MODEL.contentKeys.length} content keys + ${MODEL.contentPrefixes.length} prefixes · out unless --store-content`, box: [BIN2.x, SLOT2.y - 3, 0, BIN2.x + BIN2.w + 10, SUB.y + SUB.d + 3, FLOOR + 6] },
  { id: "store", read: "what is left · written to the store", box: [CAB.x, CAB.y, 0, CAB.x + CAB.w, CAB.y + CAB.d, CAB_H + HOPPER_H] },
]
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up = []
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
const HIT = HOVER.map((s) => {
  const [x0, y0, z0, x1, y1, z1] = s.box
  const pts = [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]].map(at)
  return { id: s.id, read: s.read, hull: hull(pts) }
})

const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  run: [SPOUT.x + 6, DECK.x + DECK.w], // where a token rides
  slots: [SLOT1.x + SLOT1.w / 2, SLOT2.x + SLOT2.w / 2],
  shutterPark: SHUTTER_PARK,
  floor: FLOOR,
  deck: { y0: DECK.y + 3, y1: LIP.y, x0: DECK.x + 3, x1: DECK.x + DECK.w },
  hopper: HOPPER.x + HOPPER.w / 2,
  hopperZ: CAB_H + 2,
  spoutZ: SPOUT_Z + 2,
  tokens: TOKENS,
  hit: HIT,
  hoverIds: HOVER.map((h) => h.id),
  // Dark hues, then light ones: content (indigo), tool (teal), identity (red), kept (stone).
  hues: {
    dark: [[0.604, 0.573, 0.957], [0.247, 0.753, 0.698], [0.93, 0.45, 0.42], [0.6, 0.59, 0.56]],
    light: [[0.388, 0.349, 0.878], [0.078, 0.6, 0.557], [0.851, 0.325, 0.31], [0.47, 0.46, 0.44]],
  },
  facts: { identity: MODEL.identityKeys.length, content: MODEL.contentKeys.length, prefixes: MODEL.contentPrefixes.length },
}

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="Redaction. P opens the prompt valve, T the tool details valve, C slides the content shutter (--store-content). Arrow keys move between parts.">${backSvg}<canvas class="fx-layer fx-gl" aria-hidden="true"></canvas>${frontSvg}</div>`
const body = k.plateHtml({
  fig: "Fig 3",
  title: "Redaction",
  hint: "P · T · C, or click a valve",
  readout: "",
  keys: [
    { mark: "lit", label: "A valve or shutter you have switched on (P, T, C)" },
    { mark: "raised", label: "Tokens are attribute keys: identity red, content indigo, tool details teal, the rest stone" },
    { mark: "edge", label: "Smallest falls first: identity through slot 1, content through slot 2 unless the shutter covers it" },
  ],
  caption: `Two gates. Claude Code only sends prompt text with OTEL_LOG_USER_PROMPTS=1 and tool details with OTEL_LOG_TOOL_DETAILS=1. Then Aftertrace, before anything is written, deletes ${MODEL.identityKeys.length} identity keys always and ${MODEL.contentKeys.length} content keys and ${MODEL.contentPrefixes.length} key prefixes unless you run with --store-content, from every resource, span, span event, log record and metric point. Tool details are not content keys, so when the source sends them they are kept.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "redaction-dark.html" : "redaction.html")
writeFileSync(file, k.pageHtml({ title: "Redaction", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
