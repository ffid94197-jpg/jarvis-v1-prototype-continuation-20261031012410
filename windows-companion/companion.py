"""JARVIS experimental Windows sidecar. Loopback-only, one bearer secret, no CORS.

The sidecar has USER-SESSION privileges. This is not an OS security sandbox.
Never expose it on LAN. The browser is a dedicated Playwright-managed instance.
"""
from __future__ import annotations
import io
import ipaddress
import json
import os
import queue
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.parse
import ctypes
from ctypes import wintypes
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from app_support import (BUILTINS, SETTINGS_PAGES, app_aliases, resolve_app, approved_config)
from capability_discovery import recommend as find_capability
from native_uia import validate_request as validate_native_request, run_native
from browser_net_guard import is_public_http_url
from desktop_control import check_input as validate_desktop_input, run_action as run_desktop_action, discover_installed, start_emergency_monitor
from minecraft_supervisor import ReconnectBudget, auto_reconnect_enabled

HOST = '127.0.0.1'
PORT = 20189
TOKEN = os.environ.get('JARVIS_WINDOWS_COMPANION_TOKEN', '')
if os.name != 'nt' or len(TOKEN) < 32 or os.environ.get('JARVIS_WINDOWS_AGENT_ENABLED') != '1':
    raise SystemExit('Windows-only local companion must be launched by JARVIS.')

frame_lock = threading.Lock()
recent_frames = deque(maxlen=16)
frame_running = threading.Event()
frame_running.set()
lease_lock = threading.Lock()
capture_deadline = 0.0

def lease_capture(seconds):
    global capture_deadline
    with lease_lock:
        capture_deadline = max(capture_deadline, time.monotonic() + min(max(seconds, 1), 18))

def capture_leased():
    with lease_lock:
        return time.monotonic() < capture_deadline

browser_commands: queue.Queue = queue.Queue(maxsize=8)
worker_stop = threading.Event()
cancelled_tasks = set()
cancel_lock = threading.Lock()

def check_job_cancel(job):
    task_id = job.get("taskId")
    with cancel_lock:
        if isinstance(task_id, str) and task_id in cancelled_tasks:
            raise RuntimeError("Operator cancelled Windows browser task; remaining steps not executed.")
bot_proc = None
bot_lock = threading.Lock()
bot_ack_lock = threading.Lock()
# Reconnect is a separate, explicit local opt-in. It may restore the network
# session, but it never resumes a saved gameplay mission.
bot_engine = None
bot_reconnecting = False
bot_supervisor_enabled = False
bot_supervisor_generation = 0
bot_supervisor_thread = None
bot_ack_waiters = {}



def capture_loop():
    try:
        import mss
        from PIL import Image
    except ImportError:
        print('[companion] Screen feed disabled: install mss and Pillow.', flush=True)
        return
    # Capture only while explicitly opted into screen watching.
    if os.environ.get('JARVIS_SCREEN_WATCH_ENABLED') != '1':
        return
    while frame_running.is_set():
        if not capture_leased():
            time.sleep(.25)
            continue
        try:
            with mss.mss() as sct:
                display = sct.monitors[1]
                snap = sct.grab(display)
                im = Image.frombytes('RGB', snap.size, snap.rgb)
                if im.width > 960:
                    im.thumbnail((960, 960))
                out = io.BytesIO()
                im.save(out, format='JPEG', quality=57)
                with frame_lock:
                    recent_frames.append((time.monotonic(), out.getvalue()))
        except Exception as err:
            # Do not log private frames or image content.
            print('[companion] screen capture failed:', type(err).__name__, flush=True)
        time.sleep(.34)  # ~3 FPS bounded feed, NOT a single static screenshot.


def browser_loop():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('[companion] Browser automation disabled: install playwright.', flush=True)
        while True:
            job = browser_commands.get()
            if job is None: break
            job['error'] = 'Playwright not installed on this Windows PC.'
            job['done'].set()
        return
    with sync_playwright() as pw:
        browser = None
        page = None
        browser_state = {}
        try:
            while not worker_stop.is_set():
                job = browser_commands.get()
                if job is None: break
                try:
                    check_job_cancel(job)
                    if browser is None:
                        # Browser receives Windows display variables only, never the sidecar token.
                        safe_env = {k:v for k,v in os.environ.items() if k.upper() in (
                            'PATH','SYSTEMROOT','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','COMSPEC','PROGRAMFILES','PROGRAMFILES(X86)')}
                        browser = pw.chromium.launch(headless=False, env=safe_env)
                        context = browser.new_context(accept_downloads=False)
                        def intercept(route):
                            try:
                                if not is_public_http_url(route.request.url):
                                    route.abort();return
                                route.continue_()
                            except Exception:
                                route.abort()
                        context.route('**/*', intercept)
                        page = context.new_page()
                        page.set_default_timeout(12000)
                    if job['operation'] == 'open_url':
                        page.goto(job['url'], wait_until='domcontentloaded', timeout=30000)
                        check_job_cancel(job)
                        browser_state.pop('inspection',None)
                        job['result'] = {'pageUrl': page.url, 'pageTitle': page.title()[:180], 'browser': 'Playwright Chromium'}
                    elif job['operation'] == 'youtube_oldest':
                        # An on-screen Playwright session, not a fabricated YouTube result.
                        channel = job['channel']
                        search_url = 'https://www.youtube.com/results?search_query=' + urllib.parse.quote(channel)
                        page.goto(search_url, wait_until='domcontentloaded', timeout=35000)
                        check_job_cancel(job)
                        job['searchVisited'] = page.url
                        if channel.casefold().strip() == 'mrbeast':
                            handle = 'MrBeast'
                        else:
                            selector = page.locator('ytd-channel-renderer a[href*="/@"]').first
                            selector.wait_for(timeout=12000)
                            href = selector.get_attribute('href') or ''
                            matched = re.search(r'/@([A-Za-z0-9_.-]+)', href)
                            if not matched:
                                raise RuntimeError('Unable to verify the channel handle in YouTube search results.')
                            handle = matched.group(1)
                        page.goto('https://www.youtube.com/@' + handle + '/videos', wait_until='domcontentloaded', timeout=35000)
                        check_job_cancel(job)
                        # Use YouTube's actual Oldest ordering control. Never
                        # represent 'latest upload' as the oldest by guessing.
                        old = page.get_by_text('Oldest', exact=True).first
                        old.wait_for(timeout=15000)
                        old.click(timeout=12000)
                        check_job_cancel(job)
                        page.wait_for_timeout(1800)
                        vid = page.locator('ytd-rich-grid-media a[href*="/watch?v="]').first
                        vid.wait_for(timeout=15000)
                        video_title = vid.get_attribute('title') or vid.get_attribute('aria-label') or '(unknown title)'
                        check_job_cancel(job)
                        vid.click(timeout=12000)
                        check_job_cancel(job)
                        page.locator('video').first.wait_for(timeout=15000)
                        page.locator('video').first.evaluate('(v) => v.play().catch(() => {})')
                        page.wait_for_timeout(1400)
                        state = page.locator('video').first.evaluate('(v) => ({playing:!v.paused, time:v.currentTime})')
                        if not page.url.startswith('https://www.youtube.com/watch?v='):
                            raise RuntimeError('Selected video did not produce a verifiable YouTube watch URL.')
                        browser_state.pop('inspection',None)
                        job['result'] = {'channel':handle,'selectedTitle':video_title[:180],
                                         'videoUrl':page.url,'playbackConfirmed':bool(state['playing']),
                                         'playbackTimeSeconds':state['time']}
                    elif job['operation']=='browser_search':
                        state = browser_state
                        page.goto('https://www.google.com/search?q='+urllib.parse.quote(job['query']),
                                  wait_until='domcontentloaded',timeout=30000)
                        check_job_cancel(job)
                        state.pop('inspection',None)
                        job['result']={'pageUrl':page.url,'pageTitle':page.title()[:180],
                                       'searched':True,'webQuery':job['query']}
                    elif job['operation']=='browser_inspect':
                        job['result']=inspect_page(page,browser_state,job.get('query'))
                    elif job['operation']=='browser_read_page':
                        if page.url=='about:blank':
                            raise RuntimeError('No webpage open. Search or open a site first.')
                        content=page.locator('body').inner_text(timeout=7000)[:6000]
                        job['result']={'pageUrl':page.url,'text':content,
                            'untrustedPageContent':True,'truncated':len(content)>=6000}
                    elif job['operation'] in ('browser_click_link','browser_fill_search','browser_scroll'):
                        job['result']=action_on_inspected_page(page,browser_state,job)
                    else:
                        job['error'] = 'Unknown browser action.'
                except Exception as err:
                    job['error'] = f'{type(err).__name__}: {str(err)[:260]}'
                finally:
                    job['done'].set()
        finally:
            if browser is not None:
                browser.close()



