"""Operator-enabled, on-device Windows desktop control for JARVIS experiments.

This module executes only short, typed actions. No shell, generated scripts,
network listeners or arbitrary executable paths. It is invoked ONLY by the
loopback bearer-protected companion after the Core's Guardian audit.

Ctrl+Shift+F12 is an emergency stop: it latches input-control OFF until restart.
"""
from __future__ import annotations
import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import re
import secrets
import threading
import time

ENABLED = 'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL'
KEYS = {
    'enter':0x0D,'esc':0x1B,'tab':0x09,'space':0x20,'backspace':0x08,
    'delete':0x2E,'up':0x26,'down':0x28,'left':0x25,'right':0x27,
    'home':0x24,'end':0x23,'ctrl':0x11,'alt':0x12,'shift':0x10,'win':0x5B,
    'a':0x41,'c':0x43,'v':0x56,'x':0x58,'s':0x53,'f':0x46,
    'r':0x52,'t':0x54,'w':0x57,'d':0x44,'e':0x45,'n':0x4E,
    'p':0x50,'z':0x5A,'y':0x59,'f4':0x73,
}
_lock=threading.RLock()
_stopped=threading.Event()
_active_windows={}


def is_enabled():
    return os.name == 'nt' and os.environ.get(ENABLED) == '1'


def check_input(op):
    if not isinstance(op,dict): return 'Invalid desktop request.'
    name=op.get('operation')
    if name in ('desktop_state','desktop_windows','desktop_observe'): return None
    if name=='desktop_focus':
        return None if isinstance(op.get('windowId'),str) and re.fullmatch(r'[a-f0-9]{24}',op['windowId']) else 'Use a fresh windowId.'
    if name == 'desktop_click' and 'elementToken' in op:
        if (os.environ.get('JARVIS_CUA_DRIVER_ENABLED') == '1' and
            type(op.get('pid')) is int and 0 < op['pid'] < 2**32 and
            isinstance(op.get('cuaWindowId'), str) and re.fullmatch(r'[0-9]{1,20}', op['cuaWindowId']) and
            0 < int(op['cuaWindowId']) < 2**64 and
            isinstance(op.get('elementToken'), str) and re.fullmatch(r'[A-Za-z0-9:_-]{1,128}', op['elementToken']) and
            op.get('button', 'left') in ('left','right','double')):
            return None
        return 'Invalid or incomplete CUA element target.'
    if name in ('desktop_move','desktop_click'):
        if any(type(op.get(k)) is not int or not 0<=op[k]<16000 for k in ('x','y')):
            return 'Invalid screen coordinates.'
        if name=='desktop_click' and op.get('button') not in ('left','right','double'):
            return 'Invalid mouse button.'
        return None
    if name=='minecraft_input':
        return None if op.get('action') in ('forward','back','left','right','jump','sneak','attack','use','inventory') and \
            type(op.get('durationMs')) is int and 100 <= op['durationMs'] <= 1500 else 'Invalid bounded Minecraft input.'
    if name=='desktop_type':
        s=op.get('text')
        return None if isinstance(s,str) and 1<=len(s)<=400 and not any(ord(c)<32 and c not in '\t\n\r' for c in s) else 'Invalid text.'
    if name=='desktop_keys':
        seq=op.get('keys')
        return None if isinstance(seq,list) and 1<=len(seq)<=4 and all(isinstance(k,str) and k in KEYS for k in seq) else 'Invalid key combination.'
    if name=='desktop_scroll':
        n=op.get('amount')
        return None if type(n) is int and n!=0 and -5<=n<=5 else 'Invalid scroll amount.'
    if name=='launch_installed':
        return None if isinstance(op.get('appId'),str) and re.fullmatch(r'start-[a-f0-9]{12}',op['appId']) else 'Unknown installed app ID.'
    return 'Unknown desktop operation.'


