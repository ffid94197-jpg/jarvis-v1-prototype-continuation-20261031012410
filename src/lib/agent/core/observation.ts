/** Turn actual tool receipts into bounded, syntactically valid JSON for the planner.
 * Never truncate raw JSON mid-character or hide status fields. The companion
 * accessibility tree can contain far more than the old 2600-character limit.
 */
export interface PlannerReceipt {ok:boolean;tool?:string;evidence?:string;error?:string;detail?:Record<string,unknown>}
function reduce(value:unknown, depth:number, arrays:number, strings:number):unknown {
  if (typeof value === "string") return value.length>strings ? value.slice(0,strings)+"…" : value;
  if (value===null || typeof value !== "object") return value;
  if (depth>=7) return "(nested data omitted)";
  if (Array.isArray(value)) return value.slice(0,arrays).map(v=>reduce(v,depth+1,arrays,strings));
  const record=value as Record<string,unknown>;
  return Object.fromEntries(Object.entries(record).slice(0,48).map(([k,v])=>[k,reduce(v,depth+1,arrays,strings)]));
}
export function compactToolObservation(r:PlannerReceipt, cap=4600):string {
  const budget=Math.min(9000,Math.max(500,Math.floor(cap)));
  const base={ok:r.ok,tool:r.tool,error:r.error,detail:r.detail,evidence:r.evidence};
  let content=JSON.stringify(base);
  if(content.length<=budget)return content;
  for(const limit of [[24,280],[16,200],[10,160],[5,120],[2,80]] as const){
    content=JSON.stringify(reduce(base,0,limit[0],limit[1]));
    if(content.length<=budget)return content;
  }
  // Even an unusually large tool observation must remain valid JSON and
  // never claim more than what the executor observed.
  content=JSON.stringify({ok:r.ok,tool:r.tool,error:r.error?.slice(0,180),
    evidence:"large structured result omitted; repeat a narrower observation",
    truncated:true,detailKeys:Object.keys(r.detail??{}).slice(0,20)});
  return content.length<=budget?content:JSON.stringify({ok:r.ok,truncated:true});
}