# Restricted app/window inspection: do not reveal titles of non-allowlisted apps.
APP_EXE = {'notepad': 'notepad.exe', 'calculator': 'calculatorapp.exe',
           'explorer': 'explorer.exe', 'paint': 'mspaint.exe',
           'settings': 'systemsettings.exe', 'chrome': 'chrome.exe',
           'edge': 'msedge.exe', 'firefox': 'firefox.exe', 'vscode': 'code.exe'}

def list_approved_windows():
    if os.name != 'nt' or os.environ.get('JARVIS_WINDOWS_UI_CONTROL_ENABLED') != '1':
        return []
    user32, kernel = ctypes.windll.user32, ctypes.windll.kernel32
    # ctypes defaults to 32-bit integer returns; explicitly use pointer-width
    # HWND/HANDLE types on 64-bit Windows to avoid truncating handles.
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    results = []
    callback_t = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    @callback_t
    def visit(hwnd, lparam):
        if len(results) >= 30:
            return False
        if not user32.IsWindowVisible(hwnd) or user32.GetWindowTextLengthW(hwnd) < 1:
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        proc = kernel.OpenProcess(0x1000, False, pid.value)
        if not proc:
            return True
        try:
            namebuf = ctypes.create_unicode_buffer(4096)
            name_len = wintypes.DWORD(len(namebuf))
            if not kernel.QueryFullProcessImageNameW(proc, 0, namebuf, ctypes.byref(name_len)):
                return True
            exe = os.path.basename(namebuf.value).lower()
        finally:
            kernel.CloseHandle(proc)
        alias = next((alias for alias, process in APP_EXE.items() if exe == process), None)
        if not alias:
            alias = next((candidate for candidate, spec in approved_config().items()
                          if os.path.basename(spec).lower() == exe), None)
        if alias:
            titlebuf = ctypes.create_unicode_buffer(160)
            user32.GetWindowTextW(hwnd, titlebuf, len(titlebuf))
            results.append({'app':alias, 'title':titlebuf.value[:100], 'pid':pid.value,
                            '_hwnd':hwnd})
        return True
    user32.EnumWindows.argtypes = [callback_t, wintypes.LPARAM]
    user32.EnumWindows(visit, 0)
    return results


def window_command(body):
    if os.environ.get('JARVIS_WINDOWS_UI_CONTROL_ENABLED') != '1':
        return {'ok':False,'error':'Window control is disabled.'}
    rows = list_approved_windows()
    if body['operation'] == 'list_windows':
        return {'ok':True,'evidence':{'windows':[
            {k:v for k,v in x.items() if k!='_hwnd'} for x in rows], 'count':len(rows),
            'scope':'Only explicitly allowlisted window processes'}}
    alias = body.get('app')
    row = next((x for x in rows if x['app'] == alias),None)
    if row is None:
        return {'ok':False,'error':'No visible allowlisted app window found.'}
    user32 = ctypes.windll.user32
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.ShowWindow(row['_hwnd'],9)
    user32.SetForegroundWindow(row['_hwnd'])
    verified = user32.GetForegroundWindow() == row['_hwnd']
    return {'ok':verified, 'evidence':{'app':alias,'focusedVerified':verified},
            'error':None if verified else 'Windows declined to move foreground focus.'}

# The browser tool never accepts arbitrary selectors, scripts, or shell commands.
# A page token and inspected index guard against actions on stale/unreviewed DOM.
BROWSER_ELEMENTS = 'a:visible, input:visible'

def safe_public_link(url):
    try:
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or '').lower()
        if p.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+',host) or \
           p.port or p.username or p.password or p.fragment or \
           host.endswith(('.localhost','.local','.internal','.test')) or host == 'localhost':
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            return True
    except ValueError:
        return False


def safe_search_field(element):
    kind=(element.get_attribute('type') or 'text').lower()
    info=' '.join([element.get_attribute(x) or '' for x in ('name','placeholder','aria-label','role')]).lower()
    return kind in ('text','search') and ('search' in info or kind=='search' or \
           (element.get_attribute('name') or '').lower() in ('q','query'))


