# Aftertrace — final mark assets

Rebuild everything (from this folder): `python3 scripts/build.py && python3 scripts/sheet.py && python3 scripts/context.py`

Requires Python 3 with Pillow (and `iconutil` on macOS for `.icns`). The Newsreader instance used for lockups is SIL OFL — see `fonts/OFL.txt`.

- `scripts/mark.py` — single source of truth: hand-placed peaks, continuous-corner squircle, small-size drawings, glyphs
- `svg/` — icon-light/dark (master), icon-{128,64,48,32,16}-{light,dark} (dedicated drawings), glyph-*, mark-ink/cream, lockup-light/dark (text outlined)
- `AppIcon.iconset/` + `AppIcon.icns` (all 10 slots; 16/32/64/128 use the dedicated drawings)
- `windows/Aftertrace.ico` (16–256), `favicon.ico` (16/32/48)
- `linux/hicolor/<N>x<N>/apps/aftertrace.png` + `scalable/apps/aftertrace.svg`
- `glyphs/TrayTemplate.png` / `@2x` (28×18 pt), plus `-22` and `-16` attempts. Black on transparent; for Electron use `nativeImage.createFromPath(...)` then `setTemplateImage(true)`; the `Template` suffix is the macOS convention.
- `png/` — icon PNGs at each size, lockups @3x, README mark @2x
- Font: Newsreader (SIL OFL), static instance wght 520 / opsz 72 in `fonts/`
