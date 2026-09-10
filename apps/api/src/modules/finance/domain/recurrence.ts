/**
 * When a recurring expense falls due — PRD F-AD-71.
 *
 * Pure, because the awkward case is not obvious and needs to be pinned down: a monthly
 * expense starting on the 31st has to land on the 28th in February. Skipping the month
 * loses the rent, and spilling into March files it under the wrong period.
 */

export type Recurrence = 'weekly' | 'monthly' | 'yearly';

/**
 * Every date a series falls on, from its start up to a cut-off.
 *
 * Inclusive of the start date itself; the caller decides whether the original row
 * already covers it.
 */
export function occurrencesBetween(
  start: Date,
  recurrence: Recurrence,
  until: Date,
  endsAt: Date | null = null,
): Date[] {
  const dates: Date[] = [];
  const limit = endsAt && endsAt < until ? endsAt : until;
  const dayOfMonth = start.getUTCDate();

  // A bound rather than a condition: a corrupt row must not spin forever.
  for (let index = 0; index < 600; index += 1) {
    const date = advance(start, recurrence, index, dayOfMonth);
    if (date > limit) break;
    dates.push(date);
  }

  return dates;
}

/** The nth occurrence after a start date. */
export function advance(
  start: Date,
  recurrence: Recurrence,
  steps: number,
  dayOfMonth = start.getUTCDate(),
): Date {
  if (recurrence === 'weekly') {
    return new Date(start.getTime() + steps * 7 * 86_400_000);
  }

  const months = recurrence === 'yearly' ? steps * 12 : steps;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;

  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay)));
}
