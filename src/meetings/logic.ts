// Pure helpers for meeting tracking.

/** Minutes between two ISO instants (never negative). */
export function minutesBetween(start: string, end: string): number {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 60000);
}

/** Hours to log: at least the minimum, rounded up to the step. */
export function billableHours(minutes: number, minMinutes: number, stepMinutes: number): number {
  const step = Math.max(1, stepMinutes);
  const rounded = Math.ceil(minutes / step - 1e-9) * step;
  return Math.max(rounded, minMinutes) / 60;
}

/** "14:05" in local time. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "12:04" or "1:02:09" for a running timer. */
export function elapsed(fromIso: string, now: number): string {
  const total = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

const KNOWN_APPS: Record<string, string> = {
  "com.microsoft.teams2": "Teams",
  "com.microsoft.teams": "Teams",
  "us.zoom.xos": "Zoom",
  "com.google.Chrome": "Chrome",
  "com.apple.Safari": "Safari",
  "org.mozilla.firefox": "Firefox",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.apple.FaceTime": "FaceTime",
  "com.hnc.Discord": "Discord",
  "com.cisco.webexmeetingsapp": "Webex",
  "company.thebrowser.Browser": "Arc",
  "com.microsoft.edgemac": "Edge",
};

/** A readable name for an app bundle id ("Teams", or the id's last part). */
export function appName(bundleId: string): string {
  return KNOWN_APPS[bundleId] ?? bundleId.split(".").pop() ?? bundleId;
}

export function appNames(ids: string[]): string {
  return [...new Set(ids.map(appName))].join(", ");
}

/** The shortcut whose name matches a scheduled meeting's title, if any. */
export function matchShortcut<T extends { name: string }>(title: string | null | undefined, shortcuts: T[]): T | undefined {
  const t = title?.trim().toLowerCase();
  if (!t || t.length < 3) return undefined;
  return shortcuts.find((s) => {
    const n = s.name.trim().toLowerCase();
    return n.length > 2 && (t.includes(n) || n.includes(t));
  });
}

/** Parse what the user typed in the hours box; null when it isn't usable. */
export function parseHours(text: string): number | null {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) && n > 0 && n <= 12 ? Math.round(n * 100) / 100 : null;
}
