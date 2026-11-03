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
test({'command':'natural_goal','text':'Jarvis, help me gather diamonds'})
test({'command':'natural_goal','text':'mine 6 cobblestone'})
test({'command':'natural_goal','text':' '},False)
test({'command':'natural_goal','text':'hi\nevil'},False)
test({'command':'natural_goal','text':'X'*601},False)
test({'command':'natural_goal','text':'follow me','code':'danger'},False)
test({'command':'attack_player'},False)
assert "child_env['JARVIS_MODEL_BACKEND']='ollama'" in source
checks+=1
assert "16 if body.get('command') == 'natural_goal' else 8" in source
checks+=1
assert "'JARVIS_MINECRAFT_LAN_HOST':os.environ.get('JARVIS_MINECRAFT_LAN_HOST','127.0.0.1')" in source
checks+=1

for goal in ['dragon_then_netherite_run']:
    test({'command':'auto_goal','goal':goal,'durationSeconds':21600})
valid_goals=[
 {'command':'auto_goal','goal':'gather','resource':'diamond','targetCount':4,'durationSeconds':300},
 {'command':'auto_goal','goal':'travel','destination':{'x':1,'y':64,'z':1},'arrivalRange':2},
 {'command':'auto_goal','goal':'craft','item':'chest','targetCount':2},
 {'command':'auto_goal','goal':'equip','item':'iron_helmet','destinationSlot':'head'},
 {'command':'auto_goal','goal':'build','position':{'x':1,'y':64,'z':1},'axis':'x+','length':4,'block':'cobblestone'},
 {'command':'auto_goal','goal':'farm_wheat','position':{'x':1,'y':63,'z':1},'width':2,'depth':2,'targetCount':4},
 {'command':'auto_goal','goal':'sequence','steps':[
   {'goal':'gather','resource':'logs','targetCount':2},
   {'goal':'craft','item':'chest','targetCount':1},
   {'goal':'equip','item':'iron_helmet','destination':'head'}
 ]}
]
for goal in valid_goals: test(goal)
for invalid in [
 {'command':'auto_goal','goal':'gather','resource':'command_block','targetCount':1},
 {'command':'auto_goal','goal':'gather','resource':'diamond','targetCount':100},
 {'command':'auto_goal','goal':'craft','item':'dragon_egg','targetCount':1},
 {'command':'auto_goal','goal':'equip','item':'diamond_sword','destinationSlot':'head'},
 {'command':'auto_goal','goal':'travel','destination':{'x':30000001,'y':64,'z':0},'arrivalRange':2},
 {'command':'auto_goal','goal':'build','position':{'x':1,'y':64,'z':1},'length':10,'axis':'x+','block':'cobblestone'},
 {'command':'auto_goal','goal':'farm_wheat','position':{'x':1,'y':64,'z':1},'width':100,'depth':2,'targetCount':4},
 {'command':'auto_goal','goal':'sequence','steps':[{'goal':'sequence','steps':[{'goal':'tools'}]}]},
 {'command':'auto_goal','goal':'sequence','steps':[{'goal':'equip','item':'iron_helmet','destinationSlot':'head'}]},
 {'command':'auto_goal','goal':'survive','code':'danger'},
 {'command':'auto_goal','goal':'gather','resource':'logs','targetCount':1,'durationSeconds':False}
]: test(invalid,False)
test({'command':'auto_checkpoint'})
test({'command':'auto_resume'})
assert "'resource','targetCount','arrivalRange','steps'" in source
checks+=1

print(f'MINECRAFT_GATEWAY_POLICY {checks}/{checks} PASS (offline Python, no LAN world)')
