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
  const post = () => window.parent.postMessage({ figure: "store", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(document.body);
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
const byId = Object.fromEntries(D.stations.map((s) => [s.id, s]));
const count = { spans: 1240, span_events: 312, events: 3118, metric_points: 862 };
const fmt = (n) => n.toLocaleString("en-US");
let focus = null, tour = 0, touring = true, idle = 0, note = "";
const spots = [...stage.querySelectorAll(".fig-spot")];
const glass = [...stage.querySelectorAll(".fig-glass[data-view]")];
const glows = [...stage.querySelectorAll(".fig-glow")];
function setFocus(id) {
  if (focus === id) return;
  focus = id;
  note = "";
  if (id) stage.setAttribute("data-focus", id); else stage.removeAttribute("data-focus");
  for (const s of spots) s.toggleAttribute("data-on", s.dataset.spot === id);
  for (const g of glass) g.toggleAttribute("data-on", g.dataset.view === id);
  // A drawer coming out is nearer than the closed ones, so it is painted last.
  const t = D.tables.findIndex((x) => x.name === id);
  if (t >= 0) { const slot = q(`[data-part="drawer-slot-${t}"]`); slot.parentNode.appendChild(slot); }
  // A view lights the tables it reads.
  const v = D.views.find((x) => x.name === id);
  for (const g of glows) g.toggleAttribute("data-on", Boolean(v && v.reads.includes(g.dataset.glow)));
  write();
}
function write() {
  const s = byId[focus];
  let text = "";
  if (note) text = note;
  else if (s && s.table !== undefined) text = `${s.label} · ${fmt(count[s.label])} rows · ${s.read}`;
  else if (s) text = `${s.label} · ${s.read}`;
  if (readout.textContent !== text) readout.textContent = text;
}
function pause() {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; }, 6000);
}
const hitAt = (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  // Later parts in this order sit on top of earlier ones, so the last hit wins.
  let hit = null;
  for (const id of D.order) if (inside(pt, byId[id].hull)) hit = id;
  return hit;
};
stage.addEventListener("pointermove", (e) => {
  const hit = hitAt(e);
  if (hit) { pause(); setFocus(hit); }
});
stage.addEventListener("pointerleave", () => pause());
stage.addEventListener("click", (e) => { const hit = hitAt(e); if (hit) { pause(); setFocus(hit); } });
stage.addEventListener("keydown", (e) => {
  const ids = D.tour;
  const i = Math.max(0, ids.indexOf(focus));
  if (e.key === "ArrowRight" || e.key === "ArrowDown") setFocus(ids[(i + 1) % ids.length]);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setFocus(ids[(i + ids.length - 1) % ids.length]);
  else if (e.key === "r" || e.key === "R") resend();
  else return;
  e.preventDefault();
  pause();
});

// ── Batches: run the trough, wait at the gate, ride the lift, get filed ──
// kind 0 = traces (spans and span events), 1 = logs (events), 2 = metrics (metric points)
const ADDS = [{ spans: 6, span_events: 2 }, { events: 4 }, { metric_points: 3 }];
const DRAWER_OF = [0, 2, 3];
const SPEED = 46;
const SLOT = 9; // spacing of waiting batches in the queue
let batches = [], born = 0, spawnAt = 0;
function spawn(kind, dup = false) {
  batches.push({ kind, dup, x: D.trough.x0 + 4, a: 0, phase: "run" });
  born++;
}
function resend() {
  // The last batch of each kind, sent again: the same span ids, the same log records.
  [0, 1, 2].forEach((kind, n) => setTimeout(() => spawn(kind, true), n * 260));
  pause();
  setFocus("writer");
  note = "One writer · the last batches, sent again";
  write();
}
const blink = (el, ms = 360) => { if (!el) return; el.setAttribute("data-on", ""); setTimeout(() => el.removeAttribute("data-on"), ms); };
// A filed batch washes its drawer front for a moment (a view's own light stays on).
const flash = (el) => { if (!el) return; el.setAttribute("data-flash", ""); setTimeout(() => el.removeAttribute("data-flash"), 560); };
const lampOf = (name) => q(`[data-lamp="${name}"]`);
function file(b) {
  const adds = ADDS[b.kind];
  const lines = [];
  for (const [name, n] of Object.entries(adds)) {
    const t = D.tables.find((x) => x.name === name);
    blink(lampOf(name));
    flash(q(`[data-glow="${name}"]`));
    if (b.dup && t.keyed) lines.push(`${name} · ${n} sent again, same key: replaced · still ${fmt(count[name])} rows`);
    else {
      count[name] += n;
      if (b.dup) lines.push(`${name} · ${n} sent again, no key: stored twice · ${fmt(count[name])} rows`);
    }
  }
  blink(lampOf("wal"));
  if (b.dup) {
    pause();
    setFocus(D.tables[DRAWER_OF[b.kind]].name);
    note = lines[0];
  }
  write();
}

