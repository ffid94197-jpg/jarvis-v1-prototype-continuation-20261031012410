#!/usr/bin/env python3
"""Offline owner wake + Piper adapter stress suite; no real weights needed."""
from pathlib import Path
import argparse,base64,importlib.util,io,os,sys,json,tempfile,unittest.mock as mock,wave
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
def module(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
bio=module(ROOT/'windows-companion/perception/biometric_cli.py','bio')
tts=module(ROOT/'windows-companion/perception/piper_speak.py','tts')
parser=argparse.ArgumentParser();parser.add_argument('--rounds',type=int,default=3);parser.add_argument('--cases',type=int,default=125);parser.add_argument('--output',type=str,default='')
a=parser.parse_args();assert 1<=a.rounds<=20 and 1<=a.cases<=1000

def wave_payload(frequency=160):
 # 3 sec 16 kHz moderate sinusoid with varying envelopes (signal fixture, NOT real human voice)
 samples=np.arange(48000,dtype='float32')/16000
 tone=.14*np.sin(2*np.pi*frequency*samples)+.035*np.sin(2*np.pi*1.7*frequency*samples)
 b=io.BytesIO()
 with wave.open(b,'wb') as w:
  w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes((tone*32767).astype('<i2').tobytes())
 return base64.b64encode(b.getvalue()).decode()

full=wave_payload();negative=wave_payload(310)
assert len(bio.voice_vector(bio.parse_audio(full)))==26
assert len(bio.voice_vector(bio.parse_audio(negative)))==26
with tempfile.TemporaryDirectory() as tmp:
 os.environ['JARVIS_BIOMETRIC_STORE']=tmp+'/vault'
 from cryptography.fernet import Fernet
 os.environ['JARVIS_FACE_VAULT_KEY']=Fernet.generate_key().decode()
 voice_model=Path(tmp)/'jarvis-high.onnx';voice_model.write_bytes(b'0'*(1024*1024+1));Path(str(voice_model)+'.json').write_text('{"audio":{"sample_rate":22050}}')
 os.environ['JARVIS_PIPER_VOICE_MODEL']=str(voice_model)
 class MockVoice:
  @classmethod
  def load(cls,*args,**kwargs):return cls()
  def synthesize_wav(self,text,wav):
   wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(22050);wav.writeframes(b'\0\0'*22050)
 class MockPiper:
  PiperVoice=MockVoice
 with mock.patch.dict(sys.modules,{'piper':MockPiper()}):
  assert tts.handle({'text':'At your service, sir.'})['sampleRate']==22050
  assert tts.handle({'text':' '*200})['ok'] is False
  assert tts.handle({'text':'x'*601})['ok'] is False
  assert tts.handle({'text':'Jarvis ready.'})['audioBase64']
  rounds=[];total=0
  for roundno in range(1,a.rounds+1):
   checks=0
   for j in range(a.cases):
    owner=f'user-{roundno}-{j}'
    with mock.patch.object(bio,'voice_vector',return_value=[1.0,0.0,0.0]):
     for i in range(3):
      result=bio.handle({'owner':owner,'action':'voice_enroll_sample','audio':full})
      assert result['ok'] and result['sampleCount']==i+1
      checks+=1
     assert result['enrolled']
     match=bio.handle({'owner':owner,'action':'voice_check','audio':full})
     assert match['matched'] and match['auth'] is False
     checks+=1
     with mock.patch.object(bio,'transcribe_pcm',return_value='jarvis open notepad') as stt:
      wake=bio.handle({'owner':owner,'action':'wake_check','audio':full})
      stt.assert_not_called()
     assert not wake['wakeDetected'] and wake['reason']=='SPEAKER_NOT_VERIFIED'
     checks+=1
     with mock.patch.object(bio,'transcribe_pcm',return_value='open jarvis notepad'):
      wrong=bio.handle({'owner':owner,'action':'wake_check','audio':full})
     assert not wrong['wakeDetected']
     checks+=1
     other=bio.handle({'owner':owner+'other','action':'voice_check','audio':full})
     assert not other['enrolled'] and not other['matched']
     checks+=1
    with mock.patch.object(bio,'voice_vector',return_value=[0.0,1.0,0.0]):
     with mock.patch.object(bio,'transcribe_pcm') as recognizer:
      incorrect=bio.handle({'owner':owner,'action':'wake_check','audio':full})
      recognizer.assert_not_called()
     assert not incorrect['wakeDetected'] and not incorrect['speaker']['matched']
     checks+=1
    fourth=bio.handle({'owner':owner,'action':'voice_enroll_sample','audio':full})
    assert fourth['code']=='VOICE_ENROLLED'
    checks+=1
    assert bio.handle({'owner':owner,'action':'voice_delete'})['deleted']
    assert not bio.handle({'owner':owner,'action':'voice_check','audio':full})['enrolled']
    checks+=2
   rounds.append({'round':roundno,'cases':a.cases,'assertions':checks,'passed':True});total+=checks
   print(f'PASS owner wake round {roundno}: {a.cases} owners / {checks} assertions',flush=True)
  # Encrypted voice-template negative tests, independent of mocked speaker features.
  with mock.patch.object(bio,'voice_vector',return_value=[1.,0.,0.]):
   res=bio.handle({'owner':'corrupt','action':'voice_enroll_sample','audio':full})
   assert res['ok']
   path=bio.owner_voice_file(bio.safe_owner('corrupt'))
   assert b'1.0' not in path.read_bytes()
   with mock.patch.dict(os.environ,{'JARVIS_FACE_VAULT_KEY':Fernet.generate_key().decode()}):
    try:bio.handle({'owner':'corrupt','action':'voice_check','audio':full});raise AssertionError('Accepted wrong key')
    except RuntimeError:pass
   path.write_bytes(b'invalid vault')
   assert bio.handle({'owner':'corrupt','action':'voice_enroll_sample','audio':full})['code']=='VAULT_UNREADABLE'
  assert tts.handle({'text':'x'})['ok']
  voice_model.unlink();assert tts.handle({'text':'test'})['ok'] is False
report={'verdict':'OFFLINE_FIXTURE_PASS','rounds':rounds,'totalCases':a.rounds*a.cases,'passedAssertions':total,
 'knownUnverified':['Real jgkawell ONNX inference','Real Vosk wake phrase','Human voiceprint false-accept/false-reject','Live webcam/microphone','Windows production build','Always-on wake when browser closed']}
if a.output:
 f=Path(a.output);f.parent.mkdir(parents=True,exist_ok=True);f.write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='rounds'}))
