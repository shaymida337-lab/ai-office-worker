#!/usr/bin/env python3
"""Generate the AI Office Worker favicon/app-icon set with Pillow.
Draws a master glyph at high resolution and downsamples (LANCZOS) for crisp output.
Two masters: 'detailed' (with spark) for large sizes, 'simple' for tiny sizes."""
from PIL import Image, ImageDraw
import math, os

OUT = "/mnt/user-data/outputs/ai-office-worker/brand/favicons"
os.makedirs(OUT, exist_ok=True)

# brand colors
BLUE_TL = (58, 108, 255)    # #3a6cff
BLUE_MID = (29, 91, 255)    # #1d5bff
BLUE_BR = (20, 60, 191)     # #143cbf
WHITE = (255, 255, 255)
GREEN_A = (52, 211, 153)    # #34d399
GREEN_B = (16, 185, 129)    # #10b981

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def gradient_tile(size, radius):
    """Diagonal blue gradient inside a rounded square, transparent outside."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    maxd = (size - 1) * 2
    for y in range(size):
        for x in range(size):
            t = (x + y) / maxd            # 0 (top-left) -> 1 (bottom-right)
            if t < 0.55:
                c = lerp(BLUE_TL, BLUE_MID, t / 0.55)
            else:
                c = lerp(BLUE_MID, BLUE_BR, (t - 0.55) / 0.45)
            px[x, y] = (c[0], c[1], c[2], 255)
    # rounded-rect alpha mask
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    return img

def round_line(draw, p0, p1, width, fill):
    """Thick line with round caps."""
    draw.line([p0, p1], fill=fill, width=width)
    r = width / 2.0
    for p in (p0, p1):
        draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=fill)

def bar_gradient_color():
    return lerp(GREEN_A, GREEN_B, 0.5)

def draw_glyph(img, size, detailed=True):
    d = ImageDraw.Draw(img)
    def P(nx, ny):
        return (nx * size, ny * size)
    # chevron (ascending A)
    apex = P(0.500, 0.300)
    lf   = P(0.265, 0.742)
    rf   = P(0.735, 0.742)
    cw = int(round(0.112 * size))
    round_line(d, lf, apex, cw, WHITE)
    round_line(d, apex, rf, cw, WHITE)
    # round the apex joint
    r = cw / 2.0
    d.ellipse([apex[0]-r, apex[1]-r, apex[0]+r, apex[1]+r], fill=WHITE)
    # green crossbar
    bw = int(round(0.100 * size))
    round_line(d, P(0.322, 0.602), P(0.678, 0.602), bw, bar_gradient_color())
    # AI spark (detailed only)
    if detailed:
        cx, cy = P(0.760, 0.250)
        s = 0.085 * size
        pts = [(cx, cy - s), (cx + s*0.32, cy - s*0.32), (cx + s, cy),
               (cx + s*0.32, cy + s*0.32), (cx, cy + s),
               (cx - s*0.32, cy + s*0.32), (cx - s, cy),
               (cx - s*0.32, cy - s*0.32)]
        d.polygon(pts, fill=GREEN_A)

def render(size, detailed=True, SS=4):
    big = size * SS
    radius = int(round(0.222 * big))
    img = gradient_tile(big, radius)
    draw_glyph(img, big, detailed=detailed)
    return img.resize((size, size), Image.LANCZOS)

# PNG outputs: (filename, size, detailed)
targets = [
    ("favicon-16.png", 16, False),
    ("favicon-32.png", 32, False),
    ("favicon-48.png", 48, False),
    ("apple-touch-icon.png", 180, True),
    ("android-chrome-192.png", 192, True),
    ("android-chrome-512.png", 512, True),
    ("icon-256.png", 256, True),
]
# keep supersample memory reasonable for big sizes
imgs = {}
for name, sz, det in targets:
    ss = 8 if sz <= 64 else (4 if sz <= 192 else 2)
    im = render(sz, detailed=det, SS=ss)
    im.save(os.path.join(OUT, name))
    imgs[sz] = im
    print("wrote", name)

# multi-resolution .ico (use simple master at small sizes for legibility)
ico_sizes = [16, 32, 48]
ico_imgs = [render(s, detailed=False, SS=8) for s in ico_sizes]
ico_imgs[0].save(os.path.join(OUT, "favicon.ico"),
                 sizes=[(s, s) for s in ico_sizes],
                 append_images=ico_imgs[1:])
print("wrote favicon.ico")
print("DONE")
