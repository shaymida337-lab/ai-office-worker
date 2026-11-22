import json,subprocess,os,sys,re
import numpy as np
def load(f):
    b=subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar','16000','-f','f32le','-'],capture_output=True).stdout
    return np.frombuffer(b,np.float32)
from faster_whisper import WhisperModel
m=WhisperModel("small",device="cpu",compute_type="int8")
out={}
for l in open('final_meta.jsonl'):
    d=json.loads(l); vid=d['id']; f=f'vids/{vid}.mp4'
    if not os.path.exists(f): continue
    # scene cuts
    r=subprocess.run(['ffmpeg','-i',f,'-vf',"select='gt(scene,0.3)',showinfo",'-f','null','-'],capture_output=True,text=True)
    cuts=[float(x) for x in re.findall(r'pts_time:([\d.]+)',r.stderr)]
    dur=d.get('duration') or 1
    # audio loudness presence
    segs,info=m.transcribe(load(f),beam_size=1,vad_filter=True)
    segs=list(segs)
    speech=sum(s.end-s.start for s in segs)
    first=[s for s in segs if s.start<4]
    out[vid]=dict(cuts=len(cuts),cuts_per_10s=round(len(cuts)/dur*10,1),first_cut=cuts[0] if cuts else None,
        lang=info.language,lang_p=round(info.language_probability,2),speech_ratio=round(speech/dur,2),
        opening=' '.join(s.text.strip() for s in first)[:200], first_speech=round(segs[0].start,2) if segs else None)
    print(vid,out[vid],flush=True)
json.dump(out,open('analysis.json','w'),ensure_ascii=False,indent=1)
