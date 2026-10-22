// Fig 2 · Receiving, as a sorting bench.
// Exports enter on the left and are taken apart on the way right: sources are
// cabled into an inlet box with two sockets (the gRPC and HTTP receivers), each
// lane runs under a size gauge (the 32 MB cap), the HTTP lane past a reader
// that turns to protobuf or JSON (the Content-Type), and a paper tray feeds a
// third lane (aftertrace import). All three end in an unpacker whose window
// shows the nesting it undoes (resource, scope, records). Single rows leave it
// under a comb (redaction), run down a sorting channel into four bins (the
// tables), and the bins sit on one tray with one plunger: an export is written
// as one transaction, then it is in the store.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as k from "../kit/iso-kit.mjs"
import { glCamera } from "../kit/gl.mjs"
import { kitScript, glScript } from "../kit/inline.mjs"
import { MODEL } from "../model.mjs"
import { RECEIVE } from "./facts.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = process.env.FIGURES_OUT || join(HERE, "..", "dist")
const theme = process.argv.includes("--dark") ? "dark" : "light"

const W = 760
const H = 420

// ── World plan (units ≈ px; x along the bench, y toward the reader, z up) ──
const BENCH = { x: -278, y: -88, w: 504, d: 166, r: 10 }
const BENCH_H = 12
const FOOT_H = 6

const TROUGH_Z = 30 // floor of every channel, on its stands
const TROUGH_W = 14
const HALF = TROUGH_W / 2

// Three lanes into the unpacker: gRPC, HTTP, and the import tray.
const LANE = { grpc: -24, http: 18, file: -66 }

const SRC_X = -250
const SRC_Y = [-50, -16, 18]
const SRC_PLAN = (y) => ({ x: SRC_X - 16, y: y - 12, w: 32, d: 24, r: 3 })
const SRC_H = 22

const IN = { x: -218, y: -48, w: 46, d: 86, r: 4 }
const IN_H = 38
const SOCK_X = IN.x + 17

const U = { x: -50, y: -76, w: 46, d: 106, r: 4 } // the unpacker
const U_H = 42

const LANES = [
  { id: "grpc", y: LANE.grpc, x0: IN.x + IN.w, x1: U.x },
  { id: "http", y: LANE.http, x0: IN.x + IN.w, x1: U.x },
  { id: "file", y: LANE.file, x0: -104, x1: U.x },
]

const GAUGE_X = -136
const DEC_X = -108 // the Content-Type reader, a bridge over the HTTP lane
const BAR_Z = TROUGH_Z + 17
const KNOB = [DEC_X, LANE.http]
const KNOB_Z = BAR_Z + 2.6 + 4

const TRAY = { x: -146, y: -80, w: 40, d: 28, r: 2 } // import: a paper tray of .jsonl files
const TRAY_H = 5
const TRAY_Z = TROUGH_Z - 2 // the tray stands at lane height, behind the gRPC lane

const OUT_Y = -2 // the channel out of the unpacker
const OUTRUN = { x0: U.x + U.w, x1: 34 }
const COMB_X = 14
const CROSS = { x: 34, y: -48, w: 14, d: 112 } // the sorting channel, along y
const CROSS_C = CROSS.x + CROSS.w / 2

const BIN_X = CROSS.x + CROSS.w
const BIN_W = 46
const BINS = MODEL.tables.map((t, i) => ({ table: t, y: -46 + i * 27, d: 23 }))
const BIN_Z = TROUGH_Z - 3 // bin floors sit level with the channel floor
const TX = { x: CROSS.x - 4, y: -52, w: CROSS.w + BIN_W + 10, d: 118, r: 3 } // the tray all bins sit on: one transaction
const TX_Z = BIN_Z - 4
const PLUNGER = [TX.x + TX.w + 8, 6]

const CAB = { x: 150, y: -34, w: 54, d: 60, r: 3 } // the store, at the end of the bench
const CAB_H = 70

const P = k.fitProjection(
  [...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [U.x, U.y, U_H + 6], [CAB.x + CAB.w, CAB.y, CAB_H + 6], [GAUGE_X, LANE.grpc - 14, TROUGH_Z + 24]],
  W,
  H,
  { pad: 24, azimuth: 52 },
)

