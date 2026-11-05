#!/usr/bin/env python3
"""Add a Hebrew voiceover (edge-tts, he-IL-HilaNeural) to RELUNAVI_ad.mp4.

Usage:
    pip install edge-tts          # ffmpeg/ffprobe must be on PATH
    python make_voiceover.py [input.mp4] [output.mp4]

Defaults: input = RELUNAVI_ad.mp4, output = RELUNAVI_ad_voice.mp4 (same folder as input).
"""
import asyncio
import os
import subprocess
import sys

import edge_tts

VOICE = "he-IL-HilaNeural"
BASE_RATE = 5      # +5%
MAX_RATE = 20      # speed up to at most +20% when a segment does not fit
RATE_STEP = 1
GAP = 0.15         # minimum silence (s) kept before the next segment starts
MUSIC_VOL = 0.25
VOICE_VOL = 1.6    # boost voice; a limiter afterwards prevents clipping

SEGMENTS = [
    (0.3, "רגליים עייפות בסוף היום? יש לנו בדיוק את הפתרון."),
    (3.4, "מעסה הקרסול של רלונאבי, עם חימום ורטט."),
    (7.8, "חום נעים שמשחרר את השרירים, עיסוי רטט מרגיע, והכול בלחיצה אחת, בנוחות של הבית."),
    (13.2, "רגע של שקט, בסוף כל יום."),
    (16.4, "עכשיו רק מאה ארבעים ותשעה שקלים, עם משלוח חינם לנקודת איסוף. הזמינו עכשיו!"),
]


def duration(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path])
    return float(out.strip())


async def tts(text, rate, path):
    await edge_tts.Communicate(text, VOICE, rate=f"+{rate}%").save(path)


async def build_segments(video_len, workdir):
    clips = []
    for i, (start, text) in enumerate(SEGMENTS):
        end_limit = SEGMENTS[i + 1][0] - GAP if i + 1 < len(SEGMENTS) else video_len - 0.1
        available = end_limit - start
        path = os.path.join(workdir, f"segment_{i + 1}.mp3")
        rate = BASE_RATE
        while True:
            await tts(text, rate, path)
            d = duration(path)
            if d <= available or rate >= MAX_RATE:
                break
            rate = min(MAX_RATE, rate + RATE_STEP)
        status = "OK" if d <= available else "STILL OVERLAPS (max rate reached)"
        print(f"segment {i + 1}: start {start:5.2f}s  len {d:5.2f}s  "
              f"window {available:5.2f}s  rate +{rate}%  {status}")
        clips.append((start, path))
    return clips


def mix(video, clips, out):
    cmd = ["ffmpeg", "-y", "-i", video]
    for _, p in clips:
        cmd += ["-i", p]
    parts = [f"[0:a]volume={MUSIC_VOL}[music]"]
    labels = []
    for n, (start, _) in enumerate(clips, start=1):
        ms = int(round(start * 1000))
        parts.append(f"[{n}:a]aresample=48000,adelay={ms}|{ms},volume={VOICE_VOL}[v{n}]")
        labels.append(f"[v{n}]")
    parts.append("[music]" + "".join(labels) +
                 f"amix=inputs={len(clips) + 1}:duration=first:normalize=0,"
                 "alimiter=limit=0.95:level=false[aout]")
    cmd += ["-filter_complex", ";".join(parts),
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)


def main():
    video = sys.argv[1] if len(sys.argv) > 1 else "RELUNAVI_ad.mp4"
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(video)), "RELUNAVI_ad_voice.mp4")
    workdir = os.path.join(os.path.dirname(os.path.abspath(out)), "voice_segments")
    os.makedirs(workdir, exist_ok=True)
    video_len = duration(video)
    clips = asyncio.run(build_segments(video_len, workdir))
    mix(video, clips, out)
    print(f"\nDone: {os.path.abspath(out)}")


if __name__ == "__main__":
    main()
