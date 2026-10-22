// Fig 7 · Ask, as a pass-through between two benches.
// The long bench is your machine: a terminal where you type the question, the
// card cabinet (the DuckDB store), a press that only stamps read-only SQL, a
// guillotine that trims result sheets, and a step counter. The short bench
// across the gap is the Anthropic API: a teleprinter (the model). Two open
// channels bridge the gap, out along the back and in along the front, and a
// sluice gate with a padlock closes both. Light in the channels is what moves:
// indigo leaves the machine, teal is SQL coming in, red is an error going back,
// amber is the answer.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { MODEL } from "../model.mjs"
import { ASK } from "./facts.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 350

// ── World plan (units ≈ px; x along the benches, y toward the reader, z up) ──
const BENCH = { x: -252, y: -94, w: 372, d: 168, r: 10 } // this machine
const API = { x: 150, y: -60, w: 104, d: 120, r: 8 } // the Anthropic API
const BENCH_H = 12
const FOOT_H = 6

const LANE = { out: -40, in: 40 } // the y of each channel's centre line
const TZ = 24 // channel floor (top)
const HALF = 7 // half the channel's inside width
const LANE_X = [-198, 172] // terminal face to teleprinter face

const TERM = { x: -240, y: -58, w: 42, d: 116, r: 4 }
const TERM_H = 36
const MON = { x: -236, y: -36, w: 22, d: 72, r: 3 }
const MON_Z = [42, 86]
const GLASS_X = MON.x + MON.w

const CAB = { x: -142, y: -26, w: 60, d: 52, r: 3 } // plinth; the drawers sit on it
const PLINTH_H = 36
const CAB_TOP = 80
const PORT_X = -112 // where SQL goes in (front) and rows come out (back)
const TABLES = MODEL.tables

const STAMP_X = -40
const CHUTE_X = -62 // refused SQL crosses back to the out channel here
const CUT_X = 10
const DIAL = { x: 46, y: -86, w: 28, d: 16, r: 2 } // behind the out channel, facing you
const DIAL_Z = [36, 64]
const GATE_X = 112
const LIFT = 16 // how far the gate rises when Ask is on

const TP = { x: 172, y: -54, w: 70, d: 108, r: 6 } // teleprinter body
const TP_H = 36

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), ...k.boxCorners(API, -BENCH_H - FOOT_H, 0), [MON.x, MON.y, MON_Z[1] + 2], [MON.x + MON.w, MON.y + MON.d, MON_Z[1] + 2], [GATE_X, -54, 84], [190, -34, 80]],
  W,
  H,
  { pad: 22, azimuth: 58 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const box = (x0, y0, x1, y1, r = 0.6) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r })
const pt = (p) => at(p).map((v) => v.toFixed(1))
const lamp = (part, p, hue, r = 1.5) => { const [cx, cy] = pt(p); return `<circle data-part="${part}" class="fig-lamp" data-hue="${hue}" cx="${cx}" cy="${cy}" r="${r}"/>` }
const halo = (plan, blur = 4) => `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(${blur}px)"/>`

