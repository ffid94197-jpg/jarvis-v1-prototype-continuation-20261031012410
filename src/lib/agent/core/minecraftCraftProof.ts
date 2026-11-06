export interface NativeCraftReceiptExpectation {
  item: string;
  count: number;
  inventoryBefore: number;
  inventoryAfter: number;
}

/**
 * A native PlayerEngine craft is complete only when the SAME task reports:
 * - the exact output and requested quantity,
 * - a fresh inventory increase, and
 * - a server-side Stats.CRAFTED delta for that output.
 *
 * Inventory possession alone is never a craft-method proof.
 */
export function verifyNativeCraftReceipt(
  receipt: unknown,
  expected: NativeCraftReceiptExpectation,
): boolean {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const r = receipt as Record<string, unknown>;
  const m = r.milestones && typeof r.milestones === "object" && !Array.isArray(r.milestones)
    ? r.milestones as Record<string, unknown> : null;
  if (!m) return false;
  const {item,count,inventoryBefore,inventoryAfter}=expected;
  if (!item || !Number.isSafeInteger(count) || count<1 || count>16 ||
      !Number.isSafeInteger(inventoryBefore) || inventoryBefore<0 ||
      !Number.isSafeInteger(inventoryAfter) || inventoryAfter<0) return false;
  const before=m.initialCount, after=m.currentCount;
  const craftProofCount=m.craftProofCount;
  const crafted=m.craftedCount;
  if (r.goal!=="craft" || r.status!=="complete" ||
      r.item!==item || r.targetCount!==count || m.craftDone!==true ||
      typeof before!=="number" || !Number.isSafeInteger(before) || before!==inventoryBefore ||
      typeof after!=="number" || !Number.isSafeInteger(after) || after!==inventoryAfter ||
      inventoryAfter-inventoryBefore<count ||
      typeof craftProofCount!=="number" || !Number.isSafeInteger(craftProofCount) ||
      craftProofCount<count ||
      typeof crafted!=="number" || !Number.isSafeInteger(crafted) ||
      crafted!==craftProofCount) return false;
  return true;
}
