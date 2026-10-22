// Fig 6 · Reading a turn, as a strip-chart recorder with a tally in front.
// Six pens hang from a beam over moving chart paper, one per kind of span in a
// Claude Code turn: the turn itself, model requests, retry attempts, the tool
// call, the permission wait and the tool's execution. The paper runs left, so
// the record reads like the app's waterfall. In front, a router hands every
// second of the turn to exactly one rod of an abacus, in Aftertrace's paint
// order; the four rods are the story view's time bar.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { TURN, PRIORITY, SEGMENTS, breakdown } from "./turn.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 420

// ── World plan (units ≈ px; x along the bench, y toward the reader, z up) ──
const BENCH = { x: -176, y: -88, w: 340, d: 166, r: 10 }
const BENCH_H = 12
const FOOT_H = 6

// The recorder: a case whose top is the chart table. The paper comes up out of
// a slot on the right (the supply roll is inside), runs left under the pens and
// goes down a slot on the left onto the take-up spool.
const BODY = { x: -150, y: -56, w: 290, d: 104, r: 3 }
const PLINTH_H = 2.5
const PZ = 30 // top of the case
const PAPER_Z = PZ + 0.4
const PAPER = { x: -137, y: -50, w: 265, d: 90 } // x -137..128, y -50..40
const SLOT_L = PAPER.x
const SLOT_R = PAPER.x + PAPER.w
const PEN_X = 86
const SP = 0.0043 // paper units per millisecond of the turn: the whole turn fits between the slot and the pens
const RULE_Y = 34 // a printed rule near the front edge; second ticks run from it to the edge

// One lane of paper per pen, back to front.
const LANES = [
  { id: "turn", hue: "turn", y0: -47, y1: -38, span: "claude_code.interaction" },
  { id: "model", hue: "model", y0: -34, y1: -22, span: "claude_code.llm_request" },
  { id: "retry", hue: "retry", y0: -20, y1: -16, span: "gen_ai.request.attempt" },
  { id: "tool", hue: "tool", y0: -12, y1: -8, span: "claude_code.tool" },
  { id: "wait", hue: "wait", y0: -4, y1: 8, span: "claude_code.tool.blocked_on_user" },
  { id: "run", hue: "tool", y0: 12, y1: 24, span: "claude_code.tool.execution" },
]
const laneMid = (l) => (l.y0 + l.y1) / 2

// The pen bridge: a post behind the case and a beam cantilevered over the paper.
const POST = { x: 80, y: -66, w: 12, d: 9, r: 1 }
const POST_H = 70
const BEAM = { x: 81, y: -66, w: 10, d: 96, r: 1 }
const BEAM_Z = [59, 66]
const PEN_LIFT = 3.2

