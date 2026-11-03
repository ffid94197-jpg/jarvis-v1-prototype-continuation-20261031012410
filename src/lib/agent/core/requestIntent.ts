/**
 * JARVIS request-intent separation: conversational vs actionable.
 *
 * WHY THIS EXISTS
 * A conversational request may be answered directly. An actionable request may
 * only be reported complete once the executor has produced independently
 * verified evidence. Before this module the Core guarded that boundary with a
 * DENYLIST of actionable phrasings (desktopObjectiveRequiresActions +
 * requiresExternalActionEvidence). A denylist is incomplete by construction, so
 * any imperative it did not enumerate was settled as `completed` after ZERO
 * tool calls. Measured at c3f8e51..cd4fbed, 9 of 14 ordinary actionable
 * requests slipped through, including:
 *   "turn on bluetooth", "mute the speakers", "connect to the LAN world",
 *   "stop the music", "restart the companion bot", "enable the screen capture",
 *   "switch to the other window", "print that document", "lock the workstation"
 *
 * THE FIX
 * Invert the burden of proof. An objective is conversational ONLY when it
 * positively matches a non-actionable form (greeting, acknowledgement, identity
 * or chit-chat question, short remark with no doing-verb, or an interrogative
 * knowledge question). Everything else is actionable and therefore requires
 * real execution evidence.
 *
 * SAFETY DIRECTION
 * This can only ever move a terminal verdict from `completed` toward
 * `partial`/`failed`. It can never authorize an action, never grant a tool
 * permission, and never mark anything complete. Wording classification is
 * advisory; Guardian authorization, durable effect admission and
 * arbitrateCompletion remain the sole authorities on what happened.
 *
 * COMPATIBILITY
 * The two pre-existing classifiers keep full precedence and are consulted
 * first, so every objective they already treated as actionable still is. The
 * interrogative branch preserves this repository's deliberate rule that
 * educational questions do not require effects (see autonomyGate.ts: "Only
 * require effects for active gameplay, not educational questions").
 */

import { desktopObjectiveRequiresActions } from "./autonomyGate";
import { requiresExternalActionEvidence } from "./goalPlanner";

export type RequestKind = "conversational" | "actionable";

export interface RequestClassification {
  kind: RequestKind;
  /** Human-readable reason, safe to surface to the operator and to audit. */
  reason: string;
}

/** Anything longer than this is a task description, not a conversational remark. */
const MAX_CONVERSATIONAL_LENGTH = 400;

/** Interrogative / educational lead. Deliberately mirrors the question forms the
 * existing classifiers already exempt, so behaviour there is unchanged. */
const INTERROGATIVE_LEAD =
  /^(?:what|whats|what's|why|when|where|who|whom|whose|which|how|hows|how's|is|are|am|was|were|can|could|do|does|did|should|would|will|shall|may|might|explain|describe|define|summarize|summarise|compare|contrast|translate|elaborate|clarify)\b/i;

/** Greetings. */
const SOCIAL_LEAD =
  /^(?:hi|hello|hey|hiya|howdy|yo|sup|greetings|good\s+(?:morning|afternoon|evening|night)|welcome\s+back|morning|afternoon|evening)\b/i;

/** Acknowledgements, praise and closings. */
const GRATITUDE_LEAD =
  /^(?:thanks|thank\s+you|thx|ty|cheers|much\s+appreciated|appreciate\s+it|ok|okay|alright|all\s+right|fine|good|nice|great|cool|awesome|perfect|excellent|well\s+done|good\s+job|brilliant|got\s+it|understood|noted|roger|bye|goodbye|good\s+night|see\s+you|farewell|lol|haha|h+m+|uh+h|sure)\b/i;

/** Questions about JARVIS's own identity or capabilities — always conversational,
 * and the branch that must never leak the underlying model's identity. */
