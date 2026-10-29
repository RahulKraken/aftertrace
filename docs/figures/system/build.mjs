// Fig 1 · How Aftertrace works, as one instrument bench.
// Data enters on the left and moves right: sources plug into a junction box
// (the receivers), batches run down a trough into a sieve (redaction), drop
// into a four-drawer card cabinet (the DuckDB file), a reading carriage over
// the cabinet checks them against the rule templates and drops finding
// cards in a tray, and a screen shows it all (the UI). A locked outbox at the
// end is Ask, the only thing that can send anything off the bench.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { MODEL } from "../model.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 410

// ── World plan (units ≈ px; x along the bench, y toward the reader, z up) ──
const BENCH = { x: -270, y: -86, w: 540, d: 172, r: 10 }
const BENCH_H = 12
const FOOT_H = 6

const SRC = [-226, [-34, 0, 34]] // x, and the y of each source unit
const SRC_PLAN = (y) => ({ x: SRC[0] - 18, y: y - 13, w: 36, d: 26, r: 3 })
const SRC_H = 24

const JBOX = { x: -168, y: -40, w: 52, d: 80, r: 4 }
const JBOX_H = 30
const SOCKETS = [
  { y: -16, port: MODEL.ports.grpc, kind: "gRPC" },
  { y: 16, port: MODEL.ports.http, kind: "HTTP" },
]

const TROUGH_Z = 30 // floor of the troughs, on their stands
const TROUGH_W = 14
const T1 = { x0: JBOX.x + JBOX.w, x1: -78 }

const SIEVE = { x: -78, y: -38, w: 62, d: 76, r: 4 }
const SIEVE_H = 58
const BIN = { x: -70, y: 38, w: 46, d: 18, r: 2 } // reject drawer, pulled out toward the reader

const T2 = { x0: SIEVE.x + SIEVE.w, x1: 18 }

const CAB = { x: 18, y: -46, w: 92, d: 92, r: 4 }
const CAB_H = 118
const DRAWERS = MODEL.tables // one drawer per table, top to bottom
const DRAWER_H = (CAB_H - 14) / DRAWERS.length

const RAIL_Z = CAB_H + 2
const CARRIAGE_RANGE = [CAB.x + 14, CAB.x + CAB.w - 30]
const TRAY = { x: CAB.x + CAB.w + 4, y: 10, w: 30, d: 34, r: 2 }
const TRAY_Z = 62

const SCREEN = { x: 150, y: -40, w: 70, d: 26, r: 3 }
const SCREEN_Z = 22
const SCREEN_H = 62

const OUTBOX = { x: 200, y: 34, w: 46, d: 34, r: 3 }
const OUTBOX_H = 24

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [CAB.x, CAB.y, RAIL_Z + 30], [CAB.x + CAB.w, CAB.y + CAB.d, RAIL_Z + 30], [SCREEN.x, SCREEN.y, SCREEN_Z + SCREEN_H + 4]],
  W,
  H,
  { pad: 26, azimuth: 58 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
const g = (part, body, extra = "") => `<g data-part="${part}"${extra}>${body}</g>`

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
  // A ruler along the front edge: the direction data travels.
  const strip = { x: BENCH.x + 40, y: BENCH.y + BENCH.d - 17, w: BENCH.w - 80, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  // Label plate, back left: three rule lines for its printed text.
  const plate = { x: BENCH.x + 16, y: BENCH.y + 12, w: 46, d: 20, r: 1.5 }
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }))
  out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P), { tone: "faint" }))
  for (const [i, len] of [30, 22, 26].entries()) out.push(L(k.lineOnTop([plate.x + 6, plate.y + 6 + i * 4], [plate.x + 6 + len, plate.y + 6 + i * 4], 0.8, P), { tone: "lo", free: true }))
  out.push(D([at([plate.x + 3, plate.y + 3, 0.8]), at([plate.x + plate.w - 3, plate.y + plate.d - 3, 0.8])], { size: 0.4 }))
  return out.join("")
}

