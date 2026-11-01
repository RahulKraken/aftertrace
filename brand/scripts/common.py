import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFont
from render import png
from wordmark import static_font
SANS='/usr/share/fonts/truetype/sand-box/google/Instrument Sans/InstrumentSans-VariableFont_wdth,wght.ttf'
serif=lambda s: ImageFont.truetype(static_font(), s)
def sans(s, w=420):
    f=ImageFont.truetype(SANS, s)
    try: f.set_variation_by_axes([100, w])
    except Exception: pass
    return f
INKc=(31,29,26); MUTED=(118,111,101); BG=(250,248,243)
def tint(m, col):
    o=Image.new('RGBA', m.size, col+(0,)); o.putalpha(m.split()[3]); return o
def open_rgba(p): return Image.open(p).convert('RGBA')
def zoom(im, k): return im.resize((im.width*k, im.height*k), Image.NEAREST)