def inspect_page(page, state, query=None):
    if not page or page.url == 'about:blank':
        raise RuntimeError('Open a webpage or search before inspecting the browser.')
    token = secrets.token_hex(12)
    items=[]
    loc = page.locator(BROWSER_ELEMENTS)
    for idx in range(min(loc.count(),40)):
        element=loc.nth(idx)
        tag=element.evaluate('(e) => e.tagName.toLowerCase()')
        if tag=='a':
            href=element.get_attribute('href') or ''
            resolved=urllib.parse.urljoin(page.url,href)
            if not safe_public_link(resolved):
                continue
            label=(element.inner_text(timeout=2000) or element.get_attribute('aria-label') or '').strip()[:110]
            items.append({'index':idx,'kind':'link','text':label,'href':resolved})
        elif tag=='input' and safe_search_field(element):
            hint=element.get_attribute('aria-label') or element.get_attribute('placeholder') or 'Search'
            items.append({'index':idx,'kind':'search','hint':hint[:80]})
    if query is not None:
        # Browser-Use-style observed-element grounding: rank only inspected
        # public HTTPS links and search inputs; NEVER model-guessed selectors.
        words=[w for w in re.findall(r'[a-z0-9]+',query.casefold())
               if len(w)>1 and w not in ('please','click','press','open','find','the','this','that','link')][:20]
        def rank(entry):
            label=str(entry.get('text') or entry.get('hint') or '').casefold()
            matches=sum(1 for w in words if w in label)
            exact=label.strip()==query.casefold().strip()
            return 100*int(exact)+matches
        items=[row for row in items if words and rank(row)>0]
        items.sort(key=lambda row:(-rank(row),row['index']))
    state['inspection']={'token':token,'url':page.url, 'entries':{x['index']:x for x in items}}
    return {'pageUrl':page.url,'pageTitle':page.title()[:180],'pageToken':token,
            'items':items[:40],'indexLimit':40,'untrustedPageContent':True,
            'queryApplied':query is not None,'queryGrounded':query is not None and bool(items)}


def action_on_inspected_page(page,state,job):
    snap=state.get('inspection')
    if not snap or job.get('pageToken')!=snap['token'] or page.url!=snap['url']:
        raise RuntimeError('Page changed or stale pageToken; inspect again before acting.')
    operation=job['operation']
    if operation=='browser_scroll':
        page.mouse.wheel(0, (1 if job['direction']=='down' else -1)*job['pages']*640)
        page.wait_for_timeout(300)
        return {'scrolled':True,'direction':job['direction'],'pages':job['pages'],'pageUrl':page.url}
    idx=job['index']
    desc=snap['entries'].get(idx)
    if not desc:
        raise RuntimeError('Inspected index is absent or not permitted.')
    element=page.locator(BROWSER_ELEMENTS).nth(idx)
    if operation=='browser_click_link':
        if desc['kind']!='link':
            raise RuntimeError('Only pre-inspected public HTTPS links may be clicked.')
        resolved=urllib.parse.urljoin(page.url,element.get_attribute('href') or '')
        if not safe_public_link(resolved) or resolved!=desc['href']:
            raise RuntimeError('Link changed or unsafe; inspect again.')
        # Navigate directly to verified href: do not fire site JavaScript click
        # handlers, submit forms or invoke an element's attached actions.
        page.goto(resolved,wait_until='domcontentloaded',timeout=30000)
        state.pop('inspection',None)
        return {'pageUrl':page.url,'pageTitle':page.title()[:180],
                'clickedHref':resolved,'navigationConfirmed':True}
    if operation=='browser_fill_search':
        if desc['kind']!='search' or not safe_search_field(element):
            raise RuntimeError('Only inspected search boxes accept text.')
        element.fill(job['text'],timeout=12000)
        element.press('Enter',timeout=12000)
        page.wait_for_timeout(850)
        state.pop('inspection',None)
        return {'pageUrl':page.url,'searchSubmitted':True,
                'searchTextSentToCurrentWebsite':True}
    raise RuntimeError('Unrecognized inspected browser operation.')

