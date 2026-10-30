"""Executable action tests with a fake Windows user32; never move real input."""
import desktop_control as d
from types import SimpleNamespace
class FakeUser:
    def __init__(self):self.calls=[]
    def SetCursorPos(self,x,y):self.calls.append(('pointer',x,y));return 1
    def mouse_event(self,*args):self.calls.append(('mouse',args[0]));return None
    def keybd_event(self,*args):self.calls.append(('key',args[0],args[2]));return None
    def GetForegroundWindow(self):return 0
fake=FakeUser()
orig_enabled=d.is_enabled
orig_screen=d.screen_info
orig_windll=getattr(d.ctypes,'windll',None)
orig_input=d.input_text
n=0
def check(condition,label):
    global n
    assert condition,label;n+=1;print('PASS',label)
try:
    d.is_enabled=lambda:True
    d.screen_info=lambda:{'width':1920,'height':1080,'foregroundTitle':'Game test'}
    d.ctypes.windll=SimpleNamespace(user32=fake)
    d.input_text=lambda user, text:fake.calls.append(('text',text))
    d._stopped.clear()
    result=d.run_action({'operation':'desktop_click','x':250,'y':50,'button':'left'})
    check(result['ok'],'mock Windows left click request succeeds')
    check(('pointer',250,50) in fake.calls,'pointer location submitted to OS API')
    check(('mouse',0x0002) in fake.calls and ('mouse',0x0004) in fake.calls,'left down/up submitted')
    check(not result['evidence']['uiEffectVerified'],'click receipt does not fabricate UI success')
    before=len(fake.calls)
    check(not d.run_action({'operation':'desktop_move','x':2500,'y':4})['ok'],'offscreen move rejected')
    check(len(fake.calls)==before,'offscreen move makes no input calls')
    check(d.run_action({'operation':'desktop_type','text':'Minecraft'})['ok'],'bounded typing request succeeds')
    check(('text','Minecraft') in fake.calls,'typing submitted to dedicated input routine')
    fake.calls.clear()
    check(d.run_action({'operation':'desktop_keys','keys':['ctrl','a']})['ok'],'two-key shortcut accepted')
    check(fake.calls==[('key',0x11,0),('key',0x41,0),('key',0x41,2),('key',0x11,2)],'shortcut releases keys in reverse order')
    fake.calls.clear()
    check(not d.run_action({'operation':'minecraft_input','action':'forward','durationMs':100})['ok'],
          'Minecraft input refused when foreground is not Minecraft')
    check(not fake.calls,'wrong foreground causes no injected input')
    d.screen_info=lambda:{'width':1920,'height':1080,'foregroundTitle':'Minecraft 1.21.8'}
    result=d.run_action({'operation':'minecraft_input','action':'forward','durationMs':100})
    check(result['ok'],'Minecraft forward key is sent with game in foreground')
    check(fake.calls==[('key',0x57,0),('key',0x57,2)],'Minecraft key press is released')
    check(result['evidence']['inGameEffectVerified'] is False,'game result not falsely verified')
    fake.calls.clear()
    check(d.run_action({'operation':'minecraft_input','action':'attack','durationMs':100})['ok'],
          'Minecraft left mouse attack input sent')
    check(fake.calls==[('mouse',0x0002),('mouse',0x0004)],'game mouse input always released')
    d._stopped.set()
    fake.calls.clear()
    check(not d.run_action({'operation':'desktop_click','x':4,'y':3,'button':'left'})['ok'],'emergency latch prevents input')
    check(not fake.calls,'emergency latch leaves OS input untouched')
finally:
    d.is_enabled=orig_enabled
    d.screen_info=orig_screen
    d.input_text=orig_input
    if orig_windll is None:delattr(d.ctypes,'windll')
    else:d.ctypes.windll=orig_windll
    d._stopped.clear()
print(f'FULL_DESKTOP_ACTION_FIXTURE {n}/{n} PASS (fake Win32, no device control)')