const at = (p) => k.iso(p, P)
const S = (paths, style) => k.solidSvg(paths, style)
const L = (d, style) => k.lineSvg(d, style)
const D = (pts, style) => k.dotsSvg(pts, style)
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))
const lamp = (part, hue, p, r = 1.5) => `<circle data-part="${part}" class="fig-lamp" data-hue="${hue}" cx="${at(p)[0].toFixed(1)}" cy="${at(p)[1].toFixed(1)}" r="${r}"/>`
const halo = (plan, blur = 4) => `<path class="iso-halo" d="${k.haloOf(k.insetPlan(plan, 2), 0, 0.1, P)}" style="filter:blur(${blur}px)"/>`
const box = (x0, y0, x1, y1) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.6 })

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
  // A ruler along the front edge, in the direction exports travel.
  const strip = { x: -150, y: BENCH.y + BENCH.d - 15, w: 300, d: 7, r: 1 }
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }))
  const t = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 5, 5, strip.y + 0.8, 0.6, [2, 3.8], P)
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }))
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }))
  // Label plate, front left: three rule lines for its printed text.
  const plate = { x: -232, y: 48, w: 46, d: 20, r: 1.5 }
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }))
  out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P), { tone: "faint" }))
  for (const [i, len] of [30, 22, 26].entries()) out.push(L(k.lineOnTop([plate.x + 6, plate.y + 6 + i * 4], [plate.x + 6 + len, plate.y + 6 + i * 4], 0.8, P), { tone: "lo", free: true }))
  out.push(D([at([plate.x + 3, plate.y + 3, 0.8]), at([plate.x + plate.w - 3, plate.y + plate.d - 3, 0.8])], { size: 0.4 }))
  return out.join("")
}

// ── Sources: three transmitters (Claude Code, the Agent SDK, an app) ──────
function sources() {
  const out = []
  SRC_Y.forEach((y, i) => {
    const p = SRC_PLAN(y)
    out.push(halo(p, 3))
    out.push(S(k.slabOf(p, 0, SRC_H, P, 3, 0.6), { tone: "mid" }))
    out.push(L(k.planOutline(k.insetPlan(p, 3), SRC_H, P, 3), { tone: "faint" }))
    for (const dx of [6, 11, 16]) out.push(L(k.planOutline({ x: p.x + dx, y: p.y + 6, w: 2, d: 12, r: 1 }, SRC_H, P, 2), { tone: "lo" }))
    out.push(S(k.cylinder(p.x + p.w - 7, y, 3.4, SRC_H, 3, P, 20), { tone: "hi", crease: "lo" }))
    out.push(D([at([p.x + 4, p.y + p.d - 3, SRC_H])], { size: 0.45 }))
    out.push(lamp(`src-${i}`, "model", [p.x + 5, p.y + 5, SRC_H], 1.6))
  })
  return out.join("")
}

// Claude Code sends gRPC (the setup page's first block); the SDK and the app send HTTP.
const CABLE_TO = [
  { lane: "grpc", dy: 0 },
  { lane: "http", dy: -2.5 },
  { lane: "http", dy: 2.5 },
]
const CABLE_Z = IN_H + 5
function cables() {
  const out = []
  SRC_Y.forEach((y, i) => {
    const p = SRC_PLAN(y)
    const sy = LANE[CABLE_TO[i].lane] + CABLE_TO[i].dy
    const jx = p.x + p.w - 7
    const lift = CABLE_Z + i * 1.6 // each cable in its own layer, so they cross cleanly
    const jack = [jx, y, SRC_H + 3]
    const land = [SOCK_X - 2.4, sy, IN_H + 7]
    const via = [[jx, y, lift], [jx, sy, lift], [SOCK_X - 2.4, sy, lift]]
    out.push(k.wireSvg(at(jack), at(land), { via: via.map(at), tone: "mid", ends: "both", size: 1.1 }))
  })
  return out.join("")
}

// ── Inlet box: the two receivers, one socket each, a lamp per socket ──────
function inlet() {
  const out = [halo(IN)]
  out.push(S(k.slabOf(IN, 0, 6, P, 4, 0.6), { tone: "mid" }))
  const body = k.insetPlan(IN, 2)
  out.push(S(k.slabOf(body, 6, IN_H - 6, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, IN_H - 12, P, 4), { tone: "faint" }) }))
  // A partition between the two receivers, seen as a seam across the lid.
  const mid = (LANE.grpc + LANE.http) / 2
  out.push(L(k.lineOnTop([IN.x + 4, mid], [IN.x + IN.w - 4, mid], IN_H, P), { tone: "faint" }))
  out.push(D([at([IN.x + 4, mid, IN_H]), at([IN.x + IN.w - 4, mid, IN_H])], { size: 0.4 }))
  for (const [x, y] of k.corners(body, 4)) out.push(D([at([x, y, IN_H])], { size: 0.45 }))
  for (const lane of ["grpc", "http"]) {
    const y = LANE[lane]
    out.push(S(k.cylinder(SOCK_X, y, 7.5, IN_H, 3, P, 32), { tone: "mid" }))
    out.push(L(k.knurl(SOCK_X, y, 7.5, IN_H, IN_H + 3, 30, P), { tone: "lo" }))
    out.push(S(k.cylinder(SOCK_X, y, 5, IN_H + 3, 4, P, 28), { tone: "mid", crease: "none" }))
    out.push(L(k.ring(SOCK_X, y, 2.6, IN_H + 7, P, 20), { tone: "lo" }))
    out.push(lamp(`rx-${lane}`, "model", [IN.x + IN.w - 9, y, IN_H]))
  }
  // gRPC carries its three services on one socket: three pins around the bore.
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3
    out.push(D([at([SOCK_X + Math.cos(a) * 3.9, LANE.grpc + Math.sin(a) * 3.9, IN_H + 7])], { size: 0.38, tone: "lo" }))
  }
  return out.join("")
}

