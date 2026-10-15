// Ranking for the palette: every query word must appear somewhere; entries
// whose label starts with (or contains) the query rank first.

interface Searchable {
  label: string;
  detail?: string;
  group?: string;
  keywords?: string;
}

export function rankEntries<T extends Searchable>(entries: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/[\s/]+/).filter(Boolean);
  if (words.length === 0) return entries;
  const scored: { entry: T; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = entry.label.toLowerCase();
    const haystack = `${label} ${entry.detail ?? ""} ${entry.group ?? ""} ${entry.keywords ?? ""}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return;
    const joined = words.join(" ");
    const score = label === joined ? 0 : label.startsWith(words[0]) ? 1 : label.includes(words[0]) ? 2 : 3;
    scored.push({ entry, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.entry);
}
