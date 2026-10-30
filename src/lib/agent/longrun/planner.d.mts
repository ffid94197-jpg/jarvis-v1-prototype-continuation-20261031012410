export interface LongGoal { goal: string; category: string; strategies: string[] }
export function categoryOf(goal: string): string;
export function validatePlan(plan: {goal: string; strategies?: string[]}[]): LongGoal[];
export function makePlan(objective: string, subgoals?: Array<string | {goal:string;strategies?:string[]}>): LongGoal[];
export function taskPrompt(plan: LongGoal[], stepIndex: number, routeIndex: number, originalObjective: string): string;
export function nextAfterOutcome(plan: LongGoal[], stepIndex: number, routeIndex: number, outcome: string): {kind:string; stepIndex:number;routeIndex:number;reason?:string};
export function nextSchedule(mode: string, scheduledAt: Date | string, intervalMinutes: number, now?: Date): Date | null;
export function findBoundedPath(start:string,target:string,edges:Array<{id:string;from:string;to:string;cost:number}>,excludedIds?:string[],expansionCap?:number):{found:boolean;cost:number|null;edges:string[];expanded:number};
export function nextStrategyPath(goal:LongGoal,failedRouteIndex:number):number|null;
