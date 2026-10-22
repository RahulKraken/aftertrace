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
  const post = () => window.parent.postMessage({ figure: "redaction", height: Math.ceil(page.getBoundingClientRect().height) }, "*");
  new ResizeObserver(post).observe(page);
}

// ── The three switches: two valves at the source, one shutter at Aftertrace ──
const state = { prompts: false, tools: true, content: false };
const NAMES = {
  prompts: (on) => (on ? "OTEL_LOG_USER_PROMPTS=1 · prompt text is sent" : "OTEL_LOG_USER_PROMPTS off · user_prompt arrives as <REDACTED>"),
  tools: (on) => (on ? "OTEL_LOG_TOOL_DETAILS=1 · commands and file paths are sent" : "OTEL_LOG_TOOL_DETAILS off · no commands or file paths"),
  content: (on) => (on ? "--store-content · content rides on to the store; identity still out" : "--store-content off · content falls out before the store"),
};
const shutterG = q('[data-part="shutter"]');
const knob = shutterG.querySelectorAll(".iso-solid")[1];
function apply() {
  for (const id of ["prompts", "tools"]) {
    q(`[data-part="valve-${id}"]`).setAttribute("data-state", state[id] ? "on" : "off");
    const l = q(`[data-part="lamp-${id}"]`);
    if (state[id]) l.setAttribute("data-on", ""); else l.removeAttribute("data-on");
  }
  if (state.content) knob.setAttribute("data-lit", ""); else knob.removeAttribute("data-lit");
}
let message = "", messageUntil = 0;
function toggle(id, to) {
  state[id] = to === undefined ? !state[id] : to;
  apply();
  message = NAMES[id](state[id]);
  messageUntil = performance.now() + 2800;
  flash(id === "content" ? "content" : id, 2800);
}

