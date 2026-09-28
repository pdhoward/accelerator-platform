/** Pure metric helpers for the Bridge and Metrics pages. */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Share of changes approved without a send-back, 0–100. */
export function firstPassRate(changes: { sendBacks: number }[]): number {
  if (changes.length === 0) return 100;
  return Math.round((changes.filter((c) => c.sendBacks === 0).length / changes.length) * 100);
}

/**
 * Backlog half-life: days until half of today's open requests are done, at the
 * recent completion rate (requests closed per day).
 */
export function backlogHalfLifeDays(open: number, closedPerDay: number): number | null {
  if (open === 0) return 0;
  if (closedPerDay <= 0) return null;
  return Math.ceil(open / 2 / closedPerDay);
}

/** Spend as a share of budget, for meters and the Spend gauge. */
export function budgetUsed(spentUsd: number, limitUsd: number): number {
  if (limitUsd <= 0) return 0;
  return Math.min(100, Math.round((spentUsd / limitUsd) * 100));
}
