/** A conservative first-step capability search for open-ended desktop tasks.
 * Read-only discovery is not permission to launch, upload, download or edit.
 * Guardian still validates and audits the generated tool request.
 */
/** Explicit ordinary-language expression of an app/tool requirement.
 * Read-only capability discovery is not authorization to install, launch,
 * upload a file or choose a program without the operator's intent.
 */
export function expressesCapabilityNeed(objective:string):boolean {
 if(typeof objective!=='string'||objective.length>250)return false;
 const s=objective.trim()
  .replace(/^(?:hey\s+)?jarvis[,!:\s]+/i,'')
  .replace(/^please\s+/i,'');
 const need=/^(?:i|we)\s+(?:(?:really\s+)?need|want|am looking for|are looking for|could use)\s+(?:an?\s+|some\s+)?(?:[a-z][a-z0-9 -]{0,85}\s+)?(?:editor|editing software|program|application|app|software|tool)(?:\s+for\s+.{2,90})?$/i;
 const recommend=/^(?:can|could|would)\s+you\s+(?:please\s+)?(?:find|recommend|suggest|pick|choose)\s+(?:me\s+)?(?:an?\s+|some\s+)?(?:[a-z][a-z0-9 -]{0,85}\s+)?(?:editor|app|program|software|tool)(?:\s+for\s+.{2,90})?$/i;
 return need.test(s)||recommend.test(s);
}
export function directCapabilityDiscovery(objective:string): {action:"tool";tool:"windows_find_capability";args:{goal:string}} | null {
  const s=objective.trim();
  if (s.length<3 || s.length>250 || /[\x00-\x1f\x7f]/.test(s)) return null;
  if (/^(?:how|why|what is|explain|describe|tell me about)\b/i.test(s)) return null;
  if (!expressesCapabilityNeed(s) &&
      !/\b(edit|editing|modify|retouch|crop|trim|fix|create|design|make|build|draw|record|produce|compile|extract|compress|merge|work on|find (?:an?|the) (?:app|program|editor)|which (?:app|program|editor))\b/i.test(s)) return null;
  return {action:"tool",tool:"windows_find_capability",args:{goal:s}};
}
