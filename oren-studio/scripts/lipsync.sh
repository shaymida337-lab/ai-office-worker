#!/usr/bin/env bash
# Audio-driven lips: Wav2Lip-GAN on an already-animated face video (head/eyes from LivePortrait),
# then GFPGAN v1.4 face restoration to recover sharpness lost by Wav2Lip's 96px mouth region.
# usage: lipsync.sh face.mp4 voice.wav out.mp4
set -euo pipefail
FACE=$1; VOICE=$2; OUT=$3; T=$(mktemp -d)
ffmpeg -y -loglevel error -i "$VOICE" -ar 16000 -ac 1 "$T/a.wav"
( cd /opt/tp/Wav2Lip && /opt/ml/bin/python inference.py --checkpoint_path checkpoints/wav2lip_gan.pth \
   --face "$FACE" --audio "$T/a.wav" --outfile "$T/w2l.mp4" --pads 0 18 0 0 --face_det_batch_size 4 --wav2lip_batch_size 32 )
cd "$(dirname "$0")/.." && /opt/ml/bin/python scripts/face_enhance.py "$T/w2l.mp4" "$OUT" --weight 0.5 --blend 0.75
