// Fig 4 · The store, as a card-catalogue cabinet on its own base plate.
// The base plate is the DuckDB file. Batches arrive along a trough on the left
// and wait at a gate: one lift car (the single writer) carries one batch at a
// time up to its drawer. The four drawers are the four tables. Drawers with a
// rod through their cards (spans, span_events) have a key, so a card sent
// twice slides onto the same place on the rod and replaces the old one; the
// others have no rod and a card sent twice is filed twice. Guide cards with
// tabs are the indexes. A rack of reading frames on the right is the views:
// pull one up and the drawers it reads light up. A small box of price cards
// sits behind them, a write-ahead ledger lies in front, and a sealed hatch on
// the side is the sandbox the file is opened in.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { STORE } from "./facts.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 440

// ── World plan (units ≈ px; x along the base, y toward the reader, z up) ────
const BASE = { x: -206, y: -66, w: 424, d: 164, r: 10 }
const BASE_H = 12
const FOOT_H = 6

const CAB = { x: -40, y: -58, w: 104, d: 88, r: 4 }
const CAB_H = 132
const FACE_Y = CAB.y + CAB.d // the drawer fronts sit on this plane
const TABLES = STORE.tables
const DRAWER_H = (CAB_H - 16) / TABLES.length
const OPEN = 46 // how far a drawer comes out

// The lift: a shaft on the cabinet's front-left corner, one car, one writer.
const SHAFT = { x: -104, y: -44, w: 24, d: 24, r: 1 }
const SHAFT_H = CAB_H + 14
const CAR = { x: SHAFT.x + 3, y: SHAFT.y + 3, w: SHAFT.w - 6, d: SHAFT.d - 6, r: 1 }
const CAR_H = 18
const CAR_DOCK = 14 // car floor when it is down at the trough

const TROUGH_Z = 14
const TROUGH_W = 14
const TROUGH_Y = SHAFT.y + SHAFT.d / 2
const RUN = { x0: -200, x1: SHAFT.x }
const GATE_X = SHAFT.x - 6

const LEDGER = { x: -160, y: 44, w: 50, d: 34, r: 1.5 }

const RACK = { x: 92, y: -46, w: 76, d: 100, r: 3 }
const FRAME_Y = [-34, -16, 2, 20, 38] // one standing frame per view, back to front
const FRAME = { x: RACK.x + 8, w: 60, h: 56 }
const FRAME_Z = 8
const LIFT_UP = 34 // how far a frame rises when you read it

const BOX = { x: 178, y: -52, w: 30, d: 34, r: 2 }
const BOX_H = 18