// The tally on the front panel: one rod per segment of the story's time bar,
// fed by a router at the left end. Each bead is a second; a rod's row of beads
// grows to the right like that segment of the bar.
const ROUTER = { x: -12, y: 48, w: 16, d: 14, r: 1.5 }
const ROUTER_Z = [3, 34]
const RBRACKET = { x: 126, y: 48, w: 6, d: 12, r: 1 }
const ROD_Y = 55
const ROD_Z = [29, 22, 15, 8] // top to bottom: the time bar's order
const ROD_X = [ROUTER.x + ROUTER.w, RBRACKET.x]
const BEAD_R = 2.2
const BEAD_L = 2.6
const BEAD_PITCH = 3.1
const BEADS = 24 // one bead per second of the turn, at most 24 a rod
const beadX = (j) => ROD_X[0] + 0.4 + BEAD_L / 2 + j * BEAD_PITCH // j = 0 next to the router
const BEAD_IN = ROD_X[0] - BEAD_L / 2 - 0.4

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [PEN_X, BEAM.y, POST_H + 4], [PEN_X, BEAM.y + BEAM.d, BEAM_Z[1] + 8]],
  W,
  H,
  { pad: 18, azimuth: 62, elevation: 36 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const g = (part, body, extra = "") => `<g data-part="${part}"${extra}>${body}</g>`
const { sinA, cosA, sinE, cosE } = k.cameraOf(P)
const VIEW = [cosA * cosE, sinA * cosE, sinE]

// ── A prism along x or y: rods, beads, spools, knobs, the pinch roller, the gusset ──
// profile is [u, v] around the axis: (y, z) for an x prism, (x, z) for a y prism.
const circle = (cu, cv, r, n = 28) => Array.from({ length: n }, (_, i) => [cu + r * Math.cos((i / n) * Math.PI * 2), cv + r * Math.sin((i / n) * Math.PI * 2)])
function prism(axis, profile, a0, a1, { sharp = 0 } = {}) {
  const pt = (a, [u, v]) => (axis === "x" ? [a, u, v] : [u, a, v])
  const n3 = ([nu, nv]) => (axis === "x" ? [0, nu, nv] : [nu, 0, nv])
  let area = 0
  profile.forEach(([u, v], i) => { const [u2, v2] = profile[(i + 1) % profile.length]; area += u * v2 - u2 * v })
  const ccw = area > 0
  const A = profile.map((p) => at(pt(a0, p)))
  const B = profile.map((p) => at(pt(a1, p)))
  const count = profile.length
  const normals = profile.map(([u, v], i) => {
    const [u2, v2] = profile[(i + 1) % count]
    const du = u2 - u, dv = v2 - v, len = Math.hypot(du, dv) || 1
    return ccw ? [dv / len, -du / len] : [-dv / len, du / len]
  })
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const faces = normals.map((nn) => n3(nn))
  const facing = faces.map((f) => dot(f, VIEW) > 1e-6)
  const capAxis = axis === "x" ? [1, 0, 0] : [0, 1, 0]
  const capFacing = dot(capAxis, VIEW) > 0 ? "end" : "start"
  const cap = capFacing === "end" ? B : A
  const light = [-sinA, cosA, 0]
  const shades = Array.from({ length: k.SHADES }, () => [])
  let top = ""
  faces.forEach((f, i) => {
    if (!facing[i]) return
    const j = (i + 1) % count
    const quad = k.pathOf([A[i], A[j], B[j], B[i]], true)
    if (f[2] > 0.72) { top += quad; return }
    const lit = (dot(f, light) + 1) / 2
    shades[Math.min(k.SHADES - 1, Math.max(0, Math.floor(lit * k.SHADES)))].push(quad)
  })
  const capPath = k.pathOf(cap, true)
  const capLit = (dot(capAxis, light) * (capFacing === "end" ? 1 : -1) + 1) / 2
  shades[Math.min(k.SHADES - 1, Math.max(0, Math.floor(capLit * k.SHADES)))].push(capPath)
  const all = [...A, ...B]
  const hull = convexHull(all)
  const edges = [k.pathOf(hull, true), capPath]
  if (sharp > 0) {
    // Generator lines at the profile's corners that face us.
    profile.forEach((_, i) => {
      const prev = (i + count - 1) % count
      if (!(facing[i] || facing[prev])) return
      const [a, b] = [normals[prev], normals[i]]
      if (a[0] * b[0] + a[1] * b[1] < Math.cos((sharp * Math.PI) / 180)) edges.push(k.pathOf([A[i], B[i]]))
    })
  }
  return { fill: k.pathOf(hull, true), shades: shades.map((s) => s.join("")), top, crease: "", bevel: "", outline: edges.join("") }
}
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = [], upper = []
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}
// Knurl: short generator lines on the visible side of a y-axis knob.
function knurlY(cx, cz, r, y0, y1, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2
    const n = [Math.cos(t), 0, Math.sin(t)]
    if (n[0] * VIEW[0] + n[2] * VIEW[2] < 0.25) continue
    out.push(k.segment([cx + r * Math.cos(t), y0 + 0.6, cz + r * Math.sin(t)], [cx + r * Math.cos(t), y1 - 0.2, cz + r * Math.sin(t)], P))
  }
  return out.join("")
}
// A closed outline drawn on the case's front face (the plane y = BODY front).
const FRONT_Y = BODY.y + BODY.d
const onFront = (pts) => k.pathOf(pts.map(([x, z]) => at([x, FRONT_Y, z])), true)
const frontRect = (x0, z0, x1, z1) => onFront([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])