def validate_action(body):
    if not isinstance(body, dict):
        return 'Malformed companion action.'
    op = body.get('operation')
    if op == 'open_url':
        url = body.get('url')
        if not isinstance(url, str) or len(url) > 2048:
            return 'Invalid URL.'
        try:
            p = urllib.parse.urlsplit(url)
            host = p.hostname or ''
            if p.scheme != 'https' or p.username or p.password or p.port or p.fragment or \
               not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', host) or \
               host.endswith(('.local','.internal','.test','.localhost')) or host == 'localhost':
                return 'Unsafe URL.'
            try:
                ipaddress.ip_address(host)
                return 'IP-based navigation is disallowed.'
            except ValueError:
                pass
        except ValueError:
            return 'Invalid URL.'
    elif op == 'youtube_oldest':
        channel = body.get('channel')
        if not isinstance(channel,str) or not re.fullmatch(r'[A-Za-z0-9_. -]{2,64}',channel):
            return 'Invalid channel.'
    elif op in ('browser_search','browser_inspect','browser_read_page','browser_click_link',
                'browser_fill_search','browser_scroll'):
        if os.environ.get('JARVIS_BROWSER_AGENT_ENABLED') != '1':
            return 'General browser automation is not enabled by operator.'
        if op == 'browser_inspect':
            query=body.get('query')
            if set(body) - {'operation','query'}:
                return 'Unexpected browser inspection arguments.'
            if query is not None and (not isinstance(query,str) or not 2<=len(query.strip())<=160 or
               re.search(r'[\x00-\x1f\x7f]',query)):
                return 'Browser control query must be 2–160 printable characters.'
        if op == 'browser_search':
            query=body.get('query')
            if not isinstance(query,str) or not 1 <= len(query.strip()) <= 160 or re.search(r'[\x00-\x1f\x7f]',query):
                return 'Invalid browser search query.'
        if op in ('browser_click_link','browser_fill_search','browser_scroll'):
            if not isinstance(body.get('pageToken'),str) or not re.fullmatch(r'[a-f0-9]{24}',body['pageToken']):
                return 'Fresh browser pageToken required.'
        if op in ('browser_click_link','browser_fill_search'):
            if type(body.get('index')) is not int or not 0 <= body['index'] < 40:
                return 'Invalid inspected element index.'
        if op == 'browser_fill_search':
            value=body.get('text')
            if not isinstance(value,str) or not 1 <= len(value.strip()) <= 160 or re.search(r'[\x00-\x1f\x7f]',value):
                return 'Invalid search text.'
        if op == 'browser_scroll':
            if body.get('direction') not in ('up','down') or type(body.get('pages')) is not int or not 1 <= body['pages'] <= 5:
                return 'Invalid bounded scroll.'
    elif op in ('list_windows','focus_app'):
        if os.environ.get('JARVIS_WINDOWS_UI_CONTROL_ENABLED') != '1':
            return 'Window inspection/focus not enabled by operator.'
        if op == 'focus_app' and body.get('app') not in app_aliases():
            return 'Window focus app is not allowlisted.'
    elif op == 'find_capability':
        goal=body.get('goal')
        if not isinstance(goal,str) or not 3<=len(goal.strip())<=250 or any(ord(c)<32 for c in goal):
            return 'Invalid capability goal.'
    elif op == 'discover_apps':
        pass  # Approved catalog names only; no broad process enumeration.
    elif op == 'open_app':
        if body.get('app') not in app_aliases():
            return 'App not approved by the operator.'
    elif op == 'open_settings':
        if body.get('page') not in SETTINGS_PAGES:
            return 'Settings page not allowlisted.'
    elif op == 'screen_watch':
        if os.environ.get('JARVIS_SCREEN_WATCH_ENABLED') != '1' or \
           type(body.get('seconds')) is not int or not 2 <= body['seconds'] <= 15:
            return 'Screen observation not allowed.'
    elif op in ('native_open_url','native_inspect','native_action','native_verify'):
        if os.environ.get('JARVIS_EXPERIMENTAL_DESKTOP_CONTROL') != '1':
            return 'Native desktop control requires explicit test-PC opt-in.'
        return validate_native_request(body)
    elif op in ('desktop_state','desktop_observe','desktop_windows','desktop_focus','desktop_click','desktop_move',
                'desktop_type','desktop_keys','desktop_scroll','launch_installed','minecraft_input'):
        if os.environ.get('JARVIS_EXPERIMENTAL_DESKTOP_CONTROL') != '1':
            return 'Full desktop control is disabled. Explicit localhost operator opt-in required.'
        if op == 'minecraft_input' and os.environ.get('JARVIS_MINECRAFT_GAME_INPUT_ENABLED') != '1':
            return 'Foreground Minecraft control not enabled by operator.'
        return validate_desktop_input(body)
    elif op == 'minecraft_command':
        if os.environ.get('JARVIS_MINECRAFT_LAN_ENABLED') != '1':
            return 'Minecraft LAN integration is not enabled.'
        if body.get('command') not in ('follow','stop','jump','move','look','status','come','stay','guard','collect_wood','inventory','say','observe','auto_goal','auto_status','auto_stop',
            'inspect_block','navigate','dig_block','equip_item','craft_item','place_block','interact_block','interact_entity','use_item','natural_goal','auto_checkpoint','auto_resume'):
            return 'Unsupported Minecraft command.'
        # The Python Guardian side of the bridge validates the same bounded
        # primitives as friend_protocol.cjs. All keys remain allowlisted.
        def mc_position(value):
            return (type(value) is dict and set(value) == {'x','y','z'} and
                all(type(value.get(k)) is int and abs(value[k]) <= 30000000
                for k in ('x','y','z')))
        def mc_item(value):
            return isinstance(value,str) and re.fullmatch(r'[a-z0-9_]{1,64}',value) is not None
        def bounded_int(value,low,high):
            return type(value) is int and low <= value <= high
        def minecraft_goal(record,step=False):
            if type(record) is not dict or type(record.get('goal')) is not str:
                return False
            goal=record['goal']
            fixed={'survive','wood','tools','explore','follow','guard','stone_age','iron_age',
                   'dragon_run','netherite_dragon_run','dragon_then_netherite_run','companion'}
            fields={
                'gather':{'resource','targetCount'},
                'travel':{'destination','arrivalRange'},
                'craft':{'item','targetCount'},
                'equip':{'item',('destination' if step else 'destinationSlot')},
                'build':{'position','block','axis','length'},
                'farm_wheat':{'position','width','depth','targetCount'},
                'sequence':{'steps'}
            }
            if goal in fixed:
                extra=set()
                if step and goal not in ('tools','stone_age','iron_age'):
                    return False
            else:
                extra=fields.get(goal)
                if extra is None or (step and goal=='sequence'):
                    return False
            allowed={'goal'} | extra | (set() if step else {'command','durationSeconds'})
            if set(record) - allowed:
                return False
            if not step and record.get('command')!='auto_goal':
                return False
            if step and 'command' in record:
                return False
            if not step and 'durationSeconds' in record and not bounded_int(record['durationSeconds'],10,43200):
                return False
            if goal in fixed:
                return True
            if goal=='gather':
                return type(record.get('resource')) is str and record['resource'] in {'logs','planks','sticks','cobblestone','raw_iron',
                    'iron_ingot','diamond','obsidian','flint','netherrack'} and bounded_int(record.get('targetCount'),1,64)
            if goal=='travel':
                return mc_position(record.get('destination')) and bounded_int(record.get('arrivalRange'),1,8)
            if goal=='craft':
                return type(record.get('item')) is str and record['item'] in {'stick','crafting_table','chest','furnace',
                    'ladder','bread','shield','torch'} and bounded_int(record.get('targetCount'),1,16)
            if goal=='equip':
                slots={
                    'hand':{'wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe',
                        'wooden_sword','stone_sword','iron_sword','diamond_sword','netherite_sword',
                        'bow','crossbow','trident','shield','torch'},
                    'head':{'leather_helmet','iron_helmet','golden_helmet','diamond_helmet','netherite_helmet','turtle_helmet'},
                    'torso':{'leather_chestplate','iron_chestplate','golden_chestplate','diamond_chestplate','netherite_chestplate','elytra'},
                    'legs':{'leather_leggings','iron_leggings','golden_leggings','diamond_leggings','netherite_leggings'},
                    'feet':{'leather_boots','iron_boots','golden_boots','diamond_boots','netherite_boots'},
                    'off-hand':{'shield','torch','totem_of_undying'}
                }
                slot=record.get('destination' if step else 'destinationSlot')
                return type(slot) is str and type(record.get('item')) is str and record['item'] in slots.get(slot,set())
            if goal=='build':
                p=record.get('position')
                axis=record.get('axis')
                n=record.get('length')
                if (not mc_position(p) or axis not in ('x+','x-','z+','z-') or
                    not bounded_int(n,1,8) or
                    (type(record.get('block')) is not str or record['block'] not in {'cobblestone','dirt','oak_planks','spruce_planks',
                        'birch_planks','stone_bricks','netherrack'})):
                    return False
                dx=(1 if axis=='x+' else -1 if axis=='x-' else 0)
                dz=(1 if axis=='z+' else -1 if axis=='z-' else 0)
                return (-62 <= p['y'] <= 318 and abs(p['x'])<=29999984 and
                    abs(p['z'])<=29999984 and abs(p['x']+dx*(n-1))<=29999984 and
                    abs(p['z']+dz*(n-1))<=29999984)
            if goal=='farm_wheat':
                p=record.get('position')
                w=record.get('width')
                d=record.get('depth')
                return (mc_position(p) and bounded_int(w,1,4) and bounded_int(d,1,4) and
                    bounded_int(record.get('targetCount'),1,16) and -62 <= p['y'] <= 319 and
                    -29999984 <= p['x'] <= 29999984 and -29999984 <= p['z'] <= 29999984 and
                    p['x']+w-1 <= 29999984 and p['z']+d-1 <= 29999984)
            if goal=='sequence':
                steps=record.get('steps')
                return type(steps) is list and 1 <= len(steps) <= 8 and all(minecraft_goal(s,True) for s in steps)
            return False
        command=body.get('command')
        if command == 'auto_goal':
            goal_args={k:v for k,v in body.items() if k not in ('operation','taskId')}
            if not minecraft_goal(goal_args):
                return 'Invalid or unsupported bounded Minecraft goal; no game action authorized.'

        if command == 'natural_goal':
            text=body.get('text')
            if (not isinstance(text,str) or not 1 <= len(text.strip()) <= 600 or
                re.search(r'[\x00-\x1f\x7f]',text) or
                set(body) - {'operation','taskId','command','text'}):
                return 'Invalid natural-language Minecraft instruction.'
        if command == 'navigate' and (not mc_position(body.get('position')) or
            ('range' in body and (type(body['range']) is not int or not 1 <= body['range'] <= 8))):
            return 'Invalid bounded Minecraft navigation.'
        if command in ('inspect_block','dig_block','interact_block') and not mc_position(body.get('position')):
            return 'Invalid Minecraft block coordinates.'
        if command == 'equip_item' and (not mc_item(body.get('item')) or
            body.get('destination','hand') not in ('hand','head','torso','legs','feet','off-hand')):
            return 'Invalid equipment request.'
        if command == 'craft_item' and (not mc_item(body.get('item')) or
            type(body.get('count')) is not int or not 1 <= body['count'] <= 16):
            return 'Invalid crafting request.'
        if command == 'place_block':
            face=body.get('face')
            if (not mc_item(body.get('item')) or not mc_position(body.get('reference')) or
                not mc_position(face) or sum(abs(face[k]) for k in ('x','y','z')) != 1):
                return 'Invalid block placement or face.'
        if command == 'interact_entity' and (type(body.get('entityId')) is not int or body['entityId'] < 0):
            return 'Invalid entity interaction.'
        if command == 'use_item' and body.get('hand','hand') not in ('hand','off-hand'):
            return 'Invalid use-item hand.'
        if body.get('command') == 'move' and (body.get('directionInput') not in ('forward','back','left','right') or
            type(body.get('durationMs')) is not int or not 100 <= body['durationMs'] <= 3000):
            return 'Invalid Minecraft movement instruction.'
        if body.get('command') == 'say' and (not isinstance(body.get('text'),str) or not 1 <= len(body['text']) <= 120 or re.search(r'[\x00-\x1f\x7f]',body['text'])):
            return 'Invalid Minecraft in-game chat message.'
    elif op in ('minecraft_join','minecraft_stop'):
        if os.environ.get('JARVIS_MINECRAFT_LAN_ENABLED') != '1':
            return 'Minecraft LAN not enabled.'
    else:
        return 'Unknown companion action.'
    return None


