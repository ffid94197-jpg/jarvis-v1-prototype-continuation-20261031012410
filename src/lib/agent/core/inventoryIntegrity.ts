/**
 * Narrow deterministic inventory data-fidelity contract.
 * Source: the operator's own request (or a same-owner, explicitly recalled
 * original objective). Never derive truth from model output or a report.
 * Amounts are integer paise; unknown formats remain UNVERIFIED, not guessed.
 */
export interface InventoryRow {
  product: string;
  quantity: number;
  unitPaise: number;
  totalPaise: number;
}
export interface InventorySource {
  rows: InventoryRow[];
  totalUnits: number;
  totalPaise: number;
}
function money(raw: string): number | null {
  const s = raw.replace(/[,₹$\s]/g, "");
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2,"0"));
  return Number.isSafeInteger(n) ? n : null;
}
function key(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, " "); }
const INPUT_ROW = /(?:^|[,;\n])\s*[-*•]?\s*(?:inventory\s*:\s*)?([A-Za-z][A-Za-z0-9 _-]{0,44}?)\s*:?\s*(\d{1,5})\s*(?:units?\s*)?(?:[x×*]\s*|at\s*|@\s*)[₹$]?\s*(\d{1,3}(?:,\d{3})*|\d{1,8})(?:\.(\d{1,2}))?(?=\s*(?:each\b|[,;\r\n]|$|[.!?]\s*$))/gim;
const MAX_ROWS = 40;

