"""Pure catalog and Windows launcher policy probes (not live Windows execution)."""
import sys, tempfile, json, os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from app_support import BUILTINS, SETTINGS_PAGES, safe_executable_path, approved_config, resolve_app, candidates
n=0
def check(condition,name):
    global n
    assert condition,name
    n+=1
    print('PASS',name)
check('settings' in BUILTINS,'Settings built in')
check('chrome' in BUILTINS,'Chrome built in')
check(SETTINGS_PAGES['display']=='ms-settings:display','fixed display URI')
check(not safe_executable_path('powershell.exe'),'bare arbitrary command denied')
check(not safe_executable_path(r'\\server\share\bad.exe'),'UNC executable denied')
check(not safe_executable_path(r'C:\Windows\System32\cmd.exe'),'operator cannot approve command shell')
check(safe_executable_path(r'D:\Apps\MyMusic\music.exe'),'explicit local exe path accepted')
check(not safe_executable_path(r'D:\Apps\..\cmd.exe'),'path traversal denied')
check(not safe_executable_path(r'D:\Apps\helper.cmd'),'script/batch denied')
with tempfile.TemporaryDirectory() as tmp:
    conf=Path(tmp)/'approved_apps.json'
    conf.write_text(json.dumps({'music':r'D:\Apps\MyMusic\music.exe','shell':r'C:\Windows\System32\cmd.exe','evil':'powershell.exe'}))
    parsed=approved_config(conf)
    check(list(parsed)==['music'],'custom approval filters shell and invalid path')
    conf.write_text('{bad')
    check(approved_config(conf)=={},'malformed approvals fail closed')
check(resolve_app('settings')['target']=='ms-settings:','settings protocol exact')
check(resolve_app('unknown-app') is None,'unknown program denied')
check(any(x.lower().endswith('chrome.exe') for x in candidates('chrome')),'Chrome detection paths')
check(any(x.lower().endswith('msedge.exe') for x in candidates('edge')),'Edge detection paths')
check(resolve_app('chrome',exists=lambda p:p.lower().endswith('chrome.exe'))['kind']=='exe','Chrome resolved with mocked install')
check(resolve_app('chrome',exists=lambda p:False) is None,'uninstalled Chrome not fabricated')
print(f'APP_CATALOG: {n}/{n} offline assertions passed (Windows launch pending)')
