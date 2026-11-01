"""final-sheet.png"""
import os, sys; sys.path.insert(0, os.path.dirname(__file__))
from common import *
from mark import icon_svg, small_svg, glyph_svg, GLYPHS, INK, CREAM, AMBER, EDGE_LIGHT
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
W=2400; H=3860; im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
def h1(y,t,sub=None):
    d.text((60,y),t,font=serif(44),fill=INKc)
    if sub: d.text((60,y+60),sub,font=sans(22),fill=MUTED)
def cap(x,y,t,c=MUTED,s=20): d.text((x,y),t,font=sans(s),fill=c)
def paste(p,x,y): im.paste(p,(int(x),int(y)),p)

d.text((60,40),'Aftertrace',font=serif(72),fill=INKc)
cap(64,130,'Final app mark  ·  Settle, loud start with a long decay  ·  ink #1F1D1A, cream #EFEAE2 with a #D6CEC1 hairline, amber #E29A2E',s=24)

# 1 hero
y=200
paste(png(icon_svg(),760),40,y); paste(png(icon_svg(True),760),820,y)
cap(100,y+770,'Light: 1024 master, shown at 760'); cap(880,y+770,'Dark: cream stroke on ink, same geometry')
# palette + notes column
x0=1640; cy=y+40
d.text((x0,cy),'Colour',font=serif(32),fill=INKc); cy+=60
for hx,name,note in [('#1F1D1A','Ink','stroke, dark bg'),('#EFEAE2','Cream','light bg'),('#D6CEC1','Hairline','2 px edge on 1024'),('#E29A2E','Amber','the dot')]:
    rgb=tuple(int(hx[i:i+2],16) for i in (1,3,5)); d.rounded_rectangle([x0,cy,x0+88,cy+88],radius=20,fill=rgb,outline=(214,206,193),width=2)
    cap(x0+110,cy+14,f'{name}  {hx}',INKc,24); cap(x0+110,cy+48,note); cy+=110
cy+=10
for t in ['Amber on cream: 1.97:1 luminance contrast, but a big hue and chroma jump,',
          'so the dot reads by colour. Amber on ink: 7.1:1. Ink on cream: 14:1.',
          'Flat fills only. No gradient, glow or blur. The tonal shift is the',
          'hairline edge, which keeps cream from dissolving on white.']:
    cap(x0,cy,t); cy+=30
gs=png(icon_svg(),220).convert('LA').convert('RGBA'); paste(gs,x0,cy+20); cap(x0+240,cy+100,'Greyscale check: the dot goes\npale, so it leans on colour')

# 2 size ramp
y=1060; h1(y,'Sizes','≤128 px are separate drawings: fewer spikes, heavier stroke, flat run snapped to the pixel grid. Above that, the master art.')
for row,dark in enumerate([False,True]):
    x=60; yy=y+120+row*560
    for S in [512,256,128,64,48,32,16]:
        p=open_rgba(f'png/icon-{"dark" if dark else "light"}-{S}.png'); paste(p,x,yy+(512-S))
        cap(x,yy+522,f'{S}'); x+=S+40
    # zoom of 32 and 16
    zx=x+40
    paste(zoom(open_rgba(f'png/icon-{"dark" if dark else "light"}-32.png'),8),zx,yy+256)
    paste(zoom(open_rgba(f'png/icon-{"dark" if dark else "light"}-16.png'),12),zx+290,yy+320)
    cap(zx,yy+522,'32 at 8×  ·  16 at 12×  (actual pixels)')

