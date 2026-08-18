"""Dissect the Play Way quick-reference chart into 36 transparent symbol PNGs.

Run:  python3 scripts/extract_symbols.py
Only needed if the chart artwork itself changes.

Each cell has a smooth 2-axis colour gradient behind the artwork. We fit a
quadratic surface to the cell's border ring (which is guaranteed to be pure
background), flag every pixel that matches that surface, then keep only the
region connected to the border so we never punch holes inside the artwork."""
from PIL import Image, ImageFilter
from scipy import ndimage
import numpy as np
import os, json

SRC = os.path.join(os.path.dirname(__file__), '..', 'source-art', 'PlayWayChart.jpg')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'playway')
os.makedirs(OUT, exist_ok=True)

NAMES = ["Sun","Fish","House","Crossroad","Dog","Death","Money","Spider","Cat",
         "Police","Snake","Car","Black Bird","Old Woman","Lizard","Bus Driver",
         "Mongoose","Love-Making","Blood","Belly","Wedding","Garbage","Rat",
         "Strong Man","Fire","Yard Fowl","Spirit","Boat","Sickness",
         "Beautiful Woman","Cockroach","Dirty Water","Centipede","Macko",
         "Crapaud","Vagrant"]

COLS = [(146,284),(342,475),(533,667),(725,860),(917,1051)]
ROWS = [(192,289),(316,424),(451,560),(586,696),(722,831),(858,966),(992,1102)]
CELL36 = (533,667,1129,1222)
PAD = 4
TOL = 30

BASE = Image.open(SRC).convert('RGB')


def fit_background(arr, ring=4):
    """Least-squares quadratic surface per channel, fitted on the border ring."""
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    ring_mask = np.zeros((h, w), bool)
    ring_mask[:ring, :] = ring_mask[-ring:, :] = True
    ring_mask[:, :ring] = ring_mask[:, -ring:] = True
    X = np.column_stack([np.ones(h*w), xx.ravel(), yy.ravel(),
                         (xx*yy).ravel(), (xx**2).ravel(), (yy**2).ravel()])
    sel = ring_mask.ravel()
    pred = np.zeros_like(arr, dtype=float)
    for c in range(3):
        beta, *_ = np.linalg.lstsq(X[sel], arr[:, :, c].ravel()[sel], rcond=None)
        pred[:, :, c] = (X @ beta).reshape(h, w)
    return pred


def extract(box, name, number):
    x0, x1, y0, y1 = box
    crop = BASE.crop((x0+PAD, y0+PAD, x1-PAD+1, y1-PAD+1))
    crop = crop.resize((crop.width*3, crop.height*3), Image.LANCZOS)
    arr = np.asarray(crop).astype(float)

    pred = fit_background(arr, ring=6)
    dist = np.abs(arr - pred).max(axis=2)
    candidate = dist <= TOL

    # keep only background regions touching the border
    lbl, _ = ndimage.label(candidate)
    edge_ids = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    edge_ids.discard(0)
    bg = np.isin(lbl, list(edge_ids))
    # also drop enclosed pockets of background trapped inside outlines: only
    # if they match the fitted surface almost exactly (real artwork that merely
    # resembles the gradient sits further away and is kept)
    for cid in range(1, lbl.max() + 1):
        if cid in edge_ids:
            continue
        comp = lbl == cid
        if comp.sum() >= 60 and np.median(dist[comp]) < 13:
            bg |= comp
    # close pinholes in the artwork caused by stray background-coloured pixels
    bg = ndimage.binary_opening(bg, np.ones((3, 3)))
    bg = ndimage.binary_propagation(
        ndimage.binary_erosion(bg, np.ones((5, 5))), mask=candidate)

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    out = Image.fromarray(np.dstack([np.asarray(crop), alpha]), 'RGBA')
    out.putalpha(out.split()[3].filter(ImageFilter.GaussianBlur(1.2)))

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    side = int(max(out.size) * 1.10)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side-out.width)//2, (side-out.height)//2), out)
    canvas = canvas.resize((256, 256), Image.LANCZOS)
    canvas.save(os.path.join(OUT, f'{number:02d}.png'))
    return {"number": number, "name": name.upper(), "file": f'{number:02d}.png'}


manifest = []
n = 0
for ry0, ry1 in ROWS:
    for cx0, cx1 in COLS:
        n += 1
        manifest.append(extract((cx0, cx1, ry0, ry1), NAMES[n-1], n))
manifest.append(extract(CELL36, NAMES[35], 36))

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print(f'wrote {len(manifest)} symbols')
