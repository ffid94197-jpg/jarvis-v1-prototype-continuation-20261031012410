#!/usr/bin/env python3
"""Offline contract tests for the optional faster-whisper backend.
Uses a fake inference module; never downloads or loads real model weights.
"""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest.mock as mock

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'windows-companion/perception/biometric_cli.py'
spec=importlib.util.spec_from_file_location('jarvis_biometric_test',SOURCE)
backend=importlib.util.module_from_spec(spec);spec.loader.exec_module(backend)
checks=0

def check(label,fn):
    global checks
    fn();checks+=1;print('PASS',label)

def run():
    pcm=(b'\x01\x00'*16000)
    with tempfile.TemporaryDirectory(prefix='jarvis-faster-whisper-') as tmp:
        root=Path(tmp)
        vosk_dir=root/'vosk-model-small-en-us-0.15';vosk_dir.mkdir()
        class FakeVoskRecognizer:
            def __init__(self,*args): self.accepted=False
            def AcceptWaveform(self,data): self.accepted=True
            def FinalResult(self): return json.dumps({'text':'vosk transcript'})
        fake_vosk=types.SimpleNamespace(
            Model=lambda p:p,KaldiRecognizer=FakeVoskRecognizer,
            SetLogLevel=lambda value:None)
        with mock.patch.dict(os.environ,{'JARVIS_STT_ENGINE':'vosk',
          'JARVIS_PERCEPTION_MODELS':tmp},clear=False):
            with mock.patch.dict(sys.modules,{'vosk':fake_vosk}):
                check('Vosk remains the default local transcription engine',
                      lambda: (_ for _ in ()).throw(AssertionError())
                      if backend.transcribe_pcm(pcm)!='vosk transcript' else None)

        model_dir=root/'whisper-small-ct2';model_dir.mkdir()
        (model_dir/'model.bin').write_bytes(b'local-model-fixture')
        (model_dir/'config.json').write_text('{}',encoding='utf8')
        captured={}
        class Segment:
            def __init__(self,text):self.text=text
        class FakeWhisperModel:
            def __init__(self,path,**kwargs):
                captured['path']=path;captured['init']=kwargs
            def transcribe(self,samples,**kwargs):
                captured['audio']=samples;captured['transcribe']=kwargs
                return iter([Segment(' local '),Segment('transcript ') ]),types.SimpleNamespace(language='en')
        fake_fw=types.SimpleNamespace(WhisperModel=FakeWhisperModel)
        env={'JARVIS_STT_ENGINE':'faster-whisper',
             'JARVIS_FASTER_WHISPER_MODEL_DIR':str(model_dir),
             'JARVIS_FASTER_WHISPER_DEVICE':'cpu',
             'JARVIS_FASTER_WHISPER_COMPUTE_TYPE':'int8',
             'JARVIS_FASTER_WHISPER_CPU_THREADS':'4',
             'JARVIS_STT_LANGUAGE':'en'}
        backend._faster_whisper_model.cache_clear()
        with mock.patch.dict(os.environ,env,clear=False):
            with mock.patch.dict(sys.modules,{'faster_whisper':fake_fw}):
                result=backend.transcribe_pcm(pcm)
        check('Optional local faster-whisper backend transcribes bounded PCM',
              lambda: (_ for _ in ()).throw(AssertionError(result)) if result!='local  transcript' else None)
        check('Model loads by local path with hub downloads disabled',
              lambda: (_ for _ in ()).throw(AssertionError(captured)) if
                captured['path']==str(model_dir.resolve()) and
                captured['init'].get('local_files_only') is True and
                captured['init'].get('device')=='cpu' and
                captured['init'].get('compute_type')=='int8' else None)
        check('Inference uses bounded deterministic options and float32 samples',
              lambda: (_ for _ in ()).throw(AssertionError(captured)) if
                str(captured['audio'].dtype)=='float32' and
                captured['transcribe'].get('beam_size')==1 and
                captured['transcribe'].get('vad_filter') is True and
                captured['transcribe'].get('condition_on_previous_text') is False else None)
        with mock.patch.dict(os.environ,env,clear=False):
            check('Runtime reports the selected engine honestly',
                  lambda: (_ for _ in ()).throw(AssertionError()) if
                    backend.active_stt_engine()!='faster-whisper' else None)

        def must_fail(changes):
            env2={**env,**changes}
            backend._faster_whisper_model.cache_clear()
            with mock.patch.dict(os.environ,env2,clear=False):
                try: backend.transcribe_pcm(pcm)
                except (RuntimeError,ValueError): return
            raise AssertionError('invalid configuration was accepted')
        check('Missing local model is rejected without attempting download',
              lambda: must_fail({'JARVIS_FASTER_WHISPER_MODEL_DIR':str(root/'missing')}))
        check('Unsupported device is rejected',lambda:must_fail({'JARVIS_FASTER_WHISPER_DEVICE':'remote'}))
        check('Invalid compute type is rejected',lambda:must_fail({'JARVIS_FASTER_WHISPER_COMPUTE_TYPE':'float16'}))
        check('Invalid CPU thread budget is rejected',lambda:must_fail({'JARVIS_FASTER_WHISPER_CPU_THREADS':'99'}))
        check('Invalid language selector is rejected',lambda:must_fail({'JARVIS_STT_LANGUAGE':'english'}))
        check('Unknown engine is rejected',lambda:must_fail({'JARVIS_STT_ENGINE':'unknown'}))
        backend._faster_whisper_model.cache_clear()
    print(f'FASTER_WHISPER_OFFLINE: {checks}/{checks} PASS (stub inference; real weights not loaded)')

if __name__=='__main__':run()