def discover_installed(limit=180):
    """List operator-installed Start Menu shortcuts; ids are hash-bound to exact files."""
    roots=[]
    for value, suffix in ((os.environ.get('PROGRAMDATA'), r'Microsoft\Windows\Start Menu\Programs'),
                          (os.environ.get('APPDATA'), r'Microsoft\Windows\Start Menu\Programs')):
        if value: roots.append(Path(value)/suffix)
    apps={}
    for root in roots:
        if not root.is_dir(): continue
        try:
            for file in root.rglob('*.lnk'):
                if len(apps)>=limit: return apps
                try:
                    if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
                        continue
                    # Do not launch shell/terminal tooling through Start Menu discovery.
                    if any(s in file.stem.casefold() for s in ('powershell','command prompt','terminal','registry editor','task scheduler')):
                        continue
                    ident='start-'+hashlib.sha256(str(file.resolve()).casefold().encode()).hexdigest()[:12]
                    apps[ident]={'name':file.stem[:80], 'path':str(file)}
                except OSError: continue
        except OSError: pass
    return apps


def fail(error): return {'ok':False,'error':error}


def screen_info():
    user=ctypes.windll.user32
    user.GetForegroundWindow.restype=wintypes.HWND
    user.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
    w,h=int(user.GetSystemMetrics(0)),int(user.GetSystemMetrics(1))
    title=''
    hwnd=user.GetForegroundWindow()
    if hwnd:
        buf=ctypes.create_unicode_buffer(150)
        user.GetWindowTextW(hwnd,buf,len(buf))
        title=buf.value[:100]
    point=wintypes.POINT()
    cursor=None
    if user.GetCursorPos(ctypes.byref(point)):
        cursor={'x':point.x,'y':point.y}
    return {'width':w,'height':h,'foregroundTitle':title,'cursor':cursor,
        'emergencyStopLatched':_stopped.is_set(),'scope':'Primary Windows desktop; interactive user session only'}


def observe_desktop():
    """Single scene read, no synthetic screen description. UIA may be missing."""
    state = screen_info()
    windows = all_windows()
    controls = []
    limitation = None
    try:
        from native_uia import inspect_native
        inspected = inspect_native()
        if inspected.get('ok'):
            controls = inspected.get('evidence',{}).get('controls',[])[:35]
        else:
            limitation = 'Native accessibility inspection unavailable.'
    except Exception as exc:
        limitation = 'Native accessibility unavailable ('+type(exc).__name__+').'
    # Optional screenshot inference stays local/opt-in and cannot grant
    # action authority. It never produces reusable UIA element tokens.
    omniparser=None
    if os.environ.get('JARVIS_OMNIPARSER_ENABLED')=='1':
        from omniparser_local import inspect_live_screen
        omniparser=inspect_live_screen()
    return {'desktop':state, 'visibleWindows':windows.get('windows',[])[:35],
            'foregroundControls':controls, 'uiaLimitation':limitation,
            'source':'Current Windows desktop and accessibility tree',
            'screenPixelsInterpreted':bool(omniparser and omniparser.get('ok')),
            'omniparser':omniparser,
            'note':'OmniParser yields read-only visual hints, never proof or clickable authority.'}


def emergency_monitor():
    if os.name!='nt':return
    def release_cua_session():
        if os.environ.get('JARVIS_CUA_DRIVER_ENABLED') == '1':
            try:
                from cua_driver_backend import emergency_stop
                emergency_stop()
            except Exception:
                pass
    try:
        user=ctypes.windll.user32
        while True:
            # 0x11 Ctrl, 0x10 Shift, 0x7B F12
            if all(user.GetAsyncKeyState(k)&0x8000 for k in (0x11,0x10,0x7B)):
                _stopped.set()
                release_cua_session()
                return
            time.sleep(.08)
    except Exception:
        _stopped.set() # if input-safety monitor failed, don't continue blindly
        release_cua_session()


def all_windows():
    user=ctypes.windll.user32
    user.IsWindowVisible.argtypes=[wintypes.HWND]
    user.GetWindowTextLengthW.argtypes=[wintypes.HWND]
    user.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
    callback_t=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
    entries={};rows=[]
    @callback_t
    def visit(hwnd,_):
        if len(rows)>=40:return False
        if not user.IsWindowVisible(hwnd) or user.GetWindowTextLengthW(hwnd)<2:return True
        buf=ctypes.create_unicode_buffer(160)
        user.GetWindowTextW(hwnd,buf,len(buf))
        name=buf.value.strip()
        if not name:return True
        token=secrets.token_hex(12)
        entries[token]=(int(hwnd),name,time.monotonic()+25)
        rows.append({'windowId':token,'title':name[:100]})
        return True
    user.EnumWindows.argtypes=[callback_t,wintypes.LPARAM]
    user.EnumWindows(visit,0)
    _active_windows.clear();_active_windows.update(entries)
    return {'windows':rows,'count':len(rows),'expiresInSeconds':25}


