// Logged time is decimal hours in TargetProcess (0.5 = 30 minutes, 1.25 =
// 1 hour 15 minutes). Sums are kept to the minute and shown as hours and
// minutes, so 2.25 never turns into a misleading "2.3h".

/** Round decimal hours to the nearest minute, dropping float noise. */
export function roundHours(hours: number): number {
  return Math.round(hours * 60) / 60;
}

/** `8.5` → `8h 30m`, `0.25` → `15m`, `2` → `2h`, `0` → `0h`. */
export function formatHours(hours: number): string {
  const sign = hours < 0 ? "−" : "";
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0 && m === 0) return "0h";
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}
