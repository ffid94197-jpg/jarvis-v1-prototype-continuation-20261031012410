"""Mock-backed UIA behavior fixture; NEVER claims real Windows was controlled."""
import native_uia as mod
import time

checks=0
def check(ok,label):
    global checks
    if not ok: raise AssertionError('FAIL '+label)
    checks+=1;print('PASS',label)

check(mod.validate_request({'operation':'native_inspect'}) is None,'UIA inspection contract')
check(mod.validate_request({'operation':'native_open_url','url':'https://www.youtube.com/@MrBeast/videos'}) is None,'native public browser URL')
for u in ('http://youtube.com','https://127.0.0.1:9000','file:///C:/','https://user:pass@example.com','https://example.com:444/','https://app.internal'):
    check(mod.validate_request({'operation':'native_open_url','url':u}) is not None,'native URL blocked '+u)
check(mod.validate_request({'operation':'native_action','elementId':'a'*24,'action':'set_text','text':'Hello world'}) is None,'text entry contract')
check(mod.validate_request({'operation':'native_action','elementId':'a'*24,'action':'set_text','text':'x'*501}) is not None,'oversized native text blocked')
check(mod.validate_request({'operation':'native_action','elementId':'a'*24,'action':'focus','text':'secret'}) is not None,'text rejected on focus')
check(mod.validate_request({'operation':'native_action','elementId':'invalid','action':'invoke'}) is not None,'bad control token denied')

class Elem:
    def __init__(self,name,kind='Button',password=False):
        self.element_info=type('I',(),{'name':name,'control_type':kind,'is_password':password})()
        self.value='';self.did=[];self.moved=False
    def rectangle(self):
        return type('R',(),{'left':10 if not self.moved else 14,'top':10,'right':140,'bottom':40})()
    def is_enabled(self): return True
    def descendants(self,depth=7): return [btn,edit,secret]
    def window_text(self): return 'Real Notepad'
    def invoke(self): self.did.append('invoke')
    def set_edit_text(self,x): self.value=x
    def get_value(self):return self.value
    def set_focus(self):self.did.append('focus')
    def has_keyboard_focus(self): return True
btn=Elem('Save');edit=Elem('Text editor','Edit');secret=Elem('Password','Edit',True)
root=Elem('Notepad')
oldroot,oldhwnd=mod._get_root,mod._active_hwnd
try:
    hwnd=[4242]
    mod._get_root=lambda:(4242,root)
    mod._active_hwnd=lambda:hwnd[0]
    snap=mod.inspect_native()
    check(snap['ok'] and snap['evidence']['count']==3,'inspects foreground UIA controls')
    check(all(c['name']!='Password' for c in snap['evidence']['controls']),'password field omitted')
    rows={v['name']:v['elementId'] for v in snap['evidence']['controls']}
    result=mod.action_native({'elementId':rows['Text editor'],'action':'set_text','text':'JARVIS AUTONOMOUS EXECUTION TEST SUCCESSFUL'})
    check(result['ok'] and result['evidence']['textVerifiedByUIA'],'exact text readback verified')
    check(not mod.action_native({'elementId':rows['Save'],'action':'invoke'})['ok'],'selection invalidated after action')
    snap=mod.inspect_native()
    rows={v['name']:v['elementId'] for v in snap['evidence']['controls']}
    hwnd[0]=111
    check(not mod.action_native({'elementId':rows['Save'],'action':'invoke'})['ok'],'foreground change denies action')
    hwnd[0]=4242
    snap=mod.inspect_native()
    rows={v['name']:v['elementId'] for v in snap['evidence']['controls']}
    btn.moved=True
    check(not mod.action_native({'elementId':rows['Save'],'action':'invoke'})['ok'],'moved control denies stale token')
    btn.moved=False
    snap=mod.inspect_native()
    rows={v['name']:v['elementId'] for v in snap['evidence']['controls']}
    mod._cache[rows['Save']]['expires']=time.monotonic()-1
    check(not mod.action_native({'elementId':rows['Save'],'action':'invoke'})['ok'],'expired token denied')
    snap=mod.inspect_native()
    rows={v['name']:v['elementId'] for v in snap['evidence']['controls']}
    check(mod.action_native({'elementId':rows['Save'],'action':'invoke'})['evidence']['uiResultVerified'] is False,'invoke not misrepresented as verified')
finally:
    mod._get_root,mod._active_hwnd=oldroot,oldhwnd
print(f'NATIVE_UIA_OFFLINE: {checks}/{checks} PASS (mock UIA, NOT live Windows)')