// ── Base ───────────────────────────────────────────────────────────────────
function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`]
  const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
  for (const [x, y] of byDepth(k.corners(BENCH, 26))) {
    out.push(S(k.cylinder(x, y, 8, -BENCH_H - FOOT_H, 1.8, P, 28), { tone: "lo" }))
    out.push(S(k.cylinder(x, y, 6, -BENCH_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }))
  }
  out.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(BENCH, 6), 0, P), { tone: "lo" }))
  const screws = k.corners(BENCH, 12)
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }))
  // Label plate, back left: three rule lines for its printed text.
  const plate = { x: BENCH.x + 16, y: BENCH.y + 12, w: 46, d: 20, r: 1.5 }
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }))
  out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P), { tone: "faint" }))
  for (const [i, len] of [30, 22, 26].entries()) out.push(L(k.lineOnTop([plate.x + 6, plate.y + 6 + i * 4], [plate.x + 6 + len, plate.y + 6 + i * 4], 0.8, P), { tone: "lo", free: true }))
  out.push(D([at([plate.x + 3, plate.y + 3, 0.8]), at([plate.x + plate.w - 3, plate.y + plate.d - 3, 0.8])], { size: 0.4 }))
  return out.join("")
}

// ── The pen bridge's post ──────────────────────────────────────────────────
function post() {
  const out = []
  out.push(S(k.slabOf(k.insetPlan(POST, -2), 0, 2, P, 3, 0.4), { tone: "lo" }))
  out.push(S(k.slabOf(POST, 2, POST_H - 2, P, 3, 0.6), { tone: "mid" }))
  out.push(D(k.corners(k.insetPlan(POST, -2), 1.1).map(([x, y]) => at([x, y, 2])), { size: 0.4 }))
  return out.join("")
}

// ── The recorder case ──────────────────────────────────────────────────────
function caseBody() {
  const out = []
  out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(BODY, -3), 0, 0.1, P)}" style="filter:blur(3px)"/>`)
  out.push(S(k.slabOf(k.insetPlan(BODY, -3), 0, PLINTH_H, P, 4, 0.4), { tone: "lo" }))
  out.push(S(k.slabOf(BODY, PLINTH_H, PZ - PLINTH_H, P, 4, 0.8), { tone: "mid" }))
  // Front panel: an inset plate with corner screws.
  const [px0, px1, pz0, pz1] = [BODY.x + 8, BODY.x + BODY.w - 8, 6, 26]
  out.push(L(frontRect(px0, pz0, px1, pz1), { tone: "lo" }))
  const screws = [[px0 + 3, pz0 + 3], [px1 - 3, pz0 + 3], [px0 + 3, pz1 - 3], [px1 - 3, pz1 - 3]]
  out.push(L(screws.map(([x, z]) => k.sideRing([x, FRONT_Y, z], 1.3, "y", P, 14)).join(""), { tone: "lo" }))
  out.push(D(screws.map(([x, z]) => at([x, FRONT_Y, z])), { size: 0.4 }))
  // Right end: cooling slots.
  for (let i = 0; i < 6; i++) {
    const y = BODY.y + 14 + i * 12
    const ex = BODY.x + BODY.w
    out.push(L(k.pathOf([[ex, y, 10], [ex, y + 5, 10], [ex, y + 5, 22], [ex, y, 22]].map(at), true), { tone: "lo" }))
  }
  // Top: the two slots the paper passes through, and the guide rail behind the paper.
  for (const x of [SLOT_L - 2.2, SLOT_R]) out.push(S(k.slabOf({ x, y: PAPER.y - 1.5, w: 2.2, d: PAPER.d + 3, r: 0.6 }, PZ - 0.05, 0.05, P, 2), { tone: "lo", flat: true, crease: "none" }))
  out.push(S(k.slabOf({ x: SLOT_L, y: PAPER.y - 3, w: PAPER.w, d: 2.4, r: 0.6 }, PZ, 1.4, P, 2, 0.3), { tone: "mid" }))
  return out.join("")
}

