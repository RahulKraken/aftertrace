const D = __DATA__;
const P = D.P;
const stage = document.querySelector(".fx-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LIGHT = document.body.dataset.theme === "light" ? 1 : 0;
const q = (sel) => stage.querySelector(sel);

// Inside a docs page the figure drops its own page margins and tells the
// page how tall it is, so the frame fits it exactly.
if (window.parent !== window) {
  document.documentElement.dataset.embed = "";
  const page = document.body;
  const post = () => window.parent.postMessage({ figure: "receive", height: Math.ceil(page.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(page);
}

// ── Parts: point at one to read it; idle, a tour walks them in order ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const spots = Object.fromEntries([...stage.querySelectorAll("[data-spot]")].map((el) => [el.dataset.spot, el]));
let focus = null, tour = 0, touring = true, idle = 0, note = "", noteUntil = 0;
function setFocus(id) {
  if (focus === id) return;
  if (spots[focus]) spots[focus].removeAttribute("data-lit");
  focus = id;
  if (spots[id]) spots[id].setAttribute("data-lit", "");
  if (id === "file") importFiles();
  write();
}
function write() {
  const s = D.stations.find((x) => x.id === focus);
  const text = clockMs < noteUntil ? note : s ? `${s.label} · ${s.read}` : "";
  if (readout.textContent !== text) readout.textContent = text;
}
function say(text, ms = 2600) { note = text; noteUntil = clockMs + ms; write(); }
function pause() {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; }, 5000);
}
stage.addEventListener("pointermove", (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  let hit = null;
  for (const s of D.stations) if (inside(pt, s.hull)) hit = s.id;
  if (hit) { pause(); setFocus(hit); }
});
stage.addEventListener("pointerleave", () => pause());
stage.addEventListener("click", () => {
  if (focus === "gauge") oversize();
  else if (focus === "file") importFiles(true);
});
stage.addEventListener("keydown", (e) => {
  const ids = D.stationIds;
  const i = Math.max(0, ids.indexOf(focus));
  if (e.key === "ArrowRight" || e.key === "ArrowDown") setFocus(ids[(i + 1) % ids.length]);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setFocus(ids[(i + ids.length - 1) % ids.length]);
  else if (e.key === "o" || e.key === "O") oversize();
  else if (e.key === "i" || e.key === "I") importFiles(true);
  else return;
  e.preventDefault();
  pause();
});

// ── Exports: born at a source, run a lane, are unpacked into rows, rows are filed, the export commits ──
const SPEED = 40; // world units a second along a lane
const ROW_SPEED = 46;
const UNPACK = 0.55; // seconds inside the unpacker
const HUE = { model: 0, tool: 1, wait: 2, retry: 3 };
const KIND_HUE = [HUE.model, HUE.tool, HUE.wait]; // traces, logs, metrics
// What one export becomes: traces fill spans and span events, logs fill events, metrics fill metric points.
const ROWS_OF = [[0, 0, 0, 1], [2, 2], [3, 3]];
const lampOf = (sel) => q(`[data-part="${sel}"]`);
const srcLamps = [0, 1, 2].map((i) => lampOf(`src-${i}`));
const rxLamps = { grpc: lampOf("rx-grpc"), http: lampOf("rx-http") };
const gaugeLamps = [lampOf("gauge-0"), lampOf("gauge-1")];
const binLamps = D.bins.map((_, i) => lampOf(`binlamp-${i}`));
const drawerLamps = D.bins.map((_, i) => lampOf(`drawer-${i}`));
const unpackLamp = lampOf("unpack"), combLamp = lampOf("comb"), commitLamp = lampOf("commit"), fileLamp = lampOf("file-lamp");
const cap = q('[data-part="plunger-cap"]');
const pointerPath = q('[data-part="pointer"] path');
const blink = (el, ms = 320) => { if (!el) return; el.setAttribute("data-on", ""); setTimeout(() => el.removeAttribute("data-on"), ms); };
const recolour = (el, hue) => { if (el) el.setAttribute("data-hue", hue); };

// The schedule: Claude Code over gRPC, the SDK over HTTP protobuf, an app over HTTP JSON.
const PLAN = [
  { src: 0, lane: "grpc", kind: 0 },
  { src: 1, lane: "http", kind: 0, ctype: "protobuf" },
  { src: 2, lane: "http", kind: 1, ctype: "json" },
  { src: 0, lane: "grpc", kind: 2 },
  { src: 1, lane: "http", kind: 1, ctype: "protobuf" },
  { src: 0, lane: "grpc", kind: 0 },
  { src: 2, lane: "http", kind: 2, ctype: "json" },
  { src: 0, lane: "grpc", kind: 1 },
];
let clockMs = 0, born = 0, spawnAt = 0, exportsIn = [];
function spawn(spec) {
  const b = { ...spec, t: clockMs, rows: null, done: false, flags: {} };
  exportsIn.push(b);
  if (spec.src != null) { recolour(srcLamps[spec.src], ["model", "tool", "wait"][spec.kind]); blink(srcLamps[spec.src]); }
  if (rxLamps[spec.lane]) { recolour(rxLamps[spec.lane], spec.over ? "retry" : ["model", "tool", "wait"][spec.kind]); blink(rxLamps[spec.lane]); }
  return b;
}
function oversize() {
  if (exportsIn.some((b) => b.over)) return;
  spawn({ src: 2, lane: "http", kind: 0, over: true });
  setFocus("gauge");
}
function importFiles(force) {
  if (still.matches || (!force && exportsIn.some((b) => b.lane === "file"))) return;
  [0, 1, 2].forEach((kind, i) => setTimeout(() => { spawn({ lane: "file", kind }); blink(fileLamp, 260); }, i * 520));
}

const fade = (u, len, edge = 0.18) => Math.max(0, Math.min(1, u / edge, (len - u) / edge));
// Where an export's light is on its lane.
function onLane(b, age) {
  const [x0, x1, y] = D.lanes[b.lane];
  if (b.over) {
    const stopAt = D.gaugeX - 7;
    const runFor = (stopAt - x0) / SPEED;
    if (age < runFor) return { x: x0 + age * SPEED, y, a: fade(age, 99), s: 1.6 };
    const held = age - runFor;
    if (!b.flags.refused) { b.flags.refused = true; blink(gaugeLamps[1], 1200); say(`HTTP 400 · body over ${D.maxMB} MB · nothing is stored`); }
    if (held < 1.3) return { x: stopAt, y, a: (0.75 + 0.25 * Math.cos(held * 9)) * Math.min(1, (1.3 - held) / 0.45), s: 1.6 };
    return null;
  }
  const len = (x1 - x0) / SPEED;
  if (age < len) return { x: x0 + age * SPEED, y, a: fade(age, len), s: 1.1 };
  return null;
}
// Where one row is, from the unpacker to its bin.
function onRow(table, u) {
  const [ox0, ox1, oy] = D.out;
  const [by, bx] = D.bins[table];
  const l1 = (ox1 - ox0) / ROW_SPEED, l2 = Math.abs(by - oy) / ROW_SPEED, l3 = (bx - ox1) / ROW_SPEED;
  const total = l1 + l2 + l3;
  if (u < 0 || u > total) return null;
  const a = Math.min(1, u / 0.15, (total - u) / 0.28);
  if (u < l1) return { x: ox0 + u * ROW_SPEED, y: oy, a, s: 0.62 };
  if (u < l1 + l2) return { x: ox1, y: oy + Math.sign(by - oy) * (u - l1) * ROW_SPEED, a, s: 0.62 };
  return { x: ox1 + (u - l1 - l2) * ROW_SPEED, y: by, a, s: 0.62 };
}
const rowTotal = (table) => {
  const [ox0, ox1, oy] = D.out;
  const [by, bx] = D.bins[table];
  return (ox1 - ox0 + Math.abs(by - oy) + bx - ox1) / ROW_SPEED;
};

// ── The light: two WebGL layers in the figure's own camera, one for exports on
// the lanes (behind the unpacker) and one for rows (in front of it) ──
const N = 16;
const fragment = (NW) => `
uniform float uO[${N * 6}];
uniform vec4 uWin[${NW}];
uniform float uLight;
uniform vec3 uHM, uHT, uHW, uHR;
uniform vec2 uZ;
vec3 hueOf(float h){return h<.5?uHM:(h<1.5?uHT:(h<2.5?uHW:uHR));}
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uZ.y);
  float px=pixelOf()/uCam.z;
  float inChan=0.;
  for(int w=0;w<${NW};w++){vec4 b=uWin[w];inChan=max(inChan,window(fl.x,b.x,b.y,.7*px)*window(fl.y,b.z,b.w,.7*px));}
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*6+4];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*6],uO[i*6+1],uO[i*6+2]);
    float s=uO[i*6+5];
    vec3 h=hueOf(uO[i*6+3]);
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    float core=exp(-pow(d/(2.1*s),2.));
    float body=exp(-pow(d/(4.6*s),2.));
    float halo=exp(-pow(d/(10.*s),2.))*.32;
    vec2 off=(fl.xy-c.xy);
    float pool=exp(-dot(off,off)/(90.*s*s))*inChan*.55;
    emit+=h*(body*1.1+halo+pool)*a+vec3(1.)*core*.9*a;
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),pool*a*1.4);
    vec3 seenBody=mix(vec3(1.),h,clamp((body*1.05+halo)*a,0.,1.));
    seenBody=mix(seenBody,mix(h,vec3(1.),.72),clamp(core*a,0.,1.));
    vec4 o=over(inkFor(seenBody,core*a*.85),inkFor(seenPool,0.));
    ink=over(o,ink);
  }
  vec3 col=tonemap(emit,1.25);
  float m=max(col.r,max(col.g,col.b));
  vec4 outc=mix(vec4(col,m),ink,uLight);
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  outc=max(outc+n*smoothstep(0.,1.5/255.,outc.a),0.);
  outc.rgb=min(outc.rgb,vec3(outc.a));
  gl_FragColor=outc;
}`;
const lightLayer = (name) => {
  const win = D.windows[name];
  return glLayer({
    canvas: q(`.fx-gl[data-layer="${name}"]`),
    fragment: fragment(win.length / 4),
    view: [D.W, D.H],
    camera: D.camera,
    uniforms: ["uO"],
    fixed: { uLight: LIGHT, uHM: D.hues.model, uHT: D.hues.tool, uHW: D.hues.wait, uHR: D.hues.retry, uZ: [D.orbZ, D.z], uWin: win },
  });
};
const layers = { lanes: lightLayer("lanes"), rows: lightLayer("rows") };
if (layers.lanes && layers.rows) stage.setAttribute("data-gl", "");
const orbs = { lanes: new Float32Array(N * 6), rows: new Float32Array(N * 6) };

// ── The Content-Type knob: turns to protobuf (back) or JSON (front) as an HTTP export reaches it ──
let knobAngle = D.detents[0], knobWant = D.detents[0];
function drawPointer() {
  const [cx, cy, z, r] = D.knob;
  const a = iso([cx, cy, z], P), b = iso([cx + Math.cos(knobAngle) * r, cy + Math.sin(knobAngle) * r, z], P);
  pointerPath.setAttribute("d", `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`);
}

// ── The loop ──
let frame = 0, last = 0, visible = false, tourClock = 0, glClock = 0, capDip = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (!calm) { clockMs += dt * 1000; glClock += dt; }
  if (!calm && clockMs >= spawnAt) {
    // While a refused export sits at the gauge, the HTTP lane waits behind it.
    const next = PLAN[born % PLAN.length];
    if (!(next.lane === "http" && exportsIn.some((b) => b.over))) { spawn(next); born++; }
    spawnAt = clockMs + 1050;
  }
  orbs.lanes.fill(0);
  orbs.rows.fill(0);
  const used = { lanes: 0, rows: 0 };
  const put = (o, hue, into) => { if (o && used[into] < N && o.a > 0.002) { orbs[into].set([o.x, o.y, D.orbZ, hue, o.a, o.s], used[into] * 6); used[into]++; } };
  exportsIn = exportsIn.filter((b) => {
    const age = (clockMs - b.t) / 1000;
    const hue = b.over ? HUE.retry : KIND_HUE[b.kind];
    const lane = onLane(b, age);
    if (lane) {
      put(lane, hue, "lanes");
      if (b.lane === "http" && !b.over && !b.flags.read && lane.x > D.knobX - 12) { b.flags.read = true; knobWant = b.ctype === "json" ? D.detents[1] : D.detents[0]; }
      if (b.lane !== "file" && !b.over && !b.flags.gauged && lane.x > D.gaugeX) { b.flags.gauged = true; }
      return true;
    }
    if (b.over) return false;
    const [x0, x1] = D.lanes[b.lane];
    const after = age - (x1 - x0) / SPEED;
    if (after < UNPACK) { if (!b.flags.unpacked) { b.flags.unpacked = true; recolour(unpackLamp, ["model", "tool", "wait"][b.kind]); blink(unpackLamp, UNPACK * 1000); } return true; }
    // Rows leave one after another, each to its own bin.
    const rows = ROWS_OF[b.kind];
    let alive = false;
    rows.forEach((table, r) => {
      const u = after - UNPACK - r * 0.2;
      const o = onRow(table, u);
      if (o) { alive = true; put(o, hue, "rows"); if (!b.flags["c" + r] && o.x > D.combX) { b.flags["c" + r] = true; blink(combLamp, 200); } }
      else if (u < 0) alive = true;
      else if (!b.flags["f" + r]) { b.flags["f" + r] = true; blink(binLamps[table], 360); }
    });
    if (alive) return true;
    // Every row of this export is in its bin: one transaction writes them all.
    blink(commitLamp, 420);
    capDip = 1;
    new Set(rows).forEach((t) => blink(drawerLamps[t], 520));
    return false;
  });
  // The knob eases to its detent; the plunger dips and rises.
  knobAngle += (knobWant - knobAngle) * (calm ? 1 : 1 - Math.exp(-dt / 0.12));
  drawPointer();
  capDip = calm ? 0 : Math.max(0, capDip - dt * 3.2);
  cap.setAttribute("transform", translateAlong(P, [0, 0, -2.4 * Math.sin(Math.min(1, capDip) * Math.PI)]));
  if (touring) {
    tourClock += dt;
    if (tourClock > 3.2) { tourClock = 0; tour = (tour + 1) % D.stationIds.length; setFocus(D.stationIds[tour]); }
  }
  write();
  for (const name of ["lanes", "rows"]) if (layers[name]) layers[name].draw({ uO: orbs[name] }, calm ? 0.8 : glClock);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) {
  touring = false;
  // A still frame that still tells the story: an export on each network lane, and rows on their way to the bins.
  clockMs = 10000;
  exportsIn = [
    { src: 0, lane: "grpc", kind: 0, t: clockMs - 1600, flags: {} },
    { src: 1, lane: "http", kind: 2, ctype: "protobuf", t: clockMs - 900, flags: {} },
    { src: 2, lane: "http", kind: 0, ctype: "json", t: clockMs - 4300, flags: {} },
  ];
}
drawPointer();
setFocus(D.stationIds[0]);