def run_browser_command(body):
    task = dict(body)
    task['done'] = threading.Event()
    try:
        browser_commands.put_nowait(task)
    except queue.Full:
        return {'ok': False, 'error': 'Browser action queue is full.'}
    if not task['done'].wait(77):
        return {'ok':False,'error':'Browser action exceeded deadline; effect may still be in progress. Do not blindly retry.'}
    if task.get('error'):
        return {'ok':False, 'error': task['error']}
    return {'ok':bool(task.get('result',{}).get('playbackConfirmed')) if task['operation']=='youtube_oldest' else True,
            'evidence':task.get('result'),
            'error': None if task['operation']!='youtube_oldest' or task.get('result',{}).get('playbackConfirmed') else 'Video loaded but playback could not be confirmed.'}


def discover_apps():
    entries=[]
    for alias in app_aliases():
        if alias=='settings':available=True
        else:available=resolve_app(alias) is not None
        entries.append({'app':alias,'available':available,
                        'source':'operator-approved' if alias not in BUILTINS else 'built-in'})
    if os.environ.get('JARVIS_EXPERIMENTAL_DESKTOP_CONTROL') == '1':
        entries.extend({'appId':k,'name':v['name'],'available':True,'source':'Windows Start Menu (experimental)'} for k,v in discover_installed().items())
    return {'ok':True,'evidence':{'apps':entries,'count':len(entries),
              'note':'Presence checks do not prove a visible window can open.'}}


def open_app(alias, settings_page='home'):
    if alias=='settings':
        target=SETTINGS_PAGES.get(settings_page)
        if not target:return {'ok':False,'error':'Unsupported Windows Settings page.'}
        try:
            # Shell protocol handler is hardcoded from a finite operator-approved map.
            # NEVER accept an arbitrary URI or shell expression from a model.
            os.startfile(target)
            return {'ok':True,'evidence':{'app':'settings','settingsPage':settings_page,
              'launchRequested':True,'windowVisibleVerified':False,
              'note':'Windows Settings protocol dispatched; appearance not proven.'}}
        except Exception as err:
            return {'ok':False,'error':f'Windows Settings launch failed ({type(err).__name__})'}
    spec=resolve_app(alias)
    if not spec or spec['kind']!='exe':
        return {'ok':False,'error':'App not installed in approved location or not configured. Use windows_discover_apps.'}
    try:
        # Never inherit the companion bearer token or any model credentials.
        safe_env={k:v for k,v in os.environ.items() if k.upper() in (
            'PATH','SYSTEMROOT','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA',
            'TEMP','TMP','PROGRAMFILES','PROGRAMFILES(X86)')}
        child=subprocess.Popen([spec['target']], shell=False,stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                               env=safe_env)
        # Process admission is not enough to claim that the GUI became visible.
        seen=False
        if os.environ.get('JARVIS_WINDOWS_UI_CONTROL_ENABLED')=='1':
            for _ in range(12):
                time.sleep(.25)
                try:
                    if any(row['app']==alias for row in list_approved_windows()):
                        seen=True;break
                except Exception:break
        return {'ok':True,'evidence':{'app':alias,'launchPid':child.pid,
             'launchRequested':True,'windowVisibleVerified':seen,
             'note':'A process was launched; verify the GUI before assuming task success.' if not seen else 'Approved visible window detected.'}}
    except Exception as err:
        return {'ok':False,'error':f'App launcher failed ({type(err).__name__})'}