// ── 1. Sources: three small transmitters, each with its status lamp ────────
function sources() {
  const out = []
  SRC[1].forEach((y, i) => {
    const p = SRC_PLAN(y)
    out.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(p, 2), 0, 0.1, P)}" style="filter:blur(3px)"/>`)
    out.push(S(k.slabOf(p, 0, SRC_H, P, 3, 0.6), { tone: "mid" }))
    out.push(L(k.planOutline(k.insetPlan(p, 3), SRC_H, P, 3), { tone: "faint" }))
    // Vents on top, a closed slot each.
    for (const dx of [6, 11, 16]) out.push(L(k.planOutline({ x: p.x + dx, y: p.y + 6, w: 2, d: 12, r: 1 }, SRC_H, P, 2), { tone: "lo" }))
    // Output jack on top, near the right end, where the cable leaves.
    out.push(S(k.cylinder(p.x + p.w - 7, y, 3.4, SRC_H, 3, P, 20), { tone: "hi", crease: "lo" }))
    out.push(D([at([p.x + 4, p.y + p.d - 3, SRC_H])], { size: 0.45 }))
    out.push(`<circle data-part="lamp-${i}" class="fig-lamp" data-hue="${["model", "tool", "wait"][i]}" cx="${at([p.x + 5, p.y + 5, SRC_H])[0].toFixed(1)}" cy="${at([p.x + 5, p.y + 5, SRC_H])[1].toFixed(1)}" r="1.6"/>`)
  })
  return out.join("")
}

// Cables from each source's jack: up, along the bench in its own lane, then over
// the junction box's edge and down into its receiver. Claude Code and the Agent
// SDK and apps here send OTLP over HTTP. Either port takes any source.
const CABLE_TO = [
  { socket: 0, dy: 0 },
  { socket: 1, dy: -2.5 },
  { socket: 1, dy: 2.5 },
]
const CABLE_Z = JBOX_H + 10
function cables() {
  const out = []
  SRC[1].forEach((y, i) => {
    const p = SRC_PLAN(y)
    const c = CABLE_TO[i]
    const sock = SOCKETS[c.socket]
    const jack = [p.x + p.w - 7, y, SRC_H + 3]
    const sy = sock.y + c.dy
    const cx = JBOX.x + 18
    const land = [cx, sy, JBOX_H + 7]
    const via = [
      [jack[0], y, CABLE_Z],
      [JBOX.x - 8, y, CABLE_Z],
      [JBOX.x + 2, sy, CABLE_Z],
      [cx, sy, CABLE_Z],
    ]
    out.push(k.wireSvg(at(jack), at(land), { via: via.map(at), tone: "mid", ends: "both", size: 1.1 }))
  })
  return out.join("")
}

