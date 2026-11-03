/**
 * Real-desktop autonomy supervision. Model output is never authority for
 * completion. A GUI dispatch is a pending obligation until a real UIA proof
 * arrives. A repeated failed/unverified action cannot spin forever.
 * All state is per task run; the durable journal remains authoritative.
 */
export const DESKTOP_GUI_EFFECTS = new Set([
  "windows_native_open_url", "windows_native_action",
  "windows_open_app", "windows_open_settings", "windows_open_url",
  "windows_launch_installed", "windows_desktop_focus", "windows_desktop_click",
  "windows_desktop_move", "windows_desktop_type", "windows_desktop_keys",
  "windows_desktop_scroll", "windows_focus_app", "windows_minecraft_input",
  "windows_browser_click_link", "windows_browser_fill_search", "windows_youtube_oldest",
]);
export const REPEATABLE_INPUT_TOOLS = new Set([
  "windows_desktop_focus", "windows_desktop_click", "windows_desktop_move",
  "windows_desktop_type", "windows_desktop_keys", "windows_desktop_scroll",
  "windows_minecraft_input", "windows_native_action", "windows_browser_scroll",
]);

const VERIFY_TOOLS = new Set(["windows_native_verify"]);
const PROVEN_FLAGS = ["textVerifiedByUIA", "focusVerified", "playbackConfirmed", "uiEffectVerified"];

export function desktopObjectiveRequiresActions(objective: string): boolean {
  const trimmed = objective.trim();
  if (/^(what|why|how|explain|describe|tell me about)\b/i.test(trimmed) ||
      /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:explain|describe|tell me how|show me how|teach me how|walk me through|give me instructions|tell me about)\b/i.test(trimmed)) return false;
  const desktopAction = /\b(open|launch|click|press|type|write in|scroll|navigate|play|watch|find|focus|search for|interact with|join)\b[\s\S]{0,110}\b(windows|desktop|screen|pc|chrome|browser|settings|notepad|youtube|minecraft|app|window|game|file explorer)\b/i.test(trimmed) ||
    /^(?:please |jarvis[,! ]+)?(?:open|launch|click|press|type|scroll|navigate|play|watch|find|focus)\b/i.test(trimmed);
  // A game win or inventory objective is NOT a conversational answer. Earlier,
  // "defeat the Ender Dragon" could be marked completed with zero tool calls.
  // Only require effects for active gameplay, not educational questions.
  const gameTarget = /\b(minecraft|ender dragon|dragon|nether|netherite|stronghold|end portal|dragon run|survival world|lan world|game world)\b/i.test(trimmed);
  const gameAction = /\b(defeat|kill|beat|win|finish|complete|mine|craft|collect|gather|build|farm|smelt|equip|enter|travel|survive|explore|play|join|start|get|obtain|acquire|reach|locate)\b/i.test(trimmed);
  const directGameCommand = /^(?:please\s+|jarvis[,! ]+)?(?:collect\s+wood|gather\s+logs|mine\s+(?:ore|iron|diamond)|craft\s+(?:tools|armor|weapons)|defeat\s+(?:the\s+)?(?:dragon|ender dragon))\b/i.test(trimmed);
  return desktopAction || (gameTarget && gameAction) || directGameCommand;
}
export type StepResult = {ok:boolean;detail?:Record<string,unknown>;error?:string};
function hasDirectProof(r: StepResult):boolean {
  const d=r.detail ?? {};
  return r.ok && (PROVEN_FLAGS.some(flag=>d[flag] === true) || d["proofVerified"] === true);
}
export class AutonomyGate {
  private pending = 0;
  constructor(priorPending=0) {
    this.pending=Number.isInteger(priorPending) ? Math.max(0,Math.min(100,priorPending)):0;
  }
  private lastFingerprint = "";
  private repeated = 0;
  private lastFailure = "";
  private lastTool = "";
  private observed = 0;

  get pendingGuiVerification() {return this.pending;}
  get observedChecks() {return this.observed;}
  get repeatedAttempts() {return this.repeated;}
  get lastUnverifiedTool() {return this.lastTool;}

  observe(tool:string, args:Record<string,unknown>, receipt:StepResult): {guidance:string;stalled:boolean} {
    const action = DESKTOP_GUI_EFFECTS.has(tool);
    const proof = VERIFY_TOOLS.has(tool) && hasDirectProof(receipt);
    if (action) {
      const signature=tool+"|"+JSON.stringify(args);
      if (signature===this.lastFingerprint) this.repeated++;
      else {this.lastFingerprint=signature;this.repeated=1;}
      if (!hasDirectProof(receipt)) {this.pending++;this.lastTool=tool;}
      if (!receipt.ok) this.lastFailure=receipt.error ?? "Action failed";
      else this.lastFailure="";
    } else if (proof) {
      this.observed++;
      if (this.pending>0) this.pending--;
      this.lastFingerprint="";
      this.repeated=0;
      this.lastFailure="";
    } else if (VERIFY_TOOLS.has(tool) && !receipt.ok) {
      this.lastFailure=receipt.error ?? "Expected UI condition not observed";
    }
    const stalled=action && this.repeated >= 3 && (!receipt.ok || !hasDirectProof(receipt));
    const guidance = stalled
      ? `Autonomy watchdog: repeated ${tool} three times without proof. Stop this approach; inspect the screen or report BLOCKED. Last failure: ${this.lastFailure || "no verified UI effect"}.`
      : proof
      ? `Live UIA postcondition verified. ${this.pending} earlier GUI action(s) still lack direct proof.`
      : action
      ? `Action ${tool} ${receipt.ok ? "dispatched" : "failed"}. Pending GUI proof: ${this.pending}. Next prefer windows_native_verify with an explicit expected foreground condition, or observe and choose a different action. Never treat dispatch as completion.`
      : VERIFY_TOOLS.has(tool)
      ? `Verification failed: ${this.lastFailure}. Re-inspect and recover rather than claiming success.`
      : "";
    return {guidance,stalled};
  }
  completionWarning():string | null {
    return this.pending > 0
      ? `${this.pending} desktop action(s) lack independently verified UI postconditions (latest: ${this.lastTool}). GUI task completion is PARTIAL, not verified.`
      : null;
  }
}