def _disable_minecraft_supervisor_locked():
    """Invalidate a sleeping/waiting supervisor. Caller must hold bot_lock."""
    global bot_supervisor_enabled, bot_supervisor_generation, bot_reconnecting
    bot_supervisor_enabled = False
    bot_supervisor_generation += 1
    bot_reconnecting = False


def _minecraft_supervisor_loop(generation):
    """Rejoin the configured LAN session only; never resume an old goal."""
    global bot_proc, bot_reconnecting, bot_supervisor_enabled
    budget = ReconnectBudget()
    while True:
        with bot_lock:
            if not bot_supervisor_enabled or generation != bot_supervisor_generation:
                return
            child = bot_proc
            reconnecting = bot_reconnecting

        if child is not None:
            try:
                exit_code = child.wait()
            except Exception:
                exit_code = 1
            with bot_lock:
                if not bot_supervisor_enabled or generation != bot_supervisor_generation:
                    return
                # A manual join may already have replaced the child while this
                # waiter was waking. Follow the current child; never overwrite it.
                if bot_proc is not child:
                    continue
                bot_proc = None
                bot_reconnecting = True
            terminal = getattr(child, "_jarvis_reconnect_allowed", None)
            if exit_code == 2 or (terminal is not None and not terminal.is_set()):
                with bot_lock:
                    if generation == bot_supervisor_generation:
                        bot_supervisor_enabled = False
                        bot_reconnecting = False
                print("[companion] Minecraft reconnect stopped after a terminal kick/configuration failure.", flush=True)
                return
        elif not reconnecting:
            return

        if not auto_reconnect_enabled("jarvis", os.environ):
            with bot_lock:
                if generation == bot_supervisor_generation:
                    bot_supervisor_enabled = False
                    bot_reconnecting = False
            return

        delay = budget.reserve()
        if delay is None:
            with bot_lock:
                if generation == bot_supervisor_generation:
                    bot_supervisor_enabled = False
                    bot_reconnecting = False
            print("[companion] Minecraft reconnect budget exhausted; owner action required.", flush=True)
            return

        # Interruptible bounded backoff; explicit stop/service shutdown wins.
        for _ in range(delay * 4):
            with bot_lock:
                if not bot_supervisor_enabled or generation != bot_supervisor_generation:
                    return
            time.sleep(0.25)

        with bot_lock:
            if not bot_supervisor_enabled or generation != bot_supervisor_generation:
                return
        result = minecraft_action("minecraft_join")
        if not result.get("ok"):
            print("[companion] Minecraft reconnect attempt did not establish a live spawn; bounded retry remains.", flush=True)
            # A failed join leaves bot_reconnecting true and bot_proc empty.
            # The next loop consumes another finite retry-budget slot.


def _enable_minecraft_supervisor_locked(engine):
    """Enable once after a confirmed initial spawn; caller must hold bot_lock."""
    global bot_supervisor_enabled, bot_supervisor_generation, bot_supervisor_thread
    if not auto_reconnect_enabled(engine, os.environ):
        if bot_supervisor_enabled:
            _disable_minecraft_supervisor_locked()
        return
    if bot_supervisor_enabled:
        return
    bot_supervisor_generation += 1
    generation = bot_supervisor_generation
    bot_supervisor_enabled = True
    bot_supervisor_thread = threading.Thread(
        target=_minecraft_supervisor_loop,
        args=(generation,),
        daemon=True,
        name="jarvis-minecraft-reconnect-supervisor",
    )
    bot_supervisor_thread.start()


def _terminate_minecraft_child(child):
    if child is None or child.poll() is not None:
        return
    try:
        child.terminate()
        child.wait(timeout=3)
    except Exception:
        try:
            child.kill()
            child.wait(timeout=2)
        except Exception:
            pass


def _shutdown_minecraft_bot():
    """Stop the child on Windows companion shutdown; do not leave a hidden bot."""
    global bot_proc, bot_engine
    with bot_lock:
        _disable_minecraft_supervisor_locked()
        child = bot_proc
        bot_proc = None
        bot_engine = None
    _terminate_minecraft_child(child)


