"""JARVIS read-only capability discovery and autonomous tool selection.

Search Windows installed program registry names, existing Start Menu shortcuts and
operator-approved aliases. This does NOT traverse personal files, install software,
or execute arbitrary commands. Online suggestions are verified official links,
not evidence that an online account or tool works on this machine.
"""
from __future__ import annotations
from dataclasses import dataclass
import os
import re
import time
from pathlib import Path

# Categories are expandable without giving model output execution authority.
# Evidence is based on local installed names; ambiguous user requests stop for clarification.
CATEGORIES = {
 'image': {
   'intent': ('photo', 'image', 'picture', 'photoshop', 'png', 'jpg', 'jpeg', 'psd', 'retouch', 'crop image', 'remove background'),
   'apps': ('gimp', 'photoshop', 'affinity photo', 'paint.net', 'krita', 'paint', 'photopea', 'photos'),
   'web': (('Photopea', 'https://www.photopea.com/', 'In-browser image editing; inspect file-upload behavior before use'),),
 },
 'video': {
   'intent': ('video', 'clip', 'reel', 'movie', 'mp4', 'footage', 'timeline', 'subtitle'),
   'apps': ('davinci resolve', 'premiere pro', 'capcut', 'kdenlive', 'shotcut', 'openshot', 'clipchamp'),
   'web': (('CapCut online editor', 'https://www.capcut.com/tools/online-video-editor', 'Cloud editing may require sign-in or upload'), ('Canva video editor', 'https://www.canva.com/video-editor/', 'Cloud editing may require sign-in or upload')),
 },
 'audio': {
   'intent': ('audio', 'podcast', 'recording', 'song', 'sound', 'mp3', 'waveform', 'wav'),
   'apps': ('audacity', 'reaper', 'fl studio', 'ableton', 'ocenaudio'),
   'web': (('AudioMass', 'https://audiomass.co/', 'In-browser audio editing; verify privacy locally'),),
 },
 'pdf': {
   'intent': ('pdf', 'acrobat', 'document pages', 'merge pages', 'sign pdf'),
   'apps': ('adobe acrobat', 'pdf24', 'foxit', 'pdf-xchange', 'sumatrapdf'),
   'web': (('PDF24 Tools', 'https://tools.pdf24.org/en/', 'Online PDF operations may upload documents; obtain permission before sending files'),),
 },
 'code': {
   'intent': ('code', 'program', 'script', 'source', 'repository', 'typescript', 'python', 'javascript', 'json', 'html', 'css', 'debug', 'bug', 'compile', 'frontend', 'backend'),
   'apps': ('visual studio code', 'vscode', 'vs code', 'pycharm', 'intellij', 'visual studio', 'sublime text', 'notepad++', 'cursor', 'zed'),
   'web': (('VS Code for the Web', 'https://vscode.dev/', 'Web editor has local-file and extension limitations'),),
 },
 'document': {
   'intent': ('word document', 'docx', 'letter', 'resume', 'report', 'essay', 'rich text'),
   'apps': ('microsoft word', 'libreoffice writer', 'onlyoffice', 'wps writer', 'wordpad'),
   'web': (('Google Docs', 'https://docs.google.com/', 'Requires Google account and cloud access'),),
 },
 'spreadsheet': {
   'intent': ('spreadsheet', 'excel', 'xlsx', 'csv', 'worksheet', 'table data'),
   'apps': ('microsoft excel', 'libreoffice calc', 'onlyoffice', 'wps spreadsheets'),
   'web': (('Google Sheets', 'https://sheets.google.com/', 'Requires account; data may leave device'),),
 },
 'presentation': {
   'intent': ('slide', 'presentation', 'powerpoint', 'pptx', 'pitch deck'),
   'apps': ('microsoft powerpoint', 'libreoffice impress', 'onlyoffice', 'wps presentation'),
   'web': (('Canva', 'https://www.canva.com/', 'Cloud design service may require account or upload'),),
 },
 'diagram': {
   'intent': ('diagram', 'flowchart', 'whiteboard', 'mind map', 'mindmap', 'architecture map'),
   'apps': ('draw.io', 'diagrams.net', 'visio', 'excalidraw', 'obsidian'),
   'web': (('Excalidraw', 'https://excalidraw.com/', 'Web whiteboard, check privacy before sharing'),),
 },
 '3d': {
   'intent': ('3d', 'modeling', 'render', 'blender', 'mesh', 'sculpt'),
   'apps': ('blender', 'fusion 360', 'maya', '3ds max', 'sketchup'),
   'web': (),
 },
 'archive': {
   'intent': ('zip file', 'archive', '7z', 'rar', 'extract files', 'compress folder'),
   'apps': ('7-zip', 'winrar', 'peazip'),
   'web': (),
 },
 'game': {
   'intent': ('minecraft', 'play game', 'game launcher', 'gaming'),
   'apps': ('minecraft launcher', 'tlauncher', 'steam', 'epic games launcher', 'minecraft'),
   'web': (),
 },
}

