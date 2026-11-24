#!/usr/bin/env python3
"""Draws the Lisbon street map used on the trip slide from OpenStreetMap data.

Usage: render-trip-map.py <overpass.json> <out.svg>
Overpass query: streets, parks, water and coastline inside the bbox below (out geom).
Map data (c) OpenStreetMap contributors, ODbL; the slide carries the attribution.
"""
import json, math, sys

S, N, W, E = 38.7035, 38.7265, -9.1495, -9.1255
H = 2000
K = math.cos(math.radians((S + N) / 2))
WID = round(H * (E - W) * K / (N - S))

def xy(lat, lon):
    return ((lon - W) / (E - W) * WID, (N - lat) / (N - S) * H)

def path(g, close=False):
    pts = [xy(p["lat"], p["lon"]) for p in g]
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + ("Z" if close else "")

els = json.load(open(sys.argv[1]))["elements"]
parks, water, roads, coast = [], [], {}, []
for e in els:
    t, g = e.get("tags", {}), e.get("geometry", [])
    if t.get("leisure"): parks.append(path(g, True))
    elif t.get("natural") == "water": water.append(path(g, True))
    elif t.get("natural") == "coastline": coast.append(g)
    elif t.get("highway"): roads.setdefault(t["highway"], []).append(path(g))

# Join coastline segments, then close the river around the south-east.
chains = [[(p["lat"], p["lon"]) for p in g] for g in coast]
joined = True
while joined:
    joined = False
    for a in chains:
        for b in chains:
            if a is not b and a[-1] == b[0]:
                a.extend(b[1:]); chains.remove(b); joined = True; break
        if joined: break
river = ""
for c in chains:
    pts = [xy(*p) for p in c]
    if len(pts) < 2: continue
    d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    closed = c[0] == c[-1]
    print(len(c), "closed" if closed else "open", pts[0], pts[-1], file=sys.stderr)
    if not closed:
        d += f"L{WID+900} {pts[-1][1]:.0f}L{WID+900} {H+900}L-900 {H+900}L{-900} {pts[0][1]:.0f}" if pts[-1][0] > pts[0][0] else f"L-900 {pts[-1][1]:.0f}L-900 {H+900}L{WID+900} {H+900}L{WID+900} {pts[0][1]:.0f}"
        river += f'<path d="{d}Z"/>'

STYLE = [  # kind, casing width, fill width, fill
    (("steps", "pedestrian", "living_street"), 0, 5, "#ffffff"),
    (("residential", "unclassified"), 0, 8, "#ffffff"),
    (("tertiary",), 14, 11, "#ffffff"),
    (("secondary",), 19, 15, "#fff6dc"),
    (("primary", "trunk", "motorway"), 24, 19, "#ffe9ad"),
]
out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WID} {H}" width="{WID}" height="{H}">',
       f'<rect width="{WID}" height="{H}" fill="#f1efe9"/>',
       f'<g fill="#cfe8c6">{"".join(f"<path d={chr(34)}{d}{chr(34)}/>" for d in parks)}</g>',
       '<g fill="none" stroke-linecap="round" stroke-linejoin="round">']
for kinds, casing, width, fill in STYLE:
    d = "".join("".join(roads.get(k, [])) for k in kinds)
    if casing: out.append(f'<path d="{d}" stroke="#e3ddd0" stroke-width="{casing}"/>')
    out.append(f'<path d="{d}" stroke="{fill}" stroke-width="{width}"/>')
out.append("</g>")
out.append(f'<g fill="#a9d7f5">{river}{"".join(f"<path d={chr(34)}{d}{chr(34)}/>" for d in water)}</g></svg>')
open(sys.argv[2], "w").write("\n".join(out))
print(WID, H)
for name, la, lo in [("alfama", 38.7118, -9.1303), ("graca", 38.7163, -9.1317), ("chiado", 38.7107, -9.1422), ("principe", 38.7155, -9.1443), ("baixa", 38.7078, -9.1366)]:
    x, y = xy(la, lo); print(name, round(x / WID, 3), round(y / H, 3))
