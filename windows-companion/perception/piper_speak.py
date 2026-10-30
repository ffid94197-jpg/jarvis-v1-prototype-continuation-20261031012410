"""Offline Piper speech synthesis for selected jarvis-high voice.
No shell, no remote calls, no model downloads during inference.
Input JSON {text}; output JSON {ok, audioBase64, sampleRate}; max 600 chars.
"""
import base64
import io
import json
import os
import sys
import wave
from pathlib import Path


def handle(data):
    text = data.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 600:
        return {'ok':False,'error':'Text must be 1–600 characters.'}
    base = Path(__file__).resolve().parent / 'models' / 'piper'
    model = Path(os.environ.get('JARVIS_PIPER_VOICE_MODEL',str(base / 'jarvis-high.onnx'))).resolve()
    config = Path(str(model)+'.json')
    if not model.is_file() or not config.is_file():
        return {'ok':False,'error':'PIPER_MODEL_MISSING: Install jarvis-high.onnx and jarvis-high.onnx.json first.'}
    if model.stat().st_size < 1024*1024:
        return {'ok':False,'error':'Piper model file is unexpectedly small.'}
    from piper import PiperVoice
    voice = PiperVoice.load(str(model),use_cuda=False)
    dest = io.BytesIO()
    with wave.open(dest, 'wb') as wav:
        voice.synthesize_wav(text.strip(),wav)
    output = dest.getvalue()
    if not 44 < len(output) <= 5_000_000:
        return {'ok':False,'error':'Piper audio outside expected size range.'}
    with wave.open(io.BytesIO(output),'rb') as wav:
        rate = wav.getframerate()
    return {'ok':True,'audioBase64':base64.b64encode(output).decode('ascii'),'sampleRate':rate,'voice':'jarvis-high','engine':'piper-local'}


def main():
    try:
        raw=sys.stdin.buffer.read(10000)
        if len(raw)>9000: raise ValueError('Request too large')
        result=handle(json.loads(raw))
    except Exception as exc:
        # No media/text details or secrets in errors.
        result={'ok':False,'error':'Speech engine unavailable: '+type(exc).__name__}
    print(json.dumps(result,separators=(',',':')))

if __name__=='__main__':main()