// ── 2. Junction box: the two receivers ─────────────────────────────────────
function junction() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(JBOX, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf(JBOX, 0, 6, P, 4, 0.6), { tone: "mid" }))
  out.push(S(k.slabOf(k.insetPlan(JBOX, 2), 6, JBOX_H - 6, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(k.insetPlan(JBOX, 2), JBOX_H - 10, P, 4), { tone: "faint" }) }))
  out.push(L(k.planOutline(k.insetPlan(JBOX, 6), JBOX_H, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(k.insetPlan(JBOX, 2), 4)) out.push(D([at([x, y, JBOX_H])], { size: 0.45 }))
  for (const s of SOCKETS) {
    const cx = JBOX.x + 18
    out.push(S(k.cylinder(cx, s.y, 7.5, JBOX_H, 3, P, 32), { tone: "mid" }))
    out.push(L(k.knurl(cx, s.y, 7.5, JBOX_H, JBOX_H + 3, 30, P), { tone: "lo" }))
    out.push(S(k.cylinder(cx, s.y, 5, JBOX_H + 3, 4, P, 28), { tone: "mid", crease: "none" }))
    out.push(L(k.ring(cx, s.y, 2.6, JBOX_H + 7, P, 20), { tone: "lo" }))
  }
  // Front face: a small window per receiver where its lamp shows a batch landing.
  for (const s of SOCKETS) {
    out.push(`<circle data-part="rx-${s.port}" class="fig-lamp" data-hue="model" cx="${at([JBOX.x + JBOX.w - 10, s.y, JBOX_H])[0].toFixed(1)}" cy="${at([JBOX.x + JBOX.w - 10, s.y, JBOX_H])[1].toFixed(1)}" r="1.5"/>`)
  }
  return out.join("")
}

// ── Troughs: open channels the batches run down, each on two stands ────────
function trough(t, part) {
  const out = []
  const len = t.x1 - t.x0
  const plan = { x: t.x0, y: -TROUGH_W / 2 - 2, w: len, d: TROUGH_W + 4, r: 1 }
  for (const x of [t.x0 + 8, t.x1 - 8]) {
    out.push(S(k.slabOf({ x: x - 3, y: -6, w: 6, d: 12, r: 1 }, 0, TROUGH_Z - 3, P, 3, 0.4), { tone: "mid" }))
    out.push(S(k.slabOf({ x: x - 5, y: -8, w: 10, d: 16, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
  }
  // Floor and back wall in the back SVG; the near wall goes in front of the light.
  out.push(S(k.slabOf(plan, TROUGH_Z - 3, 3, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: t.x0, y: plan.y, w: len, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2), { tone: "mid" }))
  return g(part, out.join(""))
}
function troughFront(t) {
  const len = t.x1 - t.x0
  return S(k.slabOf({ x: t.x0, y: TROUGH_W / 2, w: len, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2, 0.3), { tone: "mid" })
}

// ── 3. Sieve: redaction. Identity always falls through; content only passes with the lever up ──
function sieve() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(SIEVE, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf(SIEVE, 0, 8, P, 4, 0.6), { tone: "mid" }))
  const body = k.insetPlan(SIEVE, 3)
  out.push(S(k.slabOf(body, 8, SIEVE_H - 8, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, 30, P, 4), { tone: "faint" }) }))
  // The mesh on top: a perforated plate inside a frame.
  const mesh = k.insetPlan(SIEVE, 10)
  out.push(L(k.planOutline(mesh, SIEVE_H, P, 3), { tone: "lo" }))
  out.push(D(k.dotGrid(mesh.x + 4, mesh.y + 4, 8, 11, 5, SIEVE_H, P), { size: 0.42, tone: "lo" }))
  for (const [x, y] of k.corners(body, 4)) out.push(D([at([x, y, SIEVE_H])], { size: 0.45 }))
  return out.join("")
}
// Two levers on the near face: identity (pinned down, it never passes) and content (the --store-content lever).
const LEVERS = [
  { x: SIEVE.x + 16, name: "identity" },
  { x: SIEVE.x + 40, name: "content" },
]
function lever(l, up) {
  const y = SIEVE.y + SIEVE.d - 3
  const out = []
  out.push(S(k.slabOf({ x: l.x - 4, y, w: 8, d: 4, r: 1 }, 30, 10, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: l.x - 1.2, y: y + 4, w: 2.4, d: 10, r: 1 }, up ? 38 : 31, 2.4, P, 2), { tone: up ? "hi" : "mid", lit: up }))
  out.push(S(k.cylinder(l.x, y + 14, 2.6, up ? 37.5 : 30.5, 3.4, P, 20), { tone: up ? "hi" : "mid", lit: up }))
  return out.join("")
}
function bin() {
  const out = []
  out.push(S(k.slabOf(BIN, 2, 12, P, 2, 0.5), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(BIN, 2), 14, P, 2), { tone: "faint" }))
  // The reject drawer's pull.
  out.push(S(k.slabOf({ x: BIN.x + BIN.w / 2 - 8, y: BIN.y + BIN.d, w: 16, d: 2.4, r: 1 }, 6, 3, P, 2), { tone: "mid" }))
  return out.join("")
}