const P = k.fitProjection(
  [...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), [CAB.x, CAB.y, SHAFT_H + 10], [CAB.x + CAB.w, CAB.y, CAB_H + 6], [RACK.x, FRAME_Y[0], FRAME_Z + FRAME.h + LIFT_UP + 8]],
  W,
  H,
  { pad: 22, azimuth: 52 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
const seg = (a, b) => k.segment(a, b, P)
const rectOnFront = (x0, x1, z0, z1, y) => seg([x0, y, z1], [x1, y, z1]) + seg([x1, y, z1], [x1, y, z0]) + seg([x1, y, z0], [x0, y, z0]) + seg([x0, y, z0], [x0, y, z1])
const rectOnSide = (y0, y1, z0, z1, x) => seg([x, y0, z1], [x, y1, z1]) + seg([x, y1, z1], [x, y1, z0]) + seg([x, y1, z0], [x, y0, z0]) + seg([x, y0, z0], [x, y0, z1])

// ── Base: the file itself ──────────────────────────────────────────────────
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`]
  for (const [x, y] of byDepth(k.corners(BASE, 26))) {
    out.push(S(k.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }))
    out.push(S(k.cylinder(x, y, 6, -BASE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }))
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(BASE, 6), 0, P), { tone: "lo" }))
  const screws = k.corners(BASE, 12)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }))
  // A ruler along the front, as on Fig 1's bench.
  const strip = { x: BASE.x + 150, y: BASE.y + BASE.d - 17, w: BASE.w - 190, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  // The one engraved label, on the front edge: the file's name.
  const fy = BASE.y + BASE.d
  const plate = { x0: BASE.x + 34, x1: BASE.x + 128, z0: -BASE_H + 3, z1: -3 }
  out.push(L(rectOnFront(plate.x0, plate.x1, plate.z0, plate.z1, fy), { tone: "lo" }))
  out.push(D([at([plate.x0 + 2.5, fy, (plate.z0 + plate.z1) / 2]), at([plate.x1 - 2.5, fy, (plate.z0 + plate.z1) / 2])], { size: 0.45 }))
  out.push(k.faceTextSvg(k.sideMatrix([plate.x0 + 6, fy], plate.z0 + 1.9, P, "left"), "aftertrace.duckdb", { size: 4.4, tone: "mid" }))
  return out.join("")
}

// ── The trough the batches arrive along, and the gate at its end ──────────
function trough() {
  const out = []
  const plan = { x: RUN.x0, y: TROUGH_Y - TROUGH_W / 2 - 2, w: RUN.x1 - RUN.x0, d: TROUGH_W + 4, r: 1 }
  for (const x of [RUN.x0 + 12, RUN.x1 - 16]) {
    out.push(S(k.slabOf({ x: x - 5, y: TROUGH_Y - 8, w: 10, d: 16, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
    out.push(S(k.slabOf({ x: x - 3, y: TROUGH_Y - 6, w: 6, d: 12, r: 1 }, 2, TROUGH_Z - 5, P, 3, 0.4), { tone: "mid" }))
  }
  out.push(S(k.slabOf(plan, TROUGH_Z - 3, 3, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: RUN.x0, y: plan.y, w: RUN.x1 - RUN.x0, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2), { tone: "mid" }))
  // An end cap where the trough starts.
  out.push(S(k.slabOf({ x: RUN.x0 - 2, y: plan.y, w: 2, d: plan.d, r: 0.5 }, TROUGH_Z - 3, 10, P, 2), { tone: "mid" }))
  return out.join("")
}
function troughFront() {
  return S(k.slabOf({ x: RUN.x0, y: TROUGH_Y + TROUGH_W / 2, w: RUN.x1 - RUN.x0, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2, 0.3), { tone: "mid" })
}
// The gate across the trough: a plate in two guides that lifts to let one batch through.
function gateGuides() {
  const out = []
  for (const y of [TROUGH_Y - TROUGH_W / 2 - 3, TROUGH_Y + TROUGH_W / 2 + 1]) out.push(S(k.slabOf({ x: GATE_X - 2, y, w: 4, d: 2, r: 0.4 }, TROUGH_Z - 3, 24, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: GATE_X - 2, y: TROUGH_Y - TROUGH_W / 2 - 3, w: 4, d: TROUGH_W + 6, r: 0.5 }, TROUGH_Z + 21, 2.4, P, 2), { tone: "mid" }))
  return out.join("")
}
function gatePlate() {
  return S(k.slabOf({ x: GATE_X - 0.8, y: TROUGH_Y - TROUGH_W / 2 - 1, w: 1.6, d: TROUGH_W + 2, r: 0.3 }, TROUGH_Z, 10, P, 2), { tone: "hi", crease: "lo" })
}

// ── The lift: four corner posts, a head with its pulley, and the car ───────
const POSTS = k.corners(SHAFT, 0).map(([x, y]) => [x + (x > SHAFT.x + 1 ? -2.4 : 0), y + (y > SHAFT.y + 1 ? -2.4 : 0)])
function shaftBack() {
  const out = []
  out.push(S(k.slabOf(k.insetPlan(SHAFT, -2), 0, 4, P, 3, 0.5), { tone: "lo" }))
  // The two back posts and a back brace stand behind the car.
  for (const [x, y] of POSTS.filter(([, y]) => y < SHAFT.y + 1)) out.push(S(k.slabOf({ x, y, w: 2.4, d: 2.4, r: 0.4 }, 4, SHAFT_H - 4, P, 2), { tone: "mid" }))
  return out.join("")
}
function shaftFront() {
  const out = []
  for (const [x, y] of byDepth(POSTS.filter(([, y]) => y > SHAFT.y + 1))) out.push(S(k.slabOf({ x, y, w: 2.4, d: 2.4, r: 0.4 }, 4, SHAFT_H - 4, P, 2), { tone: "mid" }))
  // The head: a cap across the posts, and the pulley that carries the car's cable.
  out.push(S(k.slabOf(k.insetPlan(SHAFT, -1.5), SHAFT_H, 4, P, 3, 0.5), { tone: "mid" }))
  const cx = SHAFT.x + SHAFT.w / 2
  const cy = SHAFT.y + SHAFT.d / 2
  out.push(S(k.slabOf({ x: cx - 7, y: cy - 1.5, w: 2, d: 3, r: 0.4 }, SHAFT_H + 4, 8, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: cx + 5, y: cy - 1.5, w: 2, d: 3, r: 0.4 }, SHAFT_H + 4, 8, P, 2), { tone: "mid" }))
  out.push(S(k.cylinder(cx, cy, 4.6, SHAFT_H + 7, 2.2, P, 28), { tone: "hi", crease: "lo" }))
  out.push(L(k.ring(cx, cy, 1.4, SHAFT_H + 9.2, P, 12), { tone: "lo" }))
  // The writer's key, in its lock on the head: one key, so one writer.
  const kx = SHAFT.x + SHAFT.w - 2
  out.push(S(k.slabOf({ x: kx - 4, y: SHAFT.y + SHAFT.d - 1.5, w: 6, d: 2, r: 0.5 }, SHAFT_H - 10, 8, P, 2), { tone: "mid" }))
  return out.join("")
}
// The key bow, upright while the car is free, turned flat while a batch is being written.
function keyBow(turned) {
  const kx = SHAFT.x + SHAFT.w - 5
  const y = SHAFT.y + SHAFT.d + 0.5
  const z = SHAFT_H - 6
  return turned
    ? S(k.slabOf({ x: kx - 4, y, w: 8, d: 1.4, r: 0.5 }, z - 1, 2.2, P, 2), { tone: "hi", lit: true })
    : S(k.slabOf({ x: kx - 1.1, y, w: 2.2, d: 1.4, r: 0.5 }, z - 3, 6, P, 2), { tone: "hi", crease: "lo" })
}
// The car: a floor, a back and a roof in the back layer; front bars over the batch it carries.
function carBack() {
  const out = []
  out.push(S(k.slabOf(CAR, CAR_DOCK - 2, 2, P, 2, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: CAR.x, y: CAR.y, w: CAR.w, d: 1.6, r: 0.4 }, CAR_DOCK, CAR_H, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: CAR.x + CAR.w - 1.6, y: CAR.y, w: 1.6, d: CAR.d, r: 0.4 }, CAR_DOCK, CAR_H, P, 2), { tone: "mid" }))
  return out.join("")
}
function carFront() {
  const out = []
  const z1 = CAR_DOCK + CAR_H
  out.push(S(k.slabOf(k.insetPlan(CAR, -0.6), z1, 2, P, 2, 0.4), { tone: "mid" }))
  // The cable eye on the roof.
  out.push(S(k.cylinder(CAR.x + CAR.w / 2, CAR.y + CAR.d / 2, 1.6, z1 + 2, 2, P, 14), { tone: "hi", crease: "lo" }))
  // Front gate bars, floor to roof.
  const fy = CAR.y + CAR.d - 1
  for (const x of [CAR.x + 1, CAR.x + CAR.w / 2 - 0.6, CAR.x + CAR.w - 2.2]) out.push(S(k.slabOf({ x, y: fy, w: 1.2, d: 1.2, r: 0.3 }, CAR_DOCK, CAR_H, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf({ x: CAR.x, y: fy, w: CAR.w, d: 1.2, r: 0.3 }, CAR_DOCK + CAR_H * 0.55, 1.2, P, 2), { tone: "mid" }))
  return out.join("")
}

// ── The cabinet: the four tables ───────────────────────────────────────────
const drawerZ = (i) => CAB_H - 8 - (i + 1) * DRAWER_H + 2
const DRAWER_FRONT = { x: CAB.x + 6, y: FACE_Y - 2, w: CAB.w - 12, d: 3, r: 1 }
function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`]
  out.push(S(k.slabOf(CAB, 0, 6, P, 4, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(CAB, 2), 6, CAB_H - 6, P, 4, 1), { tone: "mid" }))
  out.push(S(k.slabOf(k.insetPlan(CAB, -1.5), CAB_H, 4, P, 4, 0.8), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(CAB, 6), CAB_H + 4, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(CAB, 5)) out.push(D([at([x, y, CAB_H + 4])], { size: 0.45 }))
  // The sealed hatch on the right side: the sandbox the file is opened in.
  const sx = CAB.x + CAB.w - 2
  const h = { y0: CAB.y + 14, y1: CAB.y + 50, z0: 40, z1: 92 }
  out.push(L(rectOnSide(h.y0, h.y1, h.z0, h.z1, sx), { tone: "lo" }))
  out.push(D([[h.y0 + 3, h.z0 + 3], [h.y1 - 3, h.z0 + 3], [h.y0 + 3, h.z1 - 3], [h.y1 - 3, h.z1 - 3]].map(([y, z]) => at([sx, y, z])), { size: 0.45 }))
  // Two eyelets either side of the hatch seam, a wire through both, and the lead seal hanging from it.
  const ez = (h.z0 + h.z1) / 2
  const e0 = [sx, h.y1 - 2.5, ez + 4]
  const e1 = [sx, h.y1 + 3.5, ez + 4]
  out.push(L(k.sideRing(e0, 1.4, "x", P, 14) + k.sideRing(e1, 1.4, "x", P, 14), { tone: "mid" }))
  const sealC = [sx + 0.5, h.y1 + 0.5, ez - 7]
  out.push(L(seg(e0, [sx + 0.5, h.y1 - 0.8, ez - 4.8]) + seg(e1, [sx + 0.5, h.y1 + 1.8, ez - 4.8]), { tone: "lo" }))
  out.push(`<path class="iso-fill" d="${k.sideRing(sealC, 2.6, "x", P, 18)}"/>` + L(k.sideRing(sealC, 2.6, "x", P, 18), { tone: "hi" }))
  out.push(D([at(sealC)], { size: 0.5 }))
  return out.join("")
}
// What is in a drawer: its box, a run of cards, guide cards with tabs (the
// indexes), the rod through the cards when the table has a key, and one card
// standing up with a ruled line per column. Seen only where the drawer has come
// out past the cabinet face (the page sets the clip).
const CARD_ROWS = 11
const boxOf = () => ({ x: DRAWER_FRONT.x + 3, y: CAB.y + 8, w: DRAWER_FRONT.w - 6, d: CAB.d - 10, r: 1 })
const cardY = (c) => boxOf().y + boxOf().d - 6 - c * 6.2
const COLUMN_CARD = 0 // the card that stands up: the front one
function drawerInside(i) {
  const t = TABLES[i]
  const z = drawerZ(i)
  const box = boxOf()
  const top = z + DRAWER_H - 8
  const out = []
  out.push(S(k.slabOf(box, z + 1, 2, P, 2), { tone: "lo", crease: "none" }))
  for (const x of [box.x, box.x + box.w - 2]) out.push(S(k.slabOf({ x, y: box.y, w: 2, d: box.d, r: 0.5 }, z + 1, DRAWER_H - 7, P, 2), { tone: "mid" }))
  // The rod, low through every card, from the back of the drawer to its knob on the front.
  if (t.key.length) out.push(S(k.slabOf({ x: box.x + box.w / 2 - 0.8, y: box.y + 2, w: 1.6, d: box.d - 2, r: 0.6 }, z + 4, 1.6, P, 2), { tone: "hi", crease: "lo" }))
  // Cards on edge: their top edges, and a guide card with a raised tab for each index.
  const guides = t.indexes.map((_, n) => 2 + n * 2)
  for (let c = CARD_ROWS - 1; c >= 0; c--) {
    if (c === COLUMN_CARD) continue
    const y = cardY(c)
    const h = z + DRAWER_H - 9 - (c % 3) * 0.6
    // A card: a thin solid, its lower part hidden by the card in front of it.
    let card = S(k.slabOf({ x: box.x + 3.5, y, w: box.w - 7, d: 0.7, r: 0.2 }, h - 7, 7, P, 2), { tone: "lo", crease: "none" })
    const g = guides.indexOf(c)
    if (g >= 0) {
      const tx = box.x + 48 + (g % 3) * 12
      card += S(k.slabOf({ x: tx, y: y - 0.4, w: 10, d: 0.8, r: 0.2 }, h - 0.2, 3.6, P, 2), { tone: "hi", crease: "lo" })
    }
    // Each card shows only once the drawer has brought it out past the cabinet face.
    out.push(`<g data-card-y="${y.toFixed(1)}">${card}</g>`)
  }
  return out.join("")
}
// The standing card for a table: one ruled line per column, key columns with a dot,
// JSON columns with a short double rule. Drawn on its own so it can rise.
function columnCard(i) {
  const t = TABLES[i]
  const z = drawerZ(i)
  const box = boxOf()
  const y = cardY(COLUMN_CARD)
  const x0 = box.x + 5
  const x1 = x0 + 40
  const z0 = z + 3
  const z1 = z0 + 6 + t.columns.length * 2 + 3
  const out = []
  out.push(S(k.slabOf({ x: x0, y, w: x1 - x0, d: 0.8, r: 0.2 }, z0, z1 - z0, P, 2), { tone: "hi", crease: "lo" }))
  const fy = y + 0.8
  t.columns.forEach((c, n) => {
    const lz = z1 - 4 - n * 2
    const len = 8 + ((c.name.length * 2.3) % 14)
    out.push(L(seg([x0 + 6, fy, lz], [x0 + 6 + len, fy, lz]), { tone: c.key ? "hi" : "lo", free: true }))
    if (c.key) out.push(D([at([x0 + 3, fy, lz])], { size: 0.55, tone: "hi" }))
    if (c.json) out.push(L(seg([x1 - 10, fy, lz + 0.5], [x1 - 4, fy, lz + 0.5]) + seg([x1 - 10, fy, lz - 0.5], [x1 - 4, fy, lz - 0.5]), { tone: "lo", free: true }))
  })
  return out.join("")
}
function drawerFront(i) {
  const t = TABLES[i]
  const z = drawerZ(i)
  const f = DRAWER_FRONT
  const out = []
  out.push(S(k.slabOf(f, z, DRAWER_H - 2, P, 3, 0.6), { tone: "mid" }))
  const lx = f.x + f.w / 2
  const fy = f.y + f.d
  // The label holder: a frame with a blank card in it.
  const z1 = z + DRAWER_H - 5
  const z0 = z + DRAWER_H - 11
  out.push(L(rectOnFront(lx - 13, lx + 13, z0, z1, fy), { tone: "lo" }))
  out.push(D([at([lx - 11, fy, (z0 + z1) / 2]), at([lx + 11, fy, (z0 + z1) / 2])], { size: 0.4 }))
  // The pull.
  out.push(S(k.slabOf({ x: lx - 9, y: fy, w: 18, d: 2.6, r: 1 }, z + 8.5, 3, P, 2), { tone: "mid" }))
  // The rod's knob, low on the front, only on a drawer with a key.
  if (t.key.length) out.push(S(k.cylinder(lx, fy + 1.2, 1.6, z + 2, 2, P, 16), { tone: "hi", crease: "lo" }))
  // A wash of colour over the front while a view reads this table.
  const g = [[f.x, fy, z], [f.x + f.w, fy, z], [f.x + f.w, fy, z + DRAWER_H - 2], [f.x, fy, z + DRAWER_H - 2]].map(at)
  out.push(`<path class="fig-glow" data-hue="${HUE_OF[t.name]}" data-glow="${t.name}" d="M${g.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L")}Z"/>`)
  // The drawer's lamp, at the top right of the front, in the colour of what it holds.
  out.push(`<circle class="fig-lamp" data-hue="${HUE_OF[t.name]}" data-lamp="${t.name}" cx="${at([f.x + f.w - 6, fy, z + DRAWER_H - 6])[0].toFixed(1)}" cy="${at([f.x + f.w - 6, fy, z + DRAWER_H - 6])[1].toFixed(1)}" r="1.5"/>`)
  return out.join("")
}
const HUE_OF = { spans: "model", span_events: "model", events: "tool", metric_points: "wait" }

