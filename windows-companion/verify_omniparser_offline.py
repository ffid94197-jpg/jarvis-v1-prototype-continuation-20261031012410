"""Offline-only parser bridge regressions; no screenshot, model weights or HTTP."""
from omniparser_local import normalize_detection_rows, inspect_live_screen
import os
counter=0
def check(v,name):
    global counter
    if not v:raise AssertionError(name)
    counter+=1
    print('PASS',name)
rows=normalize_detection_rows({'parsed_content_list':[
 {'type':'text','content':'Save','bbox':[.1,.2,.4,.6],'interactivity':True},
 {'type':'icon','content':'Password: secret','bbox':[0,.0,.3,.3]},
 {'type':'icon','content':'outside','bbox':[-.1,0,.3,.3]},
 {'type':'icon','content':'inverted','bbox':[.4,.4,.3,.5]},
]})
check(len(rows)==2,'Only physically valid normalized detections survive')
check(rows[0]['label']=='Save' and not rows[0]['actionable'],
      'No OmniParser visual hint may be an actionable UIA control')
check(rows[1]['label']=='[redacted sensitive field]',
      'Do not expose sensitive inferred text')
check(not normalize_detection_rows({'parsed_content_list':'malformed'}),
      'Malformed detector output is rejected')
check(not normalize_detection_rows({'parsed_content_list':[]}),
      'Empty detector output stays empty')
check(not normalize_detection_rows({'parsed_content_list':[
  {'bbox':[float('nan'),0.2,0.4,0.5], 'content':'faked target'}
]}),'NaN coordinates cannot become actionable or model-visible geometry')
for name in ('JARVIS_OMNIPARSER_ENABLED','JARVIS_SCREEN_WATCH_ENABLED',
             'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL'):
    os.environ.pop(name,None)
check(inspect_live_screen()['ok'] is False,'Inference remains off by default')
for name in ('JARVIS_OMNIPARSER_ENABLED','JARVIS_SCREEN_WATCH_ENABLED',
             'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL'):
    os.environ[name]='1'
os.environ.pop('JARVIS_OMNIPARSER_TOKEN',None)
check(inspect_live_screen()['ok'] is False,'Missing loopback secret denies screenshot inference')
print('OMNIPARSER_OFFLINE',counter,'/',counter,'PASS; model and Windows NOT tested')
