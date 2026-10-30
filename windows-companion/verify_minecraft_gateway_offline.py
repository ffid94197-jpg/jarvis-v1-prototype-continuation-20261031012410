"""Verify owner/Guardian Minecraft bridge validation without starting Minecraft."""
import ast
from pathlib import Path
import ipaddress
import os
import re
import urllib.parse
source=Path(__file__).with_name('companion.py').read_text()
func=next(f for f in ast.parse(source).body if isinstance(f,ast.FunctionDef) and f.name=='validate_action')
ns={'os':os,'ipaddress':ipaddress,'re':re,'urllib':urllib,'app_aliases':lambda:('chrome',),
    'SETTINGS_PAGES':{'home':'ms-settings:'}}
exec(compile(ast.Module(body=[func],type_ignores=[]),'policy','exec'),ns)
validate=ns['validate_action'];checks=0
os.environ['JARVIS_MINECRAFT_LAN_ENABLED']='1'
def test(args,valid=True):
    global checks
    e=validate({'operation':'minecraft_command',**args})
    assert (e is None)==valid,(args,e)
    checks+=1
for goal in ['survive','wood','tools','stone_age','iron_age','dragon_run','netherite_dragon_run','explore']:
    test({'command':'auto_goal','goal':goal,'durationSeconds':21600})
for duration in [0,9,43201,100000,-1,3.14,'300',True]:
    test({'command':'auto_goal','goal':'netherite_dragon_run','durationSeconds':duration},False)
test({'command':'auto_goal','goal':'attack_every_player'},False)
test({'command':'inspect_block','position':{'x':12,'y':64,'z':10}})
test({'command':'navigate','position':{'x':12,'y':64,'z':10},'range':3})
test({'command':'navigate','position':{'x':30000001,'y':64,'z':10}},False)
test({'command':'navigate','position':{'x':1,'y':2,'z':3},'range':90},False)
test({'command':'equip_item','item':'netherite_helmet','destination':'head'})
test({'command':'craft_item','item':'netherite_sword','count':1})
test({'command':'craft_item','item':'netherite_sword','count':False},False)
test({'command':'place_block','item':'obsidian','reference':{'x':0,'y':63,'z':0},'face':{'x':0,'y':1,'z':0}})
test({'command':'place_block','item':'obsidian','reference':{'x':0,'y':63,'z':0},'face':{'x':1,'y':1,'z':0}},False)
test({'command':'interact_entity','entityId':20})
test({'command':'interact_entity','entityId':-1},False)
test({'command':'use_item','hand':'off-hand'})
test({'command':'use_item','hand':'bazooka'},False)
test({'command':'attack_player'},False)
assert "'JARVIS_MINECRAFT_LAN_HOST':os.environ.get('JARVIS_MINECRAFT_LAN_HOST','127.0.0.1')" in source
checks+=1
print(f'MINECRAFT_GATEWAY_POLICY {checks}/{checks} PASS (offline Python, no LAN world)')
