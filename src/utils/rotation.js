// Convert a date to a period index that advances each day/week/month.
function baseIndexForPeriod(chore, date) {
  const d = new Date(date);
  const epochDays = Math.floor(d.getTime() / 86400000);

  // pseudo-ISO week number (consistent within a year)
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d - jan1) / 86400000) + 1;
  const week = Math.ceil((dayOfYear + (jan1.getDay() || 7) - 1) / 7);

  const monthIndex = d.getFullYear() * 12 + d.getMonth();

  if (chore.frequency === 'daily') return epochDays;
  if (chore.frequency === 'weekly') return week;
  return monthIndex; // monthly
}

/** Legacy (kept for reference) */
export function assignedUserFor(chore, users, date) {
  const base = baseIndexForPeriod(chore, date);
  return base % users.length;
}

/** Balanced: base period index + per-chore offset (rank within frequency) */
export function assignedUserForBalanced(chore, users, date, offset = 0) {
  const base = baseIndexForPeriod(chore, date);
  return (base + (offset % users.length)) % users.length;
}

/**
 * Balanced WITH EXEMPTIONS.
 * - `allUsers`: full user list (in display order)
 * - `eligibleUsers`: filtered users not exempt from this chore
 * Returns the **index within eligibleUsers** (not allUsers).
 * If no eligible users, returns -1.
 */
export function assignedUserForBalancedWithExempt(chore, allUsers, eligibleUsers, date, offset = 0) {
  if (!eligibleUsers || eligibleUsers.length === 0) return -1;
  const base = baseIndexForPeriod(chore, date);
  const idx = (base + (offset % eligibleUsers.length)) % eligibleUsers.length;
  return idx; // index within eligibleUsers
}

/** Period key to store completion state per period */
export function periodKey(state, choreId, date) {
  const chore = state.chores.find(c => c.id === choreId);
  if (!chore) return 'unknown';

  const d = new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();

  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d - jan1) / 86400000) + 1;
  const week = Math.ceil((dayOfYear + (jan1.getDay() || 7) - 1) / 7);

  if (chore.frequency === 'daily') return `D:${y}-${m}-${day}`;
  if (chore.frequency === 'weekly') return `W:${y}-W${week}`;
  return `M:${y}-${m}`;
}
