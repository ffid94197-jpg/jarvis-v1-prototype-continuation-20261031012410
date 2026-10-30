"""Policy contract tests. No real keyboard, window, application or Minecraft I/O."""
from desktop_control import check_input, run_action, KEYS, is_minecraft_game
import os
n=0
def check(v,label):
    global n
    assert v,label
    n+=1
    print('PASS',label)
check(check_input({'operation':'desktop_state'}) is None, 'desktop state contract')
check(check_input({'operation':'desktop_windows'}) is None, 'visible-window list contract')
check(check_input({'operation':'desktop_focus','windowId':'a'*24}) is None,'fresh-format window token')
check(check_input({'operation':'desktop_focus','windowId':'hello'}) is not None,'invalid window token rejected')
check(check_input({'operation':'desktop_click','x':50,'y':15,'button':'left'}) is None,'bounded left click')
check(check_input({'operation':'desktop_click','x':50,'y':15,'button':'double'}) is None,'bounded double click')
check(check_input({'operation':'desktop_click','x':-1,'y':2,'button':'left'}) is not None,'negative coordinates denied')
check(check_input({'operation':'desktop_click','x':100,'y':1,'button':'arbitrary'}) is not None,'unknown button denied')
check(check_input({'operation':'desktop_move','x':0,'y':100}) is None,'bounded move')
check(check_input({'operation':'desktop_type','text':'Hello Minecraft'}) is None,'bounded typing')
check(check_input({'operation':'desktop_type','text':'x'*401}) is not None,'oversized input rejected')
check(check_input({'operation':'desktop_keys','keys':['ctrl','a']}) is None,'key combination')
check(check_input({'operation':'desktop_keys','keys':['ctrl','execute_shell']}) is not None,'unknown key rejected')
check(check_input({'operation':'desktop_scroll','amount':-4}) is None,'bounded scroll')
check(check_input({'operation':'desktop_scroll','amount':100}) is not None,'unbounded scroll rejected')
check(check_input({'operation':'launch_installed','appId':'start-'+'1'*12}) is None,'Start Menu item ID')
check(check_input({'operation':'launch_installed','appId':'C:/evil.exe'}) is not None,'arbitrary app path rejected')
check(check_input({'operation':'arbitrary_shell','args':'shutdown'}) is not None,'arbitrary execution unknown')
check(not run_action({'operation':'desktop_state'})['ok'] if os.name!='nt' else True,'Linux cannot access desktop')
check(check_input({'operation':'minecraft_input','action':'forward','durationMs':500}) is None,'bounded Minecraft keys')
check(check_input({'operation':'minecraft_input','action':'attack','durationMs':5000}) is not None,'unbounded game attack refused')
check(is_minecraft_game('Minecraft 1.21.8'),'real Minecraft title accepted')
check(not is_minecraft_game('TLauncher Minecraft'),'Minecraft launcher not accepted as game')
check(not is_minecraft_game('Minecraft - YouTube - Google Chrome'),'browser pretending game denied')
check('f4' in KEYS and 'win' in KEYS,'documented key controls')
print(f'FULL_DESKTOP_POLICY {n}/{n} PASS (offline; no real Windows I/O)')
