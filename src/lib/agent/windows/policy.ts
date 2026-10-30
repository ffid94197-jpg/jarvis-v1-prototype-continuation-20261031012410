import {readFileSync} from "node:fs";
import {join} from "node:path";
/** Operator opt-in Windows capabilities. Never infer privileges from model output. */
export interface DesktopPrepared {
  operation: "open_url" | "open_app" | "open_settings" | "discover_apps" | "find_capability" | "youtube_oldest" | "screen_watch" | "minecraft_join" | "minecraft_stop" | "browser_search" | "browser_inspect" | "browser_read_page" | "browser_click_link" | "browser_fill_search" | "browser_scroll" | "list_windows" | "focus_app" | "desktop_state" | "desktop_windows" | "desktop_focus" | "desktop_click" | "desktop_move" | "desktop_type" | "desktop_keys" | "desktop_scroll" | "launch_installed" | "minecraft_command" | "minecraft_input" | "native_open_url" | "native_inspect" | "native_action" | "native_verify" | "desktop_observe";
  goal?: string;
  url?: string;
  app?: string;
  page?: string;
  channel?: string;
  seconds?: number;
  query?: string;
  text?: string;
  index?: number;
  pageToken?: string;
  direction?: "up" | "down";
  pages?: number;
  appId?: string;
  windowId?: string;
  x?: number;
  y?: number;
  button?: "left" | "right" | "double";
  keys?: string[];
  amount?: number;
  command?: string;
  directionInput?: string;
  durationMs?: number;
  durationSeconds?: number;
  position?: {x:number;y:number;z:number};
  reference?: {x:number;y:number;z:number};
  face?: {x:number;y:number;z:number};
  range?: number;
  item?: string;
  destination?: string;
  count?: number;
  entityId?: number;
  hand?: string;
  action?: string;
  elementId?: string;
  titleContains?: string;
  controlContains?: string;
  textEquals?: string;
}
const PUBLIC_HOST = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const PRIVATE_HOST = /(?:^|\.)(?:localhost|local|internal|test)$/i;
const BUILTIN_APPS = ["settings","chrome","edge","firefox","vscode", "notepad", "calculator", "explorer", "paint", "tlauncher"];
const SETTINGS_PAGES = ["home", "display", "sound", "network", "wifi", "bluetooth", "apps", "updates", "privacy", "storage", "power", "accounts", "personalization", "time"];
const DISALLOWED_EXES = new Set(["cmd.exe","powershell.exe","pwsh.exe","wscript.exe","cscript.exe", "mshta.exe","reg.exe","regedit.exe","taskkill.exe","python.exe","node.exe","bash.exe","wsl.exe","rundll32.exe","schtasks.exe","wmic.exe"]);
function operatorApps(): string[] {
  try {
    const config = JSON.parse(readFileSync(join(process.cwd(), "windows-companion", "approved_apps.json"), "utf8")) as unknown;
    if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).length > 40) return [];
    return Object.entries(config as Record<string, unknown>).filter(([alias, file]) =>
      /^[a-z][a-z0-9_-]{1,31}$/.test(alias) && !BUILTIN_APPS.includes(alias) && typeof file === "string" &&
      file.length <= 400 && /^[A-Za-z]:\\/.test(file) && file.toLowerCase().endsWith(".exe") &&
      !file.split("\\").includes("..") && !DISALLOWED_EXES.has(file.split("\\").pop()!.toLowerCase())
    ).map(([alias]) => alias);
  } catch {return [];}
}
const appApproved = (name: unknown): name is string => typeof name === "string" &&
  (BUILTIN_APPS.includes(name) || operatorApps().includes(name));
