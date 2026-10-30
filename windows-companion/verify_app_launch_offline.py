"""Execute source launch functions against fake OS and process adapters.
No Windows process launched; network and real user session untouched.
"""
import ast
import os
import sys
import types
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from app_support import SETTINGS_PAGES
source=Path(__file__).with_name('companion.py').read_text()
parsed=ast.parse(source)
names={'open_app','discover_apps'}
chosen=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(chosen)==2
calls=[]
class FakeProc:
    pid=2468
class FakeSubprocess:
    DEVNULL=-1
    @staticmethod
    def Popen(command,**kwargs):
        calls.append((command,kwargs))
        return FakeProc()
class FakeOs:
    environ={'JARVIS_WINDOWS_COMPANION_TOKEN':'SECRET_NOT_CHILD_SAFE', 'PATH':'C:\\Windows',
             'JARVIS_WINDOWS_UI_CONTROL_ENABLED':'0'}
    @staticmethod
    def startfile(uri):calls.append(('startfile',uri))
ns={'os':FakeOs,'SETTINGS_PAGES':SETTINGS_PAGES,'subprocess':FakeSubprocess,
    'resolve_app':lambda alias:({'kind':'exe','target':r'C:\Program Files\Google\Chrome\Application\chrome.exe'} if alias=='chrome' else None),
    'app_aliases':lambda:('settings','chrome'),'BUILTINS':('settings','chrome'),
    'time':types.SimpleNamespace(sleep=lambda s:None),'list_approved_windows':lambda:[]}
exec(compile(ast.Module(body=chosen,type_ignores=[]),'launch-only','exec'),ns)
tests=0
def check(cond,label):
    global tests
    assert cond,label
    tests+=1
    print('PASS',label)
res=ns['open_app']('settings','display')
check(res['ok'] and calls[-1]==('startfile','ms-settings:display'),'Windows display Settings uses fixed protocol')
check(not ns['open_app']('settings','powershell')['ok'],'arbitrary Settings target denied')
res=ns['open_app']('chrome')
check(res['ok'] and calls[-1][0]==[r'C:\Program Files\Google\Chrome\Application\chrome.exe'],'Chrome launches its installed executable')
check(calls[-1][1]['shell'] is False,'never invoke shell to launch apps')
check('JARVIS_WINDOWS_COMPANION_TOKEN' not in calls[-1][1]['env'],'private companion token not inherited')
check(not res['evidence']['windowVisibleVerified'],'launch without GUI proof not misreported')
check(not ns['open_app']('unknown')['ok'],'missing install refused')
check(ns['discover_apps']()['ok'] and len(ns['discover_apps']()['evidence']['apps'])==2,'catalog discovery explicit')
print(f'APP_LAUNCH_FIXTURE: {tests}/{tests} passed (no native app launched)')
