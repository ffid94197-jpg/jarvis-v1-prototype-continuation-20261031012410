"""JARVIS local camera / microphone perception backend.

Owner-initiated inputs only; face similarity is an informational feature, NOT login,
security authorization, liveness or permission to use tools. No raw media persisted.
Face recognition needs YuNet + SFace ONNX. Voice STT needs an installed Vosk model.
All output is constrained JSON; stdin JSON bounded by the authenticated HTTP route.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import wave
import re
from functools import lru_cache
from pathlib import Path

MAX_IMAGE_BYTES = 1_500_000
MAX_AUDIO_BYTES = 2_500_000
FACE_THRESHOLD = 0.363  # OpenCV SFace cosine recommendation; not security-grade


def fail(code: str, message: str):
    return {"ok": False, "code": code, "error": message}


def media_bytes(value, maximum):
    if not isinstance(value, str) or not value or len(value) > maximum * 2:
        raise ValueError('Missing or oversized media input.')
    data = base64.b64decode(value, validate=True)
    if len(data) > maximum:
        raise ValueError('Media input too large.')
    return data


def safe_owner(value):
    if not isinstance(value, str) or not (1 <= len(value) <= 256):
        raise ValueError('Invalid owner reference.')
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def storage_dir():
    root = Path(os.environ.get('JARVIS_BIOMETRIC_STORE', str(Path.home() / '.jarvis-face-v1'))).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return root


def vault_key():
    # Dedicated local vault key, never derived from an API key or browser secrets.
    key = os.environ.get('JARVIS_FACE_VAULT_KEY', '').strip()
    if not key:
        raise RuntimeError('JARVIS_FACE_VAULT_KEY not configured; face enrollment disabled.')
    from cryptography.fernet import Fernet
    return Fernet(key.encode('ascii'))


def extract_face(image_bytes):
    import cv2
    import numpy as np
    model_dir = Path(os.environ.get('JARVIS_PERCEPTION_MODELS', str(Path(__file__).resolve().parent / 'models')))
    yunet_path = model_dir / 'face_detection_yunet_2023mar.onnx'
    sface_path = model_dir / 'face_recognition_sface_2021dec.onnx'
    if not (yunet_path.is_file() and sface_path.is_file()):
        raise RuntimeError('FACE_MODELS_MISSING: Install the official YuNet and SFace ONNX models first.')
    image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Unreadable image.')
    h, w = image.shape[:2]
    if h < 100 or w < 100 or h*w > 3_000_000:
        raise ValueError('Image resolution outside supported range.')
    detector = cv2.FaceDetectorYN.create(str(yunet_path), '', (w, h), score_threshold=0.80)
    _, faces = detector.detect(image)
    if faces is None or len(faces) != 1:
        raise ValueError('Exactly one clearly visible face is required.')
    recognizer = cv2.FaceRecognizerSF.create(str(sface_path), '')
    aligned = recognizer.alignCrop(image, faces[0])
    feature = recognizer.feature(aligned).flatten().astype('float32')
    norm = float(np.linalg.norm(feature))
    if not 0.01 < norm < 1e9:
        raise ValueError('Invalid face feature.')
    return (feature / norm).tolist()


def parse_audio(value):
    """Shared strict PCM parser. Recognition and voiceprint see the same bytes."""
    data = media_bytes(value, MAX_AUDIO_BYTES)
    with wave.open(io.BytesIO(data), 'rb') as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError('Audio must be mono, signed 16-bit, 16kHz PCM WAV.')
        if wav.getnframes() < 1600 or wav.getnframes() > 16000 * 12:
            raise ValueError('Audio must be between 0.1 and 12 seconds.')
        pcm = wav.readframes(wav.getnframes())
    return pcm


def voice_vector(pcm):
    """Coarse MFCC statistics for optional convenience speaker *hint*, not secure biometrics.

    No raw recording is persisted. Real-world thresholds require calibration for the owner,
    microphone and acoustics. Replay/voice synthesis can spoof this feature.
    """
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    rms = float(np.sqrt(np.mean(samples * samples)))
    if rms < 0.012:
        raise ValueError('No sufficiently audible speech signal; speak closer to the microphone.')
    if len(samples) < 16000: raise ValueError('Record at least one second for owner voice enrollment.')
    # 25 ms frames, 10 ms hop, pre-emphasis and Hann window.
    emphasized = np.concatenate((samples[:1], samples[1:] - 0.97 * samples[:-1]))
    frames = np.lib.stride_tricks.sliding_window_view(emphasized, 400)[::160]
    if len(frames) > 1200: frames = frames[:1200]
    power = (abs(np.fft.rfft(frames * np.hanning(400), n=512, axis=1)) ** 2).astype(np.float64)
    # 26 triangular mel filterbank, 80 Hz to 7600 Hz
    def mel(freq): return 2595.0 * np.log10(1.0 + freq / 700)
    def hz(m): return 700.0 * (10.0 ** (m / 2595) - 1)
    bins = np.floor((513 / 16000) * hz(np.linspace(mel(80), mel(7600), 28))).astype(int)
    bins = np.clip(bins, 0, 256)
    bank = np.zeros((26, 257))
    for k in range(26):
        a,b,c = (int(n) for n in bins[k:k+3])
        if a < b: bank[k,a:b] = np.linspace(0,1,b-a,endpoint=False)
        if b < c: bank[k,b:c] = np.linspace(1,0,c-b,endpoint=False)
    log_mel = np.log(np.maximum(power @ bank.T, 1e-12))
    dct = np.cos((np.arange(26)[None,:] + .5) * (np.arange(1,14)[:,None] * np.pi / 26))
    coeff = log_mel @ dct.T
    # Relative cepstra to dampen loudness and microphone gain differences.
    coeff = coeff - coeff.mean(axis=0, keepdims=True)
    vector = np.concatenate((np.std(coeff,axis=0), np.percentile(coeff,75,axis=0)-np.percentile(coeff,25,axis=0)))
    length = np.linalg.norm(vector)
    if not (length > 0 and np.isfinite(length)): raise ValueError('Unusable audio features.')
    return (vector/length).astype('float32').tolist()


def active_stt_engine():
    """Selected local speech engine. Vosk remains the default; no silent engine fallback."""
    selected=os.environ.get('JARVIS_STT_ENGINE','vosk').strip().lower()
    if selected not in ('vosk','faster-whisper'):
        raise RuntimeError('STT_ENGINE_INVALID: Select vosk or faster-whisper.')
    return selected


@lru_cache(maxsize=1)
def _faster_whisper_model(model_path,device,compute_type,cpu_threads):
    """Load only a preinstalled local CTranslate2 model; never fetch from a hub."""
    model=Path(model_path).resolve()
    if not model.is_dir() or not (model/'model.bin').is_file():
        raise RuntimeError('FASTER_WHISPER_MODEL_MISSING: Configure a local CTranslate2 model directory.')
    if not (model/'config.json').is_file():
        raise RuntimeError('FASTER_WHISPER_MODEL_INVALID: Local model config is missing.')
    from faster_whisper import WhisperModel
    return WhisperModel(str(model),device=device,compute_type=compute_type,
                        cpu_threads=cpu_threads,num_workers=1,
                        local_files_only=True)


def _transcribe_faster_whisper(pcm):
    """Bounded local transcription. Caller already enforces mono 16kHz PCM and <=12s."""
    import numpy as np
    model_path=os.environ.get('JARVIS_FASTER_WHISPER_MODEL_DIR','').strip()
    if not model_path:
        raise RuntimeError('FASTER_WHISPER_MODEL_MISSING: Set JARVIS_FASTER_WHISPER_MODEL_DIR.')
    device=os.environ.get('JARVIS_FASTER_WHISPER_DEVICE','cpu').strip().lower()
    compute=os.environ.get('JARVIS_FASTER_WHISPER_COMPUTE_TYPE','int8' if device=='cpu' else 'float16').strip().lower()
    if device not in ('cpu','cuda'):
        raise RuntimeError('FASTER_WHISPER_DEVICE_INVALID: Select cpu or cuda.')
    allowed={'cpu':('int8','int8_float32','float32'),
             'cuda':('float16','int8_float16','int8_float32')}
    if compute not in allowed[device]:
        raise RuntimeError('FASTER_WHISPER_COMPUTE_INVALID: Unsupported device/compute type pair.')
    try:
        threads=int(os.environ.get('JARVIS_FASTER_WHISPER_CPU_THREADS','4'))
    except ValueError:
        raise RuntimeError('FASTER_WHISPER_THREADS_INVALID: Expected 1–16.')
    if not 1<=threads<=16:
        raise RuntimeError('FASTER_WHISPER_THREADS_INVALID: Expected 1–16.')
    language=os.environ.get('JARVIS_STT_LANGUAGE','en').strip().lower()
    if language!='auto' and not re.fullmatch(r'[a-z]{2,3}',language):
        raise RuntimeError('STT_LANGUAGE_INVALID: Use a language code or auto.')
    samples=np.frombuffer(pcm,dtype='<i2').astype(np.float32)/32768.0
    if samples.size<1600 or samples.size>16000*12:
        raise ValueError('Audio sample count outside the bounded 0.1–12 second range.')
    model=_faster_whisper_model(str(Path(model_path).resolve()),device,compute,threads)
    segments,_info=model.transcribe(
        samples,language=None if language=='auto' else language,
        beam_size=1,best_of=1,temperature=0,
        condition_on_previous_text=False,vad_filter=True,
        word_timestamps=False,
    )
    # The generator is consumed here, inside the request's bounded input scope.
    # Normalize segment whitespace so provider-specific leading/trailing
    # spaces cannot create doubled gaps in the final transcript.
    return ' '.join(' '.join(str(segment.text).split())
                    for segment in segments if str(segment.text).strip()).strip()[:1500]


def transcribe_pcm(pcm):
    engine=active_stt_engine()
    if engine=='faster-whisper':
        return _transcribe_faster_whisper(pcm)
    model_dir = Path(os.environ.get('JARVIS_PERCEPTION_MODELS', str(Path(__file__).resolve().parent / 'models')))
    model_path = model_dir / 'vosk-model-small-en-us-0.15'
    if not model_path.is_dir():
        raise RuntimeError('VOICE_MODEL_MISSING: Install the Vosk model first.')
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
    recognizer = KaldiRecognizer(Model(str(model_path)), 16000)
    recognizer.AcceptWaveform(pcm)
    return str(json.loads(recognizer.FinalResult()).get('text', '')).strip()[:1500]


@lru_cache(maxsize=1)
def _speaker_model(path):
    """Load a previously installed local speaker model; never download during wake."""
    from speechbrain.inference.speaker import EncoderClassifier
    model = Path(path).resolve()
    if not (model.is_dir() and (model / 'hyperparams.yaml').is_file()
            and (model / 'embedding_model.ckpt').is_file()):
        raise RuntimeError('SPEAKER_MODEL_MISSING: Install local ECAPA speaker model before verified owner wake.')
    return EncoderClassifier.from_hparams(source=str(model), savedir=str(model), run_opts={'device': 'cpu'})


def speaker_embedding(pcm):
    """ECAPA-TDNN speaker embedding. Uses local weights only; never a cloud endpoint."""
    import numpy as np
    import torch
    root = os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR', '').strip()
    if not root:
        raise RuntimeError('SPEAKER_MODEL_MISSING: Configure JARVIS_OWNER_SPEAKER_MODEL_DIR.')
    # PCM already validated by parse_audio. Model expects mono 16kHz float waveform.
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    if samples.size < 16000 or float(np.sqrt(np.mean(samples*samples))) < 0.012:
        raise ValueError('Owner speaker recording must contain at least one second of audible speech.')
    with torch.no_grad():
        vec = _speaker_model(root).encode_batch(torch.from_numpy(samples.copy()).unsqueeze(0))
    result = vec.detach().cpu().numpy().reshape(-1).astype(np.float32)
    norm = float(np.linalg.norm(result))
    if result.size < 64 or not np.isfinite(result).all() or not (norm > 0.000001):
        raise ValueError('Invalid speaker model embedding.')
    return (result / norm).tolist()


def enrolled_engine():
    return 'ecapa-v1' if os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR', '').strip() else 'mfcc-hint-v1'


def owner_embedding(pcm, engine):
    return speaker_embedding(pcm) if engine == 'ecapa-v1' else voice_vector(pcm)


def owner_voice_file(owner_hash):
    return storage_dir() / (owner_hash + '.voicevault')


def voice_match(owner_hash, pcm):
    """Weak MFCC profiles may be displayed as hints but NEVER unlock voice wake."""
    import numpy as np
    from cryptography.fernet import InvalidToken
    file = owner_voice_file(owner_hash)
    if not file.exists():
        return {'matched':False,'verified':False,'enrolled':False,'score':None}
    try: saved = json.loads(vault_key().decrypt(file.read_bytes()))
    except (InvalidToken, ValueError, KeyError, TypeError):
        raise RuntimeError('Owner voice profile cannot be decrypted.')
    voices = saved.get('samples', [])
    engine = saved.get('engine', 'mfcc-hint-v1')
    if saved.get('version') not in (1, 2) or engine not in ('mfcc-hint-v1','ecapa-v1') or not isinstance(voices,list) or len(voices)!=3:
        return {'matched':False,'verified':False,'enrolled':False,'score':None}
    if engine == 'ecapa-v1' and not os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR', '').strip():
        return {'matched':False,'verified':False,'enrolled':True,'score':None,'reason':'SPEAKER_MODEL_MISSING'}
    try: current = np.array(owner_embedding(pcm, engine),dtype=np.float32)
    except ValueError:
        return {'matched':False,'verified':False,'enrolled':True,'score':None,'reason':'INVALID_AUDIO'}
    candidates = [np.asarray(v,dtype=np.float32) for v in voices]
    if (any(v.ndim != 1 or v.shape != current.shape or not np.isfinite(v).all() for v in candidates)
        or not np.isfinite(current).all()):
        raise RuntimeError('Owner voice template is incompatible.')
    score = float(np.median([np.dot(current,v) for v in candidates]))
    if not np.isfinite(score):
        raise RuntimeError('Owner voice score is invalid.')
    if engine == 'ecapa-v1':
        threshold = float(os.environ.get('JARVIS_ECAPA_HINT_THRESHOLD', '0.42'))
        threshold = min(0.9,max(0.25,threshold))
    else:
        threshold = float(os.environ.get('JARVIS_VOICE_HINT_THRESHOLD', '0.88'))
        threshold = min(0.99,max(0.6,threshold))
    match = score >= threshold
    return {'matched':bool(match),'verified':bool(match and engine=='ecapa-v1'),
            'enrolled':True,'engine':engine,'score':round(score,4),'threshold':threshold,
            'warning':'Speaker matching can be spoofed; never use as authorization.'}


def handle_voice(payload, owner_hash):
    action = payload['action']
    file = owner_voice_file(owner_hash)
    if action == 'voice_delete':
        file.unlink(missing_ok=True)
        return {'ok':True,'deleted':True}
    pcm = parse_audio(payload.get('audio'))
    if action == 'voice_enroll_sample':
        engine = enrolled_engine()
        vector = owner_embedding(pcm, engine)
        if file.exists():
            try: saved = json.loads(vault_key().decrypt(file.read_bytes()))
            except Exception: return fail('VAULT_UNREADABLE','Cannot decrypt existing owner voice profile.')
            if saved.get('engine', 'mfcc-hint-v1') != engine:
                return fail('VOICE_ENGINE_CHANGED','Delete and re-enroll the voice profile after switching speaker engines.')
            if len(saved.get('samples',[])) >= 3:
                return fail('VOICE_ENROLLED','Delete the owner voice samples before re-enrolling.')
        else:
            saved={'version':2,'engine':engine,'samples':[]}
        saved['samples'].append(vector)
        encoded = vault_key().encrypt(json.dumps(saved,separators=(',',':')).encode())
        with open(file,'wb') as f:
            os.chmod(file,0o600)
            f.write(encoded)
        return {'ok':True,'sampleCount':len(saved['samples']),'enrolled':len(saved['samples'])>=3,'engine':engine,'ownerWakeReady':engine=='ecapa-v1' and len(saved['samples'])>=3,'auth':False}
    if action == 'voice_check':
        return {'ok':True,**voice_match(owner_hash,pcm),'auth':False}
    if action == 'voice_followup':
        match = voice_match(owner_hash,pcm)
        transcript = transcribe_pcm(pcm) if match['verified'] else ''
        return {'ok':True,'command':transcript[:1000],'speaker':match,'auth':False,'autoExecuted':False}
    if action == 'wake_check':
        # Speaker hint checked before sending transcript to browser; silence never wakes.
        result = voice_match(owner_hash,pcm)
        if not result['verified']:
            return {'ok':True,'wakeDetected':False,'command':'','speaker':result,'auth':False,'reason':'SPEAKER_NOT_VERIFIED'}
        transcript = transcribe_pcm(pcm)
        match = re.search(r'\bjarvis\b',transcript,re.I)
        # Only accept utterances that BEGIN with the invocation token.
        wake = bool(match and not transcript[:match.start()].strip())
        command = transcript[match.end():].strip(' ,.!?') if wake else ''
        return {'ok':True,'wakeDetected':wake,'command':command[:1000], 'speaker':result,
                'transcript':transcript,'auth':False,'autoExecuted':False}
    return fail('UNKNOWN_ACTION','Unsupported voice action.')


def handle(payload):
    if not isinstance(payload, dict):
        return fail('INVALID_REQUEST', 'Object required.')
    action = payload.get('action')
    if action == 'health':
        root = Path(os.environ.get('JARVIS_PERCEPTION_MODELS', str(Path(__file__).resolve().parent / 'models')))
        return {"ok": True, "faceModelsPresent": (root / 'face_detection_yunet_2023mar.onnx').is_file() and (root / 'face_recognition_sface_2021dec.onnx').is_file(),
                "voskModelPresent": (root / 'vosk-model-small-en-us-0.15').is_dir(),
                "faceEnrollmentKeyPresent": bool(os.environ.get('JARVIS_FACE_VAULT_KEY')),
                "voiceHintEngine": "mfcc-v1-insecure-convenience",
                "verifiedSpeakerModelConfigured": bool(os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR','').strip() and (Path(os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR','')) / "hyperparams.yaml").is_file() and (Path(os.environ.get('JARVIS_OWNER_SPEAKER_MODEL_DIR','')) / "embedding_model.ckpt").is_file()),
                "authentication": "face match is NOT an authentication method"}
    owner = safe_owner(payload.get('owner'))
    file = storage_dir() / (owner + '.facevault')
    if action == 'face_delete':
        file.unlink(missing_ok=True)
        return {"ok": True, "deleted": True}
    if action in ('face_enroll', 'face_check'):
        embedding = extract_face(media_bytes(payload.get('image'), MAX_IMAGE_BYTES))
        from cryptography.fernet import InvalidToken
        import numpy as np
        if action == 'face_enroll':
            if file.exists() and not payload.get('replace'):
                return fail('ALREADY_ENROLLED', 'Delete the existing enrollment before replacing it.')
            encoded = vault_key().encrypt(json.dumps({'version': 1, 'embedding': embedding}).encode())
            with open(file, 'wb') as f:
                os.chmod(file, 0o600)
                f.write(encoded)
            return {"ok": True, "enrolled": True, "storage": "encrypted-local", "auth": False}
        if not file.exists():
            return fail('NOT_ENROLLED', 'Enroll a face first.')
        try:
            saved = json.loads(vault_key().decrypt(file.read_bytes()))
        except (InvalidToken, ValueError, KeyError):
            return fail('VAULT_UNREADABLE', 'Stored face enrollment cannot be decrypted.')
        if saved.get('version') != 1 or len(saved.get('embedding', [])) != len(embedding):
            return fail('INVALID_TEMPLATE', 'Stored template is incompatible.')
        score = float(np.dot(embedding, np.array(saved['embedding'], dtype='float32')))
        return {"ok": True, "matched": bool(score >= FACE_THRESHOLD), "similarity": round(score, 4),
                "threshold": FACE_THRESHOLD, "auth": False,
                "warning": "Image matching is not identity authentication or liveness detection."}
    if action in ('voice_enroll_sample','voice_check','voice_delete','wake_check','voice_followup'):
        return handle_voice(payload, owner)
    if action == 'voice_transcribe':
        transcript = transcribe_pcm(parse_audio(payload.get('audio')))
        return {"ok": True, "transcript": transcript, "engine": "faster-whisper-local" if active_stt_engine() == "faster-whisper" else "vosk-offline", "autoExecuted": False}
    return fail('UNKNOWN_ACTION', 'Unsupported perception action.')


def main():
    try:
        raw = sys.stdin.buffer.read(4_000_001)
        if len(raw) > 4_000_000:
            result = fail('PAYLOAD_TOO_LARGE', 'Input too large.')
        else:
            result = handle(json.loads(raw))
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        result = fail('BAD_INPUT', str(exc)[:180])
    except (RuntimeError, ImportError, OSError) as exc:
        result = fail('ENGINE_UNAVAILABLE', str(exc)[:180])
    except Exception:
        result = fail('ENGINE_ERROR', 'Perception engine failed. Inspect local diagnostics.')
    print(json.dumps(result, separators=(',', ':')))

if __name__ == '__main__':
    main()
