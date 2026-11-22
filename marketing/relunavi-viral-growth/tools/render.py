"""RELUNAVI short-video renderer.
spec -> narration (he-IL female TTS, word timings) -> shots (crop removes burned-in captions) ->
synced Hebrew captions in TikTok/Reels safe zone -> 1080x1920 H.264 + AAC 48k, loudness -14 LUFS.
Outputs per video: <id>.mp4, <id>_voiceover.mp3, <id>.srt, <id>_script.txt
"""
import asyncio, json, os, re, ssl, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
FONT = os.path.join(ROOT, "fonts", "Heebo.ttf")
W, H = 1080, 1920
# Source crop window that excludes burned-in captions (y 1445-1615) and the top-left badge
CROP_Y0, CROP_H = 130, 1300
CROP_W = round(CROP_H * W / H)  # 776

def font(size, weight="ExtraBold"):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f

def wrap(draw, text, f, maxw):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for w in para.split(" "):
            t = (cur + " " + w).strip()
            if draw.textlength(t, font=f, direction="rtl", language="he") <= maxw or not cur:
                cur = t
            else:
                lines.append(cur); cur = w
        lines.append(cur)
    return lines

def text_png(path, text, style):
    """style: hook (black text on white box, top), cap (white with black stroke), tag, end"""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if style == "hook":
        f = font(62); maxw = 760; lines = wrap(d, text, f, maxw); lh = 84
        y = 300
        for ln in lines:
            tw = d.textlength(ln, font=f, direction="rtl", language="he")
            x = (W - tw) / 2
            d.rounded_rectangle([x - 26, y - 8, x + tw + 26, y + lh - 2], 18, fill=(255, 255, 255, 245))
            d.text((x, y), ln, font=f, fill=(15, 15, 15, 255), direction="rtl", language="he")
            y += lh
    elif style == "cap":
        f = font(70); lines = wrap(d, text, f, 760); lh = 92
        y = 1250 - (len(lines) - 1) * lh
        for ln in lines:
            tw = d.textlength(ln, font=f, direction="rtl", language="he")
            d.text(((W - tw) / 2, y), ln, font=f, fill=(255, 255, 255, 255), stroke_width=7,
                   stroke_fill=(0, 0, 0, 255), direction="rtl", language="he")
            y += lh
    elif style == "tag":
        f = font(30, "Medium")
        tw = d.textlength(text, font=f, direction="rtl", language="he")
        x, y = 70, 235
        d.rounded_rectangle([x - 14, y - 6, x + tw + 14, y + 42], 12, fill=(0, 0, 0, 120))
        d.text((x, y), text, font=f, fill=(255, 255, 255, 230), direction="rtl", language="he")
    elif style == "end":
        f1 = font(84, "Black"); f2 = font(54, "Bold")
        t1 = "RELUNAVI"; t2 = text
        tw1 = d.textlength(t1, font=f1); tw2 = d.textlength(t2, font=f2, direction="rtl", language="he")
        y = 760
        d.rounded_rectangle([(W - max(tw1, tw2)) / 2 - 50, y - 40, (W + max(tw1, tw2)) / 2 + 50, y + 230], 30,
                            fill=(20, 60, 45, 235))
        d.text(((W - tw1) / 2, y), t1, font=f1, fill=(255, 255, 255, 255))
        d.text(((W - tw2) / 2, y + 120), t2, font=f2, fill=(255, 255, 255, 255), direction="rtl", language="he")
    img.save(path)

# ---------- TTS ----------
async def _tts(text, out_mp3, rate):
    import edge_tts.communicate as c
    c._SSL_CTX = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
    import edge_tts
    com = edge_tts.Communicate(text, "he-IL-HilaNeural", rate=rate, pitch="+2Hz", boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as f:
        async for ch in com.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["offset"] / 1e7, (ch["offset"] + ch["duration"]) / 1e7, ch["text"]))
    return words

def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", p]).decode().strip())

def chunk_words(words, text_lines):
    """Group word timings into caption chunks following the scripted caption lines (1 line = 1 chunk).
    text_lines are the VO sentences split by '|' in the spec; we align by word count."""
    chunks, i = [], 0
    for line in text_lines:
        n = len(line.split())
        seg = words[i:i + n]
        if not seg:
            break
        chunks.append([seg[0][0], seg[-1][1], line]); i += n
    for k in range(len(chunks) - 1):      # hold each caption until the next one starts
        chunks[k][1] = chunks[k + 1][0]
    return chunks