// ── 4. Cabinet: the DuckDB file, one drawer per table ──────────────────────
function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`]
  out.push(S(k.slabOf(CAB, 0, 6, P, 4, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(CAB, 2), 6, CAB_H - 6, P, 4, 1), { tone: "mid" }))
  // Rails for the reading carriage, with end stops.
  for (const y of [-34, 30]) {
    out.push(S(k.slabOf({ x: CAB.x + 8, y, w: CAB.w - 16, d: 4, r: 1 }, CAB_H, 2.4, P, 3, 0.3), { tone: "mid" }))
    out.push(D([CAB.x + 12, CAB.x + CAB.w - 12].map((x) => at([x, y + 2, CAB_H + 2.4])), { size: 0.4 }))
  }
  for (const x of [CAB.x + 4, CAB.x + CAB.w - 8]) out.push(S(k.slabOf({ x, y: -38, w: 4, d: 76, r: 1 }, CAB_H, 6, P, 3, 0.4), { tone: "mid" }))
  return out.join("")
}
const drawerZ = (i) => CAB_H - 7 - i * DRAWER_H - DRAWER_H + 2
const DRAWER_FRONT = { x: CAB.x + 6, y: CAB.y + CAB.d - 2, w: CAB.w - 12, d: 3, r: 1 }
// What is inside a drawer: its floor, sides and standing cards. Seen only where
// the drawer has come out past the cabinet face (the page sets the clip).
function drawerInside(i) {
  const z = drawerZ(i)
  const f = DRAWER_FRONT
  const out = []
  const box = { x: f.x + 3, y: CAB.y + 8, w: f.w - 6, d: CAB.d - 10, r: 1 }
  out.push(S(k.slabOf(box, z + 1, 2, P, 2), { tone: "lo", crease: "none" }))
  for (const x of [box.x, box.x + box.w - 2]) out.push(S(k.slabOf({ x, y: box.y, w: 2, d: box.d, r: 0.5 }, z + 1, DRAWER_H - 7, P, 2), { tone: "mid" }))
  // Index cards standing on edge: their top edges, light, a few with raised tabs.
  for (let c = 0; c < 12; c++) {
    const y = box.y + box.d - 6 - c * 6
    const top = z + DRAWER_H - 8 - (c % 3) * 0.8
    out.push(L(k.lineOnTop([box.x + 4, y], [box.x + box.w - 4, y], top, P), { tone: "faint" }))
    if (c % 4 === 1) out.push(L(k.lineOnTop([box.x + 8 + (c % 3) * 14, y], [box.x + 18 + (c % 3) * 14, y], top + 2, P), { tone: "lo" }))
  }
  return out.join("")
}
function drawerFront(i) {
  const z = drawerZ(i)
  const front = DRAWER_FRONT
  const out = []
  out.push(S(k.slabOf(front, z, DRAWER_H - 2, P, 3, 0.6), { tone: "mid" }))
  const lx = front.x + front.w / 2
  const fy = front.y + front.d
  const z1 = z + DRAWER_H - 6
  const z0 = z + DRAWER_H - 11
  out.push(L(k.segment([lx - 12, fy, z1], [lx + 12, fy, z1], P) + k.segment([lx + 12, fy, z1], [lx + 12, fy, z0], P) + k.segment([lx + 12, fy, z0], [lx - 12, fy, z0], P) + k.segment([lx - 12, fy, z0], [lx - 12, fy, z1], P), { tone: "lo" }))
  out.push(S(k.slabOf({ x: lx - 8, y: fy, w: 16, d: 2.4, r: 1 }, z + 4, 3, P, 2), { tone: "mid" }))
  return out.join("")
}

// The reading carriage: a frame on the rails holding a rack of templates, one per rule.
function carriage() {
  const out = []
  const plan = { x: 0, y: -38, w: 22, d: 76, r: 2 }
  out.push(S(k.slabOf(plan, CAB_H + 2.4, 4, P, 3, 0.5), { tone: "mid" }))
  for (const y of [-36, 32]) out.push(S(k.slabOf({ x: 2, y, w: 18, d: 4, r: 1 }, CAB_H + 6.4, 18, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: 2, y: -36, w: 18, d: 72, r: 1 }, CAB_H + 24.4, 3, P, 3, 0.4), { tone: "mid" }))
  // One thin template per rule, hanging from the top bar.
  const n = MODEL.rules.length
  for (let i = 0; i < n; i++) {
    const y = -30 + (i * 60) / (n - 1)
    out.push(S(k.slabOf({ x: 6, y: y - 0.6, w: 10, d: 1.2, r: 0.3 }, CAB_H + 10, 14, P, 2), { tone: "hi", crease: "lo" }))
  }
  out.push(D([at([1.5, -37, CAB_H + 6.4]), at([20.5, -37, CAB_H + 6.4])], { size: 0.4 }))
  return out.join("")
}
function tray() {
  const out = []
  out.push(S(k.slabOf({ x: CAB.x + CAB.w - 2, y: TRAY.y + 8, w: 8, d: 18, r: 1 }, TRAY_Z - 8, 10, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf(TRAY, TRAY_Z, 2, P, 2, 0.4), { tone: "mid" }))
  for (const [dx, dy, w, d] of [[0, 0, TRAY.w, 2], [0, TRAY.d - 2, TRAY.w, 2], [TRAY.w - 2, 0, 2, TRAY.d]]) out.push(S(k.slabOf({ x: TRAY.x + dx, y: TRAY.y + dy, w, d, r: 0.5 }, TRAY_Z + 2, 5, P, 2), { tone: "mid" }))
  return out.join("")
}

function cards() {
  const out = []
  for (let i = 0; i < 5; i++) {
    const plan = { x: TRAY.x + 4 + i * 0.6, y: TRAY.y + 5 + i * 0.4, w: TRAY.w - 10, d: TRAY.d - 10, r: 0.8 }
    out.push(`<g class="card" data-card="${i}">${S(k.slabOf(plan, TRAY_Z + 2 + i * 1.1, 1, P, 2), { tone: "hi", crease: "none" })}</g>`)
  }
  return `<g data-part="cards">${out.join("")}</g>`
}

// ── 5. Screen: the UI, a small monitor on a foot ───────────────────────────
function screen() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: SCREEN.x + 14, y: SCREEN.y + 4, w: 42, d: 22, r: 4 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`]
  out.push(S(k.slabOf({ x: SCREEN.x + 14, y: SCREEN.y + 2, w: 42, d: 22, r: 4 }, 0, 4, P, 4, 0.6), { tone: "mid" }))
  out.push(S(k.slabOf({ x: SCREEN.x + 31, y: SCREEN.y + 8, w: 8, d: 6, r: 1.5 }, 4, SCREEN_Z - 4, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf(SCREEN, SCREEN_Z, SCREEN_H, P, 4, 0.8), { tone: "hi", crease: "lo" }))
  return out.join("")
}
// The picture on the screen, drawn in the plane of its front face.
function screenFace() {
  const y = SCREEN.y + SCREEN.d
  const m = k.sideMatrix([0, y], 0, P, "left")
  const x0 = SCREEN.x + 6
  const x1 = SCREEN.x + SCREEN.w - 6
  const z0 = SCREEN_Z + 6
  const z1 = SCREEN_Z + SCREEN_H - 6
  const w = x1 - x0
  const h = z1 - z0
  const bars = [
    ["model", 0.81],
    ["tool", 0.06],
    ["wait", 0.05],
  ]
  let bx = x0 + 6
  const segs = bars
    .map(([hue, f]) => {
      const bw = (w - 12) * Math.max(f, 0.04)
      const r = `<rect class="fig-bar" data-hue="${hue}" x="${bx.toFixed(1)}" y="${(-z0 - h * 0.45).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="4"/>`
      bx += bw
      return r
    })
    .join("")
  const lines = [0.8, 0.62, 0.7]
    .map((f, i) => `<line class="fig-text" x1="${x0 + 6}" x2="${(x0 + 6 + (w - 12) * f).toFixed(1)}" y1="${(-z1 + 8 + i * 5).toFixed(1)}" y2="${(-z1 + 8 + i * 5).toFixed(1)}"/>`)
    .join("")
  return `<g transform="${m}"><rect class="fig-glass" x="${x0}" y="${-z1}" width="${w}" height="${h}" rx="2"/>${lines}${segs}<rect class="fig-glass-edge" x="${x0}" y="${-z1}" width="${w}" height="${h}" rx="2"/></g>`
}

