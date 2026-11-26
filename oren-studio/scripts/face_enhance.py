"""Per-frame GFPGAN v1.4 face restoration (CPU), blended to preserve identity.
usage: face_enhance.py in.mp4 out.mp4 [--weight 0.5] [--blend 0.7]"""
import argparse, cv2, numpy as np, subprocess, os, tempfile
from gfpgan import GFPGANer
p = argparse.ArgumentParser(); p.add_argument('inp'); p.add_argument('out')
p.add_argument('--weight', type=float, default=0.5); p.add_argument('--blend', type=float, default=0.7)
a = p.parse_args()
r = GFPGANer(model_path='/opt/tp/gfpgan/GFPGANv1.4.pth', upscale=1, arch='clean', channel_multiplier=2, bg_upsampler=None)
cap = cv2.VideoCapture(a.inp); fps = cap.get(cv2.CAP_PROP_FPS)
w, h = int(cap.get(3)), int(cap.get(4)); n = int(cap.get(7))
tmp = tempfile.mktemp(suffix='.mp4')
vw = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))
i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    _, _, out = r.enhance(f, has_aligned=False, only_center_face=True, paste_back=True, weight=a.weight)
    if out is None: out = f
    vw.write(cv2.addWeighted(out, a.blend, f, 1 - a.blend, 0)); i += 1
    if i % 25 == 0: print(f'{i}/{n}', flush=True)
vw.release()
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-i', a.inp, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', a.out], check=True)
os.remove(tmp); print('saved', a.out)
