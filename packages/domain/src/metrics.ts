/** Pure metric helpers (the Cockpit Dial and the Account page). */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Spend as a share of budget, for meters and the Spend gauge. */
export function budgetUsed(spentUsd: number, limitUsd: number): number {
  if (limitUsd <= 0) return 0;
  return Math.min(100, Math.round((spentUsd / limitUsd) * 100));
}
