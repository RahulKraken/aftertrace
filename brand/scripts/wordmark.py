"""Outlined wordmark: Newsreader (OFL, Production Type / Google Fonts), static instance wght 520, opsz 72."""
import os, uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
SRC='/usr/share/fonts/truetype/sand-box/google/Newsreader/Newsreader-VariableFont_opsz,wght.ttf'
OUT=os.path.join(os.path.dirname(__file__),'..','fonts','Newsreader-Aftertrace-520-opsz72.ttf')
def static_font():
    if not os.path.exists(OUT):
        os.makedirs(os.path.dirname(OUT),exist_ok=True)
        f=instancer.instantiateVariableFont(TTFont(SRC),{'wght':520,'opsz':72}); f.save(OUT)
    return OUT
def text_path(text, size, x=0, y=0, tracking=0.0):
    """Return (svg path d, advance width, cap height) with baseline at y."""
    path=static_font(); blob=hb.Blob.from_file_path(path); face=hb.Face(blob); font=hb.Font(face)
    buf=hb.Buffer(); buf.add_str(text); buf.guess_segment_properties(); hb.shape(font,buf,{'kern':True,'liga':True})
    tt=TTFont(path); gs=tt.getGlyphSet(); upm=tt['head'].unitsPerEm; k=size/upm
    order=tt.getGlyphOrder(); pen=SVGPathPen(gs); cx=0
    for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
        g=order[info.codepoint]
        gs[g].draw(TransformPen(pen,(k,0,0,-k,x+(cx+pos.x_offset)*k,y-pos.y_offset*k)))
        cx+=pos.x_advance+tracking*upm
    cap=tt['OS/2'].sCapHeight*k
    return pen.getCommands(), (cx-tracking*upm)*k, cap