// The spools behind the front face show as hubs: take-up with a crank knob,
// supply with a boss. A chart-speed knob, a pilot lamp and a power switch.
function frontControls() {
  const out = []
  const hub = (x, z, crank) => {
    out.push(S(prism("y", circle(x, z, 7), FRONT_Y, FRONT_Y + 1.6), { tone: "mid" }))
    out.push(L(k.sideRing([x, FRONT_Y + 1.6, z], 5.2, "y", P, 28), { tone: "faint" }))
    out.push(S(prism("y", circle(x, z, 2.6), FRONT_Y + 1.6, FRONT_Y + 3.8), { tone: "hi", crease: "lo" }))
    if (crank) {
      out.push(S(prism("y", circle(x, z, 3.6), FRONT_Y + 3.8, FRONT_Y + 7.4), { tone: "hi", crease: "lo" }))
      out.push(L(knurlY(x, z, 3.6, FRONT_Y + 3.8, FRONT_Y + 7.4, 20), { tone: "lo" }))
    } else out.push(D([at([x, FRONT_Y + 3.8, z])], { size: 0.5 }))
  }
  hub(BODY.x + 26, 16, true)
  // Chart speed: a knurled knob and its dial ticks on the panel.
  const [kx, kz] = [BODY.x + 64, 16]
  const ticks = []
  for (let i = 0; i <= 10; i++) {
    const t = ((-135 + i * 27) * Math.PI) / 180
    const r0 = 6.4, r1 = i % 5 === 0 ? 8.4 : 7.4
    ticks.push(k.segment([kx + r0 * Math.sin(t), FRONT_Y, kz + r0 * Math.cos(t)], [kx + r1 * Math.sin(t), FRONT_Y, kz + r1 * Math.cos(t)], P))
  }
  out.push(L(k.sideRing([kx, FRONT_Y, kz], 6.4, "y", P, 32), { tone: "faint" }))
  out.push(L(ticks.join(""), { tone: "lo" }))
  out.push(S(prism("y", circle(kx, kz, 4.4), FRONT_Y, FRONT_Y + 4.6), { tone: "hi", crease: "lo" }))
  out.push(L(knurlY(kx, kz, 4.4, FRONT_Y, FRONT_Y + 4.6, 24), { tone: "lo" }))
  out.push(L(k.segment([kx, FRONT_Y + 4.6, kz], [kx + 2.6 * Math.sin(0.6), FRONT_Y + 4.6, kz + 2.6 * Math.cos(0.6)], P), { tone: "mid" }))
  out.push(D([at([kx, FRONT_Y + 4.6, kz])], { size: 0.45 }))
  // Pilot lamp (lit while recording) and the power toggle under it.
  const lx = BODY.x + 88
  out.push(S(prism("y", circle(lx, 20.5, 2.2), FRONT_Y, FRONT_Y + 0.8), { tone: "lo" }))
  out.push(`<g data-part="pilot" class="fig-pilot">${S(prism("y", circle(lx, 20.5, 1.4), FRONT_Y + 0.8, FRONT_Y + 1.6), { tone: "hi", crease: "none" })}</g>`)
  out.push(S(k.slabOf({ x: lx - 3, y: FRONT_Y, w: 6, d: 0.8, r: 0.4 }, 9, 6, P, 2), { tone: "lo", crease: "none" }))
  out.push(S(prism("y", [[lx - 0.8, 12.6], [lx + 0.8, 12.6], [lx + 0.4, 14.8], [lx - 0.4, 14.8]], FRONT_Y + 0.8, FRONT_Y + 3.6, { sharp: 20 }), { tone: "hi", crease: "lo" }))
  return out.join("")
}

// ── Paper, its grid, the record, the front guide and the pinch roller ──────
function paper() {
  // Each lane is printed in a pale wash of its pen's colour, so an empty lane still says what it is for.
  const bands = LANES.map((l) => `<path class="fig-lane" data-hue="${l.hue}" d="${k.pathOf([[PAPER.x, l.y0], [PAPER.x + PAPER.w, l.y0], [PAPER.x + PAPER.w, l.y1], [PAPER.x, l.y1]].map(([x, y]) => at([x, y, PAPER_Z])), true)}"/>`).join("")
  return S(k.slabOf({ ...PAPER, r: 0 }, PZ, 0.4, P, 1), { tone: "hi", crease: "none", className: "fig-paper" }) + bands + L(k.lineOnTop([PAPER.x, RULE_Y], [PAPER.x + PAPER.w, RULE_Y], PAPER_Z, P), { tone: "faint" })
}
// Moving parts on the paper are paths the page rewrites: grid, scale, marks.
function paperLive() {
  const marks = DATA_MARKS.map((m, i) => `<path class="fig-ink" data-hue="${m.hue}" data-kind="${m.kind}" data-mark="${i}" d="M0 0Z"/>`).join("")
  return `<path class="iso-line fig-grid" data-tone="faint" data-part="grid" d=""/><path class="iso-line fig-grid" data-tone="lo" data-part="grid-major" d=""/>${marks}<path class="fig-focus" data-part="focus" d=""/>`
}
function frontGuide() {
  const out = []
  out.push(S(k.slabOf({ x: SLOT_L, y: PAPER.y + PAPER.d + 0.6, w: PAPER.w, d: 2.4, r: 0.6 }, PZ, 1.4, P, 2, 0.3), { tone: "mid" }))
  // Pinch roller just past the pens, its axle in a bracket at each edge of the case.
  const RX = PEN_X + 16, RZ = PAPER_Z + 2.4
  const bracket = (y) => S(k.slabOf({ x: RX - 3, y, w: 6, d: 2.8, r: 0.6 }, PZ, 6, P, 2, 0.3), { tone: "mid" })
  out.push(bracket(BODY.y))
  out.push(S(prism("y", circle(RX, RZ, 2.4, 24), BODY.y + 2.8, FRONT_Y - 2.8), { tone: "hi", crease: "lo" }))
  out.push(bracket(FRONT_Y - 2.8))
  out.push(D([at([RX, FRONT_Y, RZ])], { size: 0.5 }))
  return out.join("")
}

