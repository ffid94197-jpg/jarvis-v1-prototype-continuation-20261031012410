# JARVIS Voice/Face adversarial test upgrade — 2026-10-28

## Why this change was required

The previous 26-feature MFCC statistics produce false-high scores for unrelated audio, including instrumental recordings. The 0.88 threshold is not adequate owner recognition. This test detected that before the new release. **Existing MFCC voice enrollments are now low-assurance hints only: they cannot arm wake or authorize any task.**

## Enabling speaker-gated wake

Run `powershell -ExecutionPolicy Bypass -File .\INSTALL_OWNER_SPEAKER_MODEL.ps1` in the new source root on your Windows test machine. This downloads a local ECAPA-TDNN model from `speechbrain/spkrec-ecapa-voxceleb` (~89 MB model repository) and installs additional Python dependencies. Set `JARVIS_OWNER_SPEAKER_MODEL_DIR` in your **private** `.env` to the installer output path. Keep existing `JARVIS_FACE_VAULT_KEY`. In Console → Settings → Owner Identity, **delete your old voice profile, then enroll 3 different spoken phrases** so it uses the new model (engine `ecapa-v1`).

A matching new ECAPA speaker embedding plus a successfully transcribed wake phrase is required for wake. Identity remains a **convenience-only probabilistic check**, vulnerable to playback, voice cloning and adversarial inputs. JARVIS still needs an authenticated owner session and Guardian permission for actions. No biometric grants authorization.

## Validation

- Run `python scripts/perception/verify_biometric_adversarial.py --rounds 12 --cases 500 --output evidence/biometric_adversarial.json` for repeated simulated owner data + real sample-media checks.
- Run `python scripts/perception/verify_owner_wake_tts.py --rounds 3 --cases 25` after installing Python runtime deps.
- Run `python scripts/perception/verify_face_voice.py --rounds 1 --cases 40` for existing perception tests.
- On Windows after model installation, test live enrollment, same-person and different-person voice recordings, silence and ambient audio, camera face matching, and spoofed/recorded wake phrases. Measure false positives/negatives instead of assuming zero.
- Require `.env` key and working ECAPA weights; without them, voice wake is unavailable and must not pretend to identify the owner.

## Test corpus limits

Audios here use bundled Gradio/pyannote public example recordings and locally generated espeak voices, plus synthetic noise/music. Public face assets use the NASA astronaut sample and scikit-image LFW subset. The LFW thumbnails are 25×25 pixels and **not valid substitutes for full-resolution identity verification**. OpenCV Haar detection is used for local image negative/perturbation probes only; production uses YuNet+SFace ONNX, which must be separately installed and evaluated. No web/private user face or voice data is embedded in the release.

## Honest certification boundary

The Linux test environment has no Windows webcam/microphone and cannot download the large production ONNX/Vosk/ECAPA weights. Simulation verifies logic and handling, not biometric accuracy; final Windows acceptance still required.

Sources: https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb ; https://scikit-image.org/docs/stable/api/skimage.data .
