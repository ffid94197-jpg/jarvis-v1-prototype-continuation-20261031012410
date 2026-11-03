/** Bounded strategy graph for long-running desktop tasks. No model calls and no permissions granted. */
export const MAX_GOALS = 8;
export const MAX_STRATEGIES = 4;
const paths = {
  desktop: [
    'Inspect the native Windows UI Automation tree and interact with element IDs; verify observed UI state.',
    'Inspect the foreground window and screenshot, use a small number of desktop inputs, then verify with a fresh observation.',
    'Discover the installed application and relaunch or focus its native window, then inspect and verify again.',
  ],
  browser: [
    'Use the already-installed default Windows browser and native UI Automation; verify the page state.',
    'Observe the visible browser window and control it with Windows mouse and keyboard; verify the resulting page.',
    'If permitted, use browser DOM tools as a fallback; do not claim this is native desktop control.',
  ],
  minecraft: [
    'Inspect the Minecraft LAN bot status and coordinates before issuing a bounded movement or Pathfinder action.',
    'Recheck the LAN port and bot connection; use the Mineflayer companion if connected, then verify position/status.',
  ],
  files: [
    'Inspect current files before editing; use workspace filesystem tools and read back the exact result.',
    'Find a safe workspace path, use an alternate permitted filesystem operation, then independently read back.',
  ],
  general: [
    'Observe existing state, choose one authorized tool action at a time, and independently verify the result.',
    'Re-observe the environment, make a new plan from the observed failure, then attempt a different authorized path.',
  ],
};
export function categoryOf(goal) {
  if (/minecraft|mineflayer|lan world|creeper|crafting|game player/i.test(goal)) return 'minecraft';
  if (/browser|chrome|edge|youtube|website|web page|search online/i.test(goal)) return 'browser';
  if (/notepad|windows|desktop|mouse|keyboard|screen|settings|\bapps?\b|\bapplications?\b/i.test(goal)) return 'desktop';
  if (/\bfile\b|folder|directory|save|document|csv|report/i.test(goal)) return 'files';
  return 'general';
}
export function validatePlan(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_GOALS) throw Error('Plan needs 1–8 subgoals.');
  return input.map((part) => {
    if (!part || typeof part.goal !== 'string' || !part.goal.trim() || part.goal.length > 1200) throw Error('Invalid subgoal.');
    const category = categoryOf(part.goal);
    const strategies = Array.isArray(part.strategies) && part.strategies.length ? part.strategies : paths[category];
    if (strategies.length > MAX_STRATEGIES || strategies.length < 1 || strategies.some(s => typeof s !== 'string' || !s.trim() || s.length > 600)) throw Error('Invalid strategy alternatives.');
    return { goal: part.goal.trim(), category, strategies: [...strategies] };
  });
}
export function makePlan(objective, subgoals) {
  if (typeof objective !== 'string' || !objective.trim() || objective.length > 2000) throw Error('Objective must be 1–2000 characters.');
  const goals = subgoals?.length ? subgoals.map(goal => typeof goal === 'string' ? {goal} : goal) : [{goal: objective}];
  return validatePlan(goals);
}
export function taskPrompt(plan, stepIndex, routeIndex, originalObjective) {
  const current = plan[stepIndex];
  if (!current || !current.strategies[routeIndex]) throw Error('No eligible alternative strategy.');
  return `LONG-RUN JARVIS ROUTINE — SUBGOAL ${stepIndex + 1}/${plan.length}\nOriginal objective: ${originalObjective}\nCurrent subgoal: ${current.goal}\nPreferred problem-solving path ${routeIndex + 1}/${current.strategies.length}: ${current.strategies[routeIndex]}\nYou must observe, act, verify, and report actual evidence. Never pretend that an attempted action succeeded. Do not repeat denied or unknown effects. Guardian and operator cancellation remain authoritative.`;
}
export function nextAfterOutcome(plan, stepIndex, routeIndex, outcome) {
  if (!plan[stepIndex]) throw Error('Invalid planner state.');
  if (outcome === 'completed' || outcome === 'verified') {
    return stepIndex + 1 < plan.length ? {kind:'advance', stepIndex:stepIndex+1, routeIndex:0} : {kind:'cycle_complete',stepIndex:0,routeIndex:0};
  }
  if (['denied','effect_unknown','cancelled','unsafe_interrupted'].includes(outcome)) return {kind:'blocked',reason:outcome,stepIndex,routeIndex};
  if (outcome === 'failed' || outcome === 'partial' || outcome === 'watchdog_pause') {
    const next=nextStrategyPath(plan[stepIndex],routeIndex);
    if (next !== null) return {kind:'retry_alternative',stepIndex,routeIndex:next};
    return {kind:'blocked',reason:'all_strategies_exhausted',stepIndex,routeIndex};
  }
  return {kind:'hold',stepIndex,routeIndex};
}
export function nextSchedule(mode, scheduledAt, intervalMinutes, now = new Date()) {
  if (mode === 'once') return null;
  if (mode !== 'interval' || !Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080) throw Error('Interval must be 5–10080 minutes.');
  // Catch up without replaying every missed period; one run at a time.
  const delta=intervalMinutes*60000, origin=+new Date(scheduledAt), current=+new Date(now);
  if (!Number.isFinite(origin) || !Number.isFinite(current)) throw Error('Invalid schedule timestamp.');
  // A future first run must not be skipped before it becomes due.
  if (current < origin) return new Date(origin);
  const next=origin + (Math.floor((current-origin)/delta)+1)*delta;
  if (!Number.isFinite(next)) throw Error('Schedule exceeds valid timestamp range.');
  return new Date(next);
}