// ── The beam, its solenoids and the pens ───────────────────────────────────
// Gusset under the beam where it leaves the post, clear of the first pen.
const gusset = () => S(prism("x", [[POST.y + POST.d, BEAM_Z[0]], [POST.y + POST.d, BEAM_Z[0] - 9], [POST.y + POST.d + 8, BEAM_Z[0]]], PEN_X - 2, PEN_X + 2, { sharp: 20 }), { tone: "mid" })
function beam() {
  const out = []
  out.push(S(k.slabOf(BEAM, BEAM_Z[0], BEAM_Z[1] - BEAM_Z[0], P, 3, 0.6), { tone: "mid" }))
  out.push(D([at([BEAM.x + 2.4, BEAM.y + BEAM.d - 2.4, BEAM_Z[1]]), at([BEAM.x + BEAM.w - 2.4, BEAM.y + BEAM.d - 2.4, BEAM_Z[1]])], { size: 0.4 }))
  // Wiring loom along the beam top, from the post to a terminal block past the last pen.
  const tb = { x: BEAM.x + 0.8, y: laneMid(LANES[5]) + 5, w: 3, d: 4, r: 0.4 }
  out.push(L(k.lineOnTop([BEAM.x + 2.3, POST.y + POST.d], [BEAM.x + 2.3, tb.y], BEAM_Z[1], P), { tone: "lo" }))
  // It leaves the post through a grommet.
  out.push(L(k.sideRing([BEAM.x + 2.3, POST.y + POST.d, BEAM_Z[1] + 0.9], 0.9, "y", P, 12), { tone: "lo" }))
  out.push(D([at([BEAM.x + 2.3, POST.y + POST.d, BEAM_Z[1]])], { size: 0.45 }))
  out.push(S(k.slabOf(tb, BEAM_Z[1], 1.6, P, 2, 0.2), { tone: "hi", crease: "lo" }))
  return out.join("")
}
function solenoid(l, i) {
  const y = laneMid(l)
  const out = []
  out.push(S(k.cylinder(PEN_X + 1, y, 2.6, BEAM_Z[1], 5.4, P, 24, 0.3), { tone: "hi", crease: "lo" }))
  out.push(L(k.ring(PEN_X + 1, y, 1.8, BEAM_Z[1] + 5.4, P, 20), { tone: "faint" }))
  out.push(D([at([PEN_X + 1 - 1.4, y - 1.2, BEAM_Z[1] + 5.4]), at([PEN_X + 1 - 1.4, y + 1.2, BEAM_Z[1] + 5.4])], { size: 0.3 }))
  out.push(g(`plunger-${i}`, S(k.cylinder(PEN_X + 1, y, 0.8, BEAM_Z[1] + 5.4, 1.6, P, 14), { tone: "mid" })))
  return out.join("")
}
function pen(l, i) {
  const y = laneMid(l)
  const body = S(k.cylinder(PEN_X, y, 1.5, PAPER_Z + 3.6, BEAM_Z[0] - 1 - (PAPER_Z + 3.6), P, 20), { tone: "hi", crease: "lo" })
  const collar = S(k.cylinder(PEN_X, y, 2, PAPER_Z + 8, 1.6, P, 20, 0.2), { tone: "mid" })
  const tip = `<g class="fig-hued" data-hue="${l.hue}">${S(k.cylinder(PEN_X, y, 0.9, PAPER_Z, 3.6, P, 16), { tone: "hi", crease: "none" })}</g>`
  const moving = g(`pen-${i}`, tip + body + collar, ` transform="${k.translateAlong(P, [0, 0, PEN_LIFT])}"`)
  const sleeve = S(k.cylinder(PEN_X, y, 2.3, BEAM_Z[0] - 6, 6, P, 22, 0.2), { tone: "mid" })
  return moving + sleeve
}

