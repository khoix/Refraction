#!/usr/bin/env python3
"""
Build the full Refraction Display Bold font.

What it does
------------
1. Downloads the canonical Oxanium Bold TTF from the upstream Oxanium repository.
2. Keeps the ENTIRE Oxanium Bold glyph set, punctuation, lowercase, accents,
   symbols, OpenType tables, kerning, etc.
3. Replaces only the screenshot-traced uppercase glyphs:
      A C E F I N R T
4. Leaves every other glyph — including O — as true Oxanium Bold.
5. Renames the resulting font to:
      Refraction Display Bold
6. Downloads the Oxanium SIL OFL license beside the output font.

Requirements
------------
    python -m pip install fonttools

Run
---
    python build_refraction_display_full.py

Outputs
-------
    RefractionDisplay-Bold.ttf
    OFL-Oxanium.txt
"""

from pathlib import Path
from urllib.request import Request, urlopen

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen

BASE = Path(__file__).resolve().parent
OXANIUM_TTF = BASE / "_Oxanium-Bold.ttf"
OUTPUT_TTF = BASE / "RefractionDisplay-Bold.ttf"
LICENSE_OUT = BASE / "OFL-Oxanium.txt"

OXANIUM_URL = (
    "https://raw.githubusercontent.com/sevmeyer/oxanium/"
    "master/fonts/ttf/Oxanium-Bold.ttf"
)
LICENSE_URL = (
    "https://raw.githubusercontent.com/sevmeyer/oxanium/master/OFL.txt"
)

# Vector traces captured from the generated REFRACTION title artwork.
# Coordinates are source-image coordinates and are scaled to the donor
# font's cap height at build time.
TRACED = {
    "R": {
        "w": 105, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[0,0],[0,103],[18,102],[19,65],[50,65],[84,103],[104,102],[75,67],[76,65],[93,64],[100,59],[103,53],[103,12],[98,4],[90,0]]},
            {"parent": 0, "pts": [[18,18],[84,17],[85,47],[19,48]]},
        ],
    },
    "E": {
        "w": 94, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[0,0],[0,103],[93,103],[93,86],[17,85],[18,60],[78,59],[77,43],[18,43],[17,18],[71,16],[93,17],[93,0]]},
        ],
    },
    "F": {
        "w": 96, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[95,0],[0,0],[1,103],[18,102],[19,60],[78,59],[77,43],[19,43],[18,18],[94,17]]},
        ],
    },
    "A": {
        "w": 101, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[7,3],[3,7],[0,14],[0,103],[17,103],[17,67],[19,65],[82,65],[83,103],[100,103],[100,12],[98,8],[92,2],[87,0],[13,0]]},
            {"parent": 0, "pts": [[17,18],[19,16],[82,17],[83,47],[18,48]]},
        ],
    },
    "C": {
        "w": 98, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[6,4],[2,8],[0,14],[0,89],[3,95],[8,100],[15,103],[96,103],[96,86],[52,87],[19,86],[17,84],[17,18],[25,16],[97,16],[97,1],[13,0]]},
        ],
    },
    "T": {
        "w": 99, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[0,0],[1,17],[32,16],[41,18],[40,102],[57,103],[58,18],[86,16],[98,17],[98,0]]},
        ],
    },
    "I": {
        "w": 19, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[0,0],[0,103],[17,103],[18,1]]},
        ],
    },
    "N": {
        "w": 102, "h": 104,
        "contours": [
            {"parent": -1, "pts": [[1,0],[0,102],[18,102],[19,27],[82,103],[100,103],[101,1],[83,0],[82,76],[19,0]]},
        ],
    },
}


def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 0:
        return
    print(f"Downloading {path.name} ...")
    req = Request(url, headers={"User-Agent": "Refraction-font-builder/1.0"})
    with urlopen(req) as src, path.open("wb") as dst:
        dst.write(src.read())


