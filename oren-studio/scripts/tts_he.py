"""Oren Hebrew TTS: text -> Phonikud niqqud -> Chatterbox Multilingual (CPU), with ASR self-check.
Each sentence is generated, transcribed by ivrit-ai whisper and regenerated (new seed) if it does not match.
usage: tts_he.py in.txt out.wav [--ref voice.wav] [--exag 0.6] [--seed 42] [--tries 4]"""
import argparse, re, random, json, tempfile, numpy as np, torch, torchaudio as ta, jiwer
from phonikud_onnx import Phonikud
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from faster_whisper import WhisperModel

NUM = {'50': 'חמישים', '100': 'מאה', '20': 'עשרים', '30': 'שלושים', '10': 'עשר', '3': 'שלושה'}
def norm(t):
    t = re.sub(r'(\d+),000', lambda m: m.group(1) + ' אלף', t)
    t = re.sub(r'\d+', lambda m: NUM.get(m.group(0), m.group(0)), t)
    t = re.sub(r'[^א-ת ]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

p = argparse.ArgumentParser(); p.add_argument('inp'); p.add_argument('out'); p.add_argument('--ref')
p.add_argument('--exag', type=float, default=0.6); p.add_argument('--cfg', type=float, default=0.4)
p.add_argument('--temp', type=float, default=0.8); p.add_argument('--seed', type=int, default=42)
p.add_argument('--pause', type=float, default=0.22); p.add_argument('--tries', type=int, default=4)
a = p.parse_args()
torch.set_num_threads(4)
nik = Phonikud('/opt/tp/phonikud/phonikud-1.0.int8.onnx')
m = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
asr = WhisperModel('/opt/tp/whisper-he', device='cpu', compute_type='int8')
text = open(a.inp, encoding='utf-8').read().strip()
parts = [s.strip() for s in re.split(r'(?<=[.!?…])\s+|\n+', text) if s.strip()]
ws, log = [], []
for i, s in enumerate(parts):
    v = nik.add_diacritics(s).replace('|', '').replace('֫', '').replace('ֽ', '')
    best = None
    for k in range(a.tries):
        sd = a.seed + i * 100 + k
        torch.manual_seed(sd); random.seed(sd); np.random.seed(sd)
        w = m.generate(v, language_id='he', audio_prompt_path=a.ref, exaggeration=a.exag, cfg_weight=a.cfg, temperature=a.temp)
        x = w[0]; thr = 0.02 * x.abs().max(); idx = (x.abs() > thr).nonzero()
        if len(idx): x = x[max(0, idx[0].item() - 800): idx[-1].item() + 2400]
        f = tempfile.mktemp(suffix='.wav'); ta.save(f, x[None], m.sr)
        hyp = ' '.join(z.text for z in asr.transcribe(f, language='he', beam_size=5)[0])
        cer = jiwer.cer(norm(s), norm(hyp)); dur = x.shape[0] / m.sr
        score = cer + (0.5 if dur > 0.11 * len(s) + 1.0 else 0)
        print(f'[{i}] try{k} cer={cer:.3f} dur={dur:.1f}s | {hyp}', flush=True)
        if best is None or score < best[0]: best = (score, x, cer, hyp, sd)
        if score <= 0.06: break
    log.append(dict(sentence=s, cer=round(best[2], 3), asr=best[3], seed=best[4]))
    ws += [best[1][None], torch.zeros(1, int(m.sr * a.pause))]
ta.save(a.out, torch.cat(ws[:-1], 1), m.sr)
json.dump(log, open(a.out + '.qa.json', 'w'), ensure_ascii=False, indent=1)
print('saved', a.out)