// ── The tally and its router ───────────────────────────────────────────────
function tallyBack() {
  const out = []
  // The right-hand bracket the rods end in.
  out.push(S(k.slabOf(RBRACKET, ROUTER_Z[0], ROUTER_Z[1] - ROUTER_Z[0], P, 2, 0.4), { tone: "mid" }))
  out.push(D([at([RBRACKET.x + RBRACKET.w / 2, RBRACKET.y + RBRACKET.d, ROUTER_Z[0] + 3]), at([RBRACKET.x + RBRACKET.w / 2, RBRACKET.y + RBRACKET.d, ROUTER_Z[1] - 3])], { size: 0.4 }))
  return out.join("")
}
function rods() {
  return ROD_Z.map((z) => S(prism("x", circle(ROD_Y, z, 0.7, 12), ROD_X[0], ROD_X[1]), { tone: "mid", crease: "none" })).join("")
}
function beads() {
  const out = []
  ROD_Z.forEach((z, r) => {
    const hue = SEGMENTS[r].key
    const shape = S(prism("x", circle(ROD_Y, z, BEAD_R, 22), -BEAD_L / 2, BEAD_L / 2), { tone: "hi", crease: "none" })
    for (let i = 0; i < BEADS; i++) out.push(`<g class="fig-hued fig-bead" data-hue="${hue}" data-bead="${r}-${i}" style="visibility:hidden" transform="${k.translateAlong(P, [BEAD_IN, 0, 0])}">${shape}</g>`)
  })
  return out.join("")
}
function router() {
  const out = []
  out.push(S(k.slabOf(ROUTER, ROUTER_Z[0], ROUTER_Z[1] - ROUTER_Z[0], P, 3, 0.6), { tone: "mid" }))
  const fy = ROUTER.y + ROUTER.d
  const sx = ROUTER.x + 5
  // A slot in the front face, a dot at each rod's height, and the carriage that rides it.
  out.push(L(k.pathOf([[sx, fy, ROUTER_Z[0] + 3], [sx + 6, fy, ROUTER_Z[0] + 3], [sx + 6, fy, ROUTER_Z[1] - 2], [sx, fy, ROUTER_Z[1] - 2]].map(at), true), { tone: "lo" }))
  out.push(D(ROD_Z.map((z) => at([sx - 2.6, fy, z])), { size: 0.5 }))
  out.push(L(k.planOutline(k.insetPlan(ROUTER, 2.4), ROUTER_Z[1], P, 2), { tone: "faint" }))
  out.push(D(k.corners(ROUTER, 1.6).map(([x, y]) => at([x, y, ROUTER_Z[1]])), { size: 0.4 }))
  out.push(g("carriage", S(k.slabOf({ x: sx - 0.4, y: fy, w: 6.8, d: 2.6, r: 0.6 }, -2.6, 5.2, P, 2, 0.3), { tone: "hi", lit: true }), ` transform="${k.translateAlong(P, [0, 0, ROD_Z[3]])}"`))
  return out.join("")
}

