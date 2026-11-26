"""Animated Hebrew motion graphics (PIL + raqm RTL) rendered to mp4 frames via ffmpeg.
Brand: Bracha & Hatzlacha renovations — charcoal #1E1F22, yellow #F5C400, white, red #E5484D.
usage: gfx_he.py <counter|quote|checklist> out.mp4 --dur 3.4 [--w 1080 --h 1920]"""
import argparse, subprocess, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
p = argparse.ArgumentParser(); p.add_argument('kind'); p.add_argument('out')
p.add_argument('--dur', type=float, required=True); p.add_argument('--w', type=int, default=1080); p.add_argument('--h', type=int, default=1920)
a = p.parse_args(); W, H, FPS = a.w, a.h, 25
BG, Y, WH, RED, GR = (30, 31, 34), (245, 196, 0), (255, 255, 255), (229, 72, 77), (150, 152, 158)
F = 'assets/fonts/Rubik-VF.ttf'
def font(sz, wght=800):
    f = ImageFont.truetype(F, sz)
    try: f.set_variation_by_axes([wght])
    except Exception: pass
    return f
def ease(x): x = max(0, min(1, x)); return 1 - (1 - x) ** 3
def txt(d, xy, s, f, fill, anchor='mm'): d.text(xy, s, font=f, fill=fill, anchor=anchor, direction='rtl', language='he')
def bg():
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    for i in range(0, W + H, 90): d.line([(i, 0), (i - H, H)], fill=(36, 37, 41), width=2)  # subtle blueprint hatch
    return im
def counter(t):
    im = bg(); d = ImageDraw.Draw(im); k = ease((t - 0.5) / 1.8)
    v = int(50000 + 50000 * k)
    txt(d, (W / 2, H * 0.30), 'התקציב שתכננתם', font(64, 600), GR)
    txt(d, (W / 2, H * 0.40), '₪50,000', font(120), WH)
    col = tuple(int(WH[i] + (RED[i] - WH[i]) * k) for i in range(3))
    s = 1 + 0.12 * math.sin(min(1, k) * math.pi)
    txt(d, (W / 2, H * 0.58), 'מה שתשלמו בפועל', font(64, 600), GR)
    txt(d, (W / 2, H * 0.68), f'₪{v:,}', font(int(170 * s)), col)
    if k > 0.98: txt(d, (W / 2, H * 0.80), 'פי 2.', font(110), Y)
    return im
def quote(t):
    im = bg(); d = ImageDraw.Draw(im)
    px, py, pw, ph = 110, int(H * 0.2), W - 220, int(H * 0.56)
    sh = Image.new('L', (W, H), 0); ImageDraw.Draw(sh).rounded_rectangle([px + 12, py + 18, px + pw + 12, py + ph + 18], 28, fill=150)
    im.paste((10, 10, 12), (0, 0), sh.filter(ImageFilter.GaussianBlur(18)))
    d.rounded_rectangle([px, py, px + pw, py + ph], 28, fill=(250, 248, 242))
    txt(d, (W / 2, py + 90), 'הצעת מחיר', font(76), (25, 25, 25))
    rows = [('הריסה ופינוי', '₪6,500'), ('אינסטלציה', '₪9,800'), ('ריצוף 40 מ"ר', 'כולל חומרים'), ('צבע', '₪4,200')]
    for i, (n, v) in enumerate(rows):
        y = py + 230 + i * 150
        d.line([(px + 60, y + 60), (px + pw - 60, y + 60)], fill=(220, 216, 205), width=3)
        if i == 2:
            hk = ease((t - 0.8) / 0.7); x1 = px + pw - 40; x0 = x1 - (x1 - (px + 40)) * hk
            if hk > 0: d.rounded_rectangle([x0, y - 38, x1, y + 38], 10, fill=(255, 226, 80))
        txt(d, (px + pw - 70, y), n, font(54, 600), (40, 40, 40), 'rm')
        txt(d, (px + 70, y), v, font(54, 800 if i == 2 else 500), RED if (i == 2 and t > 1.6) else (40, 40, 40), 'lm')
    if t > 1.8:
        s = ease((t - 1.8) / 0.35); r = int(70 * s); cx, cy = W // 2, py + 230 + 4 * 150 + 10
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
        if s > 0.5: txt(d, (cx, cy + 4), '?', font(int(90 * s)), WH)
    if t > 2.2: txt(d, (W / 2, H * 0.86), 'אילו חומרים בדיוק?', font(84), Y)
    return im
def checklist(t):
    im = bg(); d = ImageDraw.Draw(im)
    txt(d, (W / 2, H * 0.2), 'לפני שחותמים:', font(96), Y)
    items = ['מחיר לכל סעיף', 'מותג ודגם לכל חומר', 'מחיר לכל שינוי – בכתב']
    for i, s in enumerate(items):
        t0 = 0.4 + i * (a.dur - 1.0) / 3; k = ease((t - t0) / 0.45)
        if k <= 0: continue
        y = H * (0.36 + i * 0.16); x = W - 130 + (1 - k) * 200
        d.rounded_rectangle([x - 70, y - 55, x + 40, y + 55], 22, fill=Y)
        txt(d, (x - 15, y + 3), str(i + 1), font(76), BG)
        txt(d, (x - 110, y), s, font(68, 700), WH, 'rm')
    return im
fn = dict(counter=counter, quote=quote, checklist=checklist)[a.kind]
n = int(a.dur * FPS)
pr = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', a.out], stdin=subprocess.PIPE)
for i in range(n):
    t = i / FPS; im = fn(t)
    if t < 0.25:  # quick scale-in transition
        s = 0.92 + 0.08 * ease(t / 0.25); im2 = im.resize((int(W * s), int(H * s))); im = bg(); im.paste(im2, ((W - im2.width) // 2, (H - im2.height) // 2))
    pr.stdin.write(im.tobytes())
pr.stdin.close(); pr.wait(); print('saved', a.out)
