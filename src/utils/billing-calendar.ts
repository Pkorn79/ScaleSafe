/** Calendar dates use UTC throughout billing; never let the server timezone shift them. */
export function billingDate(value: string | Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid billing date');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && date.toISOString().slice(0, 10) !== value) throw new Error('Invalid billing date');
  return date;
}

export function nextBillingDate(frequency: string | null | undefined, from: Date = new Date(), anchorDay?: number): string {
  const next = billingDate(from);
  const dayIntervals: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, bi_weekly: 14 };
  const days = dayIntervals[frequency || ''];
  if (days) {
    next.setUTCDate(next.getUTCDate() + days);
  } else {
    const months = frequency === 'quarterly' ? 3 : frequency === 'annual' ? 12 : 1;
    const day = anchorDay ?? next.getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('Invalid billing anchor day');
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + months);
    const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, last));
  }
  return next.toISOString().slice(0, 10);
}