// ── The record: what each pen writes, in turn milliseconds ─────────────────
const BD = breakdown(TURN)
const byId = Object.fromEntries(TURN.spans.map((s) => [s.id, s]))
const human = (src) => !src || src === "unknown" || src.startsWith("user_")
const laneOf = (s) => ({ "claude_code.interaction": "turn", "claude_code.llm_request": "model", "claude_code.tool": "tool", "claude_code.tool.blocked_on_user": "wait", "claude_code.tool.execution": "run" })[s.name]
const secs = (ms) => (ms >= 10000 ? (ms / 1000).toFixed(1) : ms >= 1000 ? (ms / 1000).toFixed(2) : `${ms}\u00a0ms`).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + (ms >= 1000 ? "\u00a0s" : "")
const fmt = (n) => n.toLocaleString("en-US")
const DATA_MARKS = []
for (const s of TURN.spans) {
  const lane = laneOf(s)
  if (lane === "turn") {
    DATA_MARKS.push({ lane, kind: "hair", t0: s.t0, t1: s.t1, hue: "turn", span: s.id })
    DATA_MARKS.push({ lane, kind: "stamp", t0: s.t0, t1: s.t1, hue: "turn", span: s.id })
    continue
  }
  const auto = lane === "wait" && !human(s.attrs.source)
  DATA_MARKS.push({ lane, kind: auto ? "auto" : "bar", t0: s.t0, t1: s.t1, hue: lane === "run" ? "tool" : LANES.find((l) => l.id === lane).hue, span: s.id })
  if (s.attempts && s.attempts.length > 1) {
    DATA_MARKS.push({ lane: "retry", kind: "bar", t0: s.t0, t1: s.attempts[s.attempts.length - 1], hue: "retry", span: s.id + "-retry" })
    for (const a of s.attempts) DATA_MARKS.push({ lane: "retry", kind: "tick", t0: a, t1: a, hue: "retry", span: s.id + "-retry" })
  }
}
// What the readout says for each span (all values synthetic).
function about(s) {
  const a = s.attrs
  const d = s.t1 - s.t0
  if (s.name === "claude_code.interaction") return `claude_code.interaction · turn ${a["interaction.sequence"]} · ${secs(d)} · prompt of ${a.user_prompt_length} chars`
  if (s.name === "claude_code.llm_request") {
    const retry = s.attempts.length > 1 ? ` · ${s.attempts.length} attempts` : ""
    return `claude_code.llm_request · ${a.model.replace(/^claude-/, "")} · ${secs(d)}${retry} · first token ${secs(a.ttft_ms)} · ${fmt(a.cache_read_tokens)} cache read · ${a.output_tokens} out · $${s.joined.cost_usd.toFixed(3)} · ${a.stop_reason}`
  }
  if (s.name === "claude_code.tool") {
    const kids = TURN.spans.filter((k2) => k2.parent === s.id)
    const w = kids.find((k2) => k2.name.endsWith("blocked_on_user")), x = kids.find((k2) => k2.name.endsWith("execution"))
    return `claude_code.tool · ${a.tool_name}${a.bash_argv0 ? ` (${a.bash_argv0})` : ""} · ${secs(d)} = ${secs(w.t1 - w.t0)} permission + ${secs(x.t1 - x.t0)} running · ${fmt(a.result_tokens)} result tokens`
  }
  if (s.name === "claude_code.tool.blocked_on_user") {
    const who = human(a.source) ? "waiting on you" : "decided by config, not counted as waiting on you"
    return `claude_code.tool.blocked_on_user · ${a.decision} · source ${a.source} · ${secs(d)} ${who}`
  }
  if (s.name === "claude_code.tool.execution") return `claude_code.tool.execution · ${secs(d)} · success ${a.success}`
  return s.name
}
const SPANS = TURN.spans.map((s) => ({ id: s.id, lane: laneOf(s), t0: s.t0, t1: s.t1, read: about(s) }))
for (const s of TURN.spans) if (s.attempts && s.attempts.length > 1) {
  const last = s.attempts[s.attempts.length - 1]
  SPANS.push({ id: s.id + "-retry", lane: "retry", t0: s.t0, t1: last, read: `gen_ai.request.attempt × ${s.attempts.length} on that request · ${secs(last - s.t0)} from its start to the last attempt, painted as retry` })
}
const segLabel = Object.fromEntries(SEGMENTS.map((s) => [s.key, s.label]))
const RODS = SEGMENTS.map((s) => {
  const ms = BD.segments[s.key]
  const what = {
    wait: "permission prompts a person answered (a user_* source)",
    model: "model requests, retries included",
    tool: "tools executing",
    other: "hooks, permission checks decided by config, and gaps",
  }[s.key]
  const short = { wait: "you", model: "thinking", tool: "tools", other: "other" }[s.key]
  return { key: s.key, label: s.label, short, ms, read: `${s.label} · ${secs(ms)} · ${what}` }
})
const NICE = { permission_wait: "waiting on you", retry: "retry", model: "model", tool: "tool", hook: "hook", permission_check: "permission check" }
const ORDER_TEXT = PRIORITY.map((c) => NICE[c]).join(" › ")

// ── Assemble ───────────────────────────────────────────────────────────────
const back = [
  bench(),
  g("post", post()),
  g("case", caseBody() + frontControls()),
  g("paper", paper() + paperLive()),
  g("guide", frontGuide()),
]
const front = [
  // The pens go up into the beam, so the beam is painted over their tops.
  g("pens", gusset() + LANES.map(pen).join("")),
  g("beam", beam() + LANES.map(solenoid).join("")),
  // The router first: the rods start at its face and the newest bead sits just in front of it.
  g("tally", router() + rods() + beads() + tallyBack()),
]

const LABEL =
  "A strip-chart recorder that explains one Claude Code turn. Six pens hang from a beam over chart paper that moves to the left: a grey pen for the turn, an indigo pen for model requests, a red pen for retry attempts, teal pens for the tool call and its execution, and an amber pen for the permission wait. In front of the recorder, a router hands every second of the turn to one rod of an abacus: waiting on you, Claude thinking, running tools, and other."

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer fx-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">${front.join("")}</svg>`