// ── 6. Outbox: Ask, locked by default ─────────────────────────────────────
function outbox(open) {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(OUTBOX, 2), 0, 0.1, P)}" style="filter:blur(3px)"/>`]
  out.push(S(k.slabOf(OUTBOX, 0, OUTBOX_H, P, 3, 0.6), { tone: "mid" }))
  const well = k.insetPlan(OUTBOX, 3)
  if (open) {
    // Open: a recess, and in it the only two things Ask ever sends, the schema and query rows.
    out.push(S(k.slabOf(well, OUTBOX_H - 0.2, 0.2, P, 2), { tone: "lo", flat: true, crease: "none" }))
    out.push(S(k.slabOf({ x: well.x + 6, y: well.y + well.d - 12, w: 16, d: 2, r: 0.4 }, OUTBOX_H - 12, 12, P, 2), { tone: "hi", lit: true }))
    out.push(S(k.slabOf({ x: well.x + 20, y: well.y + well.d - 12, w: 14, d: 2, r: 0.4 }, OUTBOX_H - 12, 10, P, 2), { tone: "hi", crease: "lo" }))
  } else out.push(L(k.planOutline(well, OUTBOX_H, P, 2), { tone: "lo" }))
  // The lid slides back along its runners, still resting on the box.
  out.push(`<g data-part="lid" transform="${k.translateAlong(P, [0, open ? -OUTBOX.d * 0.62 : 0, 0])}">${S(k.slabOf(k.insetPlan(OUTBOX, -1), OUTBOX_H, 3, P, 3, 0.5), { tone: "mid" })}</g>`)
  // Padlock on the near face: a body and a shackle loop, gone when unlocked.
  const lx = OUTBOX.x + OUTBOX.w / 2
  const ly = OUTBOX.y + OUTBOX.d
  if (!open) out.push(S(k.slabOf({ x: lx - 4, y: ly, w: 8, d: 3, r: 1 }, 8, 8, P, 2, 0.4), { tone: "hi", crease: "lo" }) + L(k.segment([lx - 2.5, ly + 1.5, 16], [lx - 2.5, ly + 1.5, 20], P) + k.segment([lx - 2.5, ly + 1.5, 20], [lx + 2.5, ly + 1.5, 20], P) + k.segment([lx + 2.5, ly + 1.5, 20], [lx + 2.5, ly + 1.5, 16], P), { tone: "mid" }))
  return out.join("")
}

