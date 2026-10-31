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

export function parseInventorySource(text: string): InventorySource | null {
  if (typeof text !== "string" || text.length > 12000 ||
      !/\b(?:inventory|stock|products?|unit\s+prices?)\b/i.test(text)) return null;
  const rows: InventoryRow[] = [];
  const seen = new Set<string>();
  INPUT_ROW.lastIndex = 0;
  for (const m of text.matchAll(INPUT_ROW)) {
    const product = m[1].trim();
    const quantity = Number(m[2]);
    const unitPaise = money(m[3] + (m[4] ? "." + m[4] : ""));
    if (!product || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        unitPaise === null || seen.has(key(product)) || rows.length >= MAX_ROWS) return null;
    const totalPaise = quantity * unitPaise;
    if (!Number.isSafeInteger(totalPaise)) return null;
    seen.add(key(product));
    rows.push({ product, quantity, unitPaise, totalPaise });
  }
  if (rows.length < 2) return null;
  return {
    rows,
    totalUnits: rows.reduce((a, x) => a + x.quantity, 0),
    totalPaise: rows.reduce((a, x) => a + x.totalPaise, 0),
  };
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
export function verifyInventoryCsv(csv: string, source: InventorySource): string | null {
  if (typeof csv !== "string" || csv.length > 65536) return "CSV missing or too large";
  const lines = csv.trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const head = lines.shift()?.replace(/^\uFEFF/, "").toLowerCase().replace(/\s+/g,"");
  if (head !== "product,quantity,unit_price_inr,total_value_inr")
    return "CSV requires exact product,quantity,unit_price_inr,total_value_inr header";
  const actual: InventoryRow[] = [];
  for (const line of lines) {
    // Conservative subset: reject unsupported quoting or extra columns
    // rather than falsely interpreting a spreadsheet containing commas.
    const cells = line.split(",");
    if (cells.length !== 4) return "CSV row malformed (exactly four unquoted columns required)";
    const [product,q,p,t] = cells.map(x=>x.trim());
    if (!product || !/^[1-9]\d{0,5}$/.test(q)) return "CSV product/quantity malformed";
    const unitPaise = decimalValue(p), totalPaise = decimalValue(t);
    if (unitPaise === null || totalPaise === null) return "CSV contains invalid monetary value";
    actual.push({product,quantity:Number(q),unitPaise,totalPaise});
  }
  return cmpRows(actual, source);
}
export function verifyInventoryReport(report: string, source: InventorySource): string | null {
  if (typeof report !== "string" || report.length > 65536) return "Report missing or too large";
  const actual: InventoryRow[]=[];
  for(const line of report.split(/\r?\n/)) {
    if(!line.includes("|")) continue;
    const cells=line.split("|").map(x=>x.trim());
    if(cells.length!==4 || !/^[1-9]\d{0,5}$/.test(cells[1]))continue;
    const unitPaise=decimalValue(cells[2]),totalPaise=decimalValue(cells[3]);
    if(unitPaise===null || totalPaise===null) return "Report has malformed product amount";
    actual.push({product:cells[0],quantity:Number(cells[1]),unitPaise,totalPaise});
  }
  const mismatch=cmpRows(actual,source);
  if(mismatch) return "report table: " + mismatch;
  const total = report.match(/^\s*TOTAL INVENTORY VALUE\s*:\s*(?:INR|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*$/im);
  const units = report.match(/^\s*Total Units\s*:\s*(\d+)\s*$/im);
  if(!total || !units) return "Report lacks total inventory value or total units";
  if(decimalValue(total[1])!==source.totalPaise) return "Report grand total differs from original data";
  if(Number(units[1])!==source.totalUnits) return "Report unit count differs from original data";
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