// Screen hulls for hit-testing.
function hull(pts) {
  return convexHull(pts.map(at)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
}
const box = (x0, y0, z0, x1, y1, z1) => hull([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]])
const PENS_HIT = LANES.map((l) => ({ id: l.id, hull: box(PEN_X - 2.4, laneMid(l) - 2.4, PAPER_Z, PEN_X + 2.4, laneMid(l) + 2.4, BEAM_Z[0]), read: `The ${l.id === "run" ? "execution" : l.id === "wait" ? "permission wait" : l.id} pen · draws ${l.span}` }))
const RODS_HIT = ROD_Z.map((z, r) => ({ id: RODS[r].key, hull: box(ROD_X[0], ROD_Y - 3, z - 3, ROD_X[1], ROD_Y + 3, z + 3) }))

const hues = {
  turn: [0.667, 0.647, 0.612],
  model: [0.388, 0.349, 0.878],
  tool: [0.078, 0.6, 0.557],
  wait: [0.886, 0.604, 0.18],
  retry: [0.851, 0.325, 0.31],
}
const darkHues = {
  turn: [0.467, 0.447, 0.416],
  model: [0.604, 0.573, 0.957],
  tool: [0.247, 0.753, 0.698],
  wait: [0.941, 0.706, 0.353],
  retry: [0.937, 0.478, 0.467],
}
const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  paper: { x0: SLOT_L, x1: SLOT_R, y0: PAPER.y, y1: PAPER.y + PAPER.d, z: PAPER_Z },
  penX: PEN_X,
  sp: SP,
  rule: RULE_Y,
  penLift: PEN_LIFT,
  lanes: LANES.map((l) => ({ id: l.id, y0: l.y0, y1: l.y1, hue: l.hue })),
  marks: DATA_MARKS,
  spans: SPANS,
  turnEnd: TURN.spans[0].t1,
  ivs: BD.ivs,
  priority: PRIORITY,
  segOf: Object.fromEntries(SEGMENTS.flatMap((s) => s.cats.map((c) => [c, s.key]))),
  segments: SEGMENTS.map((s) => s.key),
  segLabel,
  rods: RODS,
  rodZ: ROD_Z,
  rodY: ROD_Y,
  beadX: Array.from({ length: BEADS }, (_, i) => beadX(i)),
  beadIn: BEAD_IN,
  beads: BEADS,
  orderText: ORDER_TEXT,
  hit: {
    pens: PENS_HIT,
    rods: RODS_HIT,
    router: box(ROUTER.x, ROUTER.y, ROUTER_Z[0], ROUTER.x + ROUTER.w, ROUTER.y + ROUTER.d, ROUTER_Z[1]),
    blank: box(PEN_X + 3, PAPER.y, PZ, SLOT_R, PAPER.y + PAPER.d, PZ + 1),
  },
  hues: theme === "dark" ? darkHues : hues,
}

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="Reading a turn. Arrow keys step through the spans; Space pauses the recorder.">${backSvg}<canvas class="fx-layer fx-gl" aria-hidden="true"></canvas>${frontSvg}</div>`
const S2 = (ms) => (Math.round(ms / 100) / 10).toFixed(1)
const body = k.plateHtml({
  fig: "Fig 6",
  title: "Reading a turn",
  hint: "Point at a mark · ← → · Space",
  readout: "",
  keys: [
    { mark: "raised", label: "Pens: grey the turn, indigo model requests, red retries, teal tools, amber waiting on you" },
    { mark: "lit", label: `The router: each second goes to one rod, in the order ${ORDER_TEXT}` },
    { mark: "edge", label: "Arrow keys step through the spans; Space pauses the recorder" },
  ],
  caption: `One synthetic turn of Claude Code, ${S2(TURN.spans[0].t1)} s long. Each pen draws one kind of span as the paper runs left, so the record reads like the app's waterfall: the turn on top, then model requests, their retry attempts, the tool call, its permission wait and its execution. Underneath, every moment of the turn is given to exactly one category, the first of ${ORDER_TEXT} that is running, and to Other when none is. The four rods are the story view's time bar: ${RODS.map((r) => `${r.label.toLowerCase()} ${S2(r.ms)} s`).join(", ")}.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "turn-dark.html" : "turn.html")
writeFileSync(file, k.pageHtml({ title: "Reading a turn", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
