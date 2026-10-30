#!/usr/bin/env python3
"""Deterministic regression + stress tests for owner-driven perception.
 Uses NASA/skimage astronaut demo image and Gradio's public package WAV fixture.
 Does not pretend mock face embeddings are genuine SFace inference.
"""
import argparse
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest.mock as mock
import wave

import cv2
import numpy as np

BASE=Path(__file__).resolve().parents[2]
MOD=BASE/'windows-companion/perception/biometric_cli.py'
spec=importlib.util.spec_from_file_location('perception_backend',MOD)
backend=importlib.util.module_from_spec(spec);spec.loader.exec_module(backend)

p=argparse.ArgumentParser()
p.add_argument('--rounds',type=int,default=12)
p.add_argument('--cases',type=int,default=1000)
p.add_argument('--output',default='')
a=p.parse_args()
assert 1<=a.rounds<=30 and 20<=a.cases<=10000

# Published public-domain sample from scikit-image, source NASA.
astro=cv2.imread(str(BASE/'scripts/perception/samples/nasa_astronaut_public_domain.jpg'))
cat=cv2.imread(str(BASE/'scripts/perception/samples/chelsea_cat_sample.jpg'))
assert astro is not None and cat is not None
detector=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
assert not detector.empty()
image_detected=len(detector.detectMultiScale(cv2.cvtColor(astro,cv2.COLOR_BGR2GRAY),scaleFactor=1.1,minNeighbors=4,minSize=(40,40)))
cat_detected=len(detector.detectMultiScale(cv2.cvtColor(cat,cv2.COLOR_BGR2GRAY),scaleFactor=1.1,minNeighbors=4,minSize=(40,40)))
assert image_detected>=1 and cat_detected==0,(image_detected,cat_detected)
# Variation of a real sample under image resizing/brightness
face_variants=[]
for scale in (0.8,1.,1.2):
 for brightness in (-32,-16,0,16,32):
  variant=cv2.resize(astro,None,fx=scale,fy=scale)
  variant=cv2.convertScaleAbs(variant,alpha=1,beta=brightness)
  face_variants.append(len(detector.detectMultiScale(cv2.cvtColor(variant,cv2.COLOR_BGR2GRAY),1.1,4,minSize=(36,36)))>=1)

# Public open-source Gradio WAV sample (already installed); validate resampling and input checks.
source=BASE/'scripts/perception/samples/gradio_test_audio.wav'
assert source.is_file(), 'Missing public Gradio audio fixture.'
with wave.open(str(source),'rb') as w:
 assert w.getnchannels()==1 and w.getsampwidth()==2
 samples=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2');sr=w.getframerate()
