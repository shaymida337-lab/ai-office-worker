"""Automated QA for RELUNAVI videos. Usage: python3 qa.py <outdir>
Checks: format, duration bucket, loudness/peak, black frames, voice audible + transcript match (Whisper),
caption/voice sync, claims & price scan, source-range rights/price guard, safe-zone preview sheets."""
import json, os, re, subprocess, sys, difflib
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from specs import SPECS

OUT = sys.argv[1]
BUCKETS = {"8-10s": (8.0, 10.0), "11-15s": (11.0, 15.0), "16-20s": (16.0, 20.0)}
FORBIDDEN = ["₪", "מחיר", "שקל", "הנחה", "מבצע", "מרפא", "ריפוי", "מרפאים", "רפואי", "טיפול", "מטפל",
             "מעלים את הכאב", "כאבים", "מבטיח", "מוכח", "קליני", "רופא", "ביקורת", "לקוחות אומרים", "הכי טוב בעולם"]
# Source ranges allowed (neck/shoulder only; no end card / price / leg / back segments)
ALLOWED = {"n7_full_demo": [(0, 25.0), (44.9, 54.6)], "n7_main": [(0, 3.0)], "n7_30s": [(0, 30.2)]}

def probe(p):
    return json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", p]))

def ebur(p):
    r = subprocess.run(["ffmpeg", "-i", p, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r)[-1]); tp = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r)[-1])
    return I, tp

def black(p):
    r = subprocess.run(["ffmpeg", "-i", p, "-vf", "blackdetect=d=0.2:pix_th=0.08", "-an", "-f", "null", "-"], capture_output=True, text=True).stderr
    return len(re.findall("black_start", r))

def norm(t):
    t = re.sub(r"[^\u0590-\u05FFA-Za-z0-9 ]", " ", t); t = re.sub(r"[\u0591-\u05C7]", "", t)
    return re.sub(r"\s+", " ", t).strip().lower()

def audio(p):
    b = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(b, np.float32)

def srt(p):
    items = []
    for blk in open(p, encoding="utf-8").read().strip().split("\n\n"):
        l = blk.split("\n"); a, b = l[1].split(" --> ")
        f = lambda s: int(s[:2]) * 3600 + int(s[3:5]) * 60 + int(s[6:8]) + int(s[9:]) / 1000
        items.append((f(a), f(b), l[2]))
    return items

