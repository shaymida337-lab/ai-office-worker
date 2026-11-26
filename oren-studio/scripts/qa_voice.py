"""Objective voice QA: Hebrew ASR (ivrit-ai whisper) -> CER vs script, plus prosody stats.
usage: qa_voice.py script.txt a.wav [b.wav ...]"""
import sys, re, json, numpy as np, librosa, jiwer
from faster_whisper import WhisperModel
ref = open(sys.argv[1], encoding='utf-8').read()
norm = lambda s: re.sub(r'\s+', ' ', re.sub(r'[^א-ת0-9 ]', ' ', s)).strip()
m = WhisperModel('/opt/tp/whisper-he', device='cpu', compute_type='int8')
res = {}
for f in sys.argv[2:]:
    segs, _ = m.transcribe(f, language='he', beam_size=5)
    hyp = ' '.join(s.text for s in segs)
    y, sr = librosa.load(f, sr=16000)
    f0, vf, _ = librosa.pyin(y, fmin=60, fmax=300, sr=sr)
    f0v = f0[~np.isnan(f0)]
    rms = librosa.feature.rms(y=y)[0]; sil = (rms < 0.1 * rms.max()).mean()
    dur = len(y) / sr; words = len(norm(ref).split())
    res[f] = dict(cer=round(jiwer.cer(norm(ref), norm(hyp)), 3), dur=round(dur, 1),
                  wpm=round(words / dur * 60), f0_med=round(float(np.median(f0v)), 1),
                  f0_semitone_sd=round(float(np.std(12 * np.log2(f0v / np.median(f0v)))), 2),
                  silence_ratio=round(float(sil), 2), hyp=hyp)
    print(json.dumps({f: res[f]}, ensure_ascii=False))
