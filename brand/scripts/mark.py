"""Aftertrace mark: geometry, squircle and SVG builders. All art is built here."""
import math
INK='#1F1D1A'; CREAM='#EFEAE2'; AMBER='#E29A2E'
EDGE_LIGHT='#D6CEC1'; EDGE_DARK='#3A3631'; CREAM_STROKE='#EFEAE2'

def squircle(x, y, w, h, r, xi=0.6):
    """Continuous-corner rounded rect (Figma-style corner smoothing; xi=0.6 ~ Apple icon shape)."""
    p=min((1+xi)*r, min(w,h)/2)
    arc=90*(1-xi); s=math.sin(math.radians(arc/2))*r*math.sqrt(2)
    alpha=(90-arc)/2; p34=r*math.tan(math.radians(alpha/2))
    beta=45*xi; c=p34*math.cos(math.radians(beta)); d=c*math.tan(math.radians(beta))
    b=(p-s-c-d)/3; a=2*b
    L,T,R,B=x,y,x+w,y+h
    f=lambda *v: ' '.join('%.3f'%n for n in v)
    return (f"M{f(L+p,T)} H{f(R-p)} "
            f"c{f(a,0,a+b,0,a+b+c,d)} a{f(r,r)} 0 0 1 {f(s,s)} c{f(d,c,d,b+c,d,a+b+c)} "
            f"V{f(B-p)} "
            f"c{f(0,a,0,a+b,-d,a+b+c)} a{f(r,r)} 0 0 1 {f(-s,s)} c{f(-c,d,-(b+c),d,-(a+b+c),d)} "
            f"H{f(L+p)} "
            f"c{f(-a,0,-a-b,0,-(a+b+c),-d)} a{f(r,r)} 0 0 1 {f(-s,-s)} c{f(-d,-c,-d,-(b+c),-d,-(a+b+c))} "
            f"V{f(T+p)} "
            f"c{f(0,-a,0,-(a+b),d,-(a+b+c))} a{f(r,r)} 0 0 1 {f(s,-s)} c{f(c,-d,b+c,-d,a+b+c,-d)} Z")

def damped(x0, y0, A0, n, s0, grow, decay, notes=None):
    """Hand-tuned damped zigzag. Starts at baseline, goes straight UP into the first peak.
    Returns polyline points. notes: dict half-cycle index -> (dx, dy_scale, notch) tweaks."""
    notes=notes or {}
    pts=[(x0,y0)]; x=x0; A=A0; s=s0
    for i in range(n):
        x+= s*0.72 if i==0 else s
        sign=-1 if i%2==0 else 1          # up first (SVG y grows downward)
        dx,ky,notch=notes.get(i,(0,1,None))
        px,py=x+dx, y0+sign*A*ky
        if notch:   # tiny shoulder on the way into this peak: fraction along, offset
            f,o=notch; qx,qy=pts[-1]
            pts.append((qx+(px-qx)*f+o[0], qy+(py-qy)*f+o[1]))
        pts.append((px,py))
        A*=decay; s*=grow
    return pts, x

def poly(pts): return 'M'+' L'.join('%.2f %.2f'%p for p in pts)

def mark_geom(size=1024, variant='master'):
    """Return (points, dot(cx,cy,r), stroke) in a 1024 space (scaled later)."""
    if variant=='master':
        y=524; x0=204
        notes={2:(0,1.0,(0.52,(2,-1))), 5:(4,0.94,None)}   # hand-made irregularity: faint shoulder on spike 3, slight lean on spike 6
        pts,xe=damped(x0,y,136,8,31,1.065,0.72,notes)
        # settle: final half-cycles soften into the run
        run_end=790; dot=(818,y,36); stroke=18
        pts=pts+[(xe+40,y),(run_end,y)]
        return pts,dot,stroke
    raise ValueError

def icon_svg(dark=False, w=1024):
    pts,(dx,dy,r),sw=mark_geom()
    bg=INK if dark else CREAM; edge=EDGE_DARK if dark else EDGE_LIGHT; ink=CREAM_STROKE if dark else INK
    body=squircle(100,100,824,824,185.4)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{w}" viewBox="0 0 1024 1024">'
            f'<path d="{body}" fill="{bg}"/>'
            f'<path d="{squircle(101,101,822,822,184.4)}" fill="none" stroke="{edge}" stroke-width="2"/>'
            f'<path d="{poly(pts)}" fill="none" stroke="{ink}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{dx}" cy="{dy}" r="{r}" fill="{AMBER}"/></svg>')

# ---- Dedicated small-size drawings (pixel units, drawn natively; flat run snapped to pixel rows) ----
SMALL = {
  # size: (inset, stroke, points, dot(cx,cy,r))
  128: (12, 4.0, [(26,65),(29.5,46),(35,80),(40,55),(46,73),(52,59),(58,69),(64,65),(98,65)], (102,65,6.0)),
  64:  (6,  3.0, [(12.5,32.5),(15.5,21.5),(20,42.5),(24,26),(28,37),(32,32.5),(49,32.5)], (51,32.5,3.6)),
  48:  (5,  2.5, [(9.5,24.5),(12,16),(15.5,32),(19,19.5),(22.5,28),(26,24.5),(37,24.5)], (38.5,24.5,2.9)),
  32:  (3,  2.0, [(6.5,16),(8.5,8),(11.5,23),(14,12.5),(16.5,16),(23.5,16)], (25,16,2.7)),
  16:  (2,  1.5, [(3.5,8),(5,4),(7,12),(8.5,8),(10.5,8)], (11.4,8,1.8)),
}
def small_svg(S, dark=False):
    inset,sw,pts,(cx,cy,r)=SMALL[S]
    body=S-2*inset; rad=body*185.4/824
    bg=INK if dark else CREAM; edge=EDGE_DARK if dark else EDGE_LIGHT; ink=CREAM_STROKE if dark else INK
    ew=1.0 if S<=64 else 1.5
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
            f'<path d="{squircle(inset,inset,body,body,rad)}" fill="{bg}"/>'
            f'<path d="{squircle(inset+ew/2,inset+ew/2,body-ew,body-ew,rad-ew/2)}" fill="none" stroke="{edge}" stroke-width="{ew}"/>'
            f'<path d="{poly(pts)}" fill="none" stroke="{ink}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{AMBER}"/></svg>')

# ---- Menu-bar template glyphs ----
# corner: compact "trace corner" (one bend + endpoint). w28 is the retired wide ECG.
GLYPHS = {
  # name: (w, h, stroke, points, dot)
  'corner': (18, 18, 1.7, [(4.6,13.4),(4.6,5.4),(12.0,5.4)], (13.4,5.4,1.55)),
  'w28': (28, 18, 2.0, [(1.5,9),(3.4,2.2),(6.4,14.0),(9.6,5.6),(12.8,11.2),(15.4,9),(21,9)], (24.6,9,3.0)),
  'sq22':(22, 22, 1.8, [(5.6,16.2),(5.6,6.6),(14.4,6.6)], (16.0,6.6,1.8)),
  'sq16':(16, 16, 1.5, [(4.2,12.0),(4.2,4.8),(10.6,4.8)], (11.8,4.8,1.35)),
}
def glyph_svg(name, color='#000000'):
    w,h,sw,pts,(cx,cy,r)=GLYPHS[name]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<path d="{poly(pts)}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/></svg>')