// ── The views: a rack of standing reading frames ───────────────────────────
function rackBase() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(RACK, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf(RACK, 0, FRAME_Z, P, 3, 0.6), { tone: "mid" }))
  // A slot for each frame, cut in the top.
  for (const y of FRAME_Y) out.push(L(k.planOutline({ x: FRAME.x - 2, y: y - 1, w: FRAME.w + 4, d: 4, r: 0.6 }, FRAME_Z, P, 2), { tone: "lo" }))
  for (const [x, y] of k.corners(RACK, 4)) out.push(D([at([x, y, FRAME_Z])], { size: 0.45 }))
  return out.join("")
}
// A reading frame: a thin board with a glass window and a tab on top, its tab
// at its own place so every view can be told apart from above.
function frame(n) {
  const y = FRAME_Y[n]
  const out = []
  const z0 = FRAME_Z - 2
  const z1 = FRAME_Z + FRAME.h
  out.push(S(k.slabOf({ x: FRAME.x, y, w: FRAME.w, d: 2, r: 0.5 }, z0, z1 - z0, P, 2, 0.3), { tone: "hi", crease: "lo" }))
  const tx = FRAME.x + 4 + n * 10
  out.push(S(k.slabOf({ x: tx, y, w: 12, d: 2, r: 0.5 }, z1, 5, P, 2), { tone: "hi", crease: "lo" }))
  const m = k.sideMatrix([0, y + 2], 0, P, "left")
  const gx0 = FRAME.x + 6
  const gx1 = FRAME.x + FRAME.w - 6
  const gz0 = z1 - 30
  const gz1 = z1 - 7
  out.push(`<g transform="${m}"><rect class="fig-glass" data-view="${STORE.views[n].name}" x="${gx0}" y="${-gz1}" width="${gx1 - gx0}" height="${gz1 - gz0}" rx="1.5"/><rect class="fig-glass-edge" x="${gx0}" y="${-gz1}" width="${gx1 - gx0}" height="${gz1 - gz0}" rx="1.5"/></g>`)
  // Two finger holes under the glass to lift it by.
  out.push(L(k.sideRing([FRAME.x + FRAME.w / 2 - 6, y + 2, gz0 - 6], 1.8, "y", P, 14) + k.sideRing([FRAME.x + FRAME.w / 2 + 6, y + 2, gz0 - 6], 1.8, "y", P, 14), { tone: "lo" }))
  return out.join("")
}

