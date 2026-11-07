"""Build every production asset from mark.py. Run from final/: ../../.venv-logo/bin/python scripts/build.py"""
import os, sys, shutil
sys.path.insert(0, os.path.dirname(__file__))
from mark import *; from render import png; from wordmark import text_path
from PIL import Image
os.chdir(os.path.join(os.path.dirname(__file__),'..'))
for d in ['svg','png','glyphs','AppIcon.iconset','linux','windows']: os.makedirs(d,exist_ok=True)
def save(name, s): open(name,'w').write(s); return s

# 1. master + dark SVG, dedicated small SVGs
save('svg/icon-light.svg', icon_svg()); save('svg/icon-dark.svg', icon_svg(True))
for S in SMALL:
    save(f'svg/icon-{S}-light.svg', small_svg(S)); save(f'svg/icon-{S}-dark.svg', small_svg(S,True))

def icon_png(S, dark=False):
    """Size-aware: dedicated drawing at <=128 px, master art above."""
    return png(small_svg(S,dark),S) if S in SMALL else png(icon_svg(dark),S)
for S in [1024,512,256,128,64,48,32,16]:
    icon_png(S).save(f'png/icon-light-{S}.png'); icon_png(S,True).save(f'png/icon-dark-{S}.png')

# 2. macOS iconset + icns
spec=[(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)]
for base,sc in spec:
    n=f'icon_{base}x{base}'+('@2x' if sc==2 else '')
    icon_png(base*sc).save(f'AppIcon.iconset/{n}.png')
def write_icns(path):
    """Minimal .icns writer (PNG payloads, same OSTypes iconutil emits) so 16/32 px use the dedicated drawings."""
    import io, struct
    types=[('icp4',16),('icp5',32),('ic11',32),('ic12',64),('ic07',128),('ic13',256),('ic08',256),('ic14',512),('ic09',512),('ic10',1024)]
    body=b''
    for t,px in types:
        b=io.BytesIO(); icon_png(px).save(b,'PNG'); data=b.getvalue()
        body+=t.encode()+struct.pack('>I',len(data)+8)+data
    open(path,'wb').write(b'icns'+struct.pack('>I',len(body)+8)+body)
write_icns('AppIcon.icns')

# 3. Windows .ico (dedicated drawings embedded per size) + favicon
sizes=[16,32,48,64,128,256]
imgs=[icon_png(s) for s in sizes]
imgs[-1].save('windows/Aftertrace.ico', sizes=[(s,s) for s in sizes], append_images=imgs[:-1])
icon_png(48).save('favicon.ico', sizes=[(16,16),(32,32),(48,48)], append_images=[icon_png(16),icon_png(32)])

# 4. Linux hicolor PNGs
for S in [16,22,24,32,48,64,128,256,512]:
    d=f'linux/hicolor/{S}x{S}/apps'; os.makedirs(d,exist_ok=True)
    im = icon_png(S) if S in SMALL or S>128 else png(small_svg(32 if S<32 else 48),S)
    im.save(f'{d}/aftertrace.png')
os.makedirs('linux/hicolor/scalable/apps',exist_ok=True); shutil.copy('svg/icon-light.svg','linux/hicolor/scalable/apps/aftertrace.svg')

# 5. Menu-bar template glyphs (black on transparent; macOS tints them). Name ends in 'Template' per AppKit convention.
for n in GLYPHS:
    w,h=GLYPHS[n][:2]; s=save(f'svg/glyph-{n}.svg', glyph_svg(n))
    stem={'corner':'TrayTemplate','sq22':'TrayTemplate-22','sq16':'TrayTemplate-16','w28':'TrayTemplate-wide'}[n]
    png(s,w,h).save(f'glyphs/{stem}.png'); png(s,w*2,h*2).save(f'glyphs/{stem}@2x.png')

# 6. Mark alone (README header) and wordmark lockups, text outlined to paths
pts,(dx,dy,r),sw=mark_geom()
def mark_alone(ink, dot=AMBER):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="690" height="282" viewBox="180 364 690 282">'
            f'<path d="{poly(pts)}" fill="none" stroke="{ink}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{dx}" cy="{dy}" r="{r}" fill="{dot}"/></svg>')
save('svg/mark-ink.svg', mark_alone(INK)); save('svg/mark-cream.svg', mark_alone(CREAM))
png(mark_alone(INK),1380,564).save('png/readme-mark-light@2x.png'); png(mark_alone(CREAM),1380,564).save('png/readme-mark-dark@2x.png')

def lockup(dark=False, S=200):
    W_ICON=S; gap=0.20*S; size=0.31*S/0.67; P=3
    d,tw,cap=text_path('Aftertrace', size)
    W=int(W_ICON+gap+tw+2*P+4); H=S+2*P
    base=H/2+cap/2
    d,tw,cap=text_path('Aftertrace', size, x=P+W_ICON+gap, y=base)
    ic=icon_svg(dark).split('>',1)[1].rsplit('</svg>',1)[0]
    col=CREAM if dark else INK
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<g transform="translate({P-S*100/824:.3f},{P-S*100/824:.3f}) scale({S/824:.5f})">{ic}</g>'
            f'<path d="{d}" fill="{col}"/></svg>'), W, H
for dark in (False,True):
    s,W,H=lockup(dark); t='dark' if dark else 'light'
    save(f'svg/lockup-{t}.svg', s); png(s,W*3,H*3).save(f'png/lockup-{t}@3x.png')
print('built')
