// Calendar helpers on `YYYY-MM-DD` strings. Everything is done in UTC so a
// day never shifts with the viewer's timezone or a DST change — the strings
// already carry the TargetProcess calendar day.

const DAY_MS = 86_400_000;

export function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day in the local timezone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const day = toDate(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Monday-first weeks covering the whole month that contains `iso`. */
export function monthGrid(iso: string): string[][] {
  const first = `${iso.slice(0, 7)}-01`;
  const start = startOfWeek(first);
  const nextMonth = addDays(first, 32).slice(0, 7);
  const weeks: string[][] = [];
  for (let weekStart = start; weekStart < `${nextMonth}-01`; weekStart = addDays(weekStart, 7)) {
    weeks.push(eachDay(weekStart, addDays(weekStart, 6)));
  }
  return weeks;
}

export function shiftMonth(iso: string, months: number): string {
  const d = toDate(`${iso.slice(0, 7)}-01`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d);
}

/** The working day before `iso`, skipping non-working weekdays. */
export function previousWorkingDay(iso: string, workingDays: number[]): string {
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
  let d = addDays(iso, -1);
  for (let i = 0; i < 7 && !days.includes(isoWeekday(d)); i++) d = addDays(d, -1);
  return d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatDay(iso: string): string {
  const d = toDate(iso);
  return `${WEEKDAYS[isoWeekday(iso) - 1]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatMonth(iso: string): string {
  const d = toDate(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export { WEEKDAYS };