def srt_time(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

def render(spec, outdir):
    vid = spec["id"]; os.makedirs(outdir, exist_ok=True)
    tmp = os.path.join(outdir, "_tmp_" + vid); os.makedirs(tmp, exist_ok=True)
    cap_lines = [s.strip() for s in spec["vo"].split("|") if s.strip()]
    vo_text = " ".join(cap_lines)
    vo_mp3 = os.path.join(outdir, f"{vid}_voiceover.mp3")
    import time
    for attempt in range(5):
        try:
            words = asyncio.run(_tts(vo_text, vo_mp3, spec.get("rate", "+10%"))); break
        except Exception as e:
            if attempt == 4: raise
            time.sleep(3 * (attempt + 1))
    n_words = sum(len(l.split()) for l in cap_lines)
    assert len(words) == n_words, f"{vid}: TTS returned {len(words)} word boundaries, script has {n_words}"
    lead = spec.get("vo_delay", 0.15)
    vo_d = dur(vo_mp3)
    total = round(max(spec.get("min_len", 0), lead + vo_d + spec.get("tail", 0.7)), 2)
    chunks = chunk_words(words, cap_lines)
    for c in chunks:
        c[0] += lead; c[1] += lead
    chunks[-1][1] = total
    # ---- shots
    shots, acc = [], 0.0
    for s in spec["shots"]:
        src, t0, t1, xc = s[:4]; z = s[4] if len(s) > 4 else 1.0; yc = s[5] if len(s) > 5 else None
        d = min(t1 - t0, total - acc)
        if d <= 0.05: break
        shots.append((src, t0, d, xc, z, yc)); acc += d
    if acc < total - 0.05:
        raise SystemExit(f"{vid}: shots cover {acc:.2f}s < {total:.2f}s")
    # ---- overlays
    ov = []
    if spec.get("hook"):
        p = os.path.join(tmp, "hook.png"); text_png(p, spec["hook"], "hook")
        ov.append((p, 0, spec.get("hook_until", total)))
    p = os.path.join(tmp, "tag.png"); text_png(p, "הדמיה", "tag"); ov.append((p, 0, total))
    for k, (a, b, t) in enumerate(chunks):
        p = os.path.join(tmp, f"cap{k}.png"); text_png(p, t.rstrip(",،"), "cap"); ov.append((p, a, b))
    if spec.get("end"):
        p = os.path.join(tmp, "end.png"); text_png(p, spec["end"], "end"); ov.append((p, total - spec.get("end_len", 1.6), total))
    # ---- ffmpeg graph
    args = ["ffmpeg", "-v", "error", "-y"]
    for (src, t0, d, xc, z, yc) in shots:
        args += ["-ss", f"{t0:.3f}", "-t", f"{d:.3f}", "-i", os.path.join(SRC, src + ".mp4")]
    args += ["-i", vo_mp3]
    for (p, a, b) in ov:
        args += ["-i", p]
    fc = []
    for i, (src, t0, d, xc, z, yc) in enumerate(shots):
        cw, ch = CROP_W / z, CROP_H / z
        cy = (CROP_Y0 + CROP_H / 2) if yc is None else yc
        x = min(max(xc - cw / 2, 0), 1080 - cw); y = min(max(cy - ch / 2, CROP_Y0), CROP_Y0 + CROP_H - ch)
        fc.append(f"[{i}:v]fps=30,crop={cw:.0f}:{ch:.0f}:{x:.0f}:{y:.0f},scale={W}:{H}:flags=lanczos,setsar=1,"
                  f"trim=duration={d:.3f},setpts=PTS-STARTPTS[v{i}]")
    fc.append("".join(f"[v{i}]" for i in range(len(shots))) + f"concat=n={len(shots)}:v=1:a=0[base]")
    last = "base"; nA = len(shots)
    for j, (p, a, b) in enumerate(ov):
        fc.append(f"[{last}][{nA + 1 + j}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[o{j}]"); last = f"o{j}"
    fc.append(f"[{nA}:a]adelay={int(lead * 1000)}:all=1,aresample=48000,apad,atrim=0:{total:.3f},"
              f"loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
    out = os.path.join(outdir, f"{vid}.mp4")
    args += ["-filter_complex", ";".join(fc), "-map", f"[{last}]", "-map", "[aout]",
             "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
             "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{total:.3f}",
             "-movflags", "+faststart", out]
    subprocess.run(args, check=True)
    # ---- subtitles + script
    with open(os.path.join(outdir, f"{vid}.srt"), "w", encoding="utf-8") as f:
        for k, (a, b, t) in enumerate(chunks, 1):
            f.write(f"{k}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n\n")
    with open(os.path.join(outdir, f"{vid}_script.txt"), "w", encoding="utf-8") as f:
        f.write(f"ID: {vid}\nHook (on-screen): {spec.get('hook','')}\nVO: {vo_text}\nEnd: {spec.get('end','')}\n"
                f"Length: {total:.2f}s\nShots: {json.dumps(shots, ensure_ascii=False)}\n")
    subprocess.run(["rm", "-rf", tmp])
    return dict(id=vid, length=total, vo_len=round(vo_d, 2), captions=chunks, shots=len(shots))

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    from specs import SPECS
    only = sys.argv[2:] if len(sys.argv) > 2 else None
    res = []
    for s in SPECS:
        if only and s["id"] not in only: continue
        r = render(s, sys.argv[1]); print(json.dumps(r, ensure_ascii=False)); res.append(r)
    json.dump(res, open(os.path.join(sys.argv[1], "render_log.json"), "w"), ensure_ascii=False, indent=1)