# Phrase boundaries avoid accidental classification of 'apple' as an 'app' etc.
FORMAT_EXTENSIONS = {
  'pdf':'pdf','xlsx':'spreadsheet','xls':'spreadsheet','csv':'spreadsheet',
  'ppt':'presentation','pptx':'presentation','doc':'document','docx':'document',
  'png':'image','jpg':'image','jpeg':'image','psd':'image','svg':'image','webp':'image',
  'mp4':'video','mkv':'video','mov':'video','avi':'video',
  'mp3':'audio','wav':'audio','flac':'audio','ogg':'audio',
  'ts':'code','tsx':'code','js':'code','jsx':'code','py':'code','json':'code','html':'code','css':'code',
  'blend':'3d','stl':'3d','obj':'3d','zip':'archive','rar':'archive','7z':'archive',
}
FORMAT_WORDS = {'pdf':'pdf','excel':'spreadsheet','spreadsheet':'spreadsheet',
 'powerpoint':'presentation','presentation':'presentation','word document':'document','docx':'document',
 'video':'video','audio':'audio','photo':'image','image':'image','3d':'3d'}

ACTION_WORDS = ('edit','modify','retouch','cut','trim','fix','create','design','open','play','work on','make','build','compose','convert','merge','compress','organize','draw')
SENSITIVE_HINTS = ('private', 'confidential', 'sensitive', 'secret', 'medical', 'passport', 'aadhaar', 'bank statement', 'password', 'offline only', 'local only', 'do not upload')


def _clean(s, limit=100):
    if not isinstance(s, str): return ''
    return ''.join(c for c in s if c.isprintable() and c not in '\r\n\x00')[:limit].strip()


def _contains(text, phrase):
    return bool(re.search(r'(?<![\w])' + re.escape(phrase) + r'(?![\w])', text, re.I))


def classify_goal(goal):
    g = goal.casefold()
    scores = {}
    # Explicit filename extensions outrank generic words such as "report".
    extensions = re.findall(r'(?<![\w])[^\s/\\:]+\.([A-Za-z0-9]{2,5})(?![\w])', g)
    explicit = [FORMAT_EXTENSIONS[e] for e in extensions if e in FORMAT_EXTENSIONS]
    if len(set(explicit)) == 1 and explicit:
        return explicit[0], [explicit[0]]
    for kind, entry in CATEGORIES.items():
        hits = [term for term in entry['intent'] if _contains(g, term)]
        if hits:
            scores[kind] = sum(3 if len(t)>5 else 2 for t in hits)
    for token, kind in FORMAT_WORDS.items():
        if _contains(g,token):scores[kind] = scores.get(kind,0) + 10
    if not scores:
        return None, []
    order=sorted(scores, key=lambda k:(-scores[k], k))
    if len(order)>1 and scores[order[0]]==scores[order[1]]:
        return None, order
    return order[0], order


def _registry_apps(limit=360):
    if os.name!='nt': return []
    try: import winreg
    except ImportError: return []
    result=[]
    roots=((winreg.HKEY_CURRENT_USER,winreg.KEY_WOW64_64KEY),
           (winreg.HKEY_LOCAL_MACHINE,winreg.KEY_WOW64_64KEY),
           (winreg.HKEY_LOCAL_MACHINE,winreg.KEY_WOW64_32KEY))
    path=r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    for hive, view in roots:
        try:
            with winreg.OpenKey(hive,path,0,winreg.KEY_READ|view) as key:
                _,count,_=winreg.QueryInfoKey(key)
                for i in range(min(count,1200)):
                    if len(result)>=limit: return result
                    try:
                        with winreg.OpenKey(key,winreg.EnumKey(key,i)) as sub:
                            value=winreg.QueryValueEx(sub,'DisplayName')[0]
                            if not isinstance(value,str): continue
                            name=_clean(value,80)
                            if name and len(name)>2:
                                result.append({'name':name,'source':'Windows installed-program registry','launchable':False})
                    except (OSError,ValueError): continue
        except OSError: continue
    return result


