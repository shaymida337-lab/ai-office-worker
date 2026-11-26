"""Finish a talking-head clip: 4:5 or 9:16 framing, slow push-in + subtle handheld drift, grade, grain,
broadcast audio chain (-14 LUFS), Hebrew captions (ASS) and the permanent 'virtual presenter' disclosure.
usage: finish_talking.py in.mp4 voice.wav captions.ass out.mp4 [--fmt 4x5|9x16] [--zoom 1.06]"""
import argparse, subprocess, json
p = argparse.ArgumentParser(); p.add_argument('inp'); p.add_argument('voice'); p.add_argument('ass'); p.add_argument('out')
p.add_argument('--fmt', default='4x5'); p.add_argument('--zoom', type=float, default=1.06)
p.add_argument('--label', default='פרזנטור וירטואלי · AI')
a = p.parse_args()
W, H = (1080, 1350) if a.fmt == '4x5' else (1080, 1920)
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.voice]).decode())
Z = a.zoom
# scale source to cover the frame at max zoom, then crop a moving window (push-in + slow drift)
vf = (f"scale={int(W*Z*1.04)}:{int(H*Z*1.04)}:force_original_aspect_ratio=increase:flags=lanczos,"
      f"crop=w='iw/(1.04*(1+({Z}-1)*t/{dur}))':h='ih/(1.04*(1+({Z}-1)*t/{dur}))'"
      f":x='(iw-ow)/2+6*sin(t*0.9)+3*sin(t*2.3)':y='(ih-oh)/2.25+5*sin(t*0.7+1)+2*sin(t*1.9)',"
      f"scale={W}:{H}:flags=lanczos,"
      "eq=contrast=1.05:saturation=1.06:gamma=0.98,colorbalance=rs=0.02:gs=0.0:bs=-0.02,"
      "vignette=PI/5,noise=alls=4:allf=t,"
      f"ass={a.ass},"
      f"drawtext=fontfile=assets/fonts/Heebo-VF.ttf:text='{a.label}':fontsize=30:fontcolor=white@0.85:"
      "box=1:boxcolor=black@0.35:boxborderw=12:x=w-tw-36:y=40,format=yuv420p")
af = ("highpass=f=75,equalizer=f=3500:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=3:attack=8:release=120,"
      "loudnorm=I=-14:TP=-1.5:LRA=9")
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', a.inp, '-i', a.voice, '-filter_complex',
                f'[0:v]{vf}[v];[1:a]{af}[a]', '-map', '[v]', '-map', '[a]', '-t', f'{dur:.3f}', '-r', '25',
                '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
                '-movflags', '+faststart', a.out], check=True)
print('saved', a.out)