const IDENTITY_QUESTION =
  /\b(?:who\s+are\s+you|what\s+are\s+you|what(?:'s|\s+is)\s+your\s+name|your\s+name|are\s+you\s+(?:jarvis|j\.?a\.?r\.?v\.?i\.?s\.?|real|alive|there|human|a\s+(?:bot|robot|ai|person))|introduce\s+yourself|tell\s+me\s+about\s+yourself|what\s+can\s+you\s+do|what\s+are\s+your\s+(?:capabilities|abilities|features|tools|functions)|what\s+do\s+you\s+do)\b/i;

/** Small talk with no request attached. */
const CHITCHAT =
  /\b(?:how\s+are\s+you|how(?:'s|\s+is)\s+it\s+going|how(?:'s|\s+is)\s+your\s+day|what(?:'s|\s+is)\s+up|what\s+do\s+you\s+think|tell\s+me\s+a\s+joke|i'?m\s+bored|are\s+you\s+bored)\b/i;

/**
 * Broad doing-verbs. Used ONLY to refuse conversational classification, so an
 * over-inclusive list errs in the safe direction: a mis-flagged remark becomes
 * "requires evidence" rather than a fabricated success.
 */
const ACTION_VERB =
  /\b(?:do|perform|complete|finish|handle|carry\s+out|continue|keep\s+going|carry\s+on|open|close|launch|start|stop|restart|reboot|shutdown|kill|terminate|resume|pause|suspend|enable|disable|activate|deactivate|toggle|switch|turn\s+(?:on|off|up|down)|connect|disconnect|pair|unpair|join|leave|mute|unmute|silence|print|lock|unlock|delete|remove|erase|rename|move|copy|cut|paste|create|make|write|save|send|submit|post|share|upload|download|fetch|install|uninstall|update|upgrade|patch|run|execute|invoke|build|compile|deploy|release|publish|schedule|cancel|abort|retry|mine|dig|craft|smelt|collect|gather|farm|harvest|chop|fish|hunt|defeat|attack|fight|breed|tame|equip|unequip|place|break|consume|trade|buy|purchase|sell|pay|order|book|reserve|call|dial|text|message|email|mail|notify|alert|remind|record|capture|screenshot|film|scan|search|find|locate|focus|click|tap|press|type|enter|input|scroll|swipe|drag|drop|select|choose|pick|set|change|adjust|increase|decrease|raise|lower|configure|setup|organize|sort|clean|clear|empty|backup|restore|migrate|sync|merge|split|edit|modify|fix|repair|refactor|implement|develop|automate|monitor|watch|play|stream|listen|analyze|analyse|review|validate|verify|test|check)\b/i;

/** Text-only drafting is a direct answer, unless the request also asks for delivery or an external side effect. */
const PLAIN_TEXT_REQUEST_PREFIX =
  /^(?:(?:hey\s+)?jarvis[,!:\s]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+(?:to\s+)?|)|please\s+|kindly\s+)?/i;
const PLAIN_TEXT_OUTPUT =
  /^(?:write|draft|compose|generate)\s+(?:me\s+)?(?:a|an|the|some)\s+(?:poem|story|email|message|essay|description|summary|snippet|example|paragraph|reply)\b/i;
const EXTERNAL_DELIVERY =
  /\b(?:to (?:a|the) file|on disk|send|publish|deploy|save|upload|share|post|submit|print|attach|export|deliver|sync|email it)\b/i;
function isPlainTextGenerationRequest(raw: string): boolean {
  const body = raw.trim().replace(PLAIN_TEXT_REQUEST_PREFIX, "").trim();
  return PLAIN_TEXT_OUTPUT.test(body) && !EXTERNAL_DELIVERY.test(body);
}

/** Polite questions can still be requests to act ("Can you complete it?"). */
const POLITE_REQUEST_PREFIX =
  /^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?help\s+me\s+(?:to\s+)?|(?:can|could|would|will)\s+you\s+(?:please\s+)?)/i;
function isPoliteActionRequest(s: string): boolean {
  const match = s.match(POLITE_REQUEST_PREFIX);
  if (!match) return false;
  const firstWords = s.slice(match[0].length).match(/^([a-z]+(?:\s+[a-z]+)?)/i)?.[1] ?? "";
  return ACTION_VERB.test(firstWords);
}

/** Short follow-up imperatives otherwise resemble the "Do you ...?" question lead. */
const BARE_DO_COMMAND =
  /^do\s+(?:it|this|that|the\s+(?:remaining|rest|work|task))\b/i;

/** Leading politeness / wake-address, which carries no intent of its own. */
const ADDRESS_PREFIX =
  /^(?:please\s+|kindly\s+|jarvis[,!:\s]+|hey\s+jarvis[,!:\s]+|ok\s+jarvis[,!:\s]+|could\s+you\s+please\s+)+/i;

function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
}

function stripAddress(s: string): string {
  const once = s.replace(ADDRESS_PREFIX, "").trim();
  return once || s;
}

function wordCount(s: string): number {
  return s.length === 0 ? 0 : s.split(" ").length;
}

/**
 * Classify one operator objective.
 *
 * Order is significant:
 *  1. the pre-existing capability/gameplay guards (unchanged authority),
 *  2. positively conversational forms,
 *  3. default → actionable (fail-closed).
 */