// ── Channels: open troughs on stands. Floor and far wall behind the light, near wall in front ──
function laneBack(l) {
  const out = []
  const len = l.x1 - l.x0
  for (const x of [l.x0 + 8, l.x1 - 8]) {
    out.push(S(k.slabOf({ x: x - 3, y: l.y - 6, w: 6, d: 12, r: 1 }, 0, TROUGH_Z - 3, P, 3, 0.4), { tone: "mid" }))
    out.push(S(k.slabOf({ x: x - 5, y: l.y - 8, w: 10, d: 16, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
  }
  out.push(S(k.slabOf({ x: l.x0, y: l.y - HALF - 2, w: len, d: TROUGH_W + 4, r: 1 }, TROUGH_Z - 3, 3, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: l.x0, y: l.y - HALF - 2, w: len, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2), { tone: "mid" }))
  return out.join("")
}
const laneFront = (l) => S(k.slabOf({ x: l.x0, y: l.y + HALF, w: l.x1 - l.x0, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2, 0.3), { tone: "mid" })

// The out channel, from the unpacker to the sorting channel, has no stands: it rides on the tray's lip.
function outBack() {
  const len = OUTRUN.x1 - OUTRUN.x0
  const out = []
  out.push(S(k.slabOf({ x: OUTRUN.x0 + 10, y: OUT_Y - 6, w: 6, d: 12, r: 1 }, 0, TROUGH_Z - 3, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: OUTRUN.x0 + 8, y: OUT_Y - 8, w: 10, d: 16, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
  out.push(S(k.slabOf({ x: OUTRUN.x0, y: OUT_Y - HALF - 2, w: len, d: TROUGH_W + 4, r: 1 }, TROUGH_Z - 3, 3, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf({ x: OUTRUN.x0, y: OUT_Y - HALF - 2, w: len, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2), { tone: "mid" }))
  return out.join("")
}
const outFront = () => S(k.slabOf({ x: OUTRUN.x0, y: OUT_Y + HALF, w: OUTRUN.x1 - OUTRUN.x0, d: 2, r: 0.6 }, TROUGH_Z, 7, P, 2, 0.3), { tone: "mid" })

// ── The transaction tray, with the sorting channel and four bins on it ──
function txTray() {
  const out = [halo(TX, 5)]
  for (const [x, y] of byDepth(k.corners(TX, 5))) {
    out.push(S(k.slabOf({ x: x - 3, y: y - 3, w: 6, d: 6, r: 1 }, 0, TX_Z, P, 3, 0.4), { tone: "mid" }))
    out.push(S(k.slabOf({ x: x - 5, y: y - 5, w: 10, d: 10, r: 1.2 }, 0, 2, P, 3), { tone: "lo" }))
  }
  out.push(S(k.slabOf(TX, TX_Z, 4, P, 4, 0.5), { tone: "mid" }))
  out.push(L(k.planOutline(k.insetPlan(TX, 2.5), TX_Z + 4, P, 3), { tone: "faint" }))
  for (const [x, y] of k.corners(TX, 2.5)) out.push(D([at([x, y, TX_Z + 4])], { size: 0.42 }))
  return out.join("")
}
function crossBack() {
  const out = []
  out.push(S(k.slabOf({ ...CROSS, r: 1 }, TROUGH_Z - 3, 3, P, 3, 0.4), { tone: "mid" }))
  // Far wall (x side), split where the out channel comes in.
  out.push(S(k.slabOf(box(CROSS.x, CROSS.y, CROSS.x + 2, OUT_Y - HALF - 2), TROUGH_Z, 7, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf(box(CROSS.x, OUT_Y + HALF + 2, CROSS.x + 2, CROSS.y + CROSS.d), TROUGH_Z, 7, P, 2), { tone: "mid" }))
  // End wall at the back.
  out.push(S(k.slabOf(box(CROSS.x, CROSS.y, CROSS.x + CROSS.w, CROSS.y + 2), TROUGH_Z, 7, P, 2), { tone: "mid" }))
  return out.join("")
}
const crossFront = () => S(k.slabOf(box(CROSS.x, CROSS.y + CROSS.d - 2, CROSS.x + CROSS.w, CROSS.y + CROSS.d), TROUGH_Z, 7, P, 2, 0.3), { tone: "mid" })

// A bin per table: floor, far and side walls behind the light, near wall and lip in front.
function binBack(b, i) {
  const out = []
  const p = { x: BIN_X, y: b.y, w: BIN_W, d: b.d, r: 1 }
  out.push(S(k.slabOf(p, BIN_Z, 3, P, 3, 0.4), { tone: "lo" }))
  out.push(S(k.slabOf(box(p.x, p.y, p.x + p.w, p.y + 2), TROUGH_Z, 9, P, 2), { tone: "mid" }))
  // The low lip rows step over from the sorting channel.
  out.push(S(k.slabOf(box(p.x, p.y + 2, p.x + 2, p.y + p.d - 2), TROUGH_Z, 3, P, 2), { tone: "mid" }))
  // Cards already filed, lying in a short stack.
  for (let c = 0; c < 3; c++) {
    const cp = { x: p.x + 10 + c * 0.8, y: p.y + 5 + c * 0.5, w: p.w - 22, d: p.d - 10, r: 0.6 }
    out.push(S(k.slabOf(cp, TROUGH_Z + c * 1.1, 0.9, P, 2), { tone: "mid", crease: "none" }))
  }
  return `<g data-part="bin-${i}">${out.join("")}</g>`
}
function binFront(b, i) {
  const p = { x: BIN_X, y: b.y, w: BIN_W, d: b.d }
  const out = []
  out.push(S(k.slabOf(box(p.x + p.w - 2, p.y + 2, p.x + p.w, p.y + p.d - 2), TROUGH_Z, 9, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf(box(p.x, p.y + p.d - 2, p.x + p.w, p.y + p.d), TROUGH_Z, 9, P, 2, 0.3), { tone: "mid" }))
  // The bin's lamp on its near wall.
  const tz = TROUGH_Z + 9
  out.push(lamp(`binlamp-${i}`, ["model", "model", "tool", "wait"][i], [p.x + 6, p.y + p.d - 1, tz], 1.3))
  return out.join("")
}

// ── Bridges over a lane: two posts and a top bar. The far post sits behind the
// light, the near post and the bar in front of it. ──
const postAt = (x, y) => ({ x: x - 2, y: y - 2, w: 4, d: 4, r: 0.8 })
function bridgeBack(x, y) {
  return S(k.slabOf({ x: x - 4, y: y - HALF - 8, w: 8, d: 6, r: 1 }, 0, 2, P, 3), { tone: "lo" }) + S(k.slabOf(postAt(x, y - HALF - 5), 2, BAR_Z - 2, P, 3, 0.3), { tone: "mid" })
}
function bridgeFront(x, y) {
  const out = []
  out.push(S(k.slabOf({ x: x - 4, y: y + HALF + 2, w: 8, d: 6, r: 1 }, 0, 2, P, 3), { tone: "lo" }))
  out.push(S(k.slabOf(postAt(x, y + HALF + 5), 2, BAR_Z - 2, P, 3, 0.3), { tone: "mid" }))
  return out.join("")
}
const bar = (x, y) => S(k.slabOf({ x: x - 2.5, y: y - HALF - 8, w: 5, d: TROUGH_W + 16, r: 1 }, BAR_Z, 2.6, P, 3, 0.4), { tone: "mid" })

// ── Size gauge over each network lane: a plate whose lower edge is the 32 MB mark ──
const GAUGES = [LANE.grpc, LANE.http]
function gaugeFront(y, i) {
  const out = [bridgeFront(GAUGE_X, y)]
  out.push(S(k.slabOf({ x: GAUGE_X - 1, y: y - HALF - 1, w: 2, d: TROUGH_W + 2, r: 0.4 }, TROUGH_Z + 10, BAR_Z - TROUGH_Z - 10, P, 2), { tone: "hi", crease: "lo" }))
  out.push(bar(GAUGE_X, y))
  for (const yy of [y - HALF - 6, y + HALF + 6]) out.push(D([at([GAUGE_X, yy, BAR_Z + 2.6])], { size: 0.42 }))
  out.push(lamp(`gauge-${i}`, "retry", [GAUGE_X, y, BAR_Z + 2.6], 1.3))
  return out.join("")
}

// ── Content-Type reader: a bridge over the HTTP lane, its head reading each body,
// its knob turned to protobuf (back) or JSON (front) ──
const DETENTS = [-Math.PI * 0.75, Math.PI * 0.25]
function decoder() {
  const out = [bridgeFront(DEC_X, LANE.http)]
  // The reading head hangs from the bar into the lane.
  out.push(S(k.slabOf({ x: DEC_X - 5, y: LANE.http - 5, w: 10, d: 10, r: 1.5 }, TROUGH_Z + 10, BAR_Z - TROUGH_Z - 10, P, 3, 0.4), { tone: "hi", crease: "lo" }))
  out.push(bar(DEC_X, LANE.http))
  // A round cap on the bar carries the knob and its two detents.
  out.push(S(k.cylinder(DEC_X, LANE.http, 7.6, BAR_Z + 2.6, 2, P, 32, 0.3), { tone: "mid" }))
  out.push(D(DETENTS.map((a) => at([KNOB[0] + Math.cos(a) * 6.3, KNOB[1] + Math.sin(a) * 6.3, BAR_Z + 4.6])), { size: 0.5, tone: "mid" }))
  out.push(S(k.cylinder(KNOB[0], KNOB[1], 4.2, BAR_Z + 4.6, KNOB_Z - BAR_Z - 4.6, P, 28), { tone: "hi", crease: "lo" }))
  out.push(L(k.knurl(KNOB[0], KNOB[1], 4.2, BAR_Z + 4.6, KNOB_Z, 26, P), { tone: "lo" }))
  out.push(D([at([KNOB[0], KNOB[1], KNOB_Z])], { size: 0.45 }))
  return out.join("")
}
// The pointer on the knob is drawn by the page, which turns it.
const pointer = () => `<g data-part="pointer"><path class="iso-line" data-tone="hi" d="M0 0"/></g>`

// ── Import: a paper tray of .jsonl files, one sheet per signal ─────────────
function tray() {
  const out = [halo(TRAY, 3)]
  const z = TRAY_Z
  for (const [x, y] of byDepth(k.corners(TRAY, 5))) {
    out.push(S(k.slabOf({ x: x - 2, y: y - 2, w: 4, d: 4, r: 0.8 }, 2, z - 2, P, 3, 0.3), { tone: "mid" }))
    out.push(S(k.slabOf({ x: x - 4, y: y - 4, w: 8, d: 8, r: 1 }, 0, 2, P, 3), { tone: "lo" }))
  }
  out.push(S(k.slabOf(TRAY, z, 2, P, 3, 0.4), { tone: "mid" }))
  out.push(S(k.slabOf(box(TRAY.x, TRAY.y, TRAY.x + TRAY.w, TRAY.y + 2), z + 2, TRAY_H, P, 2), { tone: "mid" }))
  out.push(S(k.slabOf(box(TRAY.x, TRAY.y + 2, TRAY.x + 2, TRAY.y + TRAY.d), z + 2, TRAY_H, P, 2), { tone: "mid" }))
  RECEIVE.importFiles.forEach((_, i) => {
    const sp = { x: TRAY.x + 5 + i * 1.4, y: TRAY.y + 4 + i * 0.8, w: TRAY.w - 12, d: TRAY.d - 9, r: 0.6 }
    out.push(S(k.slabOf(sp, z + 2 + i * 1.2, 0.9, P, 2), { tone: "hi", crease: "none" }))
    // A coloured edge per file: traces, logs, metrics.
    out.push(`<path class="fig-edge" data-hue="${["model", "tool", "wait"][i]}" d="${k.segment([sp.x + 2, sp.y + sp.d, z + 2.9 + i * 1.2], [sp.x + 10, sp.y + sp.d, z + 2.9 + i * 1.2], P)}"/>`)
  })
  out.push(S(k.slabOf(box(TRAY.x, TRAY.y + TRAY.d - 2, TRAY.x + TRAY.w, TRAY.y + TRAY.d), z + 2, TRAY_H - 2, P, 2, 0.3), { tone: "mid" }))
  out.push(lamp("file-lamp", "model", [TRAY.x + TRAY.w - 5, TRAY.y + TRAY.d - 1, z + TRAY_H], 1.3))
  return out.join("")
}

// ── The unpacker: its lid is a window onto the nesting it undoes ──────────
function unpacker() {
  const out = [halo(U, 5)]
  out.push(S(k.slabOf(U, 0, 7, P, 4, 0.6), { tone: "mid" }))
  const body = k.insetPlan(U, 2)
  out.push(S(k.slabOf(body, 7, U_H - 7, P, 4, 0.8), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, 26, P, 4), { tone: "faint" }) }))
  // Resource, scope, records: three nested trays seen through the lid.
  const res = k.insetPlan(U, 7)
  const scope = k.insetPlan(U, 14)
  const recs = k.insetPlan(U, 21)
  out.push(S(k.slabOf(res, U_H - 0.2, 0.2, P, 3), { tone: "lo", flat: true, crease: "none" }))
  out.push(L(k.planOutline(res, U_H, P, 3), { tone: "lo" }))
  out.push(`<g data-part="nest">`)
  out.push(L(k.planOutline(scope, U_H, P, 3), { tone: "mid" }))
  out.push(L(k.planOutline(recs, U_H, P, 2), { tone: "mid" }))
  out.push(D(k.dotGrid(recs.x + 4, recs.y + 5, 2, 10, 7.2, U_H, P), { size: 0.5, tone: "mid" }))
  out.push(`</g>`)
  for (const [x, y] of k.corners(body, 3.5)) out.push(D([at([x, y, U_H])], { size: 0.45 }))
  // A service hatch on the near face, screwed at its corners.
  const fy = U.y + U.d - 2
  const hx0 = U.x + 8, hx1 = U.x + U.w - 8, hz0 = 12, hz1 = U_H - 12
  const rect = (x0, x1, y, z0, z1) => k.segment([x0, y, z0], [x1, y, z0], P) + k.segment([x1, y, z0], [x1, y, z1], P) + k.segment([x1, y, z1], [x0, y, z1], P) + k.segment([x0, y, z1], [x0, y, z0], P)
  out.push(L(rect(hx0, hx1, fy, hz0, hz1), { tone: "lo" }))
  out.push(D([[hx0 + 2.5, hz0 + 2.5], [hx1 - 2.5, hz0 + 2.5], [hx0 + 2.5, hz1 - 2.5], [hx1 - 2.5, hz1 - 2.5]].map(([x, z]) => at([x, fy, z])), { size: 0.42 }))
  // The outlet on the right face, framed where rows leave for the out channel.
  const fx = U.x + U.w - 2
  const slot = (y0, y1, z0, z1) => k.segment([fx, y0, z0], [fx, y1, z0], P) + k.segment([fx, y1, z0], [fx, y1, z1], P) + k.segment([fx, y1, z1], [fx, y0, z1], P) + k.segment([fx, y0, z1], [fx, y0, z0], P)
  out.push(L(slot(OUT_Y - HALF - 4, OUT_Y + HALF + 4, TROUGH_Z - 6, TROUGH_Z + 11), { tone: "lo" }))
  out.push(lamp("unpack", "model", [U.x + U.w - 6, U.y + U.d - 6, U_H], 1.6))
  return out.join("")
}

// ── Redaction comb across the out channel ──────────────────────────────────
const COMB_TOP = TROUGH_Z + 15
const combPost = (y) => S(k.slabOf({ x: COMB_X - 2, y, w: 4, d: 4, r: 0.8 }, TROUGH_Z, COMB_TOP - TROUGH_Z, P, 3, 0.3), { tone: "mid" })
const combBack = () => combPost(OUT_Y - HALF - 6)
function comb() {
  const out = [combPost(OUT_Y + HALF + 2)]
  const top = COMB_TOP
  out.push(S(k.slabOf({ x: COMB_X - 2.5, y: OUT_Y - HALF - 7, w: 5, d: TROUGH_W + 14, r: 1 }, top, 2.6, P, 3, 0.4), { tone: "mid" }))
  // Teeth: a row of thin blades hanging down into the channel.
  for (let i = 0; i < 6; i++) {
    const y = OUT_Y - HALF + 1 + i * 2.4
    out.push(S(k.slabOf({ x: COMB_X - 0.5, y: y - 0.4, w: 1, d: 0.8, r: 0.2 }, TROUGH_Z + 8, top - TROUGH_Z - 8, P, 2), { tone: "mid", crease: "none" }))
  }
  out.push(lamp("comb", "model", [COMB_X, OUT_Y + HALF + 4, top + 2.6], 1.3))
  return out.join("")
}

// ── The commit plunger at the tray's end, and the cable on to the store ───
function plunger() {
  const out = []
  const [x, y] = PLUNGER
  out.push(S(k.slabOf({ x: x - 6, y: y - 6, w: 12, d: 12, r: 2 }, 0, 3, P, 3, 0.4), { tone: "lo" }))
  out.push(S(k.cylinder(x, y, 3.6, 3, TX_Z + 6, P, 24), { tone: "mid" }))
  out.push(`<g data-part="plunger-cap">${S(k.cylinder(x, y, 5.4, TX_Z + 9, 3.4, P, 28, 0.4), { tone: "hi", crease: "lo" })}${L(k.knurl(x, y, 5.4, TX_Z + 9, TX_Z + 12.4, 26, P), { tone: "lo" })}</g>`)
  out.push(lamp("commit", "model", [x, y, TX_Z + 12.4], 1.5))
  return out.join("")
}
function storeCable() {
  const a = [PLUNGER[0] + 3.6, PLUNGER[1], 14]
  const b = [CAB.x, CAB.y + CAB.d / 2, 14]
  return k.wireSvg(at(a), at(b), { via: [at([a[0] + 10, a[1], 14]), at([b[0] - 12, b[1], 14])], tone: "lo", ends: "both", size: 1.1 })
}
// The store: a small cabinet, one drawer per table (Fig 4 opens it).
function cabinet() {
  const out = [halo(CAB, 4)]
  out.push(S(k.slabOf(CAB, 0, 5, P, 3, 0.6), { tone: "lo" }))
  out.push(S(k.slabOf(k.insetPlan(CAB, 2), 5, CAB_H - 5, P, 3, 1), { tone: "mid" }))
  const dh = (CAB_H - 12) / MODEL.tables.length
  MODEL.tables.forEach((_, i) => {
    const z = CAB_H - 6 - (i + 1) * dh + 1
    const f = { x: CAB.x + 5, y: CAB.y + CAB.d - 2, w: CAB.w - 10, d: 2.6, r: 0.8 }
    out.push(S(k.slabOf(f, z, dh - 2, P, 3, 0.5), { tone: "mid" }))
    const lx = f.x + f.w / 2
    const fy = f.y + f.d
    out.push(S(k.slabOf({ x: lx - 6, y: fy, w: 12, d: 2, r: 0.8 }, z + 3, 2.4, P, 2), { tone: "mid" }))
    out.push(lamp(`drawer-${i}`, ["model", "model", "tool", "wait"][i], [f.x + 4, fy, z + dh - 5], 1.1))
  })
  return out.join("")
}

// ── Assemble: back SVG, the light canvas, front SVG ────────────────────────
const st = (station, body) => `<g data-station="${station}">${body}</g>`
const SPOTS = {
  sources: { x: SRC_X - 24, y: -70, w: 48, d: 108, r: 10 },
  grpc: { x: IN.x - 6, y: IN.y - 6, w: IN.w + 12, d: 44, r: 8 },
  http: { x: IN.x - 6, y: -4, w: IN.w + 12, d: 48, r: 8 },
  gauge: { x: GAUGE_X - 12, y: LANE.grpc - 22, w: 24, d: 66, r: 8 },
  decoder: { x: DEC_X - 12, y: LANE.http - 22, w: 24, d: 44, r: 8 },
  file: { x: TRAY.x - 6, y: TRAY.y - 6, w: LANES[2].x1 - TRAY.x + 12, d: TRAY.d + 12, r: 8 },
  unpack: k.insetPlan(U, -8),
  redact: { x: COMB_X - 12, y: OUT_Y - 20, w: 24, d: 40, r: 8 },
  rows: k.insetPlan(TX, -6),
  commit: { x: PLUNGER[0] - 14, y: PLUNGER[1] - 14, w: 28, d: 28, r: 8 },
  store: k.insetPlan(CAB, -8),
}
const spots = Object.entries(SPOTS)
  .map(([id, plan]) => `<path class="fig-spot" data-spot="${id}" d="${k.haloOf(plan, 0, 0.1, P)}"/>`)
  .join("")

// Light runs in two layers. Exports on the lanes sit behind the unpacker and
// everything nearer than the lanes; rows leaving the unpacker sit in front of it.
const back = [
  bench(),
  spots,
  st("file", tray()),
  st("sources", sources()),
  st("grpc", inlet()),
  st("sources", cables()),
  ...LANES.map((l) => st(l.id === "file" ? "file" : "gauge", laneBack(l))),
  ...GAUGES.map((y) => st("gauge", bridgeBack(GAUGE_X, y))),
  st("decoder", bridgeBack(DEC_X, LANE.http)),
]
const mid = [
  ...LANES.map((l) => laneFront(l)),
  st("gauge", GAUGES.map(gaugeFront).join("")),
  st("decoder", decoder() + pointer()),
  st("unpack", unpacker()),
  st("rows", txTray()),
  st("redact", outBack() + combBack()),
  st("rows", crossBack() + BINS.map(binBack).join("")),
]
const front = [
  st("redact", outFront() + comb()),
  st("rows", crossFront() + BINS.map(binFront).join("")),
  st("commit", plunger()),
  st("store", storeCable() + cabinet()),
]

const LABEL = `A sorting bench that explains how Aftertrace receives telemetry. Three small transmitters on the left are cabled into an inlet box with two sockets, the gRPC receiver on port ${MODEL.ports.grpc} and the HTTP receiver on port ${MODEL.ports.http}. Each lane runs under a size gauge set at ${RECEIVE.maxBodyMB} MB, and the HTTP lane passes a knob that turns to protobuf or JSON. A paper tray of .jsonl files feeds a third lane, the import command. All lanes end in an unpacker whose lid shows nested trays, resource, scope and records. Single rows leave it under a comb, which is redaction, run down a sorting channel into ${BINS.length} bins, one per table, all on one tray with a plunger: an export is written in one transaction. A cable runs on to a small cabinet, the store.`

const backSvg = k.figureSvg({ width: W, height: H, label: LABEL, body: back.join("") })
const layerSvg = (parts) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg fx-layer" viewBox="0 0 ${W} ${H}" aria-hidden="true">${parts.join("")}</svg>`

const STATIONS = [
  { id: "sources", label: "Sources", read: "Claude Code, the Agent SDK and your apps export OTLP", box: [SRC_X - 18, -64, 0, SRC_X + 18, 32, SRC_H + 22] },
  { id: "grpc", label: "gRPC receiver", read: `${RECEIVE.listen}:${MODEL.ports.grpc} · trace, logs and metrics services`, box: [IN.x, IN.y, 0, IN.x + IN.w, (LANE.grpc + LANE.http) / 2, IN_H + 8] },
  { id: "http", label: "HTTP receiver", read: `${RECEIVE.listen}:${MODEL.ports.http} · POST ${RECEIVE.httpPaths.join(", ")}`, box: [IN.x, (LANE.grpc + LANE.http) / 2, 0, IN.x + IN.w, IN.y + IN.d, IN_H + 8] },
  { id: "gauge", label: "Size limit", read: `${RECEIVE.maxBodyMB} MB per export, on both ports · bigger is refused`, box: [GAUGE_X - 6, LANE.grpc - 18, 0, GAUGE_X + 6, LANE.http + 18, TROUGH_Z + 22] },
  { id: "decoder", label: "Decoder", read: "HTTP body: protobuf, or JSON when Content-Type says json", box: [DEC_X - 6, LANE.http - HALF - 8, 0, DEC_X + 6, LANE.http + HALF + 8, KNOB_Z + 2] },
  { id: "file", label: "Import", read: `aftertrace import <dir> · ${RECEIVE.importFiles.join(", ")}`, box: [TRAY.x, TRAY.y, 0, LANES[2].x1, TRAY.y + TRAY.d, TRAY_Z + TRAY_H + 6] },
  { id: "unpack", label: "Unpacker", read: "resource › scope › record, flattened to one row each", box: [U.x, U.y, 0, U.x + U.w, U.y + U.d, U_H] },
  { id: "redact", label: "Redaction", read: "drops identity, and content unless --store-content · Fig 3", box: [COMB_X - 6, OUT_Y - 16, 0, COMB_X + 6, OUT_Y + 16, TROUGH_Z + 18] },
  { id: "rows", label: "Rows", read: MODEL.tables.join(" · "), box: [TX.x, TX.y, 0, TX.x + TX.w, TX.y + TX.d, TROUGH_Z + 9] },
  { id: "commit", label: "Commit", read: "one export, one transaction · all of its rows or none", box: [PLUNGER[0] - 6, PLUNGER[1] - 6, 0, PLUNGER[0] + 6, PLUNGER[1] + 6, TX_Z + 13] },
  { id: "store", label: "Store", read: "into the DuckDB file · Fig 4", box: [CAB.x, CAB.y, 0, CAB.x + CAB.w, CAB.y + CAB.d, CAB_H] },
]

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

// Floor windows where light pools: the three lanes, the out channel, the sorting channel, the bins.
const LANE_WINDOWS = LANES.map((l) => [l.x0, l.x1, l.y - HALF, l.y + HALF])
const ROW_WINDOWS = [
  [OUTRUN.x0, OUTRUN.x1 + 2, OUT_Y - HALF, OUT_Y + HALF],
  [CROSS.x + 2, CROSS.x + CROSS.w, CROSS.y + 2, CROSS.y + CROSS.d - 2],
  ...BINS.map((b) => [BIN_X + 2, BIN_X + BIN_W - 2, b.y + 2, b.y + b.d - 2]),
]

const DATA = {
  W,
  H,
  P,
  camera: glCamera(P),
  z: TROUGH_Z,
  orbZ: TROUGH_Z + 4,
  lanes: Object.fromEntries(LANES.map((l) => [l.id, [l.x0, l.x1, l.y]])),
  gaugeX: GAUGE_X,
  combX: COMB_X,
  knobX: KNOB[0],
  knob: [KNOB[0], KNOB[1], KNOB_Z, 4.2],
  detents: DETENTS,
  out: [OUTRUN.x0, CROSS_C, OUT_Y],
  crossX: CROSS_C,
  bins: BINS.map((b) => [b.y + b.d / 2, BIN_X + BIN_W - 12]),
  windows: { lanes: LANE_WINDOWS.flat(), rows: ROW_WINDOWS.flat() },
  hues: { model: [0.388, 0.349, 0.878], tool: [0.078, 0.6, 0.557], wait: [0.886, 0.604, 0.18], retry: [0.851, 0.325, 0.31] },
  stations: HIT,
  stationIds: STATIONS.map((s) => s.id),
  maxMB: RECEIVE.maxBodyMB,
}

const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA))
const CSS = readFileSync(join(HERE, "figure.css"), "utf8")
const stage = `<div class="fx-stage" tabindex="0" role="group" aria-label="How Aftertrace receives telemetry. Arrow keys move between parts; O sends an export over the size limit.">${backSvg}<canvas class="fx-layer fx-gl" data-layer="lanes" aria-hidden="true"></canvas>${layerSvg(mid)}<canvas class="fx-layer fx-gl" data-layer="rows" aria-hidden="true"></canvas>${layerSvg(front)}</div>`
const body = k.plateHtml({
  fig: "Fig 2",
  title: "Receiving",
  hint: "Point at a part · O · I",
  readout: STATIONS[0].read,
  keys: [
    { mark: "lit", label: "The part you point at (or step to with the arrow keys)" },
    { mark: "raised", label: "Light is one export: traces indigo, logs teal, metrics amber; red is refused" },
    { mark: "edge", label: `O sends an export over ${RECEIVE.maxBodyMB} MB down the HTTP lane; I runs aftertrace import` },
  ],
  caption: `Both receivers listen on ${RECEIVE.listen} unless you pass --listen: gRPC on ${MODEL.ports.grpc} and HTTP on ${MODEL.ports.http} (POST ${RECEIVE.httpPaths.join(", ")}). An export over ${RECEIVE.maxBodyMB} MB is refused before it is read. The HTTP body is protobuf, or JSON when the Content-Type says so; aftertrace import reads the same JSON from ${RECEIVE.importFiles.join(", ")}. Each export is flattened into one row per span, span event, log record or metric point, redacted on the way, and written to the ${MODEL.tables.length} tables in one transaction.`,
  body: stage,
})

mkdirSync(OUT, { recursive: true })
const file = join(OUT, theme === "dark" ? "receive-dark.html" : "receive.html")
writeFileSync(file, k.pageHtml({ title: "Receiving", theme, body: `<style>${CSS}</style>${body}`, script: kitScript() + glScript() + live, width: 820 }))
console.log("wrote", file)
