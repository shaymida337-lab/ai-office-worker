"""Hebrew word-timed captions (ASS) from script + audio.
Whisper (ivrit-ai) gives word timings; the script's own spelling is aligned onto them (difflib), so
captions show the exact script text (numbers as written), timed to the real voice.
usage: captions_he.py script.txt voice.wav out.ass [--w 1080 --h 1350 --words 3 --y 0.72]"""
import argparse, re, difflib
from faster_whisper import WhisperModel
p = argparse.ArgumentParser(); p.add_argument('script'); p.add_argument('audio'); p.add_argument('out')
p.add_argument('--w', type=int, default=1080); p.add_argument('--h', type=int, default=1350)
p.add_argument('--words', type=int, default=3); p.add_argument('--y', type=float, default=0.72)
p.add_argument('--size', type=int, default=78); p.add_argument('--offset', type=float, default=0.0)
a = p.parse_args()
clean = lambda t: re.sub(r'[^א-ת0-9]', '', t)
sw = [w for w in re.split(r'\s+', open(a.script, encoding='utf-8').read()) if clean(w)]
m = WhisperModel('/opt/tp/whisper-he', device='cpu', compute_type='int8')
segs, _ = m.transcribe(a.audio, language='he', word_timestamps=True, beam_size=5)
ww = [(w.word.strip(), w.start, w.end) for s in segs for w in s.words if clean(w.word)]
sm = difflib.SequenceMatcher(None, [clean(w) for w in sw], [clean(w[0]) for w in ww], autojunk=False)
t = [None] * len(sw)
for op, i1, i2, j1, j2 in sm.get_opcodes():
    if op == 'equal':
        for k in range(i2 - i1): t[i1 + k] = ww[j1 + k][1:]
    elif j2 > j1:  # replace: spread the whisper span over the script words
        s0, e0 = ww[j1][1], ww[j2 - 1][2]; n = i2 - i1
        for k in range(n): t[i1 + k] = (s0 + (e0 - s0) * k / n, s0 + (e0 - s0) * (k + 1) / n)
for i in range(len(t)):  # fill gaps
    if t[i] is None: t[i] = (t[i - 1][1], t[i - 1][1] + 0.3) if i else (0, 0.3)
def ts(x):
    x = max(0, x + a.offset); return f'{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}'
Y = int(a.h * a.y)
hdr = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {a.w}
PlayResY: {a.h}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Rubik ExtraBold,{a.size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,6,3,5,60,60,0,177

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
ev = []
for g in range(0, len(sw), a.words):
    grp = list(range(g, min(g + a.words, len(sw))))
    for j in grp:  # one event per active word: active word in brand yellow + pop
        st = t[j][0]; en = t[j + 1][0] if j + 1 < len(sw) and j != grp[-1] else t[j][1] + 0.15
        txt = ' '.join((r'{\c&H00C8FF&\fscx108\fscy108}' + sw[k] + r'{\c&HFFFFFF&\fscx100\fscy100}') if k == j else sw[k] for k in grp)
        ev.append(f'Dialogue: 0,{ts(st)},{ts(en)},Cap,,0,0,0,,{{\\an5\\pos({a.w // 2},{Y})}}{txt}')
open(a.out, 'w', encoding='utf-8').write(hdr + '\n'.join(ev) + '\n'); print('saved', a.out, len(sw), 'words')