resampled=np.interp(np.linspace(0,len(samples)-1,int(len(samples)*16000/sr)),np.arange(len(samples)),samples).clip(-32768,32767).astype('<i2')
def wav_bytes(raw,rate=16000):
 b=io.BytesIO()
 with wave.open(b,'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(raw)
 return b.getvalue()
valid_wav=wav_bytes(resampled.tobytes())
encoded_wav=base64.b64encode(valid_wav).decode('ascii')
assert 100 <= len(resampled) <= 16000*12

# Isolate the negative missing-model fixture from any models already installed on
# the operator's Windows machine. This test intentionally exercises absence;
# separate live acceptance covers real ONNX/Vosk weights.
os.environ['JARVIS_PERCEPTION_MODELS']=str(BASE/'scripts/perception/samples/fixtures-intentionally-no-models')
# Real endpoint subprocess health + missing dependency behavior (not mock)
health=subprocess.run([sys.executable,str(MOD)],input=json.dumps({'action':'health'}),text=True,capture_output=True,timeout=15)
assert health.returncode==0,(health.returncode,health.stderr)
health_result=json.loads(health.stdout)
assert health_result['ok'] and not health_result['faceModelsPresent'] and not health_result['voskModelPresent']

image=base64.b64encode(cv2.imencode('.jpg',astro)[1].tobytes()).decode()
all_pass=0;rounds=[];failures=[]
with tempfile.TemporaryDirectory(prefix='jarvis-perception-tests-') as tmp:
 os.environ['JARVIS_BIOMETRIC_STORE']=tmp
 os.environ['JARVIS_FACE_VAULT_KEY']=''  # overridden below with valid local test key
 from cryptography.fernet import Fernet
 key=Fernet.generate_key().decode()
 os.environ['JARVIS_FACE_VAULT_KEY']=key
 rng=random.Random(20261028)
 for round_no in range(1,a.rounds+1):
  passed=0
  for i in range(a.cases):
   owner=f'owner-{round_no}-{i%113}'
   correct=np.array([1.,0.,0.,0.],dtype=np.float32)
   diff=np.array([0.,1.,0.,0.],dtype=np.float32)
   # mock only the embedding extractor; real encrypted vault, threshold and deletion exercised
   with mock.patch.object(backend,'extract_face',return_value=correct.tolist()):
    result=backend.handle({'action':'face_enroll','owner':owner,'image':image})
    assert result.get('ok') and result.get('enrolled')
    checks=backend.handle({'action':'face_check','owner':owner,'image':image})
    assert checks.get('matched') and checks.get('auth') is False
    again=backend.handle({'action':'face_enroll','owner':owner,'image':image})
    assert again.get('code')=='ALREADY_ENROLLED'
   with mock.patch.object(backend,'extract_face',return_value=diff.tolist()):
    wrong=backend.handle({'action':'face_check','owner':owner,'image':image})
    assert wrong.get('ok') and wrong.get('matched') is False
   # False owner must not read any other owner's face enrollment
   with mock.patch.object(backend,'extract_face',return_value=correct.tolist()):
    isolate=backend.handle({'action':'face_check','owner':owner+'-other','image':image})
    assert isolate.get('code')=='NOT_ENROLLED'
   if i%29==0:
    with mock.patch.object(backend,'extract_face',return_value=correct.tolist()):
     with mock.patch.dict(os.environ,{'JARVIS_FACE_VAULT_KEY':Fernet.generate_key().decode()}):
      keywrong=backend.handle({'action':'face_check','owner':owner,'image':image})
      assert keywrong.get('code')=='VAULT_UNREADABLE'
   deletion=backend.handle({'action':'face_delete','owner':owner})
   assert deletion.get('ok') and deletion['deleted']
   assert backend.handle({'action':'unknown','owner':owner}).get('code')=='UNKNOWN_ACTION'
   passed+=7+(1 if i%29==0 else 0)
  for fmt in (b'invalid',b'',b'RIFFTEST'):
   try:
    backend.handle({'action':'voice_transcribe','owner':'voice', 'audio':base64.b64encode(fmt).decode()})
    raise AssertionError('Bad audio accepted')
   except (ValueError,EOFError,wave.Error):passed+=1
  # Valid public internet-origin WAV passes header checks, then missing Vosk model fails truthfully.
  try:
   backend.handle({'action':'voice_transcribe','owner':'voice','audio':encoded_wav})
   raise AssertionError('Voice model mistakenly available or missing expected failure')
  except RuntimeError as e:
   assert 'VOICE_MODEL_MISSING' in str(e);passed+=1
  # Media input rejection
  for bad in ('$', '!'*3000001, ''):
   try:backend.media_bytes(bad,backend.MAX_AUDIO_BYTES);raise AssertionError('Bad base64 accepted')
   except ValueError:passed+=1
  assert all(isinstance(v,bool) for v in face_variants)
  round_data={'round':round_no,'cases':a.cases,'assertions':passed,'passed':True}
  rounds.append(round_data);all_pass+=passed
  print(f'PASS round {round_no}/{a.rounds}: {a.cases} complete owner flow cases; {passed} checks',flush=True)

report={'verdict':'PASS (offline/vault/simulated face vectors; real inference pending)',
 'rounds':rounds,'totalCases':a.rounds*a.cases,'passedChecks':all_pass,
 'publicSampleSources':['scikit-image astronaut (NASA public-domain photo)','scikit-image Chelsea cat negative','Gradio test_audio.wav (packaged public fixture)'],
 'realMediaChecks':{'astronautHaarDetected':image_detected,'catHaarDetected':cat_detected,'transformedAstronautFaceDetections':sum(face_variants),'transformedAstronautTotal':len(face_variants),'gradioAudioSampleRateOriginal':sr,'gradioAudioConvertedTo16kHz':True},
 'notVerified':['OpenCV YuNet+SFace ONNX real inference','Vosk real transcription','microphone/camera permission on Windows','Next.js full build']}
if a.output:
 Path(a.output).parent.mkdir(parents=True,exist_ok=True)
 Path(a.output).write_text(json.dumps(report,indent=2))
print('RESULT',json.dumps({k:report[k] for k in ('totalCases','passedChecks','realMediaChecks')},sort_keys=True))
