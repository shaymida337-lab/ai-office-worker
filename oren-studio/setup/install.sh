#!/usr/bin/env bash
# Recreate the Oren studio toolchain in a fresh (CPU-only) cloud container. Idempotent.
set -euo pipefail
export SSL_CERT_FILE=${SSL_CERT_FILE:-/root/.ccr/ca-bundle.crt} UV_NATIVE_TLS=1 REQUESTS_CA_BUNDLE=${REQUESTS_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}
[ -x /opt/ml/bin/python ] || uv venv -p /usr/bin/python3.11 /opt/ml
PY=/opt/ml/bin/python
uv pip install -q -p $PY torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
uv pip install -q -p $PY chatterbox-tts "setuptools<81" faster-whisper jiwer librosa phonikud phonikud-onnx edge-tts \
  onnxruntime opencv-python-headless pyyaml scipy imageio imageio-ffmpeg lmdb tqdm rich ffmpeg-python onnx \
  scikit-image albumentations tyro pykalman pillow matplotlib gradio_client
# edge-tts pins certifi; trust the egress proxy CA there too
C=$($PY -c "import certifi;print(certifi.where())"); grep -q "$(sed -n 2p /root/.ccr/ca-bundle.crt)" "$C" || cat /root/.ccr/ca-bundle.crt >> "$C"
mkdir -p /opt/tp
[ -d /opt/tp/LivePortrait ] || git clone --depth 1 https://github.com/KwaiVGI/LivePortrait.git /opt/tp/LivePortrait
$PY - <<'PY'
from huggingface_hub import snapshot_download, hf_hub_download
snapshot_download('KwaiVGI/LivePortrait', local_dir='/opt/tp/LivePortrait/pretrained_weights', ignore_patterns=['*.git*','README.md','docs','*animals*','*xpose*'])
snapshot_download('ivrit-ai/whisper-large-v3-turbo-ct2', local_dir='/opt/tp/whisper-he')
hf_hub_download('thewh1teagle/phonikud-onnx','phonikud-1.0.int8.onnx',local_dir='/opt/tp/phonikud')
PY
echo "oren studio toolchain ready"
# ---- OpenMontage (production orchestrator) + its local avatar tools ----
[ -d /opt/tp/OpenMontage ] || git clone --depth 1 https://github.com/OpenMontageInc/OpenMontage.git /opt/tp/OpenMontage
( cd /opt/tp/OpenMontage && [ -x .venv/bin/python ] || uv venv -q --python 3.11 .venv
  cd /opt/tp/OpenMontage && uv pip install -q -p .venv/bin/python -r requirements.txt pip && uv pip install -q -p .venv/bin/python -e .
  [ -f .env ] || cp .env.example .env
  cd remotion-composer && NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt npm install --no-audit --no-fund >/dev/null )
[ -d /opt/tp/SadTalker ] || git clone -q --depth 1 https://github.com/OpenTalker/SadTalker.git /opt/tp/SadTalker
[ -d /opt/tp/Wav2Lip ] || git clone -q --depth 1 https://github.com/Rudrabha/Wav2Lip.git /opt/tp/Wav2Lip
uv pip install -q -p $PY face_alignment kornia yacs gfpgan basicsr facexlib safetensors pydub resampy numba av
sed -i 's/from torchvision.transforms.functional_tensor import/from torchvision.transforms.functional import/' /opt/ml/lib/python3.11/site-packages/basicsr/data/degradations.py
$PY - <<'PY'
from huggingface_hub import hf_hub_download as d
import shutil
for f in ['SadTalker_V0.0.2_256.safetensors','SadTalker_V0.0.2_512.safetensors','mapping_00109-model.pth.tar','mapping_00229-model.pth.tar']:
    d('vinthony/SadTalker-V002rc', f, local_dir='/opt/tp/SadTalker/checkpoints')
for f in ['checkpoints/wav2lip_gan.pth','checkpoints/wav2lip.pth','checkpoints/s3fd-619a316812.pth']:
    d('camenduru/Wav2Lip', f, local_dir='/opt/tp/Wav2Lip')
shutil.copy('/opt/tp/Wav2Lip/checkpoints/s3fd-619a316812.pth','/opt/tp/Wav2Lip/face_detection/detection/sfd/s3fd.pth')
PY
echo "export SADTALKER_PATH=/opt/tp/SadTalker WAV2LIP_PATH=/opt/tp/Wav2Lip" > /opt/tp/openmontage.env
