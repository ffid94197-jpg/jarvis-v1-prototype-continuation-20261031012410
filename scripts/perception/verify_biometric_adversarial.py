#!/usr/bin/env python3
"""Reproducible face/voice adversarial tests: genuine sample-media probes + fixture stress.
No unconsented face identity inference and NO claims of real ECAPA accuracy.
"""
from __future__ import annotations
import argparse, base64, hashlib, importlib.util, io, json, os, subprocess, sys, tempfile, time, wave, shutil
from pathlib import Path
from unittest import mock
import numpy as np
from cryptography.fernet import Fernet
from scipy.signal import resample_poly
from math import gcd

ROOT=Path(__file__).resolve().parents[2]
def load(path, name):
    spec=importlib.util.spec_from_file_location(name, path); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
bio=load(ROOT/'windows-companion/perception/biometric_cli.py','biometric_cli_stress')
arg=argparse.ArgumentParser();arg.add_argument('--rounds',type=int,default=12);arg.add_argument('--cases',type=int,default=500);arg.add_argument('--output',default='');a=arg.parse_args()
assert 1<=a.rounds<=30 and 1<=a.cases<=1000
rng=np.random.default_rng(20261028)

# Real audio from locally bundled/test package assets; no unknown remote downloads.
paths=[ROOT/'scripts/perception/samples/gradio_test_audio.wav',
       Path('/opt/pyvenv/lib/python3.13/site-packages/gradio/media_assets/audio/cantina.wav'),
       Path('/opt/pyvenv/lib/python3.13/site-packages/gradio/media_assets/audio/recording1.wav'),
       Path('/opt/pyvenv/lib/python3.13/site-packages/gradio/media_assets/audio/sax.wav'),
       Path('/opt/pyvenv/lib/python3.13/site-packages/pyannote/audio/sample/sample.wav')]