/** Source-bound, fail-closed inventory parser; never trusts generated output. */
function buildSource(rows:InventoryRow[],original:string):InventorySource|null{
 if(rows.length<2||rows.length>MAX_ROWS)return null;
 const seen=new Set<string>();let totalUnits=0,totalPaise=0;
 for(const row of rows){
  const k=key(row.product);
  if(!k||/^(total|grand total|subtotal|sum)$/i.test(k)||seen.has(k)
    ||!Number.isSafeInteger(row.quantity)||row.quantity<=0
    ||!Number.isSafeInteger(row.unitPaise)||row.unitPaise<0
    ||!Number.isSafeInteger(row.totalPaise)||row.totalPaise!==row.quantity*row.unitPaise)return null;
  seen.add(k);totalUnits+=row.quantity;totalPaise+=row.totalPaise;
 }
 if(!Number.isSafeInteger(totalUnits)||!Number.isSafeInteger(totalPaise))return null;
 const declared=original.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:distinct\s+)?products?\b/i);
 if(declared){
  const numberWords:Record<string,number>={two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const v=/^\d+$/.test(declared[1])?Number(declared[1]):numberWords[declared[1].toLowerCase()];
  if(v!==rows.length)return null;
 }
 return {rows,totalUnits,totalPaise};
}
export function parseInventorySource(text:string):InventorySource|null{
 if(typeof text!=="string"||text.length>12000||
   !/\b(?:inventory|stock|products?|unit\s+prices?)\b/i.test(text))return null;
 // NEXUS sometimes flattens bullets into one physical line.
 const normalized=text.replace(/\*\*/g,"").replace(
  /(?:^|[ \t])[-*]\s+(?=[A-Za-z][A-Za-z0-9 _-]{0,44}\s*:\s*[-+]?\d{1,5}\b)/g,"\n- ");
 const pattern=/^\s*(?:[-*]\s*|\d{1,2}[.)]\s*)?([A-Za-z][A-Za-z0-9 _-]{0,44}?)(?::\s*|\s+)([1-9]\d{0,4})\s*(?:units?|pcs?|pieces?)?\s*(?:[x×*]|at|@)\s*(?:₹|\$|INR\s*|Rs\.?\s*)?(\d{1,3}(?:,\d{3})*|\d{1,8})(?:\.(\d{1,2}))?\s*(?:each|per\s+unit)?\s*$/i;
 const candidate=/^\s*(?:[-*]\s*|\d{1,2}[.)]\s*)?[A-Za-z][A-Za-z0-9 _-]{0,44}\s*:\s*[-+]?\d{1,5}\s*(?:units?|pcs?|pieces?)?\s*(?:[x×*]|at|@)/i;
 const rows:InventoryRow[]=[];let matches=0;
 for(const raw of normalized.split(/\r?\n/)){
  const line=raw.trim();if(!candidate.test(line))continue;matches++;
  const m=line.match(pattern);if(!m)return null;
  const quantity=Number(m[2]),unitPaise=money(m[3]+(m[4]?"."+m[4]:""));
  if(!Number.isSafeInteger(quantity)||quantity<=0||unitPaise===null)return null;
  rows.push({product:m[1].trim(),quantity,unitPaise,totalPaise:quantity*unitPaise});
  if(rows.length>MAX_ROWS)return null;
 }
 if(matches)return buildSource(rows,text);
 const legacy:InventoryRow[]=[];INPUT_ROW.lastIndex=0;
 for(const m of text.matchAll(INPUT_ROW)){
  const quantity=Number(m[2]),unitPaise=money(m[3]+(m[4]?"."+m[4]:""));
  if(!Number.isSafeInteger(quantity)||quantity<=0||unitPaise===null)return null;
  legacy.push({product:m[1].trim(),quantity,unitPaise,totalPaise:quantity*unitPaise});
  if(legacy.length>MAX_ROWS)return null;
 }
 return buildSource(legacy,text);
}
function cmpRows(actual: InventoryRow[], source: InventorySource): string | null {
  if (actual.length !== source.rows.length) return "expected " + source.rows.length + " product rows, found " + actual.length;
  const expected = new Map(source.rows.map(x=>[key(x.product), x]));
  const found = new Set<string>();
  for (const row of actual) {
    const k = key(row.product), base = expected.get(k);
    if (found.has(k)) return "duplicate product " + row.product;
    found.add(k);
    if (!base) return "unexpected product " + row.product;
    if (row.quantity !== base.quantity) return row.product + ": quantity does not match original request";
    if (row.unitPaise !== base.unitPaise) return row.product + ": unit price does not match original request";
    if (row.totalPaise !== base.totalPaise || row.totalPaise !== row.quantity * row.unitPaise)
      return row.product + ": line total does not equal quantity × original unit price";
  }
  return null;
}
function decimalValue(raw: string): number | null {return money(raw.trim());}
export function verifyInventoryCsv(csv:string,source:InventorySource):string|null{
 if(typeof csv!=="string"||csv.length>65536)return "CSV missing or too large";
 const lines=csv.trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 const header=lines.shift()?.replace(/^\uFEFF/,"").toLowerCase().replace(/\s+/g,"");
 if(!["product,quantity,unit_price_inr,total_value_inr","product,quantity,unit_price,total"].includes(header??""))
   return "CSV header invalid";
 const rows:InventoryRow[]=[];let seenTotal=false;
 for(const line of lines){
  const parts=line.split(",").map(s=>s.trim());if(parts.length!==4)return "CSV row malformed";
  const [product,q,p,t]=parts;
  if(key(product)==="total"){
   if(seenTotal||p!==""||!/^\d+$/.test(q)||Number(q)!==source.totalUnits||money(t)!==source.totalPaise)
    return "CSV TOTAL row mismatch";
   seenTotal=true;continue;
  }
  if(seenTotal)return "CSV product after TOTAL";
  if(!product||!/^[1-9]\d{0,5}$/.test(q))return "CSV product/quantity invalid";
  const unitPaise=money(p),totalPaise=money(t);
  if(unitPaise===null||totalPaise===null)return "CSV invalid monetary value";
  rows.push({product,quantity:Number(q),unitPaise,totalPaise});
 }
 return cmpRows(rows,source);
}
export function verifyInventoryReport(report:string,source:InventorySource):string|null{
 if(typeof report!=="string"||report.length>65536)return "Report absent or too large";
 const rows:InventoryRow[]=[];
 for(const line of report.split(/\r?\n/)){
  if(!line.includes("|"))continue;
  const c=line.split("|").map(s=>s.trim());
  if(c.length!==4||!/^[1-9]\d{0,5}$/.test(c[1]))continue;
  const unitPaise=money(c[2]),totalPaise=money(c[3]);
  if(unitPaise===null||totalPaise===null)return "Report invalid monetary value";
  rows.push({product:c[0],quantity:Number(c[1]),unitPaise,totalPaise});
 }
 if(rows.length===0){
  const readable=/^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]{0,44}?)\s*:\s*([1-9]\d{0,5})\s*units?\s*[x×*]\s*₹?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*=\s*₹?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*$/gim;
  for(const m of report.matchAll(readable)){
   const unitPaise=money(m[3]),totalPaise=money(m[4]);
   if(unitPaise===null||totalPaise===null)return "Report invalid readable amount";
   rows.push({product:m[1].trim(),quantity:Number(m[2]),unitPaise,totalPaise});
  }
 }
 const mismatch=cmpRows(rows,source);if(mismatch)return "Report products: "+mismatch;
 const grand=report.match(/^\s*(?:TOTAL INVENTORY VALUE|GRAND TOTAL)\s*[:=]\s*(.*?)\s*$/im);
 const units=report.match(/^\s*TOTAL UNITS\s*[:=]\s*(.*?)\s*$/im);
 if(!grand||!units)return "Report missing grand total or total units";
 if(/-\s*(?:₹|INR\s*)?\d[\d,]*(?:\.\d{1,2})?\s*$/i.test(grand[1]))return "Negative report total invalid";
 const total=grand[1].match(/(?:₹|INR\s*)?([+-]?\d[\d,]*(?:\.\d{1,2})?)\s*$/i)?.[1];
 const count=units[1].match(/(\d+)\s*$/)?.[1];
 if(!total||money(total)!==source.totalPaise)return "Report grand total mismatch";
 if(!count||Number(count)!==source.totalUnits)return "Report total units mismatch";
 return null;
}
export type InventoryArtifactKind="csv"|"report";
export function inventoryArtifactKind(path: string): InventoryArtifactKind | null {
  if(typeof path!=="string" || !/(?:inventory|stock|products?|report|summary)/i.test(path))return null;
  if(/\.csv$/i.test(path))return "csv";
  if(/\.(?:txt|md)$/i.test(path))return "report";
  return null;
}
export function validateInventoryDraft(path: unknown, content: unknown, source: InventorySource | null): string | null {
  if(!source || typeof path!=="string" || typeof content!=="string")return null;
  const kind=inventoryArtifactKind(path);
  if(!kind)return null;
  const issue=kind==="csv"?verifyInventoryCsv(content,source):verifyInventoryReport(content,source);
  return issue ? "INVENTORY_SOURCE_MISMATCH: " + issue +
    ". Use only original owner-supplied quantities and prices; recalculate every row and both totals." : null;
}
