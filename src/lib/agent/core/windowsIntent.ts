/** Narrow user-objective matcher for familiar *single-step* Windows opens.
 * This improves reliability when the model hallucinates that Settings is Explorer.
 * It is not an authority decision: ALL generated calls still use Guardian.
 */
export interface DirectDesktopPlan {
  action: "tool";
  tool: "windows_open_settings" | "windows_open_app";
  args: {page: string} | {app: string};
}
export function directWindowsLaunch(objective: string): DirectDesktopPlan | null {
  // Deliberately not a general natural-language command executor. Combined
  // objectives go through the model; this handles only exact simple opens.
  const normalized = objective.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g," ");
  const match = normalized.match(/^(?:please )?(?:open|launch|show|start)(?: my| the)? (.+)$/);
  if (!match) return null;
  const name = match[1];
  const pages: Record<string,string> = {
    "settings":"home", "setting":"home", "windows settings":"home", "system settings":"home",
    "display settings":"display", "sound settings":"sound", "network settings":"network",
    "wifi settings":"wifi", "bluetooth settings":"bluetooth", "windows update":"updates",
    "storage settings":"storage", "power settings":"power", "privacy settings":"privacy",
  };
  if (Object.prototype.hasOwnProperty.call(pages,name))
    return {action:"tool",tool:"windows_open_settings",args:{page:pages[name]}};
  const apps: Record<string,string> = {
    "chrome":"chrome", "google chrome":"chrome", "edge":"edge", "microsoft edge":"edge",
    "firefox":"firefox", "mozilla firefox":"firefox", "vs code":"vscode", "visual studio code":"vscode",
    "notepad":"notepad", "calculator":"calculator", "paint":"paint", "file explorer":"explorer",
    "windows explorer":"explorer", "tlauncher":"tlauncher"
  };
  // If TLauncher has no configured executable, do not repeatedly send a
  // guaranteed-to-be-denied direct tool call. Let the model discover a local
  // Start Menu shortcut in the operator-enabled experimental mode.
  if (name === "tlauncher" && process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL === "1" &&
      !process.env.JARVIS_TLAUNCHER_PATH) return null;
  if (Object.prototype.hasOwnProperty.call(apps,name))
    return {action:"tool",tool:"windows_open_app",args:{app:apps[name]}};
  return null;
}
