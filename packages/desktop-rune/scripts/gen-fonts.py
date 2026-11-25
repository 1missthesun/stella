"""Converts desktop-ui's bundled woff2 fonts to TTF for the engine, under the CSS family names.

Rune reads TTF/OTF only, and these files carry other family names (Nerd Font builds, a variable
font named after its default instance), so the families are renamed to what desktop-ui's
fonts.css calls them. A variable face reports the top of its weight axis: Rune adds synthetic
bold to weights more than 200 above a face's weight class, which the axis already covers. Needs fontTools + brotli: `python -m pip install fonttools brotli`.
"""
import pathlib
import sys

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT.parent / "desktop-ui" / "src" / "assets" / "fonts"
OUT = ROOT / "ui" / "theme" / "fonts"

FONTS = [
    ("manrope", "Manrope", "Regular", None),
    ("mona-sans", "Mona Sans", "Regular", None),
    ("ibm-plex-mono", "IBM Plex Mono", "Regular", 400),
    ("ibm-plex-mono-medium", "IBM Plex Mono", "Medium", 500),
    ("ibm-plex-mono-bold", "IBM Plex Mono", "Bold", 700),
]


def rename(font: TTFont, family: str, style: str) -> None:
    names = font["name"]
    full = family if style == "Regular" else f"{family} {style}"
    ps = full.replace(" ", "")
    for rec in list(names.names):
        if rec.nameID in (16, 17, 21, 22, 25):
            names.removeNames(nameID=rec.nameID)
    for nid, value in ((1, family), (2, style), (4, full), (6, ps)):
        names.setName(value, nid, 3, 1, 0x409)
        names.setName(value, nid, 1, 0, 0)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for stem, family, style, weight in FONTS:
        font = TTFont(SRC / f"{stem}.woff2")
        font.flavor = None
        rename(font, family, style)
        if "fvar" in font:
            wght = next(a for a in font["fvar"].axes if a.axisTag == "wght")
            font["OS/2"].usWeightClass = int(wght.maxValue)
        if weight is not None:
            font["OS/2"].usWeightClass = weight
            bold = weight >= 700
            font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b1100001) | (0b100000 if bold else 0b1000000)
            font["head"].macStyle = 1 if bold else 0
        font.save(OUT / f"{stem}.ttf")
        print(f"{stem}.ttf: {family} {style}", file=sys.stderr)


main()