def is_minecraft_game(title):
    """Only target a visibly focused game, not a launcher, web page or editor."""
    if not isinstance(title,str):return False
    t=title.casefold().strip()
    return (t == 'minecraft' or t.startswith('minecraft ') or t.startswith('minecraft:')) and \
           not any(x in t for x in ('launcher','tlauncher','browser','youtube'))


def keypress(user,code,down=True):
    user.keybd_event(code,0,0 if down else 0x0002,0)


def input_text(user,text):
    """Inject UTF-16 code units via SendInput, not a shell/clipboard command."""
    from ctypes import wintypes
    ULONG_PTR=ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p)==8 else ctypes.c_ulong
    class KEYBDINPUT(ctypes.Structure):
        _fields_=[('wVk',wintypes.WORD),('wScan',wintypes.WORD),('dwFlags',wintypes.DWORD),
                  ('time',wintypes.DWORD),('dwExtraInfo',ULONG_PTR)]
    class MOUSEINPUT(ctypes.Structure):
        _fields_=[('dx',wintypes.LONG),('dy',wintypes.LONG),('mouseData',wintypes.DWORD),
                  ('dwFlags',wintypes.DWORD),('time',wintypes.DWORD),('dwExtraInfo',ULONG_PTR)]
    class UNION(ctypes.Union):_fields_=[('ki',KEYBDINPUT),('mi',MOUSEINPUT)]
    class INPUT(ctypes.Structure):_fields_=[('type',wintypes.DWORD),('u',UNION)]
    send=user.SendInput
    send.argtypes=[wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int]
    send.restype=wintypes.UINT
    encoded = text.encode('utf-16-le', 'surrogatepass')
    for i in range(0,len(encoded),2):
        unit=int.from_bytes(encoded[i:i+2],'little')
        for flag in (0x0004,0x0004|0x0002):
            evt=INPUT(type=1,u=UNION(ki=KEYBDINPUT(0,unit,flag,0,0)))
            if send(1,ctypes.byref(evt),ctypes.sizeof(INPUT))!=1:
                raise OSError('Windows SendInput failed (possibly desktop privilege boundary).')