export function classifyRequestIntent(objective: string): RequestClassification {
  const raw = typeof objective === "string" ? objective.trim() : "";

  if (!raw) {
    return { kind: "conversational", reason: "empty objective contains no actionable request" };
  }

  // A long objective is a specification, not a remark. Do not let length hide
  // behind a conversational pattern.
  if (raw.length > MAX_CONVERSATIONAL_LENGTH) {
    return {
      kind: "actionable",
      reason: `objective exceeds ${MAX_CONVERSATIONAL_LENGTH} characters, so it is treated as a task specification`,
    };
  }

  // Pure drafting is a direct conversational output, not an external effect.
  // Requests to save, send, publish or upload the draft still go through Guardian.
  if (isPlainTextGenerationRequest(raw)) {
    return { kind: "conversational", reason: "plain text generation can be answered directly without external effects" };
  }

  // 1. Existing guards keep full precedence — nothing they caught is loosened.
  if (desktopObjectiveRequiresActions(raw)) {
    return { kind: "actionable", reason: "matches a desktop or gameplay action objective" };
  }
  if (requiresExternalActionEvidence(raw)) {
    return { kind: "actionable", reason: "names an external action that requires execution evidence" };
  }

  const s = normalize(raw);
  const asked = stripAddress(s);

  // 2a. Identity, capability and small-talk questions about JARVIS itself.
  if (IDENTITY_QUESTION.test(s) || CHITCHAT.test(s)) {
    return { kind: "conversational", reason: "identity, capability or small-talk question about JARVIS itself" };
  }

  // 2b. Greeting or acknowledgement — but never if it also asks for an action
  // ("good, now open chrome" is a command, not a pleasantry).
  if ((SOCIAL_LEAD.test(asked) || GRATITUDE_LEAD.test(asked)) && !ACTION_VERB.test(asked)) {
    return { kind: "conversational", reason: "greeting or acknowledgement with no actionable request" };
  }

  // A polite interrogative with an action verb is still an instruction.
  // Explanation/knowledge questions ("Can you explain how to...?", "Do you know
  // how to...?") do not match this first-verb check and remain conversational.
  if (isPoliteActionRequest(asked) || BARE_DO_COMMAND.test(asked)) {
    return { kind: "actionable", reason: "polite or short imperative request asks JARVIS to perform an action" };
  }

  // 2c. Short remark containing no doing-verb at all.
  if (wordCount(asked) <= 5 && asked.length <= 40 && !ACTION_VERB.test(asked)) {
    return { kind: "conversational", reason: "short remark containing no actionable verb" };
  }

  // 2d. Interrogative knowledge question. Preserves the existing rule that
  // educational questions do not require effects, while an imperative that
  // merely mentions a capability still falls through to actionable.
  if (INTERROGATIVE_LEAD.test(asked)) {
    return { kind: "conversational", reason: "interrogative knowledge question rather than a command to act" };
  }

  // 3. Fail-closed default: an unrecognized imperative is actionable.
  return {
    kind: "actionable",
    reason: "request is not a recognizable conversational form, so it is treated as actionable (fail-closed)",
  };
}

/** Convenience predicate for call sites that only need the boolean. */
export function isConversationalRequest(objective: string): boolean {
  return classifyRequestIntent(objective).kind === "conversational";
}

/**
 * True when the operator is asking WHICH model or provider JARVIS is using.
 *
 * This exists because product identity and provider disclosure are different
 * obligations. JARVIS must never ADOPT a vendor identity ("I am GLM"), but when
 * the owner asks what is actually running, JARVIS must answer ACCURATELY from
 * the real configured provider metadata. A blunt text guard that rewrote every
 * vendor mention would destroy that honest disclosure, so the identity guard is
 * skipped for these questions and the Core supplies real metadata instead.
 */
const MODEL_DISCLOSURE =
  /\b(?:which|what|whose|name(?:\s+the)?)\b[^.!?\n]{0,40}\b(?:model|llm|language\s+model|provider|backend|engine|api|service|version)\b[^.!?\n]{0,30}\b(?:are\s+you|is\s+in\s+use|in\s+use|you\s+(?:use|using|run|running)|are\s+you\s+(?:using|running)|do\s+you\s+use|currently|active|routing|selected|configured)\b/i;
const MODEL_DISCLOSURE_DIRECT =
  /\b(?:which\s+model|what\s+model|which\s+provider|what\s+provider|which\s+llm|what\s+llm|which\s+backend|what\s+backend|which\s+ai\s+model|what\s+ai\s+are\s+you|which\s+version\s+are\s+you|are\s+you\s+(?:gpt|glm|claude|gemini|grok|qwen|kimi|deepseek|llama)|model\s+in\s+use|current\s+model|active\s+model|provider\s+in\s+use|who\s+made\s+you|who\s+built\s+you|who\s+developed\s+you|who\s+created\s+you)\b/i;

export function isModelDisclosureQuestion(objective: string): boolean {
  const raw = typeof objective === "string" ? objective.trim() : "";
  if (!raw || raw.length > MAX_CONVERSATIONAL_LENGTH) return false;
  const s = normalize(raw);
  return MODEL_DISCLOSURE_DIRECT.test(s) || MODEL_DISCLOSURE.test(s);
}