def cap_height(font: TTFont) -> int:
    os2 = font["OS/2"]
    cap = getattr(os2, "sCapHeight", 0)
    if cap:
        return cap

    cmap = font.getBestCmap()
    glyph_name = cmap.get(ord("H"))
    if glyph_name:
        g = font["glyf"][glyph_name]
        if g.yMax:
            return g.yMax

    return round(font["head"].unitsPerEm * 0.7)


def traced_glyph(data, target_cap: int, lsb: int):
    scale = target_cap / data["h"]
    pen = TTGlyphPen(None)

    for contour in data["contours"]:
        pts = [(lsb + x * scale, target_cap - y * scale)
               for x, y in contour["pts"]]

        signed_area = sum(
            pts[i][0] * pts[(i + 1) % len(pts)][1]
            - pts[(i + 1) % len(pts)][0] * pts[i][1]
            for i in range(len(pts))
        )

        want_clockwise = contour["parent"] == -1
        is_clockwise = signed_area < 0
        if want_clockwise != is_clockwise:
            pts.reverse()

        pen.moveTo(pts[0])
        for point in pts[1:]:
            pen.lineTo(point)
        pen.closePath()

    advance = round(data["w"] * scale + 2 * lsb)
    return pen.glyph(), advance


def set_name(font: TTFont, name_id: int, value: str) -> None:
    name_table = font["name"]
    seen = set()
    for record in list(name_table.names):
        if record.nameID == name_id:
            key = (record.platformID, record.platEncID, record.langID)
            if key in seen:
                continue
            seen.add(key)
            name_table.setName(
                value,
                name_id,
                record.platformID,
                record.platEncID,
                record.langID,
            )

    # Ensure common Windows English naming exists.
    name_table.setName(value, name_id, 3, 1, 0x409)


def rename_font(font: TTFont) -> None:
    set_name(font, 1, "Refraction Display")
    set_name(font, 2, "Bold")
    set_name(font, 3, "Refraction Display Bold 1.0")
    set_name(font, 4, "Refraction Display Bold")
    set_name(font, 6, "RefractionDisplay-Bold")

    # Preferred family/subfamily.
    set_name(font, 16, "Refraction Display")
    set_name(font, 17, "Bold")

    description = (
        "Refraction Display Bold. Derived from Oxanium Bold by Severin Meyer "
        "under the SIL Open Font License 1.1. Uppercase A, C, E, F, I, N, R, "
        "and T are custom traced glyphs from the Refraction title artwork; "
        "all other glyphs remain from Oxanium Bold."
    )
    set_name(font, 10, description)


def main():
    download(OXANIUM_URL, OXANIUM_TTF)
    download(LICENSE_URL, LICENSE_OUT)

    font = TTFont(str(OXANIUM_TTF))
    cmap = font.getBestCmap()
    target_cap = cap_height(font)

    # Use each donor glyph's existing sidebearing as a guide, but enforce a
    # small positive minimum for the screenshot glyphs.
    for char, data in TRACED.items():
        glyph_name = cmap.get(ord(char))
        if not glyph_name:
            raise RuntimeError(f"Oxanium Bold has no cmap entry for {char}")

        _, donor_lsb = font["hmtx"].metrics[glyph_name]
        lsb = max(30, donor_lsb)

        glyph, advance = traced_glyph(data, target_cap, lsb)
        font["glyf"][glyph_name] = glyph
        font["hmtx"].metrics[glyph_name] = (advance, lsb)

    rename_font(font)

    # Preserve Bold classification from Oxanium.
    font["OS/2"].usWeightClass = 700

    font.save(str(OUTPUT_TTF))

    check = TTFont(str(OUTPUT_TTF))
    cmap_count = len(check.getBestCmap())
    glyph_count = len(check.getGlyphOrder())

    print()
    print(f"Created: {OUTPUT_TTF.name}")
    print(f"Glyphs: {glyph_count}")
    print(f"Mapped Unicode characters: {cmap_count}")
    print("Custom traced uppercase: A C E F I N R T")
    print("Everything else, including O/lowercase/punctuation/accents: Oxanium Bold")
    print(f"License: {LICENSE_OUT.name}")


if __name__ == "__main__":
    main()
