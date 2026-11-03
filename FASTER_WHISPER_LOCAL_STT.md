# Optional faster-whisper local STT for Prototype JARVIS

This is a **second, opt-in local transcription backend**, not a replacement for
Vosk and not a TTS change. The owner-selected Piper `jarvis-high.onnx` voice is
unchanged.

## Provenance

- Project: https://github.com/SYSTRAN/faster-whisper
- Package: `faster-whisper==1.2.1`
- Code license: MIT (retain upstream notice when redistributing source).
- Upstream README documents CPU INT8 and GPU FP16/INT8 inference. Package code
  and model-weight licenses are separate: verify the chosen model card and
  terms before downloading/using any weights.
- This adapter only loads an **existing local CTranslate2 model directory**.
  It passes `local_files_only=True`; no Hugging Face/model download occurs
  during a JARVIS voice request.

## Install (optional; no automatic install)

Use the exact Python interpreter used by the Windows Companion. The
faster-whisper 1.2.1 package metadata requires Python >=3.9, but its universal
wheel does **not** guarantee that the native CTranslate2 dependency has a
compatible wheel for every newer Python/Windows combination. Check the actual
dependency wheels before installing. The companion's UIA dependencies may
require a different Python version; do not upgrade or replace that environment
just for this optional backend.

```powershell
python --version
$env:TEMP_FW = Join-Path $env:TEMP "jarvis-fw-wheelcheck"
New-Item -ItemType Directory -Force $env:TEMP_FW | Out-Null
python -m pip download --only-binary=:all: --dest $env:TEMP_FW faster-whisper==1.2.1
```

If pip cannot find a compatible CTranslate2 wheel, stop and keep Vosk enabled.
Do not force a native source build or change the Windows Companion Python
environment. A separate Python sidecar would require a separately reviewed
integration; it is not silently assumed by this adapter.

For GPU execution, the upstream project documents cuBLAS for CUDA 12 and
cuDNN 9 for CUDA 12. CPU INT8 is the conservative first acceptance target.
GPU mode remains disabled until the exact CUDA/cuDNN stack is installed and
tested on the actual machine.

Place a converted CTranslate2 model in a local directory. The adapter
requires `model.bin`, `config.json` and `tokenizer.json`. The tokenizer is
mandatory: upstream faster-whisper can otherwise fall back to
`Tokenizer.from_pretrained("openai/whisper-tiny")` when the local tokenizer
file is absent, and that fallback is not prevented by the local-directory
model-loading flag. JARVIS rejects an incomplete folder before loading the
runtime. Include `preprocessor_config.json` when supplied by the model.
No model is bundled.

## Enable only on the owner's isolated Windows PC

```powershell
$env:JARVIS_STT_ENGINE = "faster-whisper"
$env:JARVIS_FASTER_WHISPER_MODEL_DIR = "D:\JARVIS_MODELS\whisper-small-ct2"
$env:JARVIS_FASTER_WHISPER_DEVICE = "cpu"
$env:JARVIS_FASTER_WHISPER_COMPUTE_TYPE = "int8"
$env:JARVIS_FASTER_WHISPER_CPU_THREADS = "4"
$env:JARVIS_STT_LANGUAGE = "en"
```

For GPU, set `JARVIS_FASTER_WHISPER_DEVICE=cuda` and a supported compute
type such as `float16` only after installing the matching NVIDIA CUDA/cuBLAS
runtime and testing it on the actual GPU. Invalid combinations fail closed.

The adapter accepts only the existing validated mono 16 kHz signed PCM WAV
path (0.1–12 seconds), requires local model and tokenizer assets before import,
bounds threads to 1–16, uses beam size 1 and VAD, normalizes segment whitespace,
and caps text to 1,500 characters. Transcripts are suggestions, not identity or
authorization: wake/command text still follows the existing owner/session,
review, Core and Guardian path. No transcription automatically executes a
command.

## Upstream compatibility references

- [faster-whisper 1.2.1 on PyPI](https://pypi.org/project/faster-whisper/1.2.1/) — package metadata, Python requirement and MIT code license.
- [Official faster-whisper README](https://github.com/SYSTRAN/faster-whisper#readme) — CTranslate2, CUDA 12/cuBLAS and cuDNN 9 requirements.

A successful dependency wheel check is not a transcription acceptance. Real
local model loading, accuracy, latency and Windows microphone input remain
separate acceptance gates. If the selected engine or model is unavailable, the request returns
an honest error; it does not silently change engines.

Unset `JARVIS_STT_ENGINE` (or set it to `vosk`) to keep the current default.

## Offline regression

```powershell
python scripts/perception/verify_faster_whisper.py
```

This test uses a stub model and proves only adapter/configuration contracts.
It does not prove model quality, Windows/CUDA compatibility, latency, or
real microphone transcription. Live acceptance requires an owner-approved
sample set and comparison against Vosk at matched language/audio conditions.
