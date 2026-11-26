"""Hebrew TTS with Chatterbox Multilingual (MIT, runs on CPU).
usage: tts_chatterbox.py --text-file f.txt --out o.wav [--ref ref.wav] [--exag 0.6] [--cfg 0.4] [--temp 0.8] [--seed 42]
Long text is split by sentence (model limit ~300 chars) and joined with short natural pauses."""
import argparse, re, time, torch, torchaudio as ta, random, numpy as np
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
p = argparse.ArgumentParser()
p.add_argument('--text-file', required=True); p.add_argument('--out', required=True)
p.add_argument('--ref'); p.add_argument('--exag', type=float, default=0.6)
p.add_argument('--cfg', type=float, default=0.4); p.add_argument('--temp', type=float, default=0.8)
p.add_argument('--seed', type=int, default=42); p.add_argument('--pause', type=float, default=0.28)
a = p.parse_args()
torch.manual_seed(a.seed); random.seed(a.seed); np.random.seed(a.seed)
torch.set_num_threads(4)
m = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
text = open(a.text_file, encoding='utf-8').read().strip()
parts = [s.strip() for s in re.split(r'(?<=[.!?…])\s+|\n+', text) if s.strip()]
wavs = []; t0 = time.time()
for s in parts:
    w = m.generate(s, language_id='he', audio_prompt_path=a.ref, exaggeration=a.exag, cfg_weight=a.cfg, temperature=a.temp)
    wavs += [w, torch.zeros(1, int(m.sr * a.pause))]
out = torch.cat(wavs[:-1], dim=1)
ta.save(a.out, out, m.sr)
print(f'done {out.shape[1]/m.sr:.1f}s audio in {time.time()-t0:.0f}s')