// The lift: one car. It takes the first waiting batch, carries it up to its
// drawer, files it, and comes back down for the next.
const car = { z: 0, phase: "idle", t: 0, from: 0, to: 0, batch: null };
const gate = { open: 0 };
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
function stepLift(dt) {
  // Only the batch at the front of the queue boards, once it has reached the gate.
  const head = batches.find((b) => b.phase === "run" || b.phase === "wait");
  if (car.phase === "idle" && head && head.phase === "wait") {
    car.phase = "load"; car.t = 0; car.batch = head; head.phase = "board";
    keyPart.setAttribute("data-state", "on");
  }
  if (car.phase === "idle") return;
  car.t += dt;
  const b = car.batch;
  if (car.phase === "load") {
    const u = Math.min(1, car.t / 0.4);
    b.x = D.trough.gate - 4 + (D.car.x - (D.trough.gate - 4)) * ease(u);
    if (u >= 1) { car.phase = "up"; car.t = 0; car.from = 0; car.to = D.car.stops[DRAWER_OF[b.kind]]; b.phase = "ride"; }
  } else if (car.phase === "up" || car.phase === "down") {
    const dur = 0.25 + Math.abs(car.to - car.from) / 200;
    const u = Math.min(1, car.t / dur);
    car.z = car.from + (car.to - car.from) * ease(u);
    if (u >= 1) {
      if (car.phase === "up") { car.phase = "drop"; car.t = 0; file(b); }
      else { car.phase = "idle"; car.batch = null; }
    }
  } else if (car.phase === "drop") {
    b.a = Math.max(0, 1 - car.t / 0.35);
    if (car.t >= 0.35) {
      b.phase = "done";
      keyPart.setAttribute("data-state", "off");
      car.phase = "down"; car.t = 0; car.from = car.z; car.to = 0;
    }
  }
}
function stepBatches(dt) {
  // Waiting batches line up behind the gate, nearest first.
  let slot = 0;
  for (const b of batches) {
    if (b.phase === "run" || b.phase === "wait") {
      const stop = D.trough.gate - 4 - slot * SLOT;
      slot++;
      b.x = Math.min(stop, b.x + SPEED * dt);
      b.a = Math.min(1, b.a + dt / 0.35);
      b.phase = b.x >= stop - 0.01 ? "wait" : "run";
    }
  }
  batches = batches.filter((b) => b.phase !== "done");
}

