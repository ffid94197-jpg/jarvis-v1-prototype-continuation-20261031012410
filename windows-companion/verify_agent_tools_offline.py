"""Offline policy/DOM simulations: no Windows, browser, model, or network required."""
import ast
import ipaddress
import os
import re
import secrets
import urllib.parse
from pathlib import Path
source = Path(__file__).with_name('companion.py').read_text(encoding='utf-8')
parsed = ast.parse(source)
names = {'validate_action', 'safe_public_link', 'safe_search_field',
         'inspect_page', 'action_on_inspected_page'}
ns={'app_aliases':lambda:('settings','chrome','notepad','explorer','calculator','paint','tlauncher'), 'SETTINGS_PAGES': {'home':'ms-settings:', 'display':'ms-settings:display'}, 'os':os,'re':re,'ipaddress':ipaddress,'urllib':urllib,'secrets':secrets,
    'BROWSER_ELEMENTS':'a:visible, input:visible'}
selected=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(selected)==len(names)
exec(compile(ast.Module(body=selected,type_ignores=[]),'policy-only','exec'),ns)
check=ns['validate_action']
count=0
def passes(condition,label):
    global count
    assert condition,label
    count+=1
    print('PASS',label)

os.environ['JARVIS_BROWSER_AGENT_ENABLED']='1'
os.environ['JARVIS_WINDOWS_UI_CONTROL_ENABLED']='1'
passes(check({'operation':'browser_search','query':'fun videos'}) is None,'general browser search allowed when opted in')
passes(check({'operation':'browser_search','query':'\nsearch'}) is not None,'control characters rejected')
passes(check({'operation':'browser_search','query':'x'*161}) is not None,'oversized searches rejected')
passes(check({'operation':'browser_inspect'}) is None,'inspect allowed')
passes(check({'operation':'browser_inspect','query':'MrBeast'}) is None,
       'Visible browser element grounding accepts bounded owner query')
passes(check({'operation':'browser_inspect','query':'X'*161}) is not None,
       'Browser element grounding rejects oversized query')
passes(check({'operation':'browser_inspect','query':'MrBeast','script':'execute'}) is not None,
       'Browser element grounding refuses extra command parameters')
passes(check({'operation':'browser_read_page'}) is None,'read allowed')
passes(check({'operation':'browser_click_link','index':0,'pageToken':'a'*24}) is None,'bounded click accepted')
passes(check({'operation':'browser_click_link','index':40,'pageToken':'a'*24}) is not None,'large click index denied')
passes(check({'operation':'browser_click_link','index':0,'pageToken':'bad'}) is not None,'invalid page token denied')
passes(check({'operation':'browser_fill_search','index':2,'pageToken':'a'*24,'text':'YouTube'}) is None,'search input accepted')
passes(check({'operation':'browser_fill_search','index':2,'pageToken':'a'*24,'text':'x'*200}) is not None,'oversized search input denied')
passes(check({'operation':'browser_scroll','direction':'left','pages':1,'pageToken':'a'*24}) is not None,'horizontal scroll denied')
passes(check({'operation':'browser_scroll','direction':'down','pages':2,'pageToken':'a'*24}) is None,'bounded scroll allowed')
passes(check({'operation':'focus_app','app':'notepad'}) is None,'approved app focus')
passes(check({'operation':'open_settings','page':'display'}) is None,'approved Settings page')
passes(check({'operation':'open_settings','page':'bad'}) is not None,'unknown Settings page rejected')
passes(check({'operation':'open_app','app':'chrome'}) is None,'Chrome launch action permitted')
passes(check({'operation':'discover_apps'}) is None,'app catalog discovery permitted')
passes(check({'operation':'focus_app','app':'powershell'}) is not None,'shell focus denied')
passes(check({'operation':'list_windows'}) is None,'approved windows listing')
os.environ.pop('JARVIS_BROWSER_AGENT_ENABLED')
passes(check({'operation':'browser_read_page'}) is not None,'opt-out denies general browser')
os.environ.pop('JARVIS_WINDOWS_UI_CONTROL_ENABLED')
passes(check({'operation':'list_windows'}) is not None,'opt-out denies window inspection')
passes(ns['safe_public_link']('https://www.youtube.com/watch?v=8'),'public link accepted')
for url in ('http://example.com', 'file:///C:/secrets', 'https://127.0.0.1',
            'https://localhost/admin', 'https://corp.internal', 'https://user:pwd@example.com',
            'https://example.com:20189/private', 'javascript:alert(1)'):
    passes(not ns['safe_public_link'](url),'unsafe link rejected '+url[:35])

class Element:
    def __init__(self,tag,href='',text='',attrs=None):
        self.tag,self.href,self.text,self.attrs=tag,href,text,attrs or {}
        self.clicked=False
        self.filled=None
        self.pressed=None
    def evaluate(self,code): return self.tag
    def get_attribute(self,name):
        return self.href if name=='href' else self.attrs.get(name)
    def inner_text(self,timeout=0):return self.text
    def click(self,timeout=0):self.clicked=True
    def fill(self,text,timeout=0):self.filled=text
    def press(self,key,timeout=0):self.pressed=key
class Locator:
    def __init__(self,els):self.els=els
    def count(self):return len(self.els)
    def nth(self,index):return self.els[index]
class Mouse:
    def wheel(self,x,y):self.y=y
class Page:
    def __init__(self,els):
        self.url='https://www.youtube.com/results'
        self.els=els
        self.mouse=Mouse()
    def title(self):return 'YouTube Test'
    def locator(self,selector):return Locator(self.els)
    def goto(self,url,**kwargs):self.url=url
    def wait_for_load_state(self,*args,**kwargs):pass
    def wait_for_timeout(self,*args,**kwargs):pass

link=Element('a','https://www.youtube.com/@MrBeast','MrBeast')
unsafe=Element('a','http://127.0.0.1/','Private')
search=Element('input',attrs={'type':'search','placeholder':'Search'})
password=Element('input',attrs={'type':'password','placeholder':'Password'})
page=Page([link,unsafe,search,password]); state={}
items=ns['inspect_page'](page,state)
passes(items['items'][0]['kind']=='link' and len(items['items'])==2,'inspect omits private links and passwords')
passes(len(items['pageToken'])==24,'fresh page token issued')
def raises(f):
    try:f();return False
    except RuntimeError:return True
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':1,'pageToken':items['pageToken']})),'uninspected link denied')
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_fill_search','index':3,'pageToken':items['pageToken'],'text':'secret'})),'password input not fillable')
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':0,'pageToken':'0'*24})),'stale token denied')
passes(ns['action_on_inspected_page'](page,state,{'operation':'browser_scroll','direction':'down','pages':2,'pageToken':items['pageToken']})['scrolled'],'scroll runs on inspected page')
passes(ns['action_on_inspected_page'](page,state,{'operation':'browser_fill_search','index':2,'pageToken':items['pageToken'],'text':'oldest'})['searchSubmitted'] and search.pressed=='Enter','search box enters query')
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':0,'pageToken':items['pageToken']})),'inspection expires after submission')
items=ns['inspect_page'](page,state)
passes(ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':0,'pageToken':items['pageToken']})['navigationConfirmed'],'public inspected link clicked')
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':0,'pageToken':items['pageToken']})),'inspection expires after navigation')
items=ns['inspect_page'](page,state)
link.href='https://google.com/'
passes(raises(lambda:ns['action_on_inspected_page'](page,state,{'operation':'browser_click_link','index':0,'pageToken':items['pageToken']})),'link mutation detected')
print(f'AGENT_BROWSER_POLICY: {count}/{count} checks passed (offline, no Playwright or Windows)')