/** Cost-based pathfinding for a bounded, operator-visible strategy graph.
 * Edges have positive costs and stable IDs; visited-state budget prevents
 * malformed cyclic problem graphs from hanging the scheduler.
 */
export function findBoundedPath(start, target, edges, excludedIds = [], expansionCap = 512) {
  if (typeof start !== 'string' || typeof target !== 'string' || !Array.isArray(edges) || edges.length > 128) throw Error('Invalid search graph.');
  const banned = new Set(excludedIds);
  const best = new Map([[start,0]]);
  const queue = [{node:start,cost:0,path:[]}];
  let expanded=0;
  while(queue.length && expanded++ < expansionCap){
    queue.sort((a,b)=>a.cost-b.cost || a.node.localeCompare(b.node));
    const item=queue.shift();
    if(item.cost!==best.get(item.node))continue;
    if(item.node===target)return {found:true,cost:item.cost,edges:item.path,expanded};
    for(const edge of edges){
      if(edge.from!==item.node || banned.has(edge.id) || !Number.isFinite(edge.cost) || edge.cost<=0)continue;
      const cost=item.cost+edge.cost;
      if(cost < (best.get(edge.to)??Infinity)){
        best.set(edge.to,cost); queue.push({node:edge.to,cost,path:[...item.path,edge.id]});
      }
    }
  }
  return {found:false,cost:null,edges:[],expanded};
}
/** A failed strategy is a removed edge. Automatically find the lowest-cost
 * available alternative rather than retrying the failed action indefinitely.
 */
export function nextStrategyPath(goal, failedRouteIndex) {
  const edges=[];
  goal.strategies.forEach((_,i)=>{edges.push({id:`strategy:${i}`,from:'start',to:`route:${i}`,cost:1+i*0.01});edges.push({id:`verified:${i}`,from:`route:${i}`,to:'goal',cost:1});});
  const banned=Array.from({length:failedRouteIndex+1},(_,i)=>`strategy:${i}`);
  const route=findBoundedPath('start','goal',edges,banned);
  const selected=route.found?Number(route.edges[0]?.split(':')[1]):-1;
  return Number.isInteger(selected) && selected>=0?selected:null;
}

/** LangGraph-inspired checkpoint admissibility on JARVIS's EXISTING journal.
 * There is no second graph executor or hidden re-run. This validates that the
 * result being advanced belongs to the exact persisted routine attempt/cursor.
 */
export function advanceFromPersistedCheckpoint(plan, cursor, attempt) {
  const good = v => typeof v==='string' && /^[A-Za-z0-9_-]{8,100}$/.test(v);
  if (!Array.isArray(plan) || !plan.length || !cursor || !attempt ||
      !good(cursor.taskId) || !good(cursor.routineId) || attempt.taskId!==cursor.taskId ||
      attempt.routineId!==cursor.routineId ||
      !Number.isInteger(cursor.stepIndex) || !Number.isInteger(cursor.routeIndex) ||
      !Number.isInteger(attempt.stepIndex) || !Number.isInteger(attempt.routeIndex) ||
      attempt.stepIndex!==cursor.stepIndex || attempt.routeIndex!==cursor.routeIndex ||
      !plan[cursor.stepIndex]?.strategies?.[cursor.routeIndex] ||
      attempt.outcome!==cursor.outcome) {
    return {kind:'blocked',reason:'persisted_checkpoint_mismatch'};
  }
  // The DB attempt status and task status must agree. A model statement,
  // successful tool dispatch or stale state alone cannot advance the cursor.
  return nextAfterOutcome(plan,cursor.stepIndex,cursor.routeIndex,cursor.outcome);
}