// ── Benches ────────────────────────────────────────────────────────────────
function bench(plan, label) {
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`]
  for (const [x, y] of [...k.corners(plan, 22)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
    out.push(S(k.cylinder(x, y, 8, -BENCH_H - FOOT_H, 1.8, P, 28), { tone: "lo" }))
    out.push(S(k.cylinder(x, y, 6, -BENCH_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }))
  }
  out.push(S(k.slabOf(plan, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(plan, 6), 0, P), { tone: "lo" }))
  const screws = k.corners(plan, 12)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }))
  if (label) {
    // A ruler along the front edge, and a label plate at the back left.
    const strip = { x: plan.x + 70, y: plan.y + plan.d - 17, w: plan.w - 200, d: 7, r: 1 }
    out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
    const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
    out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
    out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
    const plate = { x: plan.x + 60, y: plan.y + 10, w: 40, d: 16, r: 1.5 }
    out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }))
    out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P), { tone: "faint" }))
    for (const [i, len] of [24, 18].entries()) out.push(L(k.lineOnTop([plate.x + 6, plate.y + 6 + i * 4], [plate.x + 6 + len, plate.y + 6 + i * 4], 0.8, P), { tone: "lo", free: true }))
    out.push(D([at([plate.x + 3, plate.y + 3, 0.8]), at([plate.x + plate.w - 3, plate.y + plate.d - 3, 0.8])], { size: 0.4 }))
  }
  return out.join("")
}

// ── Channels: an open trough on stands, in pieces so ports can open into it ──
// Each channel is drawn as floor + far wall (behind its light) and near wall
// (in front of its light). gaps: [x0, x1] where the near or far wall is cut.
const cut = (x0, x1, gaps) => {
  const runs = []
  let a = x0
  for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 > a) runs.push([a, g0]); a = Math.max(a, g1) }
  if (a < x1) runs.push([a, x1])
  return runs
}
function channelBack(y, farGaps) {
  const out = []
  const far = y - HALF - 2 // the -y wall is the far one, away from the reader
  out.push(S(k.slabOf(box(LANE_X[0], y - HALF - 2, LANE_X[1], y + HALF + 2, 0.8), TZ - 3, 3, P, 3, 0.4), { tone: "mid" }))
  for (const [a, b] of cut(LANE_X[0], LANE_X[1], farGaps)) out.push(S(k.slabOf(box(a, far, b, far + 2), TZ, 7, P, 2), { tone: "mid" }))
  return out.join("")
}
function channelNear(y, nearGaps) {
  const out = []
  const near = y + HALF
  for (const [a, b] of cut(LANE_X[0], LANE_X[1], nearGaps)) out.push(S(k.slabOf(box(a, near, b, near + 2), TZ, 7, P, 2, 0.3), { tone: "mid" }))
  return out.join("")
}
function stands(y) {
  const out = []
  for (const x of [-176, -12, 92, 160]) {
    out.push(S(k.slabOf({ x: x - 5, y: y - 8, w: 10, d: 16, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
    out.push(S(k.slabOf({ x: x - 3, y: y - 6, w: 6, d: 12, r: 1 }, 2, TZ - 5, P, 3, 0.4), { tone: "mid" }))
  }
  return out.join("")
}
// Under the gap the channels ride on a flat bridge plate each.
function bridge(y) {
  return S(k.slabOf(box(118, y - HALF - 4, 152, y + HALF + 4, 1), TZ - 6, 3, P, 3, 0.4), { tone: "lo" })
}

// ── The terminal: where you type the question and read the answer ─────────
function terminal() {
  const out = [halo(k.insetPlan(TERM, 2))]
  out.push(S(k.slabOf(TERM, 0, 4, P, 4, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(TERM, 1.5), 4, TERM_H - 4, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(k.insetPlan(TERM, 1.5), TERM_H - 10, P, 4), { tone: "faint" }) }))
  // A strip of keys on top, in front of the monitor.
  const keys = { x: GLASS_X + 4, y: -30, w: 12, d: 60, r: 1.5 }
  out.push(S(k.slabOf(keys, TERM_H, 1.2, P, 3), { tone: "hi", crease: "lo" }))
  out.push(D(k.dotGrid(keys.x + 3, keys.y + 4, 2, 10, 5.8, TERM_H + 1.2, P), { size: 0.42, tone: "lo" }))
  for (const dy of [0, 4, 8]) out.push(L(k.planOutline({ x: TERM.x + 6, y: 38 + dy, w: 26, d: 1.8, r: 0.9 }, TERM_H, P, 2), { tone: "lo" }))
  // Neck and monitor.
  out.push(S(k.slabOf({ x: MON.x + 6, y: -7, w: 10, d: 14, r: 2 }, TERM_H, MON_Z[0] - TERM_H, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf(MON, MON_Z[0], MON_Z[1] - MON_Z[0], P, 4, 0.8), { tone: "hi", crease: "lo" }))
  for (const [x, y] of k.corners(TERM, 5)) out.push(D([at([x, y, TERM_H])], { size: 0.42 }))
  // Collars where the channels plug into the terminal's face.
  for (const y of [LANE.out, LANE.in]) out.push(S(k.slabOf(box(TERM.x + TERM.w - 0.5, y - 11, TERM.x + TERM.w + 3, y + 11, 1), TZ - 6, 16, P, 3, 0.3), { tone: "mid" }))
  return out.join("")
}
// The picture, drawn in the plane of the monitor's face (it faces the channels).
function glass() {
  const m = k.sideMatrix([GLASS_X, 0], 0, P, "right")
  const u0 = -32, u1 = 32, v0 = -(MON_Z[1] - 5), v1 = -(MON_Z[0] + 5)
  const w = u1 - u0
  const lines = (rows) => rows.map(([f, i, cls]) => `<line class="${cls}" x1="${u0 + 5}" x2="${(u0 + 5 + (w - 10) * f).toFixed(1)}" y1="${(v0 + 7 + i * 4.6).toFixed(1)}" y2="${(v0 + 7 + i * 4.6).toFixed(1)}"/>`).join("")
  // The question, then the answer: three lines and a small table of bars.
  const q = lines([[0.78, 0, "fig-text fig-q"]])
  const a = lines([[0.9, 2, "fig-text"], [0.7, 3, "fig-text"], [0.82, 4, "fig-text"]])
  const bars = [0.86, 0.5, 0.32].map((f, i) => `<rect class="fig-bar" data-hue="tool" x="${u0 + 5}" y="${(v0 + 25 + i * 3.6).toFixed(1)}" width="${((w - 10) * f).toFixed(1)}" height="2.2"/>`).join("")
  return `<g transform="${m}"><rect class="fig-glass" x="${u0}" y="${v0}" width="${w}" height="${v1 - v0}" rx="2"/>${q}<g class="fig-answer" data-part="answer">${a}${bars}</g><rect class="fig-glass-edge" x="${u0}" y="${v0}" width="${w}" height="${v1 - v0}" rx="2"/></g>`
}

// ── The cabinet: the DuckDB store. A plinth with two ports, four drawers on it ──
const DRAWER_H = (CAB_TOP - 3 - PLINTH_H) / TABLES.length
function cabinet() {
  const out = [halo(k.insetPlan(CAB, 1), 5)]
  out.push(S(k.slabOf(CAB, 0, PLINTH_H, P, 4, 0.8), { tone: "mid" }))
  const body = box(CAB.x + 2, CAB.y + 2, CAB.x + CAB.w - 2, CAB.y + CAB.d - 2, 3)
  out.push(S(k.slabOf(body, PLINTH_H, CAB_TOP - PLINTH_H - 3, P, 4, 0.8), { tone: "mid" }))
  out.push(S(k.slabOf(CAB, CAB_TOP - 3, 3, P, 4, 0.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(CAB, 5), CAB_TOP, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(CAB, 4)) out.push(D([at([x, y, CAB_TOP])], { size: 0.45 }))
  // The intake port on the plinth's face: a dark mouth where SQL slips go in.
  const fy = CAB.y + CAB.d
  out.push(S(k.slabOf(box(PORT_X - 9, fy, PORT_X + 9, fy + 1.4, 1), TZ - 2, 12, P, 3, 0.3), { tone: "mid" }))
  out.push(S(k.slabOf(box(PORT_X - 6, fy + 1.4, PORT_X + 6, fy + 1.6, 0.5), TZ, 7, P, 2), { tone: "lo", flat: true, crease: "none" }))
  // Drawer fronts, one per table, each with a label frame and a pull.
  for (let i = 0; i < TABLES.length; i++) {
    const z = CAB_TOP - 3 - (i + 1) * DRAWER_H + 0.8
    const f = box(CAB.x + 6, body.y + body.d, CAB.x + CAB.w - 6, body.y + body.d + 2.4, 1)
    out.push(S(k.slabOf(f, z, DRAWER_H - 1.6, P, 3, 0.5), { tone: "mid" }))
    const lx = f.x + f.w / 2, yy = f.y + f.d
    const z1 = z + DRAWER_H - 3.4, z0 = z + DRAWER_H - 6.6
    out.push(L(k.segment([lx - 8, yy, z1], [lx + 8, yy, z1], P) + k.segment([lx + 8, yy, z1], [lx + 8, yy, z0], P) + k.segment([lx + 8, yy, z0], [lx - 8, yy, z0], P) + k.segment([lx - 8, yy, z0], [lx - 8, yy, z1], P), { tone: "lo" }))
    out.push(S(k.slabOf({ x: lx - 6, y: yy, w: 12, d: 2, r: 0.8 }, z + 1.6, 2, P, 2), { tone: "mid" }))
    out.push(lamp(`drawer-${i}`, [f.x + 4, yy, z + DRAWER_H / 2], "tool", 1.1))
  }
  return out.join("")
}
// Short spouts between the plinth and each channel.
function spout(y0, y1) {
  const out = []
  out.push(S(k.slabOf(box(PORT_X - 8, y0, PORT_X + 8, y1, 0.4), TZ - 3, 3, P, 2, 0.3), { tone: "mid" }))
  for (const x of [PORT_X - 8, PORT_X + 6]) out.push(S(k.slabOf(box(x, y0, x + 2, y1, 0.3), TZ, 7, P, 2), { tone: "mid" }))
  return out.join("")
}

// ── The press: it stamps every SQL slip; only one SELECT or WITH passes ────
const STAMP_POSTS = [LANE.in - HALF - 9, LANE.in + HALF + 3]
function stampPost(y) {
  return S(k.slabOf(box(STAMP_X - 3, y, STAMP_X + 3, y + 4, 0.6), 0, 62, P, 3, 0.4), { tone: "mid" }) + D([at([STAMP_X, y + 2, 62])], { size: 0.4 })
}
function stampTop() {
  const out = []
  out.push(S(k.slabOf(box(STAMP_X - 4, STAMP_POSTS[0] - 1, STAMP_X + 4, STAMP_POSTS[1] + 5, 1), 62, 5, P, 3, 0.5), { tone: "mid" }))
  out.push(S(k.cylinder(STAMP_X, LANE.in, 3.2, 67, 3, P, 24), { tone: "mid" }))
  out.push(L(k.knurl(STAMP_X, LANE.in, 3.2, 67, 70, 18, P), { tone: "lo" }))
  out.push(lamp("stamp-lamp", [STAMP_X - 2.4, STAMP_POSTS[1] + 2, 67], "tool", 1.4))
  return out.join("")
}
// The head and its rod move together.
function stampHead() {
  const out = []
  out.push(S(k.cylinder(STAMP_X, LANE.in, 1.1, 44, 18, P, 16), { tone: "mid", crease: "none" }))
  out.push(S(k.cylinder(STAMP_X, LANE.in, 2.4, 52, 2.4, P, 20), { tone: "mid" }))
  out.push(S(k.cylinder(STAMP_X, LANE.in, 5, 36, 8, P, 28, 0.6), { tone: "hi", crease: "lo" }))
  out.push(L(k.ring(STAMP_X, LANE.in, 3.6, 44, P, 20), { tone: "faint" }))
  return out.join("")
}

// ── The refusal chute: a refused slip crosses back to the out channel ─────
function chuteFloor() {
  const y0 = LANE.out + HALF + 2, y1 = LANE.in - HALF - 2
  return S(k.slabOf(box(CHUTE_X - HALF - 2, y0 - 2, CHUTE_X + HALF + 2, y1 + 2, 0.4), TZ - 3, 3, P, 2, 0.3), { tone: "mid" }) + S(k.slabOf(box(CHUTE_X - HALF - 2, y0, CHUTE_X - HALF, y1), TZ, 7, P, 2), { tone: "mid" }) + S(k.slabOf({ x: CHUTE_X - 3, y: -6, w: 6, d: 12, r: 1 }, 0, TZ - 3, P, 3, 0.4), { tone: "mid" })
}
function chuteNear() {
  const y0 = LANE.out + HALF + 2, y1 = LANE.in - HALF - 2
  return S(k.slabOf(box(CHUTE_X + HALF, y0, CHUTE_X + HALF + 2, y1), TZ, 7, P, 2, 0.3), { tone: "mid" })
}

// ── The guillotine: result sheets are trimmed before they leave ───────────
const CUT_POSTS = [LANE.out - HALF - 9, LANE.out + HALF + 3]
function cutPost(y) {
  return S(k.slabOf(box(CUT_X - 3, y, CUT_X + 3, y + 4, 0.6), 0, 60, P, 3, 0.4), { tone: "mid" })
}
function cutTop() {
  const out = []
  const beam = box(CUT_X - 4, CUT_POSTS[0] - 1, CUT_X + 4, CUT_POSTS[1] + 5, 1)
  out.push(S(k.slabOf(beam, 60, 6, P, 3, 0.5), { tone: "mid" }))
  // A gauge along the beam's face: the row cap, in ticks.
  const t = k.sideTicks(beam.y + 3, beam.y + beam.d - 3, 2, 5, beam.x + beam.w, 65, [1.4, 2.8], P, "y")
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(S(k.cylinder(CUT_X, CUT_POSTS[0] + 2, 2.6, 66, 4, P, 20), { tone: "mid" }))
  out.push(L(k.knurl(CUT_X, CUT_POSTS[0] + 2, 2.6, 66, 70, 16, P), { tone: "lo" }))
  return out.join("")
}
function blade() {
  const out = []
  for (const y of [LANE.out - 5, LANE.out + 5]) out.push(S(k.cylinder(CUT_X, y, 0.9, 46, 14, P, 12), { tone: "mid", crease: "none" }))
  out.push(S(k.slabOf(box(CUT_X - 1.2, LANE.out - HALF - 1, CUT_X + 1.2, LANE.out + HALF + 1, 0.3), 34, 12, P, 2), { tone: "hi", crease: "lo" }))
  out.push(L(k.segment([CUT_X + 1.2, LANE.out - HALF, 35.5], [CUT_X + 1.2, LANE.out + HALF, 35.5], P), { tone: "lo" }))
  return out.join("")
}

// ── The step counter: one tick per model call, up to the limit ────────────
const DIAL_C = [DIAL.x + DIAL.w / 2, DIAL.y + DIAL.d, (DIAL_Z[0] + DIAL_Z[1]) / 2]
const DIAL_R = 10
const SWEEP = [-135, 135] // degrees, 0 at the top
function dial() {
  const out = []
  out.push(S(k.slabOf({ x: DIAL.x + 9, y: DIAL.y + 3, w: 10, d: 10, r: 1.5 }, 0, DIAL_Z[0], P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: DIAL.x + 5, y: DIAL.y - 1, w: 18, d: 18, r: 2 }, 0, 2, P, 3), { tone: "lo" }))
  out.push(S(k.slabOf(DIAL, DIAL_Z[0], DIAL_Z[1] - DIAL_Z[0], P, 4, 0.8), { tone: "hi", crease: "lo" }))
  for (const [x, z] of [[DIAL.x + 3, DIAL_Z[0] + 3], [DIAL.x + DIAL.w - 3, DIAL_Z[1] - 3]]) out.push(D([at([x, DIAL.y + DIAL.d, z])], { size: 0.4 }))
  return out.join("")
}
function dialFace() {
  const m = k.sideMatrix([0, DIAL_C[1]], 0, P, "left")
  const [cx, cy] = [DIAL_C[0], -DIAL_C[2]]
  const ticks = []
  for (let i = 0; i <= ASK.maxSteps; i++) {
    const a = ((SWEEP[0] + ((SWEEP[1] - SWEEP[0]) * i) / ASK.maxSteps) * Math.PI) / 180
    const r0 = DIAL_R - (i === 0 || i === ASK.maxSteps ? 3.2 : 2.2), r1 = DIAL_R - 0.9
    ticks.push(`<line class="fig-tick${i === ASK.maxSteps ? " fig-tick-end" : ""}" x1="${(cx + Math.sin(a) * r0).toFixed(2)}" y1="${(cy - Math.cos(a) * r0).toFixed(2)}" x2="${(cx + Math.sin(a) * r1).toFixed(2)}" y2="${(cy - Math.cos(a) * r1).toFixed(2)}"/>`)
  }
  return `<g transform="${m}"><circle class="fig-glass" cx="${cx}" cy="${cy}" r="${DIAL_R}"/>${ticks.join("")}<g data-part="needle" style="transform-origin:${cx}px ${cy}px;transform:rotate(${SWEEP[0]}deg)"><line class="fig-needle" x1="${cx}" y1="${cy + 1.6}" x2="${cx}" y2="${cy - DIAL_R + 2}"/></g><circle class="fig-hub" cx="${cx}" cy="${cy}" r="1.1"/><circle class="fig-glass-edge" cx="${cx}" cy="${cy}" r="${DIAL_R}"/></g>`
}

// ── The gate: two sluice plates on one lift bar, held down by a padlock ───
const GATE_POSTS = [LANE.out - HALF - 9, LANE.out + HALF + 3, LANE.in - HALF - 9, LANE.in + HALF + 3]
const POST_H = 84
function gatePost(y) {
  return S(k.slabOf(box(GATE_X - 3, y, GATE_X + 3, y + 4, 0.6), 0, POST_H, P, 3, 0.4), { tone: "mid" }) + S(k.slabOf(box(GATE_X - 5, y - 2, GATE_X + 5, y + 6, 1), 0, 2, P, 3), { tone: "lo" }) + D([at([GATE_X, y + 2, POST_H])], { size: 0.4 })
}
function plate(y) {
  // Hangs from the lift bar; closed, its foot sits on the channel floor.
  const out = []
  for (const dy of [-4, 4]) out.push(S(k.cylinder(GATE_X, y + dy, 0.9, 44, 18, P, 12), { tone: "mid", crease: "none" }))
  out.push(S(k.slabOf(box(GATE_X - 1.4, y - HALF - 1, GATE_X + 1.4, y + HALF + 1, 0.4), TZ, 20, P, 2, 0.3), { tone: "hi", crease: "lo" }))
  out.push(L(k.segment([GATE_X + 1.4, y - HALF - 0.6, TZ + 17], [GATE_X + 1.4, y + HALF + 0.6, TZ + 17], P), { tone: "faint" }))
  return out.join("")
}
function liftBar() {
  const out = []
  out.push(S(k.slabOf(box(GATE_X - 2.5, GATE_POSTS[0] - 1, GATE_X + 2.5, GATE_POSTS[3] + 5, 1), 62, 5, P, 3, 0.5), { tone: "mid" }))
  for (const y of GATE_POSTS) out.push(S(k.slabOf(box(GATE_X - 3.6, y - 0.5, GATE_X + 3.6, y + 4.5, 0.6), 61, 7, P, 2, 0.3), { tone: "mid" }))
  return out.join("")
}
// The hasp: a tab hanging from the bar's middle down the post's face. It rises
// with the bar, so the padlock through it is what holds the gate down.
function haspTab() {
  return S(k.slabOf(box(GATE_X + 4, -3, GATE_X + 5.4, 3, 0.4), 40, 22, P, 2), { tone: "mid" }) + D([at([GATE_X + 5.4, 0, 58])], { size: 0.45 })
}
// A post between the channels carries the staple the padlock goes through.
function haspPost() {
  return S(k.slabOf(box(GATE_X - 4, -6, GATE_X + 4, 6, 1), 0, 48, P, 3, 0.4), { tone: "mid" }) + S(k.slabOf(box(GATE_X - 6, -8, GATE_X + 6, 8, 1.2), 0, 2, P, 3), { tone: "lo" }) + D([at([GATE_X + 4, -4, 46]), at([GATE_X + 4, 4, 46])], { size: 0.4 })
}
function padlock(open) {
  const x = GATE_X + 5.4
  const out = []
  // The shackle first, its legs running down into the body, which hides their ends:
  // through the hasp when locked, sprung up and turned clear when open.
  const z0 = 34, z1 = open ? 53 : 47
  const sx = x + 2.2
  out.push(L(k.segment([sx, -3.6, z0], [sx, -3.6, z1], P) + k.segment([sx, -3.6, z1], [sx, 3.6, z1], P) + k.segment([sx, 3.6, z1], [sx, 3.6, open ? 45 : z0], P), { tone: "mid" }))
  if (open) out.push(D([at([sx, 3.6, 45])], { size: 0.5 }))
  out.push(S(k.slabOf(box(x, -6, x + 4.4, 6, 1.4), 28, 12, P, 3, 0.5), { tone: "hi", lit: true }))
  out.push(D([at([x + 4.4, 0, 32])], { size: 0.5 }))
  return out.join("")
}

// ── The teleprinter: the model, across the gap ────────────────────────────
function teleprinter() {
  const out = [halo(k.insetPlan(TP, 2), 5)]
  out.push(S(k.slabOf(TP, 0, 4, P, 6, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(TP, 1.5), 4, TP_H - 4, P, 6, 0.9), { tone: "hi", crease: "lo", inner: L(k.sideSeam(k.insetPlan(TP, 1.5), 14, P, 6), { tone: "faint" }) }))
  // Collars where the channels go in.
  for (const y of [LANE.out, LANE.in]) out.push(S(k.slabOf(box(TP.x - 3, y - 11, TP.x + 0.5, y + 11, 1), TZ - 6, 16, P, 3, 0.3), { tone: "mid" }))
  // Platen housing at the back, a knob at each end, the paper coming out of it.
  const plat = { x: TP.x + 4, y: TP.y + 8, w: 24, d: TP.d - 16, r: 4 }
  out.push(S(k.slabOf(plat, TP_H, 12, P, 6, 0.8), { tone: "mid" }))
  for (const y of [plat.y - 3, plat.y + plat.d + 3]) {
    out.push(S(k.cylinder(plat.x + 12, y, 3.4, TP_H, 9, P, 24), { tone: "mid" }))
    out.push(L(k.knurl(plat.x + 12, y, 3.4, TP_H + 2, TP_H + 9, 20, P), { tone: "lo" }))
  }
  out.push(L(k.planOutline({ x: plat.x + 10, y: plat.y + 6, w: 8, d: plat.d - 12, r: 1.5 }, TP_H + 12, P, 2), { tone: "lo" }))
  out.push(S(k.slabOf(box(plat.x + 13.4, -30, plat.x + 14.6, 30, 0.2), TP_H + 12, 24, P, 2), { tone: "mid", crease: "faint" }))
  // The keyboard plate and its keys.
  const kb = { x: TP.x + 36, y: TP.y + 12, w: 28, d: TP.d - 24, r: 3 }
  out.push(S(k.slabOf(kb, TP_H, 1.6, P, 4), { tone: "mid" }))
  out.push(D(k.dotGrid(kb.x + 4, kb.y + 5, 4, 13, 6.6, TP_H + 1.6, P), { size: 0.5, tone: "lo" }))
  for (const [x, y] of k.corners(TP, 5)) out.push(D([at([x, y, TP_H])], { size: 0.42 }))
  out.push(lamp("tp-lamp", [TP.x + 34, TP.y + TP.d - 6, TP_H], "model", 1.6))
  return out.join("")
}
// The model's typing, on the face of the paper.
function paperFace() {
  const x = TP.x + 4 + 14.6
  const m = k.sideMatrix([x, 0], 0, P, "right")
  const rows = [[0.8, "fig-printed"], [0.6, "fig-printed"], [0.74, "fig-type"], [0.5, "fig-type"], [0.66, "fig-type"]]
  const lines = rows.map(([f, cls], i) => `<line class="${cls}" x1="-25" x2="${(-25 + 50 * f).toFixed(1)}" y1="${(-(TP_H + 35) + i * 4.2).toFixed(1)}" y2="${(-(TP_H + 35) + i * 4.2).toFixed(1)}"/>`).join("")
  return `<g transform="${m}">${lines}</g>`
}

// ── Assemble: back SVG, light (out channel), middle SVG, light (in channel), front SVG ──
const st = (station, body) => `<g data-station="${station}">${body}</g>`
const both = (part, a, b, state = "off") => `<g data-part="${part}" data-state="${state}"><g class="st-off">${a}</g><g class="st-on">${b}</g></g>`

const SPOTS = {
  screen: { x: TERM.x - 8, y: TERM.y - 8, w: TERM.w + 20, d: TERM.d + 16, r: 10 },
  store: k.insetPlan(CAB, -10),
  stamp: { x: STAMP_X - 30, y: 10, w: 48, d: 52, r: 10 },
  cutter: { x: CUT_X - 18, y: -66, w: 36, d: 52, r: 10 },
  steps: k.insetPlan(DIAL, -10),
  gate: { x: GATE_X - 14, y: -66, w: 28, d: 132, r: 10 },
  model: k.insetPlan(TP, -8),
}
const spots = Object.entries(SPOTS).map(([id, plan]) => `<path class="fig-spot" data-spot="${id}" d="${k.haloOf(plan, 0, 0.1, P)}"/>`).join("")

const portGap = [PORT_X - 8, PORT_X + 8]
const chuteGap = [CHUTE_X - HALF - 2, CHUTE_X + HALF + 2]

const back = [
  bench(BENCH, true),
  bench(API, false),
  spots,
  st("screen", terminal() + glass()),
  stands(LANE.out),
  bridge(LANE.out),
  channelBack(LANE.out, []),
  st("cutter", cutPost(CUT_POSTS[0])),
  st("steps", dial() + dialFace()),
  st("gate", gatePost(GATE_POSTS[0])),
]
const middle = [
  channelNear(LANE.out, [portGap, chuteGap]),
  st("store", spout(CAB.y - 7, CAB.y)),
  st("cutter", `<g data-part="blade">${blade()}</g>` + cutTop() + cutPost(CUT_POSTS[1])),
  st("gate", `<g data-part="plate-out">${plate(LANE.out)}</g>` + gatePost(GATE_POSTS[1])),
  st("store", cabinet()),
  st("gate", haspPost() + `<g data-part="hasp">${haspTab()}</g>` + both("padlock", padlock(false), padlock(true))),
  chuteFloor(),
  stands(LANE.in),
  bridge(LANE.in),
  channelBack(LANE.in, [portGap, chuteGap]),
  st("store", spout(CAB.y + CAB.d, LANE.in - HALF - 2)),
  st("stamp", stampPost(STAMP_POSTS[0])),
  st("gate", gatePost(GATE_POSTS[2])),
]
const front = [
  channelNear(LANE.in, []),
  chuteNear(),
  st("stamp", `<g data-part="head">${stampHead()}</g>` + stampTop() + stampPost(STAMP_POSTS[1])),
  st("gate", `<g data-part="plate-in">${plate(LANE.in)}</g>` + gatePost(GATE_POSTS[3]) + `<g data-part="lift-bar">${liftBar()}</g>`),
  st("model", teleprinter() + paperFace()),
]

const LABEL = `Ask, drawn as two benches with a gap between them. The long bench is your machine: a terminal where you type a question, a card cabinet that is the DuckDB store, a press that stamps every SQL slip and only passes a single SELECT or WITH, a guillotine that trims each result sheet to ${ASK.rowsToModel} rows with strings cut to ${ASK.cellToModel} characters, and a dial that counts up to ${ASK.maxSteps} model calls. The short bench is the Anthropic API, where a teleprinter stands for the model. Two open channels cross the gap, one out and one in, and a sluice gate held by a padlock closes both: Ask is off until you start the server with --ask and set ANTHROPIC_API_KEY.`
const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const layer = (cls, body) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`

const STATIONS = [
  { id: "screen", label: "Query page", read: "you type the question; the answer and its table land here", box: [TERM.x, TERM.y, 0, TERM.x + TERM.w, TERM.y + TERM.d, MON_Z[1]] },
  { id: "store", label: "Store", read: "each query runs in a transaction that is rolled back", box: [CAB.x, CAB.y, 0, CAB.x + CAB.w, CAB.y + CAB.d + 8, CAB_TOP] },
  { id: "stamp", label: "Read-only check", read: "one SELECT or WITH, and DuckDB's own parse must agree", box: [STAMP_X - 5, STAMP_POSTS[0], 0, STAMP_X + 5, STAMP_POSTS[1] + 4, 70] },
  { id: "cutter", label: "Cutter", read: `${ASK.rowsToModel} rows at most, every string cut to ${ASK.cellToModel} characters`, box: [CUT_X - 5, CUT_POSTS[0], 0, CUT_X + 5, CUT_POSTS[1] + 4, 70] },
  { id: "steps", label: "Steps", read: `up to ${ASK.maxSteps} model calls, then it gives up`, box: [DIAL.x, DIAL.y, 0, DIAL.x + DIAL.w, DIAL.y + DIAL.d, DIAL_Z[1]] },
  { id: "gate", label: "Gate", read: `shut unless serve --${ASK.flag} and ${ASK.keyEnv}`, box: [GATE_X - 4, GATE_POSTS[0], 0, GATE_X + 8, GATE_POSTS[3] + 4, POST_H] },
  { id: "model", label: "Model", read: `${ASK.model} via the Anthropic API`, box: [TP.x, TP.y, 0, TP.x + TP.w, TP.y + TP.d, TP_H + 38] },
]
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo = [], up = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
const HIT = STATIONS.map((s) => {
  const [x0, y0, z0, x1, y1, z1] = s.box
  const pts = []
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(at([x, y, z]))
  return { id: s.id, label: s.label, read: s.read, hull: hull(pts) }
})

const DATA = {
  W, H, P,
  camera: glCamera(P),
  lane: LANE, half: HALF, tz: TZ, orbZ: TZ + 5,
  x: { term: LANE_X[0], tp: LANE_X[1], port: PORT_X, stamp: STAMP_X, chute: CHUTE_X, cut: CUT_X, gate: GATE_X },
  lift: LIFT,
  steps: ASK.maxSteps, sweep: SWEEP,
  ask: { rows: ASK.rowsToModel, cell: ASK.cellToModel, model: ASK.model, steps: ASK.maxSteps },
  readOnly: ASK.readOnly,
  hues: { model: [0.388, 0.349, 0.878], tool: [0.078, 0.6, 0.557], wait: [0.886, 0.604, 0.18], error: [0.851, 0.325, 0.31] },
  stations: HIT,
  stationIds: STATIONS.map((s) => s.id),
}
const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")

const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="Ask. Arrow keys move between parts; A opens or locks the gate; Space asks the example question again; W sends a write to the read-only check.">${backSvg}<canvas class="fx-layer fx-gl" data-lane="out" aria-hidden="true"></canvas>${layer("fx-mid", middle.join(""))}<canvas class="fx-layer fx-gl" data-lane="in" aria-hidden="true"></canvas>${layer("fx-front", front.join(""))}</div>`

const body = k.plateHtml({
  fig: "Fig 7",
  title: "Ask",
  hint: "Point at a part · A · Space · W",
  readout: "Ask is off · the gate is down, nothing leaves",
  keys: [
    { mark: "lit", label: `The padlock: the gate stays down unless you run serve --${ASK.flag} with ${ASK.keyEnv} set (A)` },
    { mark: "raised", label: "Light leaving in indigo (question, schema, trimmed rows); SQL in teal; errors in red; the answer in amber" },
    { mark: "edge", label: "Space asks the example question again; W sends a write, which the read-only check refuses" },
  ],
  caption: `Ask is the only part of Aftertrace that sends anything off your machine, and it is off by default. When it is on, your question and the store's schema go to ${ASK.model}. The model answers with SQL; Aftertrace checks that it is a single read-only SELECT or WITH, runs it on the local store in a transaction that is rolled back, and sends back at most ${ASK.rowsToModel} rows with every string cut to ${ASK.cellToModel} characters. Errors go back too, so the model can fix its query. After at most ${ASK.maxSteps} model calls it must give a final answer; its SQL is run again here for the table you see, which is not sent.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "ask-dark.html" : "ask.html")
writeFileSync(file, k.pageHtml({ title: "Ask", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