// ── Pointing: each part has a hull on screen; the readout says what it is ──
const inside = (pt, poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const hitAt = (e) => {
  const r = svg.getBoundingClientRect();
  const pt = [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H];
  let hit = null;
  for (const s of D.hit) if (inside(pt, s.hull)) hit = s.id;
  return hit;
};
let hover = null, spotUntil = 0;
function setSpot(id) {
  if (id) stage.setAttribute("data-focus", id); else stage.removeAttribute("data-focus");
}
function flash(id, ms) { setSpot(id); spotUntil = performance.now() + ms; }
const TOGGLES = { prompts: "prompts", tools: "tools", content: "content" };
let touring = true, idle = 0;
function pause() {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { touring = !still.matches; tourClock = 0; }, 8000);
}
stage.addEventListener("pointermove", (e) => {
  const hit = hitAt(e);
  stage.style.cursor = hit && TOGGLES[hit] ? "pointer" : "";
  if (hit !== hover) { hover = hit; setSpot(hit); }
  if (hit) pause();
});
stage.addEventListener("pointerleave", () => { hover = null; setSpot(null); });
stage.addEventListener("click", (e) => {
  const hit = hitAt(e);
  if (hit && TOGGLES[hit]) { pause(); toggle(TOGGLES[hit]); }
});
stage.addEventListener("keydown", (e) => {
  const ids = D.hoverIds;
  const i = ids.indexOf(hover);
  const key = e.key.toLowerCase();
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { hover = ids[(i + 1) % ids.length]; setSpot(hover); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { hover = ids[(i + ids.length - 1 + (i < 0 ? 1 : 0)) % ids.length]; setSpot(hover); }
  else if (key === "p") toggle("prompts");
  else if (key === "t") toggle("tools");
  else if (key === "c") toggle("content");
  else if ((e.key === "Enter" || e.key === " ") && hover && TOGGLES[hover]) toggle(TOGGLES[hover]);
  else if (e.key === "Escape") { hover = null; setSpot(null); }
  else return;
  e.preventDefault();
  pause();
});

// ── Tokens: one attribute key each, poured on the deck and sorted ──
const SPEED = 30; // world units a second along the deck
const POUR = 0.42, DROP = 0.38, FALL = 0.5;
const [X0, X1] = D.run;
const [S1, S2] = D.slots;
let tokens = [], born = 0, spawnAt = 0, follow = null, followNote = "", followUntil = 0;
const fills = { identity: 0, content: 0 };
const fillEl = { identity: q('[data-part="fill-identity"]'), content: q('[data-part="fill-content"]') };
const storeLamp = q('[data-part="lamp-store"]');
const blink = (el, ms = 320) => { if (!el) return; el.setAttribute("data-on", ""); setTimeout(() => el.removeAttribute("data-on"), ms); };
function fillBin(which) {
  fills[which] = Math.min(1, fills[which] + 0.125);
  fillEl[which].style.transform = `scaleX(${fills[which]})`;
  if (fills[which] >= 1) setTimeout(() => { fills[which] = 0; fillEl[which].style.transform = "scaleX(0)"; }, 900);
}
function spawn(now) {
  // Skip the keys the source does not send with its valves as they are.
  for (let tries = 0; tries < D.tokens.length; tries++) {
    const t = D.tokens[born++ % D.tokens.length];
    if (t.gate === "tools" && !state.tools) continue;
    const real = !t.placeholder || state.prompts;
    tokens.push({ ...t, t: now, real, fate: null, fateAt: 0, x: X0, z: D.spoutZ, a: 0 });
    return;
  }
}
const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
const orbZ = (s) => D.floor + 4.2 * s;
// Where a token is now. Its fate is decided where it meets each slot, by its class and the shutter.
function step(tk, now) {
  const age = (now - tk.t) / 1000;
  const zRest = orbZ(tk.size);
  const bright = tk.real ? 1 : 0.42;
  if (age < POUR) {
    const u = age / POUR;
    tk.x = X0 + u * 6;
    tk.z = D.spoutZ + (zRest - D.spoutZ) * ease(u);
    tk.a = Math.min(1, u * 2.5) * bright;
    return true;
  }
  if (!tk.fate) {
    const x = X0 + 6 + (age - POUR) * SPEED;
    if (tk.cls === "identity" && x >= S1) { tk.fate = "identity"; tk.fateAt = now; tk.x = S1; }
    else if (tk.cls === "content" && x >= S2 && !state.content) { tk.fate = "content"; tk.fateAt = now; tk.x = S2; }
    else if (x >= D.deck.x1) { tk.fate = "store"; tk.fateAt = now; tk.x = D.deck.x1; }
    else {
      if (x >= S2 && !tk.passed) { tk.passed = true; decide(tk, now); }
      tk.x = x; tk.z = zRest; tk.a = bright; return true;
    }
    if (tk.fate !== "store") decide(tk, now);
  }
  const u = (now - tk.fateAt) / 1000;
  if (tk.fate === "store") {
    if (u > FALL) { blink(storeLamp, 360); return false; }
    const v = u / FALL;
    tk.x = D.deck.x1 + (D.hopper - D.deck.x1) * ease(v);
    tk.z = zRest + (D.hopperZ - zRest) * v * v;
    tk.a = bright * (1 - Math.max(0, (v - 0.55) / 0.45));
    return true;
  }
  if (u > DROP) { fillBin(tk.fate); return false; }
  const v = u / DROP;
  tk.z = zRest - 7 * v * v;
  tk.a = bright * Math.max(0, 1 - v * 1.6);
  return true;
}
// The readout follows one token at a time from the spout to where it ends up.
function decide(tk, now) {
  if (tk !== follow) return;
  const name = tk.placeholder && !tk.real ? `${tk.key} = <REDACTED>` : tk.key;
  followNote =
    tk.fate === "identity" ? `${name} · identity · deleted, always`
    : tk.fate === "content" ? `${name} · content · deleted (no --store-content)`
    : tk.cls === "content" ? `${name} · content · kept (--store-content)`
    : tk.gate === "tools" ? `${name} · tool detail · kept`
    : `${name} · kept`;
  followUntil = now + 2400;
  tk.done = true;
}
function write(now) {
  let text;
  if (hover) text = D.hit.find((h) => h.id === hover).read;
  else if (now < messageUntil) text = message;
  else if (follow) text = followNote;
  else text = "";
  if (text && readout.textContent !== text) readout.textContent = text;
}

// ── The light: one WebGL layer in the figure's camera ──
const N = 16;
const FRAGMENT = `
uniform float uO[${N * 4}];
uniform float uH[${N}];
uniform float uLight;
uniform vec3 uC0, uC1, uC2, uC3;
uniform float uFloor;
uniform vec4 uDeck;
vec3 hueOf(float h){return h<.5?uC0:(h<1.5?uC1:(h<2.5?uC2:uC3));}
vec4 inkFor(vec3 seen,float cover){vec3 ab=1.-seen;float a=max(max(ab.r,max(ab.g,ab.b)),cover);return vec4(vec3(a)-ab,a);}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 r0=rayOf(vb);
  vec3 fl=onFloor(vb,uFloor);
  float px=pixelOf()/uCam.z;
  float onDeck=window(fl.y,uDeck.z,uDeck.w,.7*px)*window(fl.x,uDeck.x,uDeck.y,.7*px);
  vec3 emit=vec3(0.);
  vec4 ink=vec4(0.);
  for(int i=0;i<${N};i++){
    float a=uO[i*4+2];
    if(a<.002)continue;
    vec3 c=vec3(uO[i*4],0.,uO[i*4+1]);
    float s=uO[i*4+3];
    vec3 h=hueOf(uH[i]);
    vec3 w=c-r0;float t=dot(w,V);float d=length(c-(r0+t*V));
    // On paper a kept key is a small steel ball: tight, no halo. Coloured keys glow.
    float steel=uH[i]>2.5?uLight:0.;
    float core=exp(-pow(d/(2.2*s),2.));
    float body=exp(-pow(d/(mix(4.4,3.,steel)*s),2.));
    float halo=exp(-pow(d/(9.*s),2.))*.28*(1.-steel);
    vec2 off=(fl.xy-c.xy)*vec2(.7,1.);
    float above=smoothstep(uFloor-.5,uFloor+1.5,c.z);
    float pool=exp(-dot(off,off)/(40.*s))*onDeck*.5*above;
    emit+=h*(body*1.1+halo+pool)*a+vec3(1.)*core*.85*a;
    vec3 seenPool=mix(vec3(1.),mix(vec3(1.),h,.5),pool*a*1.4);
    vec3 seenBody=mix(vec3(1.),h,clamp((body*1.05+halo)*a,0.,1.));
    // A kept key reads as a steel ball on paper (a dark core); the coloured keys glow pale at the core.
    vec3 coreTone=steel>.5?mix(h,vec3(1.),.45):mix(h,vec3(1.),.7);
    seenBody=mix(seenBody,coreTone,clamp(core*a,0.,1.));
    vec4 o=over(inkFor(seenBody,core*a*.85),inkFor(seenPool,0.));
    if(steel>.5){
      // A crisp ball, lit from the kit's key light, with a soft contact shadow on the deck.
      float R=3.1*s;
      float edge=1.-smoothstep(R-.8*px*uCam.z,R+.8*px*uCam.z,d);
      vec3 p0=r0+t*V;
      vec3 nrm=normalize((p0-c)+V*sqrt(max(R*R-d*d,0.)));
      float lam=clamp(dot(nrm,lightDir()),0.,1.);
      float spec=pow(clamp(dot(reflect(-lightDir(),nrm),V),0.,1.),18.);
      vec3 ball=mix(h*.62,vec3(.93),lam*.7)+spec*.35;
      float shadow=exp(-dot(off,off)/(14.*s))*onDeck*.22*above;
      o=over(inkFor(mix(vec3(1.),min(ball,vec3(1.)),edge*a),edge*a),inkFor(vec3(1.-shadow*a),0.));
    }
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
const C = LIGHT ? D.hues.light : D.hues.dark;
const layer = glLayer({
  canvas: q(".fx-gl"),
  fragment: FRAGMENT,
  view: [D.W, D.H],
  camera: D.camera,
  uniforms: ["uO", "uH"],
  fixed: { uLight: LIGHT, uC0: C[0], uC1: C[1], uC2: C[2], uC3: C[3], uFloor: D.floor, uDeck: [D.deck.x0, D.deck.x1, D.deck.y0, D.deck.y1] },
});
if (layer) stage.setAttribute("data-gl", "");
const orbs = new Float32Array(N * 4);
const hues = new Float32Array(N);

// ── Idle, a tour walks the switches through the settings that matter ──
const TOUR = [
  { tools: true, prompts: false, content: false },
  { tools: true, prompts: true, content: false },
  { tools: true, prompts: true, content: true },
  { tools: false, prompts: false, content: false },
];
let tourAt = 0, tourClock = 0;

// ── The loop ──
const shutterAt = { v: 1 }; // 1 = parked downstream (slot open), 0 = over the slot
let frame = 0, last = 0, clock = 0, visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (!calm && now >= spawnAt) { spawn(now); spawnAt = now + 980; }
  if (!follow || (follow.done && now > followUntil)) {
    follow = null;
    follow = tokens.find((t) => !t.fate && (now - t.t) / 1000 < 1.2) || null;
    if (follow) followNote = `${follow.placeholder && !follow.real ? follow.key + " = <REDACTED>" : follow.key} · on the deck`;
  }
  orbs.fill(0);
  let n = 0;
  if (!calm) tokens = tokens.filter((tk) => step(tk, now));
  for (const tk of tokens) {
    if (n < N && tk.a > 0.002) { orbs.set([tk.x, tk.z, tk.a, tk.size], n * 4); hues[n] = tk.hue; n++; }
  }
  // The shutter slides over the slot, or back to where it rests.
  const want = state.content ? 0 : 1;
  shutterAt.v = calm ? want : shutterAt.v + (want - shutterAt.v) * (1 - Math.exp(-dt / 0.18));
  shutterG.setAttribute("transform", translateAlong(P, [D.shutterPark * shutterAt.v, 0, 0]));
  if (spotUntil && now > spotUntil && !hover) { spotUntil = 0; setSpot(null); }
  if (touring && !calm) {
    tourClock += dt;
    if (tourClock > 7.5) {
      tourClock = 0;
      tourAt = (tourAt + 1) % TOUR.length;
      const next = TOUR[tourAt];
      const changed = Object.keys(next).filter((id) => next[id] !== state[id]);
      changed.forEach((id) => (state[id] = next[id]));
      apply();
      if (changed.length) {
        const id = changed[changed.length - 1];
        message = NAMES[id](state[id]);
        messageUntil = now + 2800;
        flash(id, 2800);
      }
    }
  }
  write(now);
  if (layer) layer.draw({ uO: orbs, uH: hues }, calm ? 0.8 : clock);
  frame = visible && !calm ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
apply();
if (still.matches) {
  touring = false;
  // A still frame that tells the story: tokens along the deck, one sinking at each slot.
  const tz = (s) => D.floor + 4.2 * s;
  const pick = (key) => D.tokens.find((t) => t.key === key);
  const at = (key, x, z, a) => { const t = pick(key); return { ...t, x, z: z ?? tz(t.size), a: a ?? 1, fate: "still", real: !t.placeholder }; };
  tokens = [
    at("user.email", D.run[0] + 18),
    at("model", D.run[0] + 44),
    at("user.account_uuid", D.slots[0], tz(0.62) - 3, 0.5),
    at("full_command", D.slots[0] + 30),
    at("user_prompt", D.slots[1], tz(0.82) - 3, 0.25),
    at("cost_usd", D.slots[1] + 46),
    at("duration_ms", D.slots[1] + 82),
  ];
  follow = null;
  readout.textContent = "Identity always out · content out unless --store-content";
  [...stage.querySelectorAll(".fig-fill")].forEach((f) => (f.style.transform = "scaleX(0.5)"));
}
