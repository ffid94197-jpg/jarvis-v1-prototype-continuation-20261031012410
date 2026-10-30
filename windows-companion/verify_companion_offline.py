"""Pure offline checks; does NOT launch Windows apps, screen capture or browser."""
from pathlib import Path
import ast
import ipaddress
import os
import re
import urllib.parse
source=Path(__file__).with_name('companion.py').read_text()
parsed=ast.parse(source)
policy=next(n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name=='validate_action')
ns={'os':os,'ipaddress':ipaddress,'re':re,'urllib':urllib,
    'app_aliases':lambda:('settings','chrome','notepad','explorer','calculator','paint','tlauncher'),
    'SETTINGS_PAGES':{'home':'ms-settings:','display':'ms-settings:display'}}
exec(compile(ast.Module(body=[policy],type_ignores=[]),'policy','exec'),ns)
check=ns['validate_action']
count=0
def run(ok,label):
    global count
    assert ok,label
    count+=1
    print('PASS',label)
run(check({'operation':'open_url','url':'https://www.youtube.com'}) is None,'ordinary HTTPS browser action accepted')
for url in ['http://youtube.com','https://127.0.0.1','https://localhost','https://192.168.1.1',
            'https://bad.local','https://test.internal','file:///C:/windows/system32',
            'https://user:secret@youtube.com','https://youtube.com:20189','https://foo.test']:
    run(check({'operation':'open_url','url':url}) is not None,'unsafe URL denied '+url)
run(check({'operation':'open_app','app':'notepad'}) is None,'allowlisted app accepted')
run(check({'operation':'open_app','app':'chrome'}) is None,'Chrome allowed')
run(check({'operation':'open_settings','page':'home'}) is None,'Settings URI command permitted')
run(check({'operation':'open_settings','page':'bad'}) is not None,'unknown Settings URI blocked')
run(check({'operation':'discover_apps'}) is None,'approved apps discovery permitted')
run(check({'operation':'open_app','app':'cmd'}) is not None,'arbitrary process denied')
run(check({'operation':'youtube_oldest','channel':'MrBeast'}) is None,'YouTube workflow request accepted')
run(check({'operation':'youtube_oldest','channel':'x;rm -rf'}) is not None,'malicious channel rejected')
run(check({'operation':'windows_shell','command':'whoami'}) is not None,'unknown action denied')
run(check({'operation':'open_url','url':None}) is not None,'null URL denied')
print(f'WINDOWS_COMPANION_POLICY {count}/{count} PASS (offline only, no Windows execution)')
