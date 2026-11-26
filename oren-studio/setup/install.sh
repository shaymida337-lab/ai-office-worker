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
