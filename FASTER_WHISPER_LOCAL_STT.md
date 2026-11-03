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

Use the exact Python interpreter used by the Windows Companion. First check
that the CTranslate2 dependency has a compatible wheel for the machine's
Python version. The companion has other Windows UIA dependencies that may
require a different Python version; do not upgrade or replace that environment
just for this optional backend.

```powershell
python --version
python -m pip install -r windows-companion/requirements-perception-advanced.txt
```

Place a converted CTranslate2 model in a local directory. The folder must
contain at least `model.bin` and `config.json`; tokenizer/preprocessor files
must also be present if required by the model. No model is bundled.

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
path (0.1–12 seconds), bounds threads to 1–16, uses beam size 1 and VAD, and
caps text to 1,500 characters. Transcripts are suggestions, not identity or
authorization: wake/command text still follows the existing owner/session,
review, Core and Guardian path. No transcription automatically executes a
command. If the selected engine or model is unavailable, the request returns
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