def inventory(installed=None, shortcuts=None, builtin=None):
    """Fixtures can inject lists on Linux; Windows uses local registry and Start Menu."""
    if installed is None: installed=_registry_apps()
    if shortcuts is None:
        try:
            from desktop_control import discover_installed
            shortcuts=discover_installed()
        except (ImportError,OSError): shortcuts={}
    if builtin is None:
        try:
            from app_support import BUILTINS, resolve_app
            builtin=[alias for alias in BUILTINS if resolve_app(alias) is not None]
        except (ImportError,OSError): builtin=[]
    items=[]; seen=set()
    for alias in builtin:
        name=_clean(alias,80)
        if name and name.casefold() not in seen:
            seen.add(name.casefold()); items.append({'name':name,'source':'approved alias','launchable':True,'launchTool':'windows_open_app','launchArgs':{'app':alias}})
    for sid, info in (shortcuts or {}).items():
        name=_clean(info.get('name','') if isinstance(info,dict) else '',80)
        if not name or name.casefold() in seen or not re.fullmatch(r'start-[a-f0-9]{12}',sid):continue
        seen.add(name.casefold());items.append({'name':name,'source':'Start Menu shortcut','launchable':True,'launchTool':'windows_launch_installed','launchArgs':{'appId':sid}})
    for row in installed:
        name=_clean(row.get('name','') if isinstance(row,dict) else '',80)
        if name and name.casefold() not in seen:
            seen.add(name.casefold());items.append({'name':name,'source':'Windows installed-program registry','launchable':False})
    return items


def _relevance(name, aliases):
    n=name.casefold()
    points=0
    for alias in aliases:
        if n==alias: points=max(points,100)
        elif _contains(n,alias): points=max(points,85)
        elif _contains(alias,n) and len(n)>5: points=max(points,55)
    return points


def recommend(goal, installed=None, shortcuts=None, builtin=None):
    """Deterministic capability advisory. No downloads, commands or credential exposure."""
    if not isinstance(goal,str) or not 3<=len(goal.strip())<=250 or any(ord(c)<32 for c in goal):
        return {'ok':False,'error':'Provide a goal of 3–250 printable characters.'}
    goal=goal.strip()
    primary, categories=classify_goal(goal)
    private=any(_contains(goal.casefold(),s) for s in SENSITIVE_HINTS)
    items=inventory(installed,shortcuts,builtin)
    if not primary:
        return {'ok':True,'evidence':{'goal':goal,'state':'needs_goal_detail','taskCategory':None,
            'possibleCategories':categories[:4],
            'question':'What kind of work or file do you want to edit or create?',
            'installedAppsExamined':len(items),'localCandidates':[],'onlineAlternatives':[],
            'verifiedExecuted':False, 'note':'No application or website was opened.'}}
    matches=[]
    aliases=CATEGORIES[primary]['apps']
    for app in items:
        rating=_relevance(app['name'], aliases)
        if rating:
            matches.append({**app,'relevance':rating+(2 if app.get('launchable') else 0)})
    matches.sort(key=lambda m:(-m['relevance'],not m['launchable'],m['name'].casefold()))
    matches=matches[:12]
    # Do not mistake registry presence for ability to launch an app.
    usable=next((m for m in matches if m['launchable']),None)
    web=[]
    if not usable and not private:
        web=[{'name':name,'url':url,'caution':note,'verifiedInstalled':False,
              'requiresUserDecision':True} for name,url,note in CATEGORIES[primary]['web'][:3]]
    state='local_options' if usable else 'online_alternatives' if web else 'no_approved_option'
    return {'ok':True,'evidence':{'goal':goal,'state':state,'taskCategory':primary,
        'otherPossibleCategories':categories[1:4], 'privateOrOfflineRequested':private,
        'installedAppsExamined':len(items),'localCandidates':matches,
        'suggestedNextTool':({'tool':usable['launchTool'],'args':usable['launchArgs']}
                             if usable else None),
        'onlineAlternatives':web,'verifiedExecuted':False,
        'note':('Local recommendations are based on installed metadata; app launch and edit completion must be separately verified.'
                if usable else 'No verified launchable matching local app found; registry entries are not proof of launchability. Websites were not opened and files were not uploaded.')}}
