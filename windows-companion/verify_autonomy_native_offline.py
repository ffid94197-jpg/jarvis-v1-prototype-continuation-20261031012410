"""Offline mocked desktop observations and independent UIA proof; not Windows execution."""
import sys
import types
import native_uia as u
import desktop_control as d
n=0
def check(test,label):
    global n
    if not test: raise AssertionError('FAIL '+label)
    n+=1
    print('PASS',label)
for args in ({'operation':'native_verify'}, {'operation':'native_verify','titleContains':'Notepad','controlContains':'Save'},
             {'operation':'native_verify','titleContains':'x'},
             {'operation':'native_verify','textEquals':'\x00secret'}):
    check(u.validate_request(args) is not None,'invalid verification predicate denied')
for k,v in (('titleContains','Notepad'),('controlContains','Text editor'),('textEquals','Hello World')):
    check(u.validate_request({'operation':'native_verify',k:v}) is None,k+' permitted')
check(d.check_input({'operation':'desktop_observe'}) is None,'unified desktop observe accepted')
class Element:
    def __init__(self,name,kind='Button',value='',password=False):
        self.element_info=type('I',(),{'name':name,'control_type':kind,'is_password':password})()
        self._value=value
    def rectangle(self):return type('R',(),{'left':1,'top':1,'right':100,'bottom':30})()
    def is_enabled(self):return True
    def window_text(self):return 'Untitled - Notepad'
    def get_value(self):return self._value
    def descendants(self,depth=7):return [btn,edit,secret]
btn=Element('Save')
edit=Element('Text editor','Edit','JARVIS_NATIVE_ACCEPTANCE_0123456789')
secret=Element('Password','Edit','super-secret',True)
root=Element('Notepad')
original=u._get_root
try:
    u._get_root=lambda:(42,root)
    proof=u.verify_native({'titleContains':'Notepad'})
    check(proof['ok'] and proof['evidence']['proofVerified'],'actual foreground title verifies')
    check(u.verify_native({'controlContains':'Save'})['ok'],'actual accessible button verifies')
    check(u.verify_native({'textEquals':'JARVIS_NATIVE_ACCEPTANCE_0123456789'})['ok'],'exact editable text verifies')
    check(not u.verify_native({'textEquals':'JARVIS_NATIVE_ACCEPTANCE_0123456780'})['ok'],'wrong text rejected')
    check(not u.verify_native({'textEquals':'super-secret'})['ok'],'password value cannot serve as proof')
    check(not u.verify_native({'titleContains':'Chrome'})['ok'],'incorrect app title rejected')
    check('super-secret' not in str(u.verify_native({'controlContains':'Save'})),'no private text echoed')
finally:u._get_root=original
old_screen,old_windows,old_inspect=d.screen_info,d.all_windows,u.inspect_native
try:
    d.screen_info=lambda:{'width':1920,'height':1080,'foregroundTitle':'Notepad'}
    d.all_windows=lambda:{'windows':[{'title':'Notepad','windowId':'a'*24}]}
    u.inspect_native=lambda:{'ok':True,'evidence':{'controls':[{'name':'Text editor','type':'Edit'}]}}
    snap=d.observe_desktop()
    check(len(snap['foregroundControls'])==1 and len(snap['visibleWindows'])==1,'scene combines live desktop + UIA')
    check(snap['screenPixelsInterpreted'] is False,'scene never claims pixel interpretation')
    u.inspect_native=lambda:(_ for _ in ()).throw(RuntimeError('UIA unavailable'))
    snap=d.observe_desktop()
    check(snap['uiaLimitation'] and snap['foregroundControls']==[],'UIA unavailable returned honestly')
finally:d.screen_info,d.all_windows,u.inspect_native=old_screen,old_windows,old_inspect
print(f'AUTONOMY_NATIVE_FIXTURE: {n}/{n} passed (mock Windows only)')
