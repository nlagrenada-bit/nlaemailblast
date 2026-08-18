#!/usr/bin/env python3
"""Pre-render every lottery ball the app can ever need as a PNG.

Why images and not CSS: Outlook (Word rendering engine) ignores border-radius,
so CSS balls arrive as squares for a large share of corporate recipients.
Rendering once, here, means the balls look identical in Outlook, Gmail,
Apple Mail, and every webmail client.

Run:  python3 scripts/generate_balls.py
Out:  public/assets/balls/<style>-<value>.png   (112px, displayed at 56px)
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'balls')
os.makedirs(OUT, exist_ok=True)

SIZE = 112          # rendered size (2x for retina)
SS = 4              # supersample factor for smooth edges
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# style -> (base colour, ink colour)
STYLES = {
    'playway':  ('#1E9BD7', '#FFFFFF'),
    'pick3':    ('#57B23D', '#FFFFFF'),
    'cash4':    ('#0A5AA0', '#FFFFFF'),
    'cashpop':  ('#14459B', '#FFFFFF'),
    'lotto':    ('#3B4EA0', '#FFFFFF'),
    'super6':   ('#E42229', '#FFFFFF'),
    'multix':   ('#FFD200', '#123A7A'),
    'letter':   ('#FFFFFF', '#123A7A'),
}


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(rgb, f):
    """f > 1 lightens toward white, f < 1 darkens."""
    if f >= 1:
        t = f - 1
        return tuple(min(255, round(c + (255 - c) * t)) for c in rgb)
    return tuple(max(0, round(c * f)) for c in rgb)


def draw_ball(value, style):
    base, ink = STYLES[style]
    base_rgb, ink_rgb = hex2rgb(base), hex2rgb(ink)
    S = SIZE * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # sphere body: radial-ish shading, lit from the upper left
    steps = 90
    for i in range(steps, 0, -1):
        t = i / steps
        r = S / 2 * t
        # light at 38%,32% of the ball
        cx = S / 2 - (S * 0.09) * (1 - t)
        cy = S / 2 - (S * 0.11) * (1 - t)
        f = 0.62 + 0.72 * (1 - t) ** 0.85
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=shade(base_rgb, f))

    # rim so pale balls stay legible on white
    d.ellipse([1, 1, S - 2, S - 2], outline=shade(base_rgb, 0.55), width=max(2, S // 90))

    # specular highlight
    hw, hh = S * 0.26, S * 0.17
    hx, hy = S * 0.30, S * 0.20
    gloss = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse([hx, hy, hx + hw, hy + hh], fill=(255, 255, 255, 150))
    img = Image.alpha_composite(img, gloss)

    # numerals, auto-fitted so '10X' and '5' both sit right
    text = str(value)
    target = S * (0.62 if len(text) <= 2 else 0.74)
    size = int(S * 0.52)
    while size > 8:
        font = ImageFont.truetype(FONT, size)
        box = ImageDraw.Draw(img).textbbox((0, 0), text, font=font)
        if (box[2] - box[0]) <= target:
            break
        size -= 2
    font = ImageFont.truetype(FONT, size)
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), text, font=font)
    tx = (S - (box[2] - box[0])) / 2 - box[0]
    ty = (S - (box[3] - box[1])) / 2 - box[1]
    d.text((tx, ty), text, font=font, fill=ink_rgb)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def pad2(v):
    return str(v).zfill(2) if isinstance(v, int) else str(v)


PLAN = {
    'playway':  [f'{n:02d}' for n in range(1, 37)],
    'cashpop':  [f'{n:02d}' for n in range(1, 16)],
    'lotto':    [f'{n:02d}' for n in range(1, 35)],
    'super6':   [f'{n:02d}' for n in range(1, 29)],
    'pick3':    [str(n) for n in range(10)],
    'cash4':    [str(n) for n in range(10)],
    'multix':   ['FP', '2X', '3X', '5X', '7X', '10X'],
    'letter':   list('ABCDEFGHIJKLMNO'),
}

if __name__ == '__main__':
    n = 0
    for style, values in PLAN.items():
        for v in values:
            draw_ball(v, style).save(os.path.join(OUT, f'{style}-{v}.png'), optimize=True)
            n += 1
    print(f'wrote {n} ball images to {os.path.normpath(OUT)}')