// Cables from the cabinet to the screen (the API serving the UI), and from the cabinet to the outbox.
function backCables() {
  const out = []
  const a = [CAB.x + CAB.w, -30, 20]
  const b = [SCREEN.x + 14, SCREEN.y + 12, 4]
  out.push(k.wireSvg(at(a), at(b), { via: [at([a[0] + 10, -30, 20]), at([b[0] - 10, b[1], 4])], tone: "lo", ends: "both", size: 1.1 }))
  const c = [CAB.x + CAB.w, 30, 14]
  const d = [OUTBOX.x, OUTBOX.y + 14, 10]
  out.push(k.wireSvg(at(c), at(d), { via: [at([c[0] + 30, 30, 14]), at([d[0] - 14, d[1], 10])], tone: "lo", ends: "both", size: 1.1 }))
  return out.join("")
}

// ── Assemble: back SVG, the light canvas, front SVG ────────────────────────
const st = (station, body) => `<g data-station="${station}">${body}</g>`
const both = (part, a, b) => `<g data-part="${part}" data-state="off"><g class="st-off">${a}</g><g class="st-on">${b}</g></g>`
// A soft pool of light on the bench under the station in focus (no part ever turns see-through).
const SPOTS = {
  sources: { x: SRC[0] - 26, y: -72, w: 52, d: 112, r: 10 },
  receive: k.insetPlan(JBOX, -8),
  redact: { x: SIEVE.x - 8, y: SIEVE.y - 8, w: SIEVE.w + 16, d: SIEVE.d + 30, r: 10 },
  store: k.insetPlan(CAB, -8),
  rules: { x: CAB.x - 6, y: CAB.y - 6, w: CAB.w + 44, d: CAB.d + 12, r: 10 },
  ui: { x: SCREEN.x + 6, y: SCREEN.y - 6, w: 58, d: 38, r: 8 },
  ask: k.insetPlan(OUTBOX, -8),
}
const spots = Object.entries(SPOTS)
  .map(([id, plan]) => `<path class="fig-spot" data-spot="${id}" d="${k.haloOf(plan, 0, 0.1, P)}"/>`)
  .join("")