// ── The light: a WebGL layer in the figure's own camera ──
const N = 16;
const FRAGMENT = `
uniform float uO[${N * 8}];
uniform float uLight;
uniform vec3 uHM, uHT, uHW;
uniform vec4 uTr;
vec3 hueOf(float h){return h<.5?uHM:(h<1.5?uHT:(h<2.5?uHW:vec3(1.,.97,.9)));}
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uTr.x);
  float px=pixelOf()/uCam.z;
  float inTrough=window(fl.y,uTr.y-uTr.z,uTr.y+uTr.z,.7*px)*window(fl.x,uTr.w,${D.car.x.toFixed(1)}+8.,.7*px);
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*8+4];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*8],uO[i*8+1],uO[i*8+2]);
    float s=uO[i*8+5];
    float pool=uO[i*8+6];
    vec3 h=hueOf(uO[i*8+3]);
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    float core=exp(-pow(d/(2.1*s),2.))*(1.-.75*step(.5,uO[i*8+7]));
    float body=exp(-pow(d/(4.6*s),2.));
    float halo=exp(-pow(d/(10.*s),2.))*.32;
    vec2 off=(fl.xy-c.xy)*vec2(.55,1.);
    float pl=exp(-dot(off,off)/90.)*inTrough*.55*pool;
    emit+=h*(body*1.1+halo+pl)*a+vec3(1.)*core*.9*a;
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),pl*a*1.4);
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
const layer = glLayer({
  canvas: q(".fx-gl"),
  fragment: FRAGMENT,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: ["uO"],
  fixed: { uLight: LIGHT, uHM: D.hues.model, uHT: D.hues.tool, uHW: D.hues.wait, uTr: [D.trough.z, D.trough.y, D.trough.half, D.trough.x0] },
});
if (layer) stage.setAttribute("data-gl", "");
const orbs = new Float32Array(N * 8);

// ── Parts that move ──
const keyPart = q('[data-part="key"]');
const gatePart = q('[data-part="gate"]');
const cable = q('[data-part="cable"]');
const carParts = [q('[data-part="car-back"]'), q('[data-part="car-front"]')];
const drawers = D.tables.map((_, i) => q(`[data-part="drawer-${i}"]`));
const insides = D.tables.map((_, i) => q(`[data-part="drawer-in-${i}"]`));
const colcards = D.tables.map((_, i) => q(`[data-part="colcard-${i}"]`));
const clipsOf = D.tables.map((_, i) => q(`[data-clip="${i}"]`));
const cardsOf = D.tables.map((_, i) => [...q(`[data-part="drawer-in-${i}"]`).querySelectorAll("[data-card-y]")]);
const frames = D.views.map((_, n) => q(`[data-part="frame-${n}"]`));
function exposed(b, open) {
  const pts = [];
  // At the cabinet face only the drawer's own height; out in front, room for the card standing up.
  for (const x of [b.x0, b.x1]) for (const [y, top] of [[b.y0, b.z1], [b.y0 + open, b.z1 + (b.extra * open) / D.open]]) for (const z of [b.z0, top]) pts.push(iso([x, y, z], P));
  pts.sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const cross = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return open < 0.05 ? "M0 0Z" : "M" + h.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}
const follow = (cur, want, dt, s, calm) => (calm ? want : cur + (want - cur) * (1 - Math.exp(-dt / s)));
const state = { open: D.tables.map(() => 0), rise: D.tables.map(() => 0), lift: D.views.map(() => 0) };

// ── The loop ──
let frame = 0, last = 0, clock = 0, visible = false, tourClock = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  // Sources send a batch every couple of seconds; when four are already waiting, the next one holds back.
  if (!calm && now >= spawnAt) {
    if (batches.filter((b) => b.phase === "run" || b.phase === "wait").length < 4) spawn([0, 1, 0, 2, 0, 1][born % 6]);
    spawnAt = now + 2300;
  }
  if (!calm) { stepBatches(dt); stepLift(dt); }

  // The car, its cable, the gate.
  const lift = translateAlong(P, [0, 0, car.z]);
  carParts.forEach((p) => p.setAttribute("transform", lift));
  const top = iso([D.car.x, D.car.y, D.car.dock + D.car.h + 4 + car.z], P);
  const pul = iso([D.car.pulley[0], D.car.pulley[1], D.car.pulley[2] - 1], P);
  cable.setAttribute("d", `M${pul[0].toFixed(1)} ${pul[1].toFixed(1)}L${top[0].toFixed(1)} ${top[1].toFixed(1)}`);
  gate.open = follow(gate.open, car.phase === "load" ? 12 : 0, dt, 0.12, calm);
  gatePart.setAttribute("transform", translateAlong(P, [0, 0, gate.open]));

  // Drawers: the one in focus opens and stands its column card up.
  D.tables.forEach((t, i) => {
    const want = focus === t.name ? D.open : 0;
    const o = (state.open[i] = follow(state.open[i], want, dt, 0.24, calm));
    const tr = translateAlong(P, [0, o, 0]);
    drawers[i].setAttribute("transform", tr);
    insides[i].setAttribute("transform", tr);
    clipsOf[i].setAttribute("d", exposed(D.drawerBox[i], o));
    for (const c of cardsOf[i]) c.style.display = Number(c.dataset.cardY) + o < D.face + 0.5 ? "none" : "";
    const r = (state.rise[i] = follow(state.rise[i], focus === t.name && o > D.open * 0.7 ? 10 : 0, dt, 0.2, calm));
    colcards[i].setAttribute("transform", translateAlong(P, [0, 0, r]));
  });
  // Frames: the view in focus rises out of the rack.
  D.views.forEach((v, n) => {
    const l = (state.lift[n] = follow(state.lift[n], focus === v.name ? D.liftUp : 0, dt, 0.24, calm));
    frames[n].setAttribute("transform", translateAlong(P, [0, 0, l]));
  });

  // Light: batches in the trough and in the lift car.
  orbs.fill(0);
  let n = 0;
  const put = (x, y, z, hue, a, size, pool, soft) => { if (n < N && a > 0.002) { orbs.set([x, y, z, hue, a, size, pool, soft], n * 8); n++; } };
  for (const b of batches) {
    if (b.phase === "ride") put(D.car.x, D.car.y, D.trough.z + 4 + car.z, b.kind, b.a, 1, 0, 0);
    else put(b.x, b.phase === "board" ? D.trough.y + (D.car.y - D.trough.y) * Math.min(1, car.t / 0.4) : D.trough.y, D.trough.z + 4, b.kind, b.a, 1, 1, 0);
  }

  if (touring) {
    tourClock += dt;
    if (tourClock > 3.4) { tourClock = 0; tour = (tour + 1) % D.tour.length; setFocus(D.tour[tour]); }
  }
  if (layer) layer.draw({ uO: orbs }, calm ? 0.8 : clock);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) {
  touring = false;
  // A still frame that still tells the story: two batches waiting, one in the car.
  batches = [{ kind: 1, x: D.trough.gate - 4 - SLOT, a: 1, phase: "wait" }, { kind: 2, x: D.trough.gate - 4 - 2 * SLOT, a: 1, phase: "wait" }];
  const b = { kind: 0, x: D.car.x, a: 1, phase: "ride" };
  batches.unshift(b);
  car.batch = b; car.phase = "up"; car.z = D.car.stops[0] * 0.55; car.to = car.z; car.from = car.z; car.t = 99;
  keyPart.setAttribute("data-state", "on");
}
setFocus(D.tour[0]);