# 3 menu bar glyphs
y=2350; h1(y,'Menu-bar glyph','Template PNG, black on transparent. Four alternating spikes decay evenly into a solid dot. 28×18 pt, @1x and @2x, 2 pt stroke on whole pixels.')
def bar(x,yy,w,dark):
    bg=(236,234,231) if dark is False else (38,37,40); fg=(22,22,22) if not dark else (242,242,242)
    d.rectangle([x,yy,x+w,yy+48],fill=bg); xr=x+w-30
    clk='Sun 1 Nov  10:28'; xr-=d.textlength(clk,font=sans(24)); d.text((xr,yy+10),clk,font=sans(24),fill=fg)
    xr-=56; d.rounded_rectangle([xr,yy+15,xr+36,yy+33],radius=5,outline=fg,width=3)
    xr-=50; d.ellipse([xr,yy+13,xr+22,yy+35],outline=fg,width=3)
    g=tint(open_rgba('glyphs/TrayTemplate@2x.png'),fg); xr-=56+34; paste(g,xr,yy+6)
    return fg,bg
bar(60,y+120,1100,False); bar(60,y+190,1100,True); cap(60,y+250,'Menu bar at 2× (Retina), right-hand status area')
zx=1240
for i,(stem,k) in enumerate([('TrayTemplate',8),('TrayTemplate@2x',4),('TrayTemplate-22',6),('TrayTemplate-16',8)]):
    g=open_rgba(f'glyphs/{stem}.png'); t=Image.new('RGBA',g.size,(236,234,231,255)); t.alpha_composite(g); t=zoom(t,k)
    paste(t,zx,y+120); cap(zx,y+120+t.height+8,{'TrayTemplate':'28×18 @1x','TrayTemplate@2x':'@2x (56×36)','TrayTemplate-22':'22 px','TrayTemplate-16':'16 px'}[stem])
    zx+=t.width+40

# 4 lockup
y=2700; h1(y,'Wordmark','Newsreader (open font, OFL), static cut wght 520 / opsz 72, outlined to paths. Mark-only version for the README header.')
lk=open_rgba('png/lockup-light@3x.png'); lk=lk.resize((lk.width*200//lk.height,200),Image.LANCZOS); paste(lk,60,y+120)
dk=Image.new('RGBA',(lk.width+80,lk.height+60),(28,27,25,255)); l2=open_rgba('png/lockup-dark@3x.png').resize(lk.size,Image.LANCZOS); dk.alpha_composite(l2,(40,30)); paste(dk,20,y+120+lk.height+40)
mk=open_rgba('png/readme-mark-light@2x.png').resize((480,196),Image.LANCZOS); paste(mk,1080,y+150)
mt=Image.new('RGBA',(560,256),(28,27,25,255)); mt.alpha_composite(open_rgba('png/readme-mark-dark@2x.png').resize((480,196),Image.LANCZOS),(40,30)); paste(mt,1640,y+120)
cap(1080,y+400,'Mark alone: ink for light READMEs, cream for dark')

# 5 before / after
y=3390; 
bx=60; h1(y,'Before / after',None)
b4=open_rgba('../round4/b-35.png').resize((300,300),Image.LANCZOS); paste(b4,60,y+80); cap(60,y+390,'Round 4 B')
paste(png(icon_svg(),300),400,y+80); cap(400,y+390,'Final')
paste(zoom(open_rgba('../round4/b-35.png').resize((32,32),Image.LANCZOS),4),760,y+150); cap(760,y+290,'R4 B at 32')
paste(zoom(open_rgba('png/icon-light-32.png'),4),920,y+150); cap(920,y+290,'Final 32')
notes=['Peaks placed by hand: they alternate up and down, decay about 0.72× each time,',
       'and spacing widens about 6.5% per step. One faint shoulder and one slight lean are kept on purpose.',
       'Clean start: the stroke rises straight from the baseline into the first, tallest spike.',
       'Noise takes the left 50% of the mark, then a calm run into the amber dot.',
       'The baseline sits 12 px below centre to balance the tall first spike. Shape: continuous-corner squircle.',
       'Small sizes and the menu-bar glyph are drawn separately, so there is no heartbeat read.']
for i,t in enumerate(notes): cap(1120,y+90+i*44,'·  '+t,INKc,22)
im.save('final-sheet.png'); print(im.size)
