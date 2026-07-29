import { useEffect, useRef, useState } from "react";
import { tpSearchUserStories } from "../../api";
import type { TpUserStory } from "../../types";

const DEBOUNCE_MS = 350;

interface UserStoryPickerProps {
  /** The chosen story, or null when nothing is linked. */
  value: TpUserStory | null;
  onChange: (story: TpUserStory | null) => void;
  /** Shown instead of results when TargetProcess is not configured. */
  disabledReason?: string;
}

/**
 * Type-to-search over TargetProcess user stories.
 *
 * Also accepts a pasted id or entity URL: the backend resolves those directly
 * rather than treating them as a name search, so pasting a link from the browser
 * just works.
 */
export function UserStoryPicker({ value, onChange, disabledReason }: UserStoryPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TpUserStory[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an earlier, slower search overwriting a later one.
  const latest = useRef(0);

  useEffect(() => {
    if (disabledReason || !query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const seq = ++latest.current;
    setSearching(true);
    const timer = setTimeout(() => {
      tpSearchUserStories(query)
        .then((found) => {
          if (seq !== latest.current) return;
          setResults(found);
          setError(found.length === 0 ? "No user stories matched." : null);
        })
        .catch((e) => seq === latest.current && setError(String(e)))
        .finally(() => seq === latest.current && setSearching(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, disabledReason]);

  if (value) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-md border border-sky-900/60 bg-sky-950/30 px-2.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-sky-300">
            #{value.id} {value.name}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {value.project_name || "unknown project"}
            {value.state_name && ` · ${value.state_name}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          className="shrink-0 text-[10px] text-slate-500 hover:text-red-400"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        value={query}
        disabled={!!disabledReason}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={disabledReason ?? "Search by name, or paste an id / entity URL…"}
        className="w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-2.5 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-600 disabled:opacity-60"
      />
      {searching && <p className="mt-1 text-[10px] text-slate-600">Searching…</p>}
      {error && !searching && <p className="mt-1 text-[10px] text-amber-500">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-[#2a3040] bg-[#0b0e14]">
          {results.map((story) => (
            <li key={story.id}>
              <button
                type="button"
                onClick={() => onChange(story)}
                className="block w-full px-2.5 py-1.5 text-left hover:bg-[#161b28]"
              >
                <span className="block truncate text-xs text-slate-200">
                  <span className="font-mono text-sky-500">#{story.id}</span> {story.name}
                </span>
                <span className="block truncate text-[10px] text-slate-600">
                  {story.project_name}
                  {story.state_name && ` · ${story.state_name}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