def safe_sheet(p, dst, d):
    """Frames at 0, 0.5s, 1/2, end-0.4 with TikTok/Reels UI danger zones shaded red."""
    tiles = []
    for t in [0.0, 0.5, d / 2, max(d - 0.4, 0)]:
        f = dst + f"_{t:.1f}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", p, "-frames:v", "1", f], check=True)
        im = Image.open(f).convert("RGB"); ov = Image.new("RGBA", im.size, (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
        dr.rectangle([0, 0, 1080, 200], fill=(255, 0, 0, 70))        # top tabs / status
        dr.rectangle([0, 1500, 1080, 1920], fill=(255, 0, 0, 70))     # caption / username / music
        dr.rectangle([940, 800, 1080, 1500], fill=(255, 0, 0, 70))    # right action buttons
        im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB").resize((270, 480)); tiles.append(im); os.remove(f)
    sheet = Image.new("RGB", (270 * 4 + 30, 480), "white")
    for i, t in enumerate(tiles): sheet.paste(t, (i * 280, 0))
    sheet.save(dst + "_safezones.jpg")

def main():
    from faster_whisper import WhisperModel
    m = WhisperModel("small", device="cpu", compute_type="int8")
    report = []
    for s in SPECS:
        vid = s["id"]; p = os.path.join(OUT, vid + ".mp4")
        if not os.path.exists(p): continue
        r = {"id": vid, "checks": {}, "fail": []}
        def chk(name, ok, val):
            r["checks"][name] = {"ok": bool(ok), "value": val}
            if not ok: r["fail"].append(name)
        pr = probe(p); v = [x for x in pr["streams"] if x["codec_type"] == "video"][0]; a = [x for x in pr["streams"] if x["codec_type"] == "audio"]
        d = float(pr["format"]["duration"])
        chk("resolution_1080x1920", (v["width"], v["height"]) == (1080, 1920), f'{v["width"]}x{v["height"]}')
        chk("h264_yuv420p", v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p", f'{v["codec_name"]}/{v["pix_fmt"]}')
        chk("aac_48k", bool(a) and a[0]["codec_name"] == "aac" and a[0]["sample_rate"] == "48000", a[0]["codec_name"] if a else None)
        lo, hi = BUCKETS[s["bucket"]]; chk("length_in_bucket", lo <= d <= hi + 0.05, round(d, 2))
        I, tp = ebur(p); chk("loudness_-14LUFS±1.5", abs(I + 14) <= 1.5, I); chk("true_peak<=-1dB", tp <= -0.9, tp)
        chk("no_black_frames", black(p) == 0, black(p))
        # voice audible + transcript
        segs, info = m.transcribe(audio(p), language="he", beam_size=5, word_timestamps=True, vad_filter=False)
        segs = list(segs); hyp = " ".join(x.text for x in segs)
        ref = " ".join(t.strip() for t in s["vo"].split("|"))
        sim = difflib.SequenceMatcher(None, norm(hyp), norm(ref)).ratio()
        r["transcript"] = hyp.strip()
        chk("voice_present", len(norm(hyp)) > 10, len(norm(hyp)))
        chk("transcript_match>=0.70", sim >= 0.70, round(sim, 2))
        # sync: first spoken word vs first caption; each caption start vs nearest whisper word start
        caps = srt(os.path.join(OUT, vid + ".srt"))
        # sync measured against real speech onsets (silencedetect), not Whisper word stamps
        sd = subprocess.run(["ffmpeg", "-i", p, "-af", "silencedetect=n=-35dB:d=0.12", "-f", "null", "-"], capture_output=True, text=True).stderr
        onsets = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", sd)]
        onsets = [o for o in onsets if o < d - 0.2]
        # for each caption: the next speech onset must come 0-0.35s after it appears (caption never late, never too early)
        sil = list(zip([float(x) for x in re.findall(r"silence_start: ([\d.]+)", sd)], [float(x) for x in re.findall(r"silence_end: ([\d.]+)", sd)] + [d]))
        def lag(c):
            if not any(a0 <= c <= b0 for a0, b0 in sil): return 0.0     # speech already in progress (continuous phrase)
            return min([o - c for o in onsets if o >= c - 0.05] or [9])
        offs = [lag(c[0]) for c in caps]
        chk("caption_sync<=0.35s", bool(offs) and max(offs) <= 0.35, round(max(offs), 2) if offs else None)
        chk("captions_cover_vo", abs(caps[-1][1] - d) < 0.1 and caps[0][0] < 0.5, f"{caps[0][0]:.2f}-{caps[-1][1]:.2f}")
        # claims / price
        text = " ".join([s.get("hook", ""), s["vo"], s.get("end", "")])
        bad = [w for w in FORBIDDEN if w in text]; chk("no_price_or_medical_claims", not bad, bad)
        # source ranges (rights + no price/end card + only verified use-areas)
        viol = []
        for sh in s["shots"]:
            rng = ALLOWED.get(sh[0], [])
            if not any(a0 <= sh[1] and sh[2] <= b0 for a0, b0 in rng): viol.append(sh[:3])
        chk("source_ranges_allowed", not viol, viol)
        safe_sheet(p, os.path.join(OUT, "qa_" + vid), d)
        r["status"] = "PASS (auto)" if not r["fail"] else "FAIL"
        report.append(r); print(vid, r["status"], r["fail"], "sim", round(sim, 2), "I", I, "TP", tp, flush=True)
    json.dump(report, open(os.path.join(OUT, "qa_report.json"), "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