const drawers = DRAWERS.map(
  (_, i) =>
    `<g clip-path="url(#dclip-${i})"><g data-part="drawer-in-${i}">${drawerInside(i)}</g></g><g data-part="drawer-${i}">${drawerFront(i)}</g>`,
).join("")
const clips = `<defs>${DRAWERS.map((_, i) => `<clipPath id="dclip-${i}"><path data-clip="${i}" d="M0 0Z"/></clipPath>`).join("")}</defs>`
const back = [
  bench(),
  spots,
  st("sources", sources()),
  st("receive", junction()),
  // Cables land on top of the junction box, so they are painted after it.
  st("sources", cables()),
  trough(T1, "trough-1"),
  trough(T2, "trough-2"),
]
// The light runs in the troughs; everything that stands in front of a trough is painted over it.
const front = [
  clips,
  troughFront(T1),
  st("redact", sieve() + `<g data-part="lever-identity">${lever(LEVERS[0], false)}</g>` + both("lever-content", lever(LEVERS[1], false), lever(LEVERS[1], true)) + `<g data-part="bin">${bin()}</g>`),
  troughFront(T2),
  st("store", cabinet() + drawers),
  st("rules", `<g data-part="carriage" transform="${k.translateAlong(P, [CARRIAGE_RANGE[0], 0, 0])}">${carriage()}</g>` + tray() + cards()),
  st("ui", backCables() + screen() + screenFace()),
  st("ask", both("outbox", outbox(false), outbox(true))),
]

const LABEL =
  `An instrument bench that explains how Aftertrace works. On the left, three small transmitters (Claude Code, the Agent SDK and your app) are cabled into a junction box with two sockets, the OpenTelemetry receivers on ports 4317 and 4318. Batches of light run down an open trough into a sieve, where identity always falls into a reject drawer and content falls too unless its lever is up. What passes drops into a four-drawer card cabinet, one drawer per table of the DuckDB file. A carriage on rails over the cabinet carries ${MODEL.rules.length} templates, the rules, and drops finding cards into a tray. A screen on the right shows the UI, and a locked outbox beside it is Ask, the only way anything leaves the bench.`

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const frontSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer fx-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">${front.join("")}</svg>`

