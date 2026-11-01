"""context.png: menu bar, Dock, README header mock (generic shapes only, no real third-party UI or icons)."""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))
from common import *
from mark import squircle, icon_svg
from wordmark import text_path
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
W=2400; H=1860; im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
def paste(p,x,y): im.paste(p,(int(x),int(y)),p)
d.text((60,36),'Aftertrace in context',font=serif(48),fill=INKc)
d.text((62,104),'Everything at 2× (Retina). Neighbouring icons and menus are neutral placeholders.',font=sans(22),fill=MUTED)
# menu bars
def menubar(y,dark):
    bg=(236,234,231) if not dark else (36,35,38); fg=(22,22,22) if not dark else (242,242,242)
    d.rectangle([0,y,W,y+48],fill=bg); d.ellipse([30,y+14,50,y+34],fill=fg); x=86
    for i,t in enumerate(['Aftertrace','File','Edit','View','Window','Help']):
        f=sans(24,620 if i==0 else 420); d.text((x,y+10),t,font=f,fill=fg); x+=d.textlength(t,font=f)+40
    xr=W-30; clk='Sun 1 Nov  10:28'; xr-=d.textlength(clk,font=sans(24)); d.text((xr,y+10),clk,font=sans(24),fill=fg)
    xr-=60; d.rounded_rectangle([xr,y+15,xr+38,y+33],radius=5,outline=fg,width=3)
    xr-=52; d.ellipse([xr,y+13,xr+22,y+35],outline=fg,width=3)
    xr-=52; d.polygon([(xr,y+34),(xr+24,y+34),(xr+12,y+13)],outline=fg,width=3)
    g=tint(open_rgba('glyphs/TrayTemplate@2x.png'),fg); xr-=56+34; paste(g,xr,y+6)
menubar(160,False); menubar(226,True)
# docks
def generic(col,kind):
    c='#F4F2EE'
    sh={'circle':f'<circle cx="512" cy="512" r="190" fill="{c}"/>','square':f'<rect x="340" y="340" width="344" height="344" rx="44" fill="{c}"/>',
        'tri':f'<path d="M512 310 L730 690 L294 690 Z" fill="{c}"/>','bars':f'<rect x="310" y="390" width="404" height="66" rx="33" fill="{c}"/><rect x="310" y="568" width="280" height="66" rx="33" fill="{c}"/>',
        'ring':f'<circle cx="512" cy="512" r="180" fill="none" stroke="{c}" stroke-width="66"/>'}[kind]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path d="{squircle(100,100,824,824,185.4)}" fill="rgb{col}"/>{sh}</svg>'
apps=[((122,132,142),'circle'),((98,118,148),'square'),((128,148,118),'tri'),None,((150,118,108),'bars'),((108,108,116),'ring')]
for i,(dark,lab) in enumerate([(False,'Dock, light'),(True,'Dock, dark')]):
    y=360+i*290; x0=360
    wall=(214,208,198) if not dark else (44,42,46); d.rectangle([0,y-20,W,y+250],fill=wall)
    d.rounded_rectangle([x0,y+20,x0+1180,y+220],radius=44,fill=(236,233,228) if not dark else (62,60,64))
    d.text((60,y+100),lab,font=sans(24),fill=(90,84,76) if not dark else (200,196,190))
    x=x0+40
    for a in apps:
        p=png(icon_svg(dark) if a is None else generic(*a),128) if a else open_rgba(f'png/icon-{"dark" if dark else "light"}-128.png')
        paste(p,x,y+46)
        if a is None: d.ellipse([x+60,y+196,x+68,y+204],fill=(40,40,40) if not dark else (230,230,230))
        x+=188
# README header mocks
def readme(x,y,w,h,dark):
    page=(255,255,255) if not dark else (17,19,22); line=(222,222,222) if not dark else (48,52,58)
    txt=(31,29,26) if not dark else (236,232,226); mut=(128,124,118) if not dark else (140,144,150)
    d.rounded_rectangle([x,y,x+w,y+h],radius=18,fill=page,outline=line,width=2)
    d.rectangle([x+2,y+2,x+w-2,y+64],fill=(246,246,246) if not dark else (24,27,31)); d.line([x,y+64,x+w,y+64],fill=line,width=2)
    d.text((x+30,y+18),'README.md',font=sans(22,560),fill=mut)
    mk=open_rgba(f'png/readme-mark-{"dark" if dark else "light"}@2x.png').resize((380,155),Image.LANCZOS)
    paste(mk,x+(w-380)/2,y+110)
    ttl=serif(64); tw=d.textlength('Aftertrace',font=ttl); d.text((x+(w-tw)/2,y+290),'Aftertrace',font=ttl,fill=txt)
    tag='A calm, local-first coach for how you spend time and money with AI.'; f=sans(24); tw=d.textlength(tag,font=f); d.text((x+(w-tw)/2,y+384),tag,font=f,fill=mut)
    bx=x+(w-3*150-2*16)/2
    for k in range(3): d.rounded_rectangle([bx+k*166,y+446,bx+k*166+150,y+478],radius=8,fill=line)
    d.line([x+40,y+520,x+w-40,y+520],fill=line,width=2)
    for k,ww in enumerate([0.82,0.9,0.64,0.86,0.5]): d.rounded_rectangle([x+40,y+556+k*40,x+40+(w-80)*ww,y+570+k*40],radius=7,fill=line)
d.text((60,960),'README header (mark alone above the title)',font=sans(24),fill=MUTED)
readme(60,1010,1110,800,False); readme(1230,1010,1110,800,True)
im.save('context.png'); print(im.size)