def run_action(op):
    if not is_enabled():return fail('Experimental desktop control is not enabled.')
    bad=check_input(op)
    if bad:return fail(bad)
    if _stopped.is_set():return fail('Emergency stop engaged; restart JARVIS to reset.')
    name=op.get('operation')
    if os.environ.get('JARVIS_CUA_DRIVER_ENABLED') == '1' and name in (
        'desktop_observe','desktop_click','desktop_move','desktop_type','desktop_keys'
    ):
        with _lock:
            if _stopped.is_set():return fail('Emergency stop engaged.')
            try:
                from cua_driver_backend import run_action as run_cua_action
                receipt=run_cua_action(op)
                if name == 'desktop_observe' and receipt.get('ok') and isinstance(receipt.get('evidence'),dict):
                    try:
                        receipt['evidence']['screenInfo']=screen_info()
                    except Exception:
                        receipt['evidence']['screenInfoUnavailable']=True
                return receipt
            except Exception as exc:
                return fail('Cua Driver dispatch failed safely: '+type(exc).__name__)
    with _lock:
        if _stopped.is_set():return fail('Emergency stop engaged.')
        try:
            name=op['operation']
            user=ctypes.windll.user32
            if name=='desktop_state': return {'ok':True,'evidence':screen_info()}
            if name=='desktop_observe': return {'ok':True,'evidence':observe_desktop()}

            if name=='desktop_windows': return {'ok':True,'evidence':all_windows()}
            if name=='desktop_focus':
                user.IsWindow.argtypes=[wintypes.HWND]
                user.ShowWindow.argtypes=[wintypes.HWND,ctypes.c_int]
                user.SetForegroundWindow.argtypes=[wintypes.HWND]
                user.GetForegroundWindow.restype=wintypes.HWND
                state=_active_windows.get(op['windowId'])
                if not state or time.monotonic()>state[2] or not user.IsWindow(state[0]):
                    return fail('Window selection expired. List windows again.')
                user.ShowWindow(state[0],9)
                user.SetForegroundWindow(state[0])
                verified=bool(user.GetForegroundWindow()==state[0])
                return {'ok':verified,'evidence':{'focusVerified':verified,'windowTitle':state[1][:100]},
                        **({} if verified else {'error':'Windows denied focus.'})}
            if name=='launch_installed':
                entry=discover_installed().get(op['appId'])
                if not entry:return fail('Installed app shortcut not found; rediscover it.')
                os.startfile(entry['path'])
                return {'ok':True,'evidence':{'application':entry['name'],
                    'launchRequested':True,'windowVisibleVerified':False,
                    'note':'Shortcut dispatched. Verify through windows_desktop_windows before claiming success.'}}
            if name in ('desktop_click','desktop_move'):
                x,y=op['x'],op['y']
                info=screen_info()
                if x>=info['width'] or y>=info['height']:return fail('Coordinates outside primary display.')
                if not user.SetCursorPos(x,y):return fail('Windows refused pointer movement.')
                if name=='desktop_click':
                    clicks=2 if op['button']=='double' else 1
                    down,up=(0x0008,0x0010) if op['button']=='right' else (0x0002,0x0004)
                    for _ in range(clicks):
                        user.mouse_event(down,0,0,0,0);user.mouse_event(up,0,0,0,0)
                        if clicks==2:time.sleep(.09)
                return {'ok':True,'evidence':{'pointerMoved':True,'clickRequested':name=='desktop_click',
                    'x':x,'y':y,'windowTitle':info['foregroundTitle'],
                    'uiEffectVerified':False}}
            if name=='desktop_scroll':
                user.mouse_event(0x0800,0,0,op['amount']*120,0)
                return {'ok':True,'evidence':{'scrollRequested':op['amount'],'uiEffectVerified':False}}
            if name=='desktop_keys':
                codes=[KEYS[k] for k in op['keys']]
                try:
                    for k in codes:keypress(user,k,True)
                    time.sleep(.06)
                finally:
                    for k in reversed(codes):keypress(user,k,False)
                return {'ok':True,'evidence':{'keyCombinationSent':op['keys'],'uiEffectVerified':False}}
            if name=='minecraft_input':
                action=op['action'];duration=op['durationMs']
                title=screen_info()['foregroundTitle']
                if not is_minecraft_game(title):
                    return fail('Focus an actual Minecraft game window first; launcher/browser not accepted.')
                keymap={'forward':0x57,'back':0x53,'left':0x41,'right':0x44,
                        'jump':0x20,'sneak':0x10,'inventory':0x45}
                if action in keymap:
                    code=keymap[action]
                    keypress(user,code,True)
                    try:
                        if action!='inventory':
                            deadline=time.monotonic()+duration/1000
                            while time.monotonic()<deadline:
                                if _stopped.is_set():break
                                if not is_minecraft_game(screen_info()['foregroundTitle']):break
                                time.sleep(.04)
                    finally:keypress(user,code,False)
                else:
                    down,up=(0x0002,0x0004) if action=='attack' else (0x0008,0x0010)
                    user.mouse_event(down,0,0,0,0)
                    try:
                        deadline=time.monotonic()+duration/1000
                        while time.monotonic()<deadline:
                            if _stopped.is_set() or not is_minecraft_game(screen_info()['foregroundTitle']):break
                            time.sleep(.04)
                    finally:user.mouse_event(up,0,0,0,0)
                return {'ok':not _stopped.is_set(),'evidence':{'targetForeground':title[:80],
                    'gameInputRequested':action,'durationRequestedMs':duration,
                    'inGameEffectVerified':False},
                    **({'error':'Emergency stop latched during game control.'} if _stopped.is_set() else {})}
            if name=='desktop_type':
                input_text(user,op['text'])
                return {'ok':True,'evidence':{'typedCharacters':len(op['text']),
                    'windowTitle':screen_info()['foregroundTitle'],'uiEffectVerified':False}}
            return fail('Unknown desktop operation.')
        except Exception as exc:
            return fail('Windows input operation failed: '+type(exc).__name__)


def start_emergency_monitor():
    threading.Thread(target=emergency_monitor,daemon=True,name='jarvis-emergency-stop').start()


def emergency_latched():
    return _stopped.is_set()
