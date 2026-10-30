# JARVIS V1 — selected Piper voice, wake word, local owner identity

## New capabilities

- **JARVIS voice output**: local Piper TTS using your exact `jgkawell/jarvis` British English high-quality ONNX pair (sample rate 22050). The voice weights are **not included**; install via the separate SHA-verified PowerShell script.
- **"Jarvis" voice activation**: a bounded, explicitly enabled microphone listener runs while the local NEXUS web page is open (console **or orb**). It listens in 3.5-second audio segments. A locally installed ECAPA speaker embedding is verified **before** local Vosk transcription. Old MFCC profiles no longer arm wake. Say **"Jarvis, open Notepad"**, or say **"Jarvis"** and give the command during the following 12 seconds. The wake toolbar shows its state and an editable pending command.
- **Owner voice profile**: `Settings → OWNER IDENTITY · FACE / VOICE → ENROLL NEXT VOICE SAMPLE` three times. Store encrypted *features*, not recordings. Supports similarity checks and erasure. Owner voice matching is a **weak MFCC similarity hint**, not secure speaker authentication and not proof of who is speaking. Other people's voices, voice recordings, or synthesized speech can sometimes be incorrectly matched. Test and recalibrate before relying on it even for convenience.
- **Owner face**: the previous opt-in camera preview, OpenCV enrollment, comparison, encrypted face template and local delete remain available inside Settings. A face match is **not** used as login and is not a liveness test.
- **Voice reply playback**: toolbar `TEST VOICE`, `Speak replies`, `STOP SPEAKING`, plus cancel-in-flight synthesis. Original LAYA, Guardian, and task execution workflow preserved.

## Installation (Windows, separate from protected Track A)

1. Unpack the full ZIP into `D:\glm 5.3\GPT6_TEST\JARVIS_V1_GPT6_VOICE_OWNER_2026-10-28`. Keep old source and your private `.env` backed up.
2. In the project root, run:
   ```powershell
   bun install --frozen-lockfile
   python -m pip install -r .\windows-companion\requirements.txt
   powershell -NoProfile -ExecutionPolicy Bypass -File .\INSTALL_FACE_VOICE_MODELS.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\INSTALL_JARVIS_PIPER_VOICE.ps1
   bunx prisma generate
   bunx prisma db push
   bunx tsc --noEmit
   bun run lint
   bun run build
   ```
   Both ONNX and JSON are downloaded from the user-selected Hugging Face paths. The ONNX must match SHA256 `9791877d9c099fabbf30be2825e011451c39b3431e21e81e866f5b6507e72993`. The Windows installer records local hashes for troubleshooting.
3. Copy your existing **private** `.env` locally. Use a fresh test SQLite DB if you want isolation. Add (or verify):
   ```dotenv
   JARVIS_TTS_ENABLED="1"
   JARVIS_PERCEPTION_ENABLED="1"
   JARVIS_FACE_VAULT_KEY="GENERATE_A_PRIVATE_FERNET_KEY"
   ```
   Generate the encryption key on your PC: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Keep your existing key if carrying over existing face/voice enrollments. Never share the key in chat.
   Optional override for Piper ONNX: `JARVIS_PIPER_VOICE_MODEL="D:\\path\\jarvis-high.onnx"` (the matching config must have `.json` appended). Default path is `windows-companion/perception/models/piper/jarvis-high.onnx`.
4. Start `bun run dev:windows`, open `http://127.0.0.1:3000`, authenticate as owner, and go to **Settings → Owner Identity**. Enroll face and three separate voice samples.
5. Return to NEXUS, select `TEST VOICE` to check the installed voice, toggle `Speak replies`, then select `ENABLE JARVIS WAKE` and grant microphone permission. Say `Jarvis, tell me the time`. Initially keep auto-send **off** and review recognized text before clicking Send. For hands-free behavior you may explicitly opt into auto-send; Guardian remains independently enforced.
6. To repeat code-level tests: `python scripts/perception/verify_owner_wake_tts.py --rounds 12 --cases 180` and the existing `RUN_FACE_VOICE_ACCEPTANCE.ps1`, `RUN_LONGRUN_ACCEPTANCE.ps1` as appropriate. For real acceptance, use several fresh recordings from your microphone and check false-wake and missed-wake rates with background speech and TTS playback.

## Security and limitations

- Wake works only in the **open authenticated NEXUS browser tab**. It is not a Windows system-wide always-listening service and does not wake a sleeping PC. The model is loaded for each short audio check, which may incur several seconds of latency; low-latency production wake requires a persistent inference service.
- Microphone capture is entirely opt-in, uses local browser permissions, and stops when the page closes or wake is disabled. Face camera starts only on request. Speech audio is sent only to the locally authenticated JARVIS endpoint and processed offline. Cloud LLMs may receive transcribed task text if selected by your LAYA routing.
- **Face and voice similarity are not security authentication.** Both can be spoofed. JARVIS actions still require a valid owner session and Guardian authorization. Disabling auto-dispatch is the safest default.
- The voice **model card is MIT-labelled**; the currently maintained `piper-tts` engine has separate GPLv3 obligations. The Marvel character and voice imitation raise separate rights issues for distribution/commercial use. Review before publication.
- **Not verified here**: real 114 MB ONNX runtime quality, real Vosk recognition/wake performance, multi-person speaker accuracy, real face matching with model weights, Windows mic/camera permissions, and full Windows production build. All offline results are fixture/algorithm/regression checks, not measured human recognition accuracy.

## References

- Model: https://huggingface.co/jgkawell/jarvis
- Voice ONNX: https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/high/jarvis-high.onnx
- Voice config: https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/high/jarvis-high.onnx.json
- Piper Python `synthesize_wav`: https://github.com/OHF-Voice/piper1-gpl

## Speaker verification update
See `OWNER_BIOMETRIC_STRESS_AND_REPAIR.md` and run `INSTALL_OWNER_SPEAKER_MODEL.ps1` before enabling verified owner wake. The original MFCC similarity was shown to produce false positives against unrelated recordings.