// ── The price box, behind the rack, and the write-ahead ledger in front ────
function priceBox() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BOX, 1), 0, 0.1, P)}" style="filter:blur(3px)"/>`]
  out.push(S(k.slabOf(BOX, 0, BOX_H, P, 3, 0.5), { tone: "mid" }))
  out.push(S(k.slabOf(k.insetPlan(BOX, 2.5), BOX_H - 0.2, 0.2, P, 2), { tone: "lo", flat: true, crease: "none" }))
  // Cards standing in it, their tops showing above the rim.
  for (let c = 0; c < 6; c++) {
    const y = BOX.y + BOX.d - 6 - c * 4.2
    out.push(S(k.slabOf({ x: BOX.x + 4, y, w: BOX.w - 8, d: 0.7, r: 0.2 }, BOX_H - 6, 9 - (c % 2) * 1.2, P, 2), { tone: "hi", crease: "none" }))
  }
  // The lid, open, standing at the back on its hinge.
  out.push(S(k.slabOf({ x: BOX.x - 0.5, y: BOX.y - 2, w: BOX.w + 1, d: 2, r: 0.5 }, BOX_H, BOX.d - 6, P, 2, 0.3), { tone: "mid" }))
  out.push(L(rectOnFront(BOX.x + 9, BOX.x + BOX.w - 9, 6, 11, BOX.y + BOX.d), { tone: "lo" }))
  out.push(`<path class="fig-glow" data-hue="wait" data-glow="prices" d="${k.haloOf(k.insetPlan(BOX, 2), BOX_H, 0.1, P)}"/>`)
  return out.join("")
}
function ledger() {
  const out = [`<path class="iso-halo" d="${k.haloOf(LEDGER, 0, 0.1, P)}" style="filter:blur(2px)"/>`]
  out.push(S(k.slabOf(LEDGER, 0, 2.2, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf(k.insetPlan(LEDGER, 1.5), 2.2, 2.2, P, 2), { tone: "hi", crease: "none" }))
  out.push(S(k.slabOf({ ...LEDGER, d: LEDGER.d, x: LEDGER.x }, 4.4, 1.4, P, 2), { tone: "mid" }))
  // The spine, and ruled lines on the cover where a label goes.
  out.push(L(seg([LEDGER.x + 6, LEDGER.y, 5.8], [LEDGER.x + 6, LEDGER.y + LEDGER.d, 5.8]), { tone: "lo" }))
  for (const [n, len] of [24, 18, 30].entries()) out.push(L(k.lineOnTop([LEDGER.x + 12, LEDGER.y + 9 + n * 5], [LEDGER.x + 12 + len, LEDGER.y + 9 + n * 5], 5.8, P), { tone: "lo", free: true }))
  // A ribbon marker hanging out of the pages at the front.
  out.push(S(k.slabOf({ x: LEDGER.x + LEDGER.w - 12, y: LEDGER.y + LEDGER.d, w: 3, d: 6, r: 0.4 }, 0.2, 0.8, P, 2), { tone: "lo", crease: "none" }))
  out.push(`<circle class="fig-lamp" data-hue="model" data-lamp="wal" cx="${at([LEDGER.x + LEDGER.w - 5, LEDGER.y + 5, 5.8])[0].toFixed(1)}" cy="${at([LEDGER.x + LEDGER.w - 5, LEDGER.y + 5, 5.8])[1].toFixed(1)}" r="1.4"/>`)
  return out.join("")
}
// A cable from the lift's foot to the ledger: every write is logged before it is filed.
function ledgerCable() {
  const a = [SHAFT.x + 6, SHAFT.y + SHAFT.d + 2, 2]
  const b = [LEDGER.x + LEDGER.w, LEDGER.y + 8, 2.2]
  return k.wireSvg(at(a), at(b), { via: [at([a[0], b[1], 2])], tone: "lo", ends: "both", size: 1.1 })
}

// ── Assemble: back SVG, the light canvas, front SVG ────────────────────────
const st = (station, body) => `<g data-station="${station}">${body}</g>`
const both = (part, a, b) => `<g data-part="${part}" data-state="off"><g class="st-off">${a}</g><g class="st-on">${b}</g></g>`
const SPOTS = {
  file: k.insetPlan(BASE, 10),
  writer: { x: RUN.x0 - 4, y: TROUGH_Y - 16, w: SHAFT.x + SHAFT.w - RUN.x0 + 8, d: 32, r: 10 },
  ...Object.fromEntries(TABLES.map((t) => [t.name, { x: CAB.x - 6, y: FACE_Y - 6, w: CAB.w + 12, d: OPEN + 14, r: 10 }])),
  ...Object.fromEntries(STORE.views.map((v) => [v.name, k.insetPlan(RACK, -8)])),
  prices: k.insetPlan(BOX, -8),
  wal: k.insetPlan(LEDGER, -8),
  sandbox: { x: CAB.x + CAB.w - 8, y: CAB.y - 6, w: 26, d: CAB.d + 12, r: 8 },
}
const spots = Object.entries(SPOTS)
  .map(([id, plan]) => `<path class="fig-spot" data-spot="${id}" d="${k.haloOf(plan, 0, 0.1, P)}"/>`)
  .join("")
const drawers = TABLES.map(
  (t, i) =>
    `<g data-part="drawer-slot-${i}"><g clip-path="url(#dclip-${i})"><g data-part="drawer-in-${i}">${drawerInside(i)}<g data-part="colcard-${i}" data-card-y="${cardY(COLUMN_CARD).toFixed(1)}">${columnCard(i)}</g></g></g><g data-part="drawer-${i}">${drawerFront(i)}</g></g>`,
).join("")
const clips = `<defs>${TABLES.map((_, i) => `<clipPath id="dclip-${i}"><path data-clip="${i}" d="M0 0Z"/></clipPath>`).join("")}</defs>`
// Frames are painted back to front; each frame is its own group so it can rise.
const frames = STORE.views.map((v, n) => `<g data-part="frame-${n}">${frame(n)}</g>`).join("")

// Back: the base and what lies on it behind the light. The light (batches in
// the trough and the lift car) is painted over that. Front: everything that
// stands in front of the light, the cabinet and its drawers included, so an
// open drawer covers the lift behind it.
const back = [
  base(),
  spots,
  st("wal", ledger() + ledgerCable()),
  st("writer", trough() + shaftBack() + `<g data-part="car-back">${carBack()}</g>`),
]
const front = [
  clips,
  st("writer", troughFront() + gateGuides() + `<g data-part="gate">${gatePlate()}</g>` + `<path class="iso-line" data-tone="mid" data-part="cable" d="M0 0"/>` + `<g data-part="car-front">${carFront()}</g>` + shaftFront() + both("key", keyBow(false), keyBow(true))),
  st("prices", priceBox()),
  st("store", cabinet() + drawers),
  st("views", rackBase() + frames),
]

const LABEL =
  `A card-catalogue cabinet on a base plate, explaining the Aftertrace store. The base plate is the one DuckDB file, ${STORE.file}. On the left, batches of light arrive along a trough and wait at a gate in front of a lift: one car, worked by one key, carries one batch at a time up to its drawer, because writes go one at a time. The cabinet has ${TABLES.length} drawers, one per table: ${TABLES.map((t) => t.name).join(", ")}. The spans and span_events drawers have a rod through their cards, a key, so a card sent twice replaces the old one; events and metric_points have no rod, so a card sent twice is filed twice. Guide cards with tabs are the indexes, and one card in each drawer stands up with a ruled line per column. On the right, a rack of ${STORE.views.length} reading frames is the views; lifting one lights the drawers it reads. Behind it a small box of ${STORE.prices} price cards is the prices table, a ledger in front is the write-ahead log, and a sealed hatch on the cabinet's side is the sandbox the file is opened in.`

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer fx-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">${front.join("")}</svg>`

const cols = (t) => `${t.columns.length} columns`
const VIEW_READ = {
  llm: "one row per model request, with its cost",
  tools: "one row per tool call, with its permission wait",
  q_spans: "every span with its cost: what Query searches",
  turn_roots: "one row per turn, running turns included",
  calls: "model calls from your own apps, priced",
}
for (const v of STORE.views) if (!VIEW_READ[v.name]) throw new Error(`no reading for view ${v.name}`)
const TABLE_READ = (t) =>
  t.key.length
    ? `${cols(t)} · key ${t.key.length > 2 ? `of ${t.key.length} columns` : t.key.join(" + ")}: sent twice, replaced`
    : `${cols(t)} · no key: sent twice, stored twice`
const STATIONS = [
  { id: "file", label: "The file", read: `${STORE.file}, one DuckDB file (--db)`, box: [BASE.x, BASE.y, -BASE_H, BASE.x + BASE.w, BASE.y + BASE.d, 0] },
  { id: "writer", label: "One writer", read: "batches wait; one transaction at a time", box: [RUN.x0, TROUGH_Y - 12, 0, SHAFT.x + SHAFT.w, SHAFT.y + SHAFT.d, SHAFT_H + 12] },
  { id: "wal", label: "aftertrace.duckdb.wal", read: "each write is logged here first", box: [LEDGER.x, LEDGER.y, 0, LEDGER.x + LEDGER.w, LEDGER.y + LEDGER.d, 6] },
  ...TABLES.map((t, i) => ({ id: t.name, label: t.name, read: TABLE_READ(t), table: i, box: [CAB.x, CAB.y, drawerZ(i), CAB.x + CAB.w, FACE_Y, drawerZ(i) + DRAWER_H] })),
  { id: "sandbox", label: "Sandbox", read: "no other files, settings locked", box: [CAB.x + CAB.w - 4, CAB.y, 30, CAB.x + CAB.w + 4, CAB.y + CAB.d, 100] },
  ...STORE.views.map((v, n) => ({ id: v.name, label: `${v.name} view`, read: `${VIEW_READ[v.name]} · reads ${v.reads.join(", ")}`, view: n, box: [FRAME.x, FRAME_Y[n], FRAME_Z, FRAME.x + FRAME.w, FRAME_Y[n] + 2, FRAME_Z + FRAME.h + 5] })),
  { id: "prices", label: "prices", read: `${STORE.prices} models, USD per million tokens, rewritten at every start`, box: [BOX.x, BOX.y, 0, BOX.x + BOX.w, BOX.y + BOX.d, BOX_H + BOX.d - 6] },
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
const boxHull = ([x0, y0, z0, x1, y1, z1]) => hull([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]].map(at))

const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  stations: STATIONS.map((s) => ({ id: s.id, label: s.label, read: s.read, table: s.table, view: s.view, hull: boxHull(s.box) })),
  // Where pointing lands first: the smaller, nearer parts win over the base plate.
  order: ["file", "wal", "writer", ...TABLES.map((t) => t.name), "sandbox", "prices", ...STORE.views.map((v) => v.name)],
  tour: ["file", "writer", ...TABLES.map((t) => t.name), ...STORE.views.map((v) => v.name), "prices", "wal", "sandbox"],
  tables: TABLES.map((t) => ({ name: t.name, keyed: t.key.length > 0 })),
  views: STORE.views.map((v) => ({ name: v.name, reads: v.reads })),
  // The drawer's box below its top edge, and how far above it the standing card may show once out.
  face: FACE_Y,
  drawerBox: TABLES.map((_, i) => ({ x0: boxOf().x, x1: boxOf().x + boxOf().w, y0: FACE_Y, z0: drawerZ(i), z1: drawerZ(i) + DRAWER_H - 2, extra: 44 })),
  open: OPEN,
  liftUp: LIFT_UP,
  trough: { z: TROUGH_Z, y: TROUGH_Y, half: TROUGH_W / 2, x0: RUN.x0, x1: RUN.x1, gate: GATE_X },
  car: { x: CAR.x + CAR.w / 2, y: CAR.y + CAR.d / 2, dock: CAR_DOCK, h: CAR_H, stops: TABLES.map((_, i) => drawerZ(i) + 2 - CAR_DOCK), top: SHAFT_H, pulley: [SHAFT.x + SHAFT.w / 2, SHAFT.y + SHAFT.d / 2, SHAFT_H + 7] },
  hues: { model: [0.388, 0.349, 0.878], tool: [0.078, 0.6, 0.557], wait: [0.886, 0.604, 0.18] },
}

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="The store. Arrow keys step through its parts; R sends the last batches again.">${backSvg}<canvas class="fx-layer fx-gl" aria-hidden="true"></canvas>${frontSvg}</div>`
const spans = TABLES.find((t) => t.name === "spans")
const body = k.plateHtml({
  fig: "Fig 4",
  title: "The store",
  hint: "Point at a drawer or a frame · R",
  readout: `${STATIONS[0].label} · ${STATIONS[0].read}`,
  keys: [
    { mark: "lit", label: "The part you point at; a drawer opens and stands its column card up" },
    { mark: "raised", label: "Light: traces in indigo, logs in teal, metrics in amber" },
    { mark: "edge", label: "R sends the last batches again: keyed drawers replace, the others file a second copy" },
  ],
  caption: `The store is one DuckDB file, ${STORE.file} by default. It has ${TABLES.length} tables: ${TABLES.map((t) => `${t.name} (${t.columns.length} columns)`).join(", ")}. Spans are keyed on ${spans.key.join(" and ")}, so a span sent twice replaces itself; events and metric points have no key and are stored as often as they arrive. Writes go one batch at a time; reads never wait. ${STORE.views.length} views (${STORE.views.map((v) => v.name).join(", ")}) join the tables into what the UI, the rules and Ask read.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "store-dark.html" : "store.html")
writeFileSync(file, k.pageHtml({ title: "The store", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
