"""Read-only, operator-opted local OmniParser observation adapter.

Grounding target: microsoft/OmniParser util/omniparser.py parse() output.
No model code/weights are bundled. Requires an operator-started LOOPBACK
OmniParser service implementing POST /parse with the official parser output.
This module never produces a clickable UIA ID or executes a suggested action.
"""
from __future__ import annotations
import base64
import http.client
import io
import json
import os
import re

def normalize_detection_rows(data):
    if not isinstance(data, dict): return []
    candidates=data.get('parsed_content_list',data.get('elements',[]))
    if not isinstance(candidates,list):return []
    rows=[]
    for item in candidates[:250]:
        if not isinstance(item,dict):continue
        box=item.get('bbox')
        if not isinstance(box,(tuple,list)) or len(box)!=4 or not all(
            type(n) in (int,float) and 0<=n<=1 for n in box):
            continue
        if box[2]<=box[0] or box[3]<=box[1]:continue
        label=str(item.get('content',''))[:140]
        if any(x in label.casefold() for x in
               ('password','access token','api key','authorization','secret key')):
            label='[redacted sensitive field]'
        rows.append({'type':str(item.get('type','unknown'))[:25],
                     'label':label,'bbox':[round(float(n),5) for n in box],
                     'interactivitySuggested':item.get('interactivity') is True,
                     'actionable':False})
        if len(rows)>=40:break
    return rows

def inspect_live_screen():
    env=os.environ
    if any(env.get(name)!='1' for name in (
      'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL','JARVIS_SCREEN_WATCH_ENABLED',
      'JARVIS_OMNIPARSER_ENABLED')):
        return {'ok':False,'reason':'Explicit private desktop, screen and OmniParser opt-ins required'}
    token=env.get('JARVIS_OMNIPARSER_TOKEN','')
    port=env.get('JARVIS_OMNIPARSER_PORT','')
    if len(token)<32 or not port.isdigit() or not 1024<=int(port)<=65535:
        return {'ok':False,'reason':'Missing bounded OmniParser loopback configuration'}
    try:
        import mss
        from PIL import Image
        with mss.mss() as capture:
            monitor=capture.monitors[1]
            shot=capture.grab(monitor)
            image=Image.frombytes('RGB',shot.size,shot.rgb)
        image.thumbnail((1280,800))
        bio=io.BytesIO()
        image.save(bio,format='PNG',optimize=True)
        png=bio.getvalue()
        if len(png)>2_000_000:
            return {'ok':False,'reason':'Private screen image exceeds local inference size limit'}
        payload=json.dumps({'image_base64':base64.b64encode(png).decode('ascii')}).encode('utf8')
        conn=http.client.HTTPConnection('127.0.0.1',int(port),timeout=5)
        try:
            conn.request('POST','/parse',body=payload,headers={
                'Content-Type':'application/json',
                'Authorization':'Bearer '+token,
                'Content-Length':str(len(payload))
            })
            resp=conn.getresponse()
            if resp.status!=200 or int(resp.getheader('Content-Length') or 0)>256000:
                return {'ok':False,'reason':'OmniParser loopback endpoint not ready'}
            raw=resp.read(256001)
            if len(raw)>256000:raise ValueError('Oversized response')
            detected=normalize_detection_rows(json.loads(raw))
            return {'ok':True,'source':'operator-approved local OmniParser model (unverified hints)',
                'detections':detected,'count':len(detected),
                'imageSize':[image.width,image.height],
                'note':'Read-only visual hints; NOT authoritative UIA IDs, model proof, or authorization'}
        finally:conn.close()
    except (OSError,ValueError,ImportError,TypeError,IndexError,KeyError,
            json.JSONDecodeError) as err:
        return {'ok':False,'reason':'Local OmniParser observation unavailable ('+
                type(err).__name__+')'}