const STATIONS = [
  { id: "sources", label: "Sources", read: "Claude Code, the Agent SDK and your apps send OpenTelemetry", box: [SRC[0] - 22, -70, 0, SRC[0] + 22, 40, SRC_H + 20] },
  { id: "receive", label: "Receivers", read: `127.0.0.1:${MODEL.ports.grpc} gRPC · :${MODEL.ports.http} HTTP`, box: [JBOX.x, JBOX.y, 0, JBOX.x + JBOX.w, JBOX.y + JBOX.d, JBOX_H + 8] },
  { id: "redact", label: "Redaction", read: `${MODEL.identityKeys.length} identity keys out · ${MODEL.contentKeys.length} content keys gated`, box: [SIEVE.x, SIEVE.y, 0, SIEVE.x + SIEVE.w, SIEVE.y + SIEVE.d + 18, SIEVE_H] },
  { id: "store", label: "Store", read: `one DuckDB file, ${DRAWERS.length} tables`, box: [CAB.x, CAB.y, 0, CAB.x + CAB.w, CAB.y + CAB.d, CAB_H - 4] },
  { id: "rules", label: "Findings", read: `${MODEL.rules.length} SQL rules over the store`, box: [CAB.x, CAB.y, CAB_H, CAB.x + CAB.w + 36, CAB.y + CAB.d, CAB_H + 30] },
  { id: "ui", label: "UI", read: `app and API on 127.0.0.1:${MODEL.ports.ui}`, box: [SCREEN.x, SCREEN.y, 0, SCREEN.x + SCREEN.w, SCREEN.y + SCREEN.d, SCREEN_Z + SCREEN_H] },
  { id: "ask", label: "Ask", read: "off: nothing leaves this machine", box: [OUTBOX.x, OUTBOX.y, 0, OUTBOX.x + OUTBOX.w, OUTBOX.y + OUTBOX.d, OUTBOX_H + 4] },
]

// Screen boxes for hit-testing, from each station's world box.
const HIT = STATIONS.map((s) => {
  const [x0, y0, z0, x1, y1, z1] = s.box
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ].map(at)
  return { id: s.id, read: s.read, label: s.label, hull: hull(pts) }
})
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

const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  trough: { z: TROUGH_Z, half: TROUGH_W / 2, runs: [[T1.x0, T1.x1], [T2.x0, T2.x1]] },
  carriage: CARRIAGE_RANGE,
  stations: HIT,
  sieve: { x: SIEVE.x, y: SIEVE.y, w: SIEVE.w, d: SIEVE.d, bin: BIN },
  tray: TRAY,
  trayZ: TRAY_Z,
  hues: { model: [0.388, 0.349, 0.878], tool: [0.078, 0.6, 0.557], wait: [0.886, 0.604, 0.18] },
  orbZ: TROUGH_Z + 4,
  drawers: DRAWERS.length,
  drawerBox: DRAWERS.map((_, i) => ({ x0: DRAWER_FRONT.x + 3, x1: DRAWER_FRONT.x + DRAWER_FRONT.w - 3, y0: CAB.y + CAB.d - 2, z0: drawerZ(i), z1: drawerZ(i) + DRAWER_H - 2 })),
  stationIds: STATIONS.map((s) => s.id),
}

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))

const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="How Aftertrace works. Arrow keys move between stations; Enter opens the page for that station; C flips the content lever; A unlocks Ask.">${backSvg}<canvas class="fx-layer fx-gl" aria-hidden="true"></canvas>${frontSvg}</div>`
const body = k.plateHtml({
  fig: "Fig 1",
  title: "How Aftertrace works",
  hint: "Point at a station · click to go deeper",
  readout: STATIONS[0].read,
  keys: [
    { mark: "lit", label: "The station you point at (or step to with the arrow keys)" },
    { mark: "raised", label: "Light in the troughs: traces in indigo, logs in teal, metrics in amber" },
    { mark: "edge", label: "C flips the content lever (--store-content); A unlocks the outbox (Ask)" },
  ],
  caption: `Everything runs in one binary on your machine. Sources send OpenTelemetry to the receivers on ports ${MODEL.ports.grpc} and ${MODEL.ports.http}; redaction drops ${MODEL.identityKeys.length} identity keys always and ${MODEL.contentKeys.length} content keys unless you run with --store-content; what is left is written to ${DRAWERS.length} tables in one DuckDB file; ${MODEL.rules.length} SQL rules turn it into findings; the UI and API on port ${MODEL.ports.ui} read it. Nothing leaves unless you switch on Ask.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "system-dark.html" : "system.html")
writeFileSync(file, k.pageHtml({ title: "How Aftertrace works", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)