export function validateDesktopTool(tool: string, args: Record<string, unknown>): {ok: true; prepared: DesktopPrepared} | {ok:false; reason:string} {
  if (process.platform !== "win32" || process.env.JARVIS_WINDOWS_AGENT_ENABLED !== "1" ||
      process.env.JARVIS_LOCAL_DEV_NO_LOGIN !== "1" || process.env.JARVIS_LOCAL_DEV_BIND !== "127.0.0.1" ||
      (process.env.JARVIS_WINDOWS_COMPANION_TOKEN || "").length < 32) {
    return {ok:false,reason:"Windows companion requires the isolated loopback development launcher."};
  }
  if (tool === "windows_open_url") {
    if (typeof args.url !== "string" || args.url.length > 2048) return {ok:false,reason:"Provide a bounded HTTPS URL."};
    try {
      const u = new URL(args.url);
      if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash ||
          !PUBLIC_HOST.test(u.hostname) || PRIVATE_HOST.test(u.hostname) ||
          /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw new Error("unsafe URL");
      return {ok:true,prepared:{operation:"open_url",url:u.toString()}};
    } catch {return {ok:false,reason:"Only ordinary public HTTPS website URLs are permitted."};}
  }
  if (tool === "windows_native_open_url") {
    if (process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL !== "1") return {ok:false,reason:"Enable explicit local desktop control for native browser navigation."};
    if (typeof args.url !== "string" || args.url.length > 2048) return {ok:false,reason:"Provide a public HTTPS URL."};
    try {
      const u = new URL(args.url);
      if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash ||
          !PUBLIC_HOST.test(u.hostname) || PRIVATE_HOST.test(u.hostname) ||
          /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) throw new Error("unsafe");
      return {ok:true,prepared:{operation:"native_open_url",url:u.toString()}};
    } catch {return {ok:false,reason:"Native navigation accepts only public HTTPS URLs."};}
  }
  if (tool === "windows_discover_apps") {
    return {ok:true,prepared:{operation:"discover_apps"}};
  }
  if (tool === "windows_find_capability") {
    if (typeof args.goal !== "string" || args.goal.trim().length < 3 || args.goal.length > 250 ||
        /[\x00-\x1f\x7f]/.test(args.goal) || !args.goal.trim())
      return {ok:false,reason:"Capability search requires a printable 3–250 character goal."};
    return {ok:true,prepared:{operation:"find_capability",goal:args.goal.trim()}};
  }
  if (tool === "windows_open_settings") {
    if (typeof args.page !== "string" || !SETTINGS_PAGES.includes(args.page))
      return {ok:false,reason:"Settings page must be one of the documented approved names."};
    return {ok:true,prepared:{operation:"open_settings",page:args.page}};
  }
  if (tool === "windows_open_app") {
    if (!appApproved(args.app)) return {ok:false,reason:"App is not in the approved Windows application catalog."};
    if (args.app === "tlauncher" && !process.env.JARVIS_TLAUNCHER_PATH)
      return {ok:false,reason:"Operator must configure JARVIS_TLAUNCHER_PATH."};
    return {ok:true,prepared:{operation:"open_app",app:args.app}};
  }
  if (tool === "windows_youtube_oldest") {
    if (typeof args.channel !== "string" || !/^[\w. -]{2,64}$/.test(args.channel)) {
      return {ok:false,reason:"Channel search must be a simple name (2–64 characters)."};
    }
    return {ok:true,prepared:{operation:"youtube_oldest",channel:args.channel}};
  }
  if (tool === "windows_watch_screen") {
    if (process.env.JARVIS_SCREEN_WATCH_ENABLED !== "1") return {ok:false,reason:"Continuous screen capture requires explicit operator opt-in."};
    if (typeof args.seconds !== "number" || !Number.isInteger(args.seconds) || args.seconds < 2 || args.seconds > 15)
      return {ok:false,reason:"Screen observation must be bounded to 2–15 seconds."};
    return {ok:true,prepared:{operation:"screen_watch",seconds:args.seconds}};
  }
  // General web automation uses the existing Playwright browser, never an
  // unconstrained browser profile or an arbitrary program/shell.
  const browserTools = ["windows_browser_search", "windows_browser_inspect",
    "windows_browser_read_page", "windows_browser_click_link",
    "windows_browser_fill_search", "windows_browser_scroll"];
  if (browserTools.includes(tool)) {
    if (process.env.JARVIS_BROWSER_AGENT_ENABLED !== "1")
      return {ok:false,reason:"Operator must opt in to JARVIS_BROWSER_AGENT_ENABLED=1."};
    if (tool === "windows_browser_search") {
      if (typeof args.query !== "string" || !/^[^\x00-\x1f\x7f]{1,160}$/.test(args.query) || !args.query.trim())
        return {ok:false,reason:"Search query must be bounded printable text."};
      return {ok:true,prepared:{operation:"browser_search",query:args.query.trim()}};
    }
    if (tool === "windows_browser_inspect") return {ok:true,prepared:{operation:"browser_inspect"}};
    if (tool === "windows_browser_read_page") return {ok:true,prepared:{operation:"browser_read_page"}};
    if (typeof args.pageToken !== "string" || !/^[a-f0-9]{24}$/.test(args.pageToken))
      return {ok:false,reason:"A fresh pageToken from windows_browser_inspect is required."};
    if (tool === "windows_browser_click_link") {
      if (!Number.isInteger(args.index) || (args.index as number) < 0 || (args.index as number) >= 40)
        return {ok:false,reason:"Link index must be 0–39 from the inspected page."};
      return {ok:true,prepared:{operation:"browser_click_link",pageToken:args.pageToken,index:args.index as number}};
    }
    if (tool === "windows_browser_fill_search") {
      if (!Number.isInteger(args.index) || (args.index as number) < 0 || (args.index as number) >= 40 ||
          typeof args.text !== "string" || !/^[^\x00-\x1f\x7f]{1,160}$/.test(args.text) || !args.text.trim())
        return {ok:false,reason:"Provide an inspected search field index and bounded search text."};
      return {ok:true,prepared:{operation:"browser_fill_search",pageToken:args.pageToken,index:args.index as number,text:args.text.trim()}};
    }
    if (tool === "windows_browser_scroll") {
      if ((args.direction !== "up" && args.direction !== "down") ||
          !Number.isInteger(args.pages) || (args.pages as number) < 1 || (args.pages as number) > 5)
        return {ok:false,reason:"Scroll requires up/down direction and 1–5 pages."};
      return {ok:true,prepared:{operation:"browser_scroll",pageToken:args.pageToken,
        direction:args.direction as "up" | "down",pages:args.pages as number}};
    }
  }
  if (tool === "windows_list_windows" || tool === "windows_focus_app") {
    if (process.env.JARVIS_WINDOWS_UI_CONTROL_ENABLED !== "1")
      return {ok:false,reason:"Operator must opt in to JARVIS_WINDOWS_UI_CONTROL_ENABLED=1."};
    if (tool === "windows_list_windows") return {ok:true,prepared:{operation:"list_windows"}};
    if (!appApproved(args.app))
      return {ok:false,reason:"Only approved local app aliases can be focused."};
    return {ok:true,prepared:{operation:"focus_app",app:args.app}};
  }
  // Experimental full-control mode is EXPLICITLY enabled by the operator on
  // a 127.0.0.1-only test machine. It never bypasses Guardian/audit.
  if (tool.startsWith("windows_desktop_") || tool.startsWith("windows_native_") || tool === "windows_launch_installed") {
    if (process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL !== "1")
      return {ok:false, reason:"Enable JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1 for this private test PC."};
    if (tool === "windows_native_inspect") return {ok:true,prepared:{operation:"native_inspect"}};
    if (tool === "windows_native_verify") {
      const names = ["titleContains", "controlContains", "textEquals"] as const;
      const supplied = names.filter(k => args[k] !== undefined);
      if (supplied.length !== 1) return {ok:false,reason:"Specify exactly one foreground UI verification predicate."};
      const key = supplied[0];
      const value = args[key];
      if (typeof value !== "string" || value.length < 2 || value.length > 160 || /[\x00-\x1f\x7f]/.test(value))
        return {ok:false,reason:"UI expectation must contain 2–160 printable characters."};
      return {ok:true,prepared:{operation:"native_verify",[key]:value}};
    }
    if (tool === "windows_desktop_observe") return {ok:true,prepared:{operation:"desktop_observe"}};
    if (tool === "windows_native_action") {
      if (typeof args.elementId !== "string" || !/^[a-f0-9]{24}$/.test(args.elementId) ||
          !["invoke","focus","set_text"].includes(String(args.action)))
        return {ok:false,reason:"Use a fresh inspected control elementId and supported action."};
      if (args.action === "set_text" && (typeof args.text !== "string" || args.text.length < 1 ||
          args.text.length > 500 || args.text.includes("\0")))
        return {ok:false,reason:"Native text must be 1–500 characters without NUL."};
      if (args.action !== "set_text" && args.text !== undefined)
        return {ok:false,reason:"Only set_text takes a text argument."};
      return {ok:true,prepared:{operation:"native_action",elementId:args.elementId,
        action:args.action as string,...(args.action === "set_text" ? {text:args.text as string}:{})}};
    }
    if (tool === "windows_desktop_state") return {ok:true,prepared:{operation:"desktop_state"}};
    if (tool === "windows_desktop_windows") return {ok:true,prepared:{operation:"desktop_windows"}};
    if (tool === "windows_launch_installed") {
      if (typeof args.appId !== "string" || !/^start-[a-f0-9]{12}$/.test(args.appId))
        return {ok:false,reason:"Use an appId from windows_discover_apps (Start Menu list)."};
      return {ok:true,prepared:{operation:"launch_installed",appId:args.appId}};
    }
    if (tool === "windows_desktop_focus") {
      if (typeof args.windowId !== "string" || !/^[a-f0-9]{24}$/.test(args.windowId))
        return {ok:false,reason:"Use a fresh windowId from windows_desktop_windows."};
      return {ok:true,prepared:{operation:"desktop_focus",windowId:args.windowId}};
    }
    if (tool === "windows_desktop_click" || tool === "windows_desktop_move") {
      if (!Number.isInteger(args.x) || !Number.isInteger(args.y) ||
          (args.x as number) < 0 || (args.y as number) < 0 ||
          (args.x as number) >= 16000 || (args.y as number) >= 16000 ||
          (tool === "windows_desktop_click" && !["left","right","double"].includes(String(args.button))))
        return {ok:false,reason:"Coordinates must be nonnegative screen pixels; click button left/right/double."};
      return {ok:true,prepared:{operation:tool === "windows_desktop_click" ? "desktop_click" : "desktop_move",
        x:args.x as number,y:args.y as number,
        ...(tool === "windows_desktop_click" ? {button:args.button as "left"|"right"|"double"}: {})}};
    }
    if (tool === "windows_desktop_type") {
      if (typeof args.text !== "string" || args.text.length < 1 || args.text.length > 400 ||
          /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(args.text))
        return {ok:false,reason:"Text must be 1–400 characters without control bytes."};
      return {ok:true,prepared:{operation:"desktop_type",text:args.text}};
    }
    if (tool === "windows_desktop_keys") {
      const allowed = new Set(["enter","esc","tab","space","backspace","delete","up","down","left","right","home","end","ctrl","alt","shift","win","a","c","v","x","s","f","r","t","w","d","e","n","p","z","y","f4"]);
      if (!Array.isArray(args.keys) || args.keys.length < 1 || args.keys.length > 4 ||
          !args.keys.every(k => typeof k === "string" && allowed.has(k)))
        return {ok:false,reason:"Use 1–4 documented keys; no arbitrary key scan codes."};
      return {ok:true,prepared:{operation:"desktop_keys",keys:args.keys as string[]}};
    }
    if (tool === "windows_desktop_scroll") {
      if (!Number.isInteger(args.amount) || Math.abs(args.amount as number) > 5 || args.amount === 0)
        return {ok:false,reason:"Scroll amount must be -5..-1 or 1..5."};
      return {ok:true,prepared:{operation:"desktop_scroll",amount:args.amount as number}};
    }
  }
  if (tool === "windows_minecraft_input") {
    if (process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL !== "1" ||
        process.env.JARVIS_MINECRAFT_GAME_INPUT_ENABLED !== "1")
      return {ok:false,reason:"Minecraft foreground game control requires explicit local operator opt-in."};
    if (typeof args.action !== "string" || !["forward","back","left","right","jump","sneak","attack","use","inventory"].includes(args.action) ||
        !Number.isInteger(args.durationMs) || (args.durationMs as number) < 100 || (args.durationMs as number) > 1500)
      return {ok:false,reason:"Minecraft action requires an approved input and duration 100–1500ms."};
    return {ok:true,prepared:{operation:"minecraft_input",action:args.action,durationMs:args.durationMs as number}};
  }
  if (tool === "minecraft_companion_command") {
    if (process.env.JARVIS_MINECRAFT_LAN_ENABLED !== "1") return {ok:false,reason:"Enable Minecraft LAN companion."};
    const command=String(args.command||"");
    const allowed=["follow","stop","jump","move","look","status","come","stay","guard","collect_wood","inventory","say","observe","auto_goal","auto_status","auto_stop",
      "inspect_block","navigate","dig_block","equip_item","craft_item","place_block","interact_block","interact_entity","use_item"];
    if (!allowed.includes(command)) return {ok:false,reason:"Unknown Minecraft companion command."};
    if (command === "auto_goal" && (!['survive','wood','tools','explore','follow','guard','stone_age','iron_age','dragon_run','netherite_dragon_run','companion'].includes(String(args.goal)) ||
        (args.durationSeconds !== undefined && (!Number.isInteger(args.durationSeconds) || (args.durationSeconds as number) < 10 || (args.durationSeconds as number) > 43200))))
      return {ok:false,reason:'Unsupported Minecraft goal or duration outside 10–43200 seconds.'};
    if (command === "move" && (!['forward','back','left','right'].includes(String(args.directionInput)) ||
        !Number.isInteger(args.durationMs) || (args.durationMs as number) < 100 || (args.durationMs as number) > 3000))
      return {ok:false,reason:"Minecraft movement requires direction and 100–3000 ms duration."};
    if (command === "say" && (typeof args.text !== 'string' || args.text.length < 1 || args.text.length > 120 || /[\x00-\x1f\x7f]/.test(args.text)))
      return {ok:false,reason:'In-game chat must contain 1–120 printable characters.'};
    const pos=(value:unknown): value is {x:number;y:number;z:number} =>
      !!value && typeof value==='object' && !Array.isArray(value) &&
      ['x','y','z'].every(k=>Number.isInteger((value as Record<string,unknown>)[k]) && Math.abs((value as Record<string,number>)[k])<=30000000);
    const name=(value:unknown):value is string=>typeof value==='string' && /^[a-z0-9_]{1,64}$/.test(value);
    if (command==='navigate' && (!pos(args.position) || (args.range!==undefined && (!Number.isInteger(args.range) || (args.range as number)<1 || (args.range as number)>8))))
      return {ok:false,reason:'Bounded navigation requires integer target coordinates.'};
    if (['dig_block','inspect_block','interact_block'].includes(command) && !pos(args.position))
      return {ok:false,reason:'Block operation requires safe integer coordinates.'};
    if (command==='equip_item' && (!name(args.item)||!['hand','head','torso','legs','feet','off-hand'].includes(String(args.destination||'hand'))))
      return {ok:false,reason:'Invalid equipment item/destination.'};
    if (command==='craft_item' && (!name(args.item)||!Number.isInteger(args.count)||(args.count as number)<1||(args.count as number)>16))
      return {ok:false,reason:'Craft count must be 1–16 for a valid item.'};
    if (command==='place_block' && (!name(args.item)||!pos(args.reference)||!pos(args.face)||
        ['x','y','z'].reduce((n,k)=>n+Math.abs((args.face as Record<string,number>)[k]),0)!==1))
      return {ok:false,reason:'Block placement requires reference coordinates and an adjacent face.'};
    if (command==='interact_entity' && (!Number.isInteger(args.entityId)||(args.entityId as number)<0))
      return {ok:false,reason:'Entity ID must be a nonnegative integer.'};
    if (command==='use_item' && !['hand','off-hand'].includes(String(args.hand||'hand')))
      return {ok:false,reason:'Unsupported held-item hand.'};
    const prepared:DesktopPrepared={operation:'minecraft_command',command};
    if(command==='say')prepared.text=args.text as string;
    if(command==='move'){prepared.directionInput=args.directionInput as string;prepared.durationMs=args.durationMs as number;}
    if(command==='auto_goal'){prepared.goal=args.goal as string;if(args.durationSeconds!==undefined)prepared.durationSeconds=args.durationSeconds as number;}
    if(['navigate','dig_block','inspect_block','interact_block'].includes(command))prepared.position=args.position as {x:number;y:number;z:number};
    if(command==='navigate'&&args.range!==undefined)prepared.range=args.range as number;
    if(['equip_item','craft_item','place_block'].includes(command))prepared.item=args.item as string;
    if(command==='equip_item')prepared.destination=String(args.destination||'hand');
    if(command==='craft_item')prepared.count=args.count as number;
    if(command==='place_block'){prepared.reference=args.reference as {x:number;y:number;z:number};prepared.face=args.face as {x:number;y:number;z:number};}
    if(command==='interact_entity')prepared.entityId=args.entityId as number;
    if(command==='use_item')prepared.hand=String(args.hand||'hand');
    return {ok:true,prepared};
  }
  if (tool === "minecraft_companion_join" || tool === "minecraft_companion_stop") {
    if (process.env.JARVIS_MINECRAFT_LAN_ENABLED !== "1") return {ok:false,reason:"Minecraft LAN companion not enabled by operator."};
    return {ok:true,prepared:{operation:tool === "minecraft_companion_join" ? "minecraft_join" : "minecraft_stop"}};
  }
  return {ok:false,reason:"Unknown Windows desktop tool."};
}