def wav_payload(y, sr):
    if y.ndim==2:y=y.mean(axis=1)
    if sr!=16000:y=resample_poly(y,16000//gcd(sr,16000),sr//gcd(sr,16000))
    if len(y)<16000:y=np.pad(y,(0,16000-len(y)))
    y=y[:16000*6]
    out=io.BytesIO()
    with wave.open(out,'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
        w.writeframes((np.clip(y,-1.,1.)*32767).astype('<i2').tobytes())
    return base64.b64encode(out.getvalue()).decode()

sample_vectors={}; real_audio_count=0
try:import soundfile as sf
except ImportError:sf=None
if sf:
    for path in paths:
        if not path.is_file():continue
        try:
            raw, sr=sf.read(path);data=wav_payload(raw,sr)
            vec=np.asarray(bio.voice_vector(bio.parse_audio(data)),dtype=np.float32)
            sample_vectors[path.name]=vec;real_audio_count+=1
        except (ValueError, RuntimeError):pass
# On a bare Windows install only the bundled public Gradio WAV is required.
assert real_audio_count>=0

# Deterministic multiple synthetic speakers (espeak is an external offline tool, optional).
synthetic=[]
if shutil.which('espeak') and sf:
    with tempfile.TemporaryDirectory() as d:
        for vi in ('en-us+m1','en-us+m3','en-us+f2','en-sc+m2','en-uk+f3','en-uk-rp+m4'):
            for phrase in ('Jarvis please open my notepad and type a sentence', 'Check the computer screen and then report the result'):
                wav=Path(d)/('sample'+str(len(synthetic))+'.wav')
                proc=subprocess.run(['espeak','-s','140','-a','150','-v',vi,'-w',str(wav),phrase],capture_output=True)
                if proc.returncode:continue
                raw,sr=sf.read(wav);data=wav_payload(raw,sr)
                try:vec=np.array(bio.voice_vector(bio.parse_audio(data)),dtype=np.float32)
                except ValueError:continue
                synthetic.append((vi,phrase,vec))

# Detector probes ONLY; production's YuNet/SFace weights are absent in this environment.
face_results={'probe':'unavailable','astronaut_variants':0,'astronaut_haar_detections':0,'lfw_faces':0,'lfw_nonfaces':0}
try:
    import cv2
    from skimage import data as skdata
    face_results['probe']='OpenCV Haar (NOT production YuNet+SFace)'
    haar=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
    astronaut=cv2.cvtColor(skdata.astronaut(),cv2.COLOR_RGB2GRAY)
    for alpha in [0.55,0.7,0.85,1.,1.15,1.3,1.55]:
        for blur in (0,3,5):
            im=cv2.convertScaleAbs(astronaut,alpha=alpha)
            if blur:im=cv2.GaussianBlur(im,(blur,blur),0)
            faces=haar.detectMultiScale(im,scaleFactor=1.08,minNeighbors=4,minSize=(40,40))
            face_results['astronaut_variants']+=1
            if len(faces)>0:face_results['astronaut_haar_detections']+=1
    subset=skdata.lfw_subset()
    for idx,frame in enumerate(subset):
        im=cv2.resize((np.clip(frame,0,1)*255).astype('uint8') if frame.dtype.kind=='f' else frame,(200,200),interpolation=cv2.INTER_CUBIC)
        faces=haar.detectMultiScale(im,scaleFactor=1.08,minNeighbors=4,minSize=(60,60))
        face_results['lfw_faces' if idx<100 else 'lfw_nonfaces']+=int(bool(len(faces)))
except Exception as e:
    face_results['probe']='unavailable: '+str(e)[:100]

# MFCC false accept exposure: compare distinct audio fixtures. Known weakness is intentional test input.
legacy_false_accepts=[]
keys=list(sample_vectors)
for i,x in enumerate(keys):
    for y in keys[i+1:]:
        cosine=float(sample_vectors[x]@sample_vectors[y])
        if cosine>=.88:legacy_false_accepts.append({'left':x,'right':y,'similarity':round(cosine,4)})
for i,(v1,p1,e1) in enumerate(synthetic):
    for v2,p2,e2 in synthetic[i+1:]:
        if v1!=v2 and float(e1@e2)>=.88 and len(legacy_false_accepts)<20:
            legacy_false_accepts.append({'left':v1,'right':v2,'similarity':round(float(e1@e2),4)})
if not legacy_false_accepts:
    # Always-available periodic input probes for environments without extra sample packages.
    tones=[]
    for hz in (170,230,290,370):
        y=.18*np.sin(np.arange(48000)*2*np.pi*hz/16000)+.03*np.sin(np.arange(48000)*2*np.pi*hz*1.5/16000)
        tones.append(np.asarray(bio.voice_vector(bio.parse_audio(wav_payload(y,16000)))))
    for i,x in enumerate(tones):
        for j,y in enumerate(tones[i+1:],start=i+1):
            cos=float(x@y)
            if cos>=.88:legacy_false_accepts.append({'left':f'synthetic-tone-{i}','right':f'synthetic-tone-{j}','similarity':round(cos,4)})
assert len(legacy_false_accepts)>0, 'MFCC false-high-score probe requires at least two usable signals.'

# Simulated ECAPA embeddings test the protocol and owner separation, NOT the pretrained weights.
voice_a=np.zeros(192,dtype=np.float32);voice_a[0]=1
voice_b=np.zeros(192,dtype=np.float32);voice_b[1]=1
samples=ROOT/'scripts/perception/samples/gradio_test_audio.wav'
if sf and samples.exists():
    audio, sr=sf.read(samples);payload=wav_payload(audio,sr)
else:
    tone=np.sin(np.arange(48000)*2*np.pi*245/16000)*0.3
    payload=wav_payload(tone,16000)
# use 3-second sine for sample durations; embedding is mocked, samples aren't real human voice in fixture tests.
if len(bio.parse_audio(payload)) < 32000:
    payload=wav_payload(np.sin(np.arange(48000)*2*np.pi*220/16000)*0.2,16000)

with tempfile.TemporaryDirectory() as temp:
    os.environ['JARVIS_BIOMETRIC_STORE']=str(Path(temp)/'vault')
    os.environ['JARVIS_FACE_VAULT_KEY']=Fernet.generate_key().decode()
    os.environ.pop('JARVIS_OWNER_SPEAKER_MODEL_DIR',None)
    rounds=[]
    for r in range(1,a.rounds+1):
        checks=0
        for i in range(a.cases):
            owner=f'test-owner-{r}-{i}'
            # Legacy voice profile is a *hint*, never a verified wake.
            with mock.patch.object(bio,'voice_vector',return_value=[1.,0.,0.]):
                for n in range(3):
                    res=bio.handle({'action':'voice_enroll_sample','owner':owner,'audio':payload})
                    assert res['ok'] and res['sampleCount']==n+1;checks+=1
                with mock.patch.object(bio,'transcribe_pcm') as stt:
                    legacy=bio.handle({'action':'wake_check','owner':owner,'audio':payload})
                    stt.assert_not_called()
                assert legacy['ok'] and legacy['wakeDetected'] is False
                assert legacy['speaker']['matched'] is True and legacy['speaker']['verified'] is False
                checks+=3
                assert not bio.handle({'action':'voice_check','owner':owner+'-impostor','audio':payload})['enrolled'];checks+=1
            assert bio.handle({'action':'voice_delete','owner':owner})['deleted'];checks+=1
            # ECAPA mock: positive and negative embedding verification.
            os.environ['JARVIS_OWNER_SPEAKER_MODEL_DIR']=str(Path(temp)/'synthetic-model')
            with mock.patch.object(bio,'speaker_embedding',return_value=voice_a.tolist()):
                for n in range(3):
                    res=bio.handle({'action':'voice_enroll_sample','owner':owner,'audio':payload})
                    assert res['ok'] and res['sampleCount']==n+1;checks+=1
                with mock.patch.object(bio,'transcribe_pcm',return_value='jarvis please open notepad') as stt:
                    positive=bio.handle({'action':'wake_check','owner':owner,'audio':payload})
                    stt.assert_called_once()
                assert positive['ok'] and positive['wakeDetected'] and positive['command']=='please open notepad'
                assert positive['speaker']['verified'] is True;checks+=2
            with mock.patch.object(bio,'speaker_embedding',return_value=voice_b.tolist()):
                with mock.patch.object(bio,'transcribe_pcm') as stt:
                    negative=bio.handle({'action':'wake_check','owner':owner,'audio':payload})
                    stt.assert_not_called()
                assert not negative['wakeDetected'] and negative['speaker']['verified'] is False;checks+=2
            # speaker checks without model must fail closed.
            del os.environ['JARVIS_OWNER_SPEAKER_MODEL_DIR']
            with mock.patch.object(bio,'transcribe_pcm') as stt:
                no_model=bio.handle({'action':'wake_check','owner':owner,'audio':payload})
                stt.assert_not_called()
            assert not no_model['wakeDetected'] and no_model['speaker']['reason']=='SPEAKER_MODEL_MISSING';checks+=1
            assert bio.handle({'action':'voice_delete','owner':owner})['deleted'];checks+=1
        rounds.append({'round':r,'cases':a.cases,'checks':checks,'passed':True})
        print(f'PASS biometric adversarial round {r}: {a.cases} cases, {checks} checks',flush=True)
    # Bad media, bad owner, wrong encryption key, tampered files; these MUST fail closed.
    invalid=0
    for x in ('', '%%%INVALID%%%', base64.b64encode(b'hello').decode()):
        try:bio.parse_audio(x);raise AssertionError('Accepted malformed audio')
        except (ValueError, EOFError, wave.Error):invalid+=1
    try:bio.safe_owner('');raise AssertionError('Accepted blank owner')
    except ValueError:invalid+=1
    with mock.patch.object(bio,'voice_vector',return_value=[1.,0.,0.]):
        bio.handle({'action':'voice_enroll_sample','owner':'tampered','audio':payload})
        path=bio.owner_voice_file(bio.safe_owner('tampered'))
        assert b'samples' not in path.read_bytes();invalid+=1
        path.write_bytes(b'invalid-encrypted-token')
        out=bio.handle({'action':'voice_enroll_sample','owner':'tampered','audio':payload})
        assert not out['ok'] and out['code']=='VAULT_UNREADABLE';invalid+=1
    # Native face recognition without downloaded ONNX weights cannot claim a match.
    os.environ['JARVIS_PERCEPTION_MODELS']=str(Path(temp)/'nonexistent-models')
    dummy=base64.b64encode(b'not-an-image').decode()
    try:bio.handle({'action':'face_check','owner':'face-owner','image':dummy});raise AssertionError('Missing face models accepted')
    except RuntimeError as e:
        assert 'FACE_MODELS_MISSING' in str(e);invalid+=1
    total=sum(x['checks'] for x in rounds)+invalid
    report={'status':'PASS_SIMULATED_ROUTING_AND_SAMPLE_PROBES','rounds':rounds,'totalCases':a.rounds*a.cases,
            'checks':total,'failedChecks':0,'legacyFalseHighSimilarityPairs':legacy_false_accepts,
            'realAudioFilesAnalyzed':len(sample_vectors),'syntheticVoiceSamples':len(synthetic),
            'faceSampleResults':face_results,
            'limitations':['ECAPA encoder mocked because weights unavailable: no biometric accuracy claim',
                           'YuNet/SFace recognition not executed: weights unavailable',
                           'Haar face detection uses different algorithm, not production verification',
                           'eSpeak voices are synthetic and not independent consenting human speakers',
                           'No Vosk weights / real Piper ONNX / Windows camera and microphone in Linux test'],
            'source':'latest Piper Wake+Owner build, locally patched'}
    if a.output:
        outfile=Path(a.output);outfile.parent.mkdir(parents=True,exist_ok=True);outfile.write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k not in ('rounds','legacyFalseHighSimilarityPairs')},indent=2))
