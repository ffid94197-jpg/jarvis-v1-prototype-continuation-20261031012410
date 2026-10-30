/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Static wiring check; Guardian and Python policies have their own executable tests.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const guardian = read('src/lib/agent/guardian/guardian.ts');
const executor = read('src/lib/agent/tools/executor.ts');
const prompt = read('src/lib/agent/core/prompts.ts');
const policy = read('src/lib/agent/windows/policy.ts');
const sidecar = read('windows-companion/companion.py');
const effects = read('src/lib/agent/core/effects.ts');
const toolToOperation = {
  windows_browser_search:'browser_search',
  windows_browser_inspect:'browser_inspect',
  windows_browser_read_page:'browser_read_page',
  windows_browser_click_link:'browser_click_link',
  windows_browser_fill_search:'browser_fill_search',
  windows_browser_scroll:'browser_scroll',
  windows_list_windows:'list_windows',
  windows_focus_app:'focus_app'
};
const readOnly = new Set(['windows_browser_inspect','windows_browser_read_page','windows_list_windows']);
let count = 0;
function test(value, label){if(!value)throw new Error('FAIL '+label);count++;console.log('PASS '+label);}
for (const [name,operation] of Object.entries(toolToOperation)) {
  test(guardian.includes('"'+name+'"') && guardian.includes('case "'+name+'":'),name+' registered and Guardian-routed');
  test(executor.includes('case "'+name+'":'),name+' dispatched by executor');
  test(prompt.includes('- '+name+' '),name+' advertised to planner');
  test(policy.includes('"'+name+'"') && policy.includes('operation:"'+operation+'"'),name+' policy normalization exists');
  test(sidecar.includes("'"+operation+"'"),operation+' handled in Windows sidecar');
  test(readOnly.has(name) || effects.includes('"'+name+'"'),name+' admission classification present');
}
test(policy.includes('JARVIS_BROWSER_AGENT_ENABLED') && sidecar.includes('JARVIS_BROWSER_AGENT_ENABLED'), 'browser opt-in checked in both tiers');
test(policy.includes('JARVIS_WINDOWS_UI_CONTROL_ENABLED') && sidecar.includes('JARVIS_WINDOWS_UI_CONTROL_ENABLED'), 'window opt-in checked in both tiers');
test(sidecar.includes("state['inspection']") && sidecar.includes('pageToken'), 'browser state uses inspected-page tokens');
test(sidecar.includes('page.goto(resolved,wait_until='), 'link actions navigate URL without DOM click handlers');
test(!prompt.includes('windows_execute_arbitrary_shell'), 'no arbitrary shell advertised');
for (const tool of ['windows_open_settings','windows_discover_apps']) {
  test([guardian,executor,prompt,policy].every(text=>text.includes(tool)), tool+' present across both policies and planner');
}
test(sidecar.includes("operation == 'open_settings'") && sidecar.includes("operation == 'discover_apps'"),'desktop sidecar dispatches new app operations');
console.log(`AGENT_TOOL_WIRING: ${count}/${count} PASS (static/integration source only)`);