def minecraft_action(op):
    global bot_proc, bot_engine, bot_reconnecting
    if os.environ.get('JARVIS_MINECRAFT_LAN_ENABLED') != '1':
        return {'ok':False,'error':'Minecraft LAN integration not enabled.'}

    if op == 'minecraft_stop':
        with bot_lock:
            _disable_minecraft_supervisor_locked()
            child = bot_proc
            engine = bot_engine
            bot_proc = None
            bot_engine = None
        was_running = child is not None and child.poll() is None
        _terminate_minecraft_child(child)
        remote = engine == 'mine-ai-mcp'
        return {'ok':True,'evidence':{
            'stopRequested':was_running or remote,
            'joinedVerified':False,
            'remoteHostStopVerified':False if remote else None,
            'warning':'External Mine AI MCP server may remain running; stop its host to disconnect player.' if remote else None}}

    with bot_lock:
        if bot_proc and bot_proc.poll() is None:
            _enable_minecraft_supervisor_locked(bot_engine or os.environ.get('JARVIS_MINECRAFT_ENGINE','jarvis'))
            return {'ok':True,'evidence':{'alreadyStarted':True,'joinedVerified':False,
                'engine':bot_engine or 'jarvis'}}
        if bot_proc is not None:
            bot_proc = None

        # Opt-in: separate Mine AI MCP host provides the physical Minecraft player.
        # Default remains the existing JarvisBuddy Mineflayer companion; never run
        # both physical bot engines for one intended player without operator choice.
        engine = os.environ.get('JARVIS_MINECRAFT_ENGINE','jarvis')
        if engine not in ('jarvis','mine-ai-mcp'):
            return {'ok':False,'error':'Unsupported Minecraft engine selector.'}
        if bot_supervisor_enabled and bot_engine and engine != bot_engine:
            return {'ok':False,'error':'Cannot switch Minecraft engines while reconnect supervision is active.'}
        script = Path(__file__).parent/'minecraft-bot'/('mine_ai_mcp_bot.cjs' if engine == 'mine-ai-mcp' else 'bot.cjs')
        if not script.is_file():
            return {'ok':False,'error':'Minecraft companion module missing.'}
        try:
            # Observe an actual Minecraft protocol SPAWN signal from Mineflayer.
            # Process creation alone NEVER counts as successful world joining.
            child_env = {k:v for k,v in os.environ.items() if k.upper() in (
                'PATH','SYSTEMROOT','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP')}
            child_env.update({'JARVIS_MINECRAFT_LAN_PORT':os.environ.get('JARVIS_MINECRAFT_LAN_PORT',''),
                              'JARVIS_MINECRAFT_LAN_HOST':os.environ.get('JARVIS_MINECRAFT_LAN_HOST','127.0.0.1'),
                              'JARVIS_MINECRAFT_PLAYER':os.environ.get('JARVIS_MINECRAFT_PLAYER','')})
            # Only the already-selected LOCAL JARVIS inference provider may be
            # handed to the JARVIS-native language adapter. No BYOK/cloud
            # credentials, tokens or provider configuration are copied.
            if engine == 'jarvis' and os.environ.get('JARVIS_MODEL_BACKEND') == 'ollama':
                child_env['JARVIS_MODEL_BACKEND']='ollama'
                for key in ('JARVIS_OLLAMA_MODEL','JARVIS_OLLAMA_BASE_URL'):
                    if key in os.environ:
                        child_env[key]=os.environ[key]
            child = subprocess.Popen(['node', str(script)],cwd=str(script.parent), shell=False,
                                     env=child_env,stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                                     text=True,encoding='utf-8')
            bot_proc = child
            bot_engine = engine
            joined = threading.Event()
            reconnect_allowed = threading.Event()
            reconnect_allowed.set()
            # Per-process marker: a server kick is not a transient disconnect
            # and must never trigger repeated login attempts.
            child._jarvis_reconnect_allowed = reconnect_allowed

            def read_bot(process=child, engine_name=engine, joined_event=joined,
                         terminal_event=reconnect_allowed):
                for line in process.stdout:
                    stripped = line.strip()
                    if (engine_name == 'jarvis' and stripped == 'MINECRAFT_COMPANION_JOINED (spawn observed)') or \
                       (engine_name == 'mine-ai-mcp' and stripped == 'MINECRAFT_MCP_JOINED (live connected status observed)'):
                        joined_event.set()
                    if stripped == 'MINECRAFT_SESSION_TERMINAL':
                        terminal_event.clear()
                    if line.startswith('BOT_ACK '):
                        try:
                            ack=json.loads(line[8:])
                            with bot_ack_lock:
                                pending=bot_ack_waiters.get(ack.get('id'))
                                if pending and pending.get('process') is process:
                                    pending['result']=ack
                                    pending['event'].set()
                        except (ValueError,TypeError):pass
                # Wake only requests issued to this exact child. A late EOF
                # from an old process cannot consume a new process's ACKs.
                with bot_ack_lock:
                    for pending in list(bot_ack_waiters.values()):
                        if pending.get('process') is process:
                            pending['result']={'ok':False,'error':'Minecraft child exited; gameplay outcome is unknown.'}
                            pending['event'].set()

            threading.Thread(target=read_bot,daemon=True,name='minecraft-join-evidence').start()

        except Exception as err:
            bot_proc = None
            bot_engine = None
            return {'ok':False,'error':f'Minecraft bot launcher failed ({type(err).__name__})'}

    # Do not hold bot_lock while waiting for a game-server spawn: explicit
    # owner stop and process shutdown must remain responsive during join.
    success = joined.wait(25)
    if not success:
        with bot_lock:
            if bot_proc is child:
                bot_proc = None
                bot_engine = None
            if not bot_supervisor_enabled:
                bot_reconnecting = False
        _terminate_minecraft_child(child)
        return {'ok':False,'error':'Minecraft LAN join not confirmed. Open world to LAN and check bot dependencies, LAN port and version.'}

    with bot_lock:
        if bot_proc is not child or child.poll() is not None:
            return {'ok':False,'error':'Minecraft process ended before its confirmed spawn could be retained.'}
        bot_reconnecting = False
        _enable_minecraft_supervisor_locked(engine)
    return {'ok':True,'evidence':{'botProcessPid':child.pid,
                                 'joinAttempted':True, 'joinedVerified':True,
                                 'autoReconnectEnabled':auto_reconnect_enabled(engine, os.environ),
                                 'missionAutoResume':False,
                                 'scope':'Independent Java LAN player (' + engine + '); reconnect never replays gameplay.', 'engine':engine}}


def minecraft_command(body):
    if os.environ.get('JARVIS_MINECRAFT_LAN_ENABLED') != '1':
        return {'ok':False,'error':'Minecraft LAN bot not enabled.'}
    global bot_proc
    with bot_lock:
        if not bot_proc or bot_proc.poll() is not None or not bot_proc.stdin:
            return {'ok':False,'error':'Minecraft companion is not connected. Join LAN world first.'}
        request_id=secrets.token_hex(8)
        if bot_reconnecting:
            return {'ok':False,'error':'Minecraft companion is reconnecting; no gameplay action was dispatched.'}
        pending={'event':threading.Event(),'result':None,'process':bot_proc}
        with bot_ack_lock:bot_ack_waiters[request_id]=pending
        try:
            message={k:v for k,v in body.items() if k in ('command','directionInput','durationMs','text','goal','durationSeconds',
                                                       'position','range','item','destination','count','reference','face','entityId','hand',
                                                       'resource','targetCount','arrivalRange','steps','block','axis','length',
                                                       'width','depth','destinationSlot')}
            message['id']=request_id
            bot_proc.stdin.write(json.dumps(message)+'\n')
            bot_proc.stdin.flush()
            if not pending['event'].wait(16 if body.get('command') == 'natural_goal' else 8):
                return {'ok':False,'error':'Minecraft bot did not acknowledge action within deadline; outcome unknown.'}
            ack=pending['result']
            if not ack.get('ok'):
                return {'ok':False,'error':str(ack.get('error','Bot rejected request.'))[:150]}
            evidence={'command':body['command'],'botAcknowledged':True,
                'status':str(ack.get('status',''))[:1900], 'inGameOutcomeVerified':False}
            if body.get('command') == 'auto_status':
                try:
                    state=json.loads(ack.get('status',''))
                    if isinstance(state,dict):
                        evidence['autonomyGoalStatus']=str(state.get('status','unknown'))[:32]
                        evidence['autonomyGoal']=str(state.get('goal',''))[:32]
                        # Completion is attested by the bot state machine only;
                        # real LAN world verification still requires a live test.
                        evidence['inGameOutcomeVerified']=state.get('status')=='complete'
                except (ValueError,TypeError):pass
            return {'ok':True,'evidence':evidence}
        except Exception as exc:
            return {'ok':False,'error':'Minecraft command transport failed ('+type(exc).__name__+')'}
        finally:
            with bot_ack_lock:bot_ack_waiters.pop(request_id,None)


