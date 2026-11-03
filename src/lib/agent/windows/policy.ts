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
  pid?: number;
  cuaWindowId?: string;
  elementToken?: string;
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
/**
 * Windows companion preconditions, reported individually.
 *
 * All five conditions are still REQUIRED and the gate still fails closed — this
 * only replaces one undifferentiated message with the specific missing
 * precondition. Previously every failure said "Windows companion requires the
 * isolated loopback development launcher", so an operator who WAS running that
 * launcher but was missing (say) a companion token or a Minecraft LAN flag was
 * told to use the launcher they were already using, and the denial was
 * undiagnosable. That is how an authorized minecraft_companion_join ended up
 * looking like a policy rejection.
 *
 * A reason string is persisted to the durable audit log, so it must never
 * contain the token value or any other secret — only the name of what is missing.
 */
function companionGateFailure(): string | null {
  if (process.platform !== "win32") {
    return `Windows companion requires a Windows host; detected ${process.platform}. The isolated loopback development launcher is Windows-only.`;
  }
  if (process.env.JARVIS_WINDOWS_AGENT_ENABLED !== "1") {
    return "Windows companion is not enabled (JARVIS_WINDOWS_AGENT_ENABLED != 1). Start it with the isolated loopback development launcher — npm run dev:windows — which also spawns the private local companion.";
  }
  if (process.env.JARVIS_LOCAL_DEV_NO_LOGIN !== "1") {
    return "Windows companion requires the isolated loopback development launcher (JARVIS_LOCAL_DEV_NO_LOGIN != 1). It is deliberately unavailable through the authenticated or production launch path.";
  }
  if (process.env.JARVIS_LOCAL_DEV_BIND !== "127.0.0.1") {
    return `Windows companion requires a loopback-only bind (JARVIS_LOCAL_DEV_BIND=${process.env.JARVIS_LOCAL_DEV_BIND || "unset"}, expected 127.0.0.1); refusing because this console is not isolated to this PC.`;
  }
  if ((process.env.JARVIS_WINDOWS_COMPANION_TOKEN || "").length < 32) {
    return "Windows companion requires a companion token of at least 32 characters (JARVIS_WINDOWS_COMPANION_TOKEN missing or too short). npm run dev:windows generates one automatically; a plain npm run dev does not.";
  }
  return null;
}
export function validateDesktopTool(tool: string, args: Record<string, unknown>): {ok: true; prepared: DesktopPrepared} | {ok:false; reason:string} {
  const gateFailure = companionGateFailure();
  if (gateFailure) return {ok:false,reason:gateFailure};
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
    if (tool === "windows_browser_inspect") {
      if (Object.keys(args).some(k => k !== "query"))
        return {ok:false,reason:"Browser inspection accepts only an optional visible-control query."};
      if (args.query === undefined) return {ok:true,prepared:{operation:"browser_inspect"}};
      if (typeof args.query !== "string" || args.query.trim().length < 2 ||
          args.query.length > 160 || /[\x00-\x1f\x7f]/.test(args.query))
        return {ok:false,reason:"Browser control query must be 2–160 printable characters."};
      return {ok:true,prepared:{operation:"browser_inspect",query:args.query.trim()}};
    }
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
    if (tool === "windows_native_inspect") {
      if (Object.keys(args).some(k => k !== "query"))
        return {ok:false,reason:"Only an optional bounded control query is accepted."};
      if (args.query === undefined) return {ok:true,prepared:{operation:"native_inspect"}};
      if (typeof args.query !== "string" || args.query.length < 2 ||
          args.query.length > 160 || !args.query.trim() ||
          /[\x00-\x1f\x7f]/.test(args.query))
        return {ok:false,reason:"Control query must be 2–160 printable characters."};
      return {ok:true,prepared:{operation:"native_inspect",query:args.query.trim()}};
    }
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
    if (tool === "windows_desktop_observe") {
      const hasTarget = args.pid !== undefined || args.cuaWindowId !== undefined;
      if (hasTarget && (process.env.JARVIS_CUA_DRIVER_ENABLED !== "1" ||
          !Number.isInteger(args.pid) || (args.pid as number) <= 0 || (args.pid as number) >= 2**32 ||
          typeof args.cuaWindowId !== "string" || !/^[1-9][0-9]{0,19}$/.test(args.cuaWindowId) ||
          (args.cuaWindowId.length === 20 && args.cuaWindowId > "18446744073709551615")))
        return {ok:false,reason:"Exact-window observation requires a fresh PID and cuaWindowId from the latest CUA window list."};
      return {ok:true,prepared:{operation:"desktop_observe",
        ...(hasTarget ? {pid:args.pid as number,cuaWindowId:args.cuaWindowId as string}:{})}};
    }
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
    if (tool === "windows_desktop_click" && args.elementToken !== undefined) {
      if (process.env.JARVIS_CUA_DRIVER_ENABLED !== "1")
        return {ok:false,reason:"Snapshot element clicks require the explicit JARVIS_CUA_DRIVER_ENABLED=1 opt-in."};
      if (!Number.isInteger(args.pid) || (args.pid as number) <= 0 || (args.pid as number) >= 2**32 ||
          typeof args.cuaWindowId !== "string" || !/^[1-9][0-9]{0,19}$/.test(args.cuaWindowId) ||
          (args.cuaWindowId.length === 20 && args.cuaWindowId > "18446744073709551615") ||
          typeof args.elementToken !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(args.elementToken) ||
          !["left","right","double"].includes(String(args.button ?? "left")))
        return {ok:false,reason:"Use a fresh elementToken, PID and cuaWindowId from the same windows_desktop_observe result."};
      return {ok:true,prepared:{operation:"desktop_click",pid:args.pid as number,
        cuaWindowId:args.cuaWindowId,elementToken:args.elementToken,
        button:(args.button ?? "left") as "left"|"right"|"double"}};
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
    const hasCuaWindowTarget = args.pid !== undefined || args.cuaWindowId !== undefined;
    if (hasCuaWindowTarget && (process.env.JARVIS_CUA_DRIVER_ENABLED !== "1" ||
        !Number.isInteger(args.pid) || (args.pid as number) <= 0 || (args.pid as number) >= 2**32 ||
        typeof args.cuaWindowId !== "string" || !/^[1-9][0-9]{0,19}$/.test(args.cuaWindowId) ||
          (args.cuaWindowId.length === 20 && args.cuaWindowId > "18446744073709551615")))
      return {ok:false,reason:"Exact-window input requires a fresh PID and cuaWindowId from the latest CUA observation."};
    if (tool === "windows_desktop_type") {
      if (typeof args.text !== "string" || args.text.length < 1 || args.text.length > 400 ||
          /[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]/.test(args.text))
        return {ok:false,reason:"Text must be 1–400 characters without control bytes."};
      return {ok:true,prepared:{operation:"desktop_type",text:args.text,
        ...(hasCuaWindowTarget ? {pid:args.pid as number,cuaWindowId:args.cuaWindowId as string}:{})}};
    }
    if (tool === "windows_desktop_keys") {
      const allowed = new Set(["enter","esc","tab","space","backspace","delete","up","down","left","right","home","end","ctrl","alt","shift","win","a","c","v","x","s","f","r","t","w","d","e","n","p","z","y","f4"]);
      if (!Array.isArray(args.keys) || args.keys.length < 1 || args.keys.length > 4 ||
          !args.keys.every(k => typeof k === "string" && allowed.has(k)))
        return {ok:false,reason:"Use 1–4 documented keys; no arbitrary key scan codes."};
      return {ok:true,prepared:{operation:"desktop_keys",keys:args.keys as string[],
        ...(hasCuaWindowTarget ? {pid:args.pid as number,cuaWindowId:args.cuaWindowId as string}:{})}};
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
  // Declarative Minecraft goals share JARVIS's existing Guardian boundary.
  // The companion independently revalidates. This grants NO raw code/tool authority.
  const validMinecraftGoal=(r:Record<string,unknown>,step=false):boolean=>{
    if(!r || typeof r!=="object" || Array.isArray(r) || typeof r.goal!=="string")return false;
    const fixed=new Set(["survive","wood","tools","explore","follow","guard","stone_age","iron_age",
      "dragon_run","netherite_dragon_run","dragon_then_netherite_run","companion"]);
    const params:Record<string,string[]>={
      gather:["resource","targetCount"],travel:["destination","arrivalRange"],
      craft:["item","targetCount"],equip:["item",step?"destination":"destinationSlot"],
      build:["position","block","axis","length"],
      farm_wheat:["position","width","depth","targetCount"],sequence:["steps"]
    };
    const g=r.goal,extra=fixed.has(g)?[]:(Object.hasOwn(params,g)?params[g]:undefined);
    if(!extra || (step && (g==="sequence" || (fixed.has(g)&&!["tools","stone_age","iron_age"].includes(g)))))
      return false;
    const permitted=["goal",...(step?[]:["command","durationSeconds"]),...extra];
    if(Object.keys(r).some(k=>!permitted.includes(k)))return false;
    if((step && r.command!==undefined)||(!step && r.command!=="auto_goal"))return false;
    const integer=(v:unknown,min:number,max:number)=>
      typeof v==="number" && Number.isInteger(v) && v>=min && v<=max;
    const at=(v:unknown)=>!!v && typeof v==="object" && !Array.isArray(v) &&
      Object.keys(v as Record<string,unknown>).length===3 &&
      ["x","y","z"].every(k=>integer((v as Record<string,unknown>)[k],-30000000,30000000));
    if(!step && r.durationSeconds!==undefined && !integer(r.durationSeconds,10,43200))return false;
    if(fixed.has(g))return true;
    if(g==="gather")return ["logs","planks","sticks","cobblestone","raw_iron","iron_ingot",
      "diamond","obsidian","flint","netherrack"].includes(String(r.resource))&&integer(r.targetCount,1,64);
    if(g==="travel")return at(r.destination)&&integer(r.arrivalRange,1,8);
    if(g==="craft")return ["stick","crafting_table","chest","furnace","ladder","bread","shield","torch"]
      .includes(String(r.item))&&integer(r.targetCount,1,16);
    if(g==="equip"){
      const slots:Record<string,string[]>={
        hand:["wooden_pickaxe","stone_pickaxe","iron_pickaxe","diamond_pickaxe","netherite_pickaxe",
          "wooden_sword","stone_sword","iron_sword","diamond_sword","netherite_sword","bow","crossbow","trident","shield","torch"],
        head:["leather_helmet","iron_helmet","golden_helmet","diamond_helmet","netherite_helmet","turtle_helmet"],
        torso:["leather_chestplate","iron_chestplate","golden_chestplate","diamond_chestplate","netherite_chestplate","elytra"],
        legs:["leather_leggings","iron_leggings","golden_leggings","diamond_leggings","netherite_leggings"],
        feet:["leather_boots","iron_boots","golden_boots","diamond_boots","netherite_boots"],
        "off-hand":["shield","torch","totem_of_undying"]
      };
      const slot=step?r.destination:r.destinationSlot;
      return typeof slot==="string" && Object.hasOwn(slots,slot) && slots[slot].includes(String(r.item));
    }
    if(g==="build"){
      if(!at(r.position)||!integer(r.length,1,8)||
          !["x+","x-","z+","z-"].includes(String(r.axis))||
          !["cobblestone","dirt","oak_planks","spruce_planks","birch_planks","stone_bricks","netherrack"].includes(String(r.block)))
        return false;
      const p=r.position as {x:number;y:number;z:number};
      const n=r.length as number;
      const dx=r.axis==="x+"?1:r.axis==="x-"?-1:0;
      const dz=r.axis==="z+"?1:r.axis==="z-"?-1:0;
      return integer(p.y,-62,318)&&Math.abs(p.x)<=29999984&&Math.abs(p.z)<=29999984&&
        Math.abs(p.x+dx*(n-1))<=29999984&&Math.abs(p.z+dz*(n-1))<=29999984;
    }
    if(g==="farm_wheat"){
      if(!at(r.position)||!integer(r.width,1,4)||!integer(r.depth,1,4)||!integer(r.targetCount,1,16))return false;
      const p=r.position as {x:number;y:number;z:number};
      return integer(p.y,-62,319)&&p.x>=-29999984&&p.z>=-29999984&&
        p.x+(r.width as number)-1<=29999984&&p.z+(r.depth as number)-1<=29999984;
    }
    if(g==="sequence")return !step && Array.isArray(r.steps)&&r.steps.length>=1&&r.steps.length<=8&&
      r.steps.every(x=>validMinecraftGoal(x as Record<string,unknown>,true));
    return false;
  };
  if (tool === "minecraft_companion_command") {
    if (process.env.JARVIS_MINECRAFT_LAN_ENABLED !== "1") return {ok:false,reason:"Enable Minecraft LAN companion."};
    const command=String(args.command||"");
    const allowed=["follow","stop","jump","move","look","status","come","stay","guard","collect_wood","inventory","say","observe","auto_goal","auto_status","auto_stop",
      "inspect_block","navigate","dig_block","equip_item","craft_item","place_block","interact_block","interact_entity","use_item","natural_goal","auto_checkpoint","auto_resume"];
    if (!allowed.includes(command)) return {ok:false,reason:"Unknown Minecraft companion command."};
    if (command==="auto_goal" && !validMinecraftGoal(args))
      return {ok:false,reason:"Minecraft goal failed bounded Guardian validation; no effect authorized."};
    if(command==="natural_goal" && (typeof args.text!=="string" || args.text.trim().length===0 ||
        args.text.length>600 || /[\x00-\x1f\x7f]/.test(args.text) ||
        Object.keys(args).some(k=>!["command","text"].includes(k))))
      return {ok:false,reason:"Minecraft language instruction invalid (1–600 printable characters, no extra fields)."};
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
    if(command==='auto_goal'){
      prepared.goal=args.goal as string;
      if(args.durationSeconds!==undefined)prepared.durationSeconds=args.durationSeconds as number;
      const fields=["resource","targetCount","destination","arrivalRange","steps","position","block","axis",
        "length","width","depth","item","destinationSlot"];
      for(const key of fields)if(args[key]!==undefined)(prepared as unknown as Record<string,unknown>)[key]=args[key];
    }
    if(command==='natural_goal')prepared.text=args.text as string;
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
    if (process.env.JARVIS_MINECRAFT_LAN_ENABLED !== "1") {
      // Name every variable the launcher preflight also requires, so a
      // half-configured Minecraft setup is diagnosable from the denial instead
      // of surfacing later as an obscure companion error.
      return {ok:false,reason:"Minecraft LAN companion not enabled by operator. Set JARVIS_MINECRAFT_LAN_ENABLED=1 together with JARVIS_MINECRAFT_LAN_HOST (127.0.0.1 or localhost), JARVIS_MINECRAFT_LAN_PORT (1024-65535) and JARVIS_MINECRAFT_PLAYER (the human Java player, not JarvisBuddy) in .env, then restart npm run dev:windows. The Java world must already be open to LAN."};
    }
    // The denial above advertises host, port and player constraints, so the gate
    // must actually enforce them. Until now it returned ok:true as soon as the
    // opt-in flag was set, which made the runtime gate WEAKER than the launcher
    // preflight (scripts/windows-startup-preflight.mjs validates all three). Any
    // path that starts the server without the preflight — a plain `next dev`, a
    // restored .env, a manual process — would then authorize a join to an
    // arbitrary REMOTE Minecraft host on an arbitrary port, defeating the
    // loopback-only isolation this launcher exists to guarantee, and would fail
    // later inside the bridge as an obscure connection error.
    //
    // STOP is deliberately exempt: halting a running companion must stay
    // available even when the connection configuration is broken.
    if (tool === "minecraft_companion_join") {
      const host = process.env.JARVIS_MINECRAFT_LAN_HOST || "127.0.0.1";
      if (host !== "127.0.0.1" && host !== "localhost") {
        return {ok:false,reason:`Minecraft LAN host must be this PC only (JARVIS_MINECRAFT_LAN_HOST=${host}, expected 127.0.0.1 or localhost). The isolated development launcher never joins a remote or LAN-wide server.`};
      }
      const portRaw = String(process.env.JARVIS_MINECRAFT_LAN_PORT ?? "").trim();
      if (!/^[0-9]+$/.test(portRaw) || !Number.isSafeInteger(Number(portRaw)) ||
          Number(portRaw) < 1024 || Number(portRaw) > 65535) {
        return {ok:false,reason:`Minecraft requires an explicit Java LAN port between 1024 and 65535 (JARVIS_MINECRAFT_LAN_PORT=${portRaw || "unset"}). Open the Java world to LAN and copy the port it reports now — a port from an earlier session is not assumed to still be active.`};
      }
      const player = String(process.env.JARVIS_MINECRAFT_PLAYER ?? "").trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(player) || player.toLowerCase() === "jarvisbuddy") {
        return {ok:false,reason:"Minecraft owner must be the human Java player name (JARVIS_MINECRAFT_PLAYER: 1-16 characters of A-Z, a-z, 0-9 or underscore), not JarvisBuddy. The companion connects as its own bot and must never impersonate the owner."};
      }
    }
    return {ok:true,prepared:{operation:tool === "minecraft_companion_join" ? "minecraft_join" : "minecraft_stop"}};
  }
  return {ok:false,reason:"Unknown Windows desktop tool."};
}
