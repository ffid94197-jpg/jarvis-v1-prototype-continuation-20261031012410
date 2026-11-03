# JARVIS V1: Face recognition + offline speech-to-text

## What works when dependencies and local models are installed

- Console → **FACE / VOICE** (beside SETTINGS): camera preview, enroll ONE explicitly consenting person, check against their stored enrollment, erase enrollment; push-to-record up to six seconds, transcript preview, and click-to-send as an ordinary JARVIS task through LAYA/Core/Guardian.
- Face detection/recognition uses the official **OpenCV Zoo YuNet + SFace** ONNX pair; matched/unknown reporting, cosine threshold 0.363. This is an informational *similarity comparison*, not proof of identity, not security authentication, and not spoof-resistant. No face-driven permission bypass, no image classification of race/gender/emotion.
- The enrollment is a normalized 128-d feature vector encrypted locally using a dedicated Fernet key; images are handled in memory and not saved. The key is not stored in the profile. Changing it makes prior enrollment unreadable. Delete enrollment using the UI before replacing it.
- Speech recognition runs locally using **Vosk**, from 16kHz mono PCM produced in the browser. It is speech-to-text only, **not voiceprint or speaker recognition**, and never auto-executes. You must review/send the transcript to JARVIS.
- Media is transmitted only between your authenticated localhost NEXUS browser and local JARVIS Node server. The API rejects invalid origins and non-owner sessions; no remote upload is introduced by these tools. If you use JARVIS cloud models to *execute the transcribed command*, the text may be sent to the selected model according to your routing choices.

## Windows install

1. Extract the source to a NEW folder, preserve previous build and .env. In project root:
   ```powershell
   bun install --frozen-lockfile
   python -m pip install -r .\windows-companion\requirements.txt
   powershell -NoProfile -ExecutionPolicy Bypass -File .\INSTALL_FACE_VOICE_MODELS.ps1
   ```
2. Generate a dedicated private vault key:
   ```powershell
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
   Place the result ONLY in the private `.env` (never paste in chat):
   ```dotenv
   JARVIS_PERCEPTION_ENABLED="1"
   JARVIS_FACE_VAULT_KEY="YOUR_GENERATED_PRIVATE_KEY"
   ```
   Keep key stable between restarts. A separate **test database** is recommended for the new copy; keep existing Gemini keys/companion secret, and other settings private.
3. Run `bunx prisma generate`, `bunx prisma db push`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`, and `bun run dev:windows`.
4. In NEXUS: Console → **FACE / VOICE** → CHECK MODELS. Permit camera/microphone only when you intend to test. Test enrollment/delete and speech recognition; the transcript is editable before manually clicking **SEND TRANSCRIPT AS JARVIS TASK**.

## Privacy/compatibility and known gaps

- No passive, background camera or microphone recording. Both require user clicks and browser permissions. Some browsers/platforms may prevent audio capture or script-processor events. This is a push-to-talk proof-of-concept, not always-on wake word or diarization.
- Camera/voice dependencies (OpenCV/Vosk) and ONNX weights are separate downloads, not bundled in the source zip. Downloads are pinned by hash for face weights. Confirm licensing for use beyond non-commercial evaluation.
- A screenshot or printed face can deceive a matching model without liveness verification. NEVER grant login, secret access, autonomous privilege, or Guardian permission from face similarity.
- Voice transcription can mishear accents, noise, music, profanity, or low volume. Always review prior to execution.
- Real Windows camera/mic, production Next build, actual ONNX/Vosk inference, and accuracy across users/conditions are acceptance gates, not proven by simulated backend tests.

## Published sample/data/model sources

- [scikit-image NASA astronaut demo image](https://scikit-image.org/docs/stable/api/skimage.data): public-domain astronaut photo for face detection variations (not suitable for evaluating identity across multiple real persons).
- [OpenCV Zoo SFace model and threshold](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface).
- [OpenCV face recognition tutorial](https://docs.opencv.org/4.x/d0/dd4/tutorial_dnn_face.html).
- [Vosk official offline models](https://alphacephei.com/vosk/models).
- Gradio open-source `test_data/test_audio.wav` fixture used only for input format/stability checks; it is not evidence of real speech transcription quality.

## Optional faster-whisper STT backend (November 3, 2026)

The existing Vosk offline backend remains the default. An optional local
`faster-whisper==1.2.1` adapter is available for owner comparison; see
[`FASTER_WHISPER_LOCAL_STT.md`](FASTER_WHISPER_LOCAL_STT.md). It loads only a
preinstalled local CTranslate2 model with hub downloads disabled. Its package
code is MIT; model-weight licenses are separate. No model or large dependency
is installed automatically. Piper `jarvis-high.onnx` remains the selected
British English TTS voice. The optional adapter has offline stub-contract
tests only; Windows/CUDA and real transcription quality remain unaccepted.
