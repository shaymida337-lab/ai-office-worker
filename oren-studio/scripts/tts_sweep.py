import sys, json, torch, torchaudio as ta, re, time
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
torch.set_num_threads(4)
m = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
for v in json.load(open(sys.argv[1])):
    torch.manual_seed(v.get('seed', 42))
    text = open(v['text'], encoding='utf-8').read().strip()
    parts = [s.strip() for s in re.split(r'(?<=[.!?…])\s+|\n+', text) if s.strip()]
    ws = []
    for s in parts:
        ws += [m.generate(s, language_id='he', audio_prompt_path=v.get('ref'), exaggeration=v['exag'], cfg_weight=v['cfg'], temperature=v['temp']), torch.zeros(1, int(m.sr*0.25))]
    ta.save(v['out'], torch.cat(ws[:-1], 1), m.sr); print('saved', v['out'], flush=True)