def watch_observation(seconds):
    if os.environ.get('JARVIS_SCREEN_WATCH_ENABLED') != '1':
        return {'ok':False,'error':'Screen watcher disabled by operator.'}
    lease_capture(seconds + 1)
    start = time.monotonic()
    stamps = set()
    while time.monotonic() - start < seconds:
        with frame_lock:
            stamps.update(t for t, _ in recent_frames if t >= start)
        time.sleep(.25)
    return {'ok':bool(stamps), 'evidence':{'framesObserved':len(stamps), 'durationSeconds':seconds,
          'feed':'live, continuous (~3 FPS)',
          'visionInterpreted':False,'note':'Raw frames not provided to model by this action; use screen-vision integration for semantic understanding.'}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Never log auth secrets, task payloads, or frames.
        pass

    def authorized(self):
        h = self.headers.get('Authorization', '')
        expected = 'Bearer ' + TOKEN
        return secrets.compare_digest(h, expected)

    def reply(self, code, data):
        encoded = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        if not self.authorized():
            self.reply(403,{'ok':False,'error':'Forbidden'});return
        if self.path not in ('/action','/cancel'):
            self.reply(404,{'ok':False});return
        length = int(self.headers.get('Content-Length','0') or '0')
        if length < 1 or length > 8192:
            self.reply(413,{'ok':False,'error':'Invalid request size'});return
        try:
            body = json.loads(self.rfile.read(length))
            if self.path == '/cancel':
                tid = body.get('taskId') if isinstance(body,dict) else None
                if not isinstance(tid,str) or len(tid)>128 or len(tid)<8:
                    self.reply(400,{'ok':False,'error':'Invalid task identifier.'});return
                with cancel_lock:
                    cancelled_tasks.add(tid)
                self.reply(200,{'ok':True,'note':'Cancellation requested. In-flight browser navigation may take time to reach a safe stopping point.'})
                return
            invalid = validate_action(body)
            if invalid:
                self.reply(403,{'ok':False,'error':invalid});return
            # Reject any queued or replayed action after operator cancellation.
            task_id = body.get('taskId')
            with cancel_lock:
                if isinstance(task_id,str) and task_id in cancelled_tasks:
                    self.reply(409,{'ok':False,'error':'Task already cancelled; no desktop action dispatched.'});return
            operation = body.get('operation')
            if operation in ('open_url','youtube_oldest','browser_search','browser_inspect',
                             'browser_read_page','browser_click_link','browser_fill_search','browser_scroll'):
                output = run_browser_command(body)
            elif operation in ('list_windows','focus_app'):
                output = window_command(body)
            elif operation == 'open_app':
                output = open_app(body.get('app'))
            elif operation == 'open_settings':
                output = open_app('settings',body.get('page'))
            elif operation == 'discover_apps':
                output = discover_apps()
            elif operation == 'find_capability':
                output = find_capability(body.get('goal'))
            elif operation == 'screen_watch':
                seconds = body.get('seconds')
                output = watch_observation(seconds) if type(seconds) is int and 2 <= seconds <= 15 else {'ok':False,'error':'Invalid duration'}
            elif operation in ('native_open_url','native_inspect','native_action','native_verify'):
                output = run_native(body)
            elif operation in ('desktop_state','desktop_observe','desktop_windows','desktop_focus','desktop_click','desktop_move',
                               'desktop_type','desktop_keys','desktop_scroll','launch_installed','minecraft_input'):
                output = run_desktop_action(body)
            elif operation == 'minecraft_command':
                output = minecraft_command(body)
            elif operation in ('minecraft_join','minecraft_stop'):
                output = minecraft_action(operation)
            else:
                output = {'ok':False,'error':'Unknown operation'}
            self.reply(200 if output.get('ok') else 422, output)
        except Exception as err:
            self.reply(500,{'ok':False,'error':f'Companion internal error ({type(err).__name__})'})

    def do_GET(self):
        if not self.authorized():
            self.reply(403,{'ok':False}); return
        if self.path == '/screen/lease':
            if os.environ.get('JARVIS_SCREEN_WATCH_ENABLED')!='1':
                self.reply(403,{'ok':False,'error':'Screen capture disabled'});return
            lease_capture(17)
            self.reply(200,{'ok':True,'leaseSeconds':17});return
        if self.path == '/health':
            self.reply(200,{'ok':True,'windows':True,'browserQueue':browser_commands.qsize(),
                'screenFeedEnabled':os.environ.get('JARVIS_SCREEN_WATCH_ENABLED')=='1',
                'hasFrames':bool(recent_frames)})
            return
        if self.path == '/screen/latest.jpg':
            with frame_lock:
                frame = recent_frames[-1][1] if recent_frames else None
            if not frame:
                self.reply(503,{'ok':False,'error':'No live screen frame available'});return
            self.send_response(200)
            self.send_header('Content-Type','image/jpeg')
            self.send_header('Content-Length',str(len(frame)))
            self.send_header('Cache-Control','no-store')
            self.end_headers();self.wfile.write(frame);return
        if self.path == '/screen/live.mjpeg':
            if os.environ.get('JARVIS_SCREEN_WATCH_ENABLED')!='1':
                self.reply(403,{'ok':False,'error':'Screen feed disabled'});return
            self.send_response(200)
            self.send_header('Content-Type','multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers()
            last = 0.
            try:
                while True:
                    lease_capture(1.2)  # release when browser viewer disconnects
                    with frame_lock:
                        current = recent_frames[-1] if recent_frames else None
                    if current and current[0] != last:
                        last, data = current
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '+str(len(data)).encode()+b'\r\n\r\n'+data+b'\r\n')
                        self.wfile.flush()
                    time.sleep(.25)
            except (BrokenPipeError, ConnectionResetError, OSError):
                return
            return
        self.reply(404,{'ok':False})


def main():
    start_emergency_monitor()
    threading.Thread(target=capture_loop,daemon=True,name='jarvis-screen-feed').start()
    threading.Thread(target=browser_loop,daemon=True,name='jarvis-browser-worker').start()
    server = ThreadingHTTPServer((HOST,PORT),Handler)
    print(f'[companion] JARVIS Windows companion listening only at {HOST}:{PORT}',flush=True)
    try:
        server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:
        pass
    finally:
        _shutdown_minecraft_bot()
        frame_running.clear();worker_stop.set()
        try: browser_commands.put_nowait(None)
        except queue.Full: pass
        server.server_close()


if __name__ == '__main__':
    main()
