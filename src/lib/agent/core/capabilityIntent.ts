/** A conservative first-step capability search for open-ended desktop tasks.
 * Read-only discovery is not permission to launch, upload, download or edit.
 * Guardian still validates and audits the generated tool request.
 */
export function directCapabilityDiscovery(objective:string): {action:"tool";tool:"windows_find_capability";args:{goal:string}} | null {
  const s=objective.trim();
  if (s.length<3 || s.length>250 || /[\x00-\x1f\x7f]/.test(s)) return null;
  if (/^(?:how|why|what is|explain|describe|tell me about)\b/i.test(s)) return null;
  if (!/\b(edit|editing|modify|retouch|crop|trim|fix|create|design|make|build|draw|record|produce|compile|extract|compress|merge|work on|find (?:an?|the) (?:app|program|editor)|which (?:app|program|editor))\b/i.test(s)) return null;
  return {action:"tool",tool:"windows_find_capability",args:{goal:s}};
}
