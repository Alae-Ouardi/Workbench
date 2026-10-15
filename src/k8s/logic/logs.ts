// Log viewer helpers: level detection for colouring, filtering, and keeping
// the buffer bounded.

export type LogLevel = "error" | "warn" | "info" | "debug" | null;

export const MAX_LOG_LINES = 20_000;

const LEVELS: [LogLevel, RegExp][] = [
  ["error", /\b(ERROR|ERR|FATAL|CRITICAL|PANIC|Exception|Traceback)\b|"level":\s*"(error|fatal|critical)"|level=(error|fatal)/i],
  ["warn", /\b(WARN|WARNING)\b|"level":\s*"warn(ing)?"|level=warn/i],
  ["debug", /\b(DEBUG|TRACE)\b|"level":\s*"(debug|trace)"|level=(debug|trace)/i],
  ["info", /\bINFO\b|"level":\s*"info"|level=info/i],
];

export function levelOf(line: string): LogLevel {
  const head = line.length > 400 ? line.slice(0, 400) : line;
  for (const [level, pattern] of LEVELS) if (pattern.test(head)) return level;
  return null;
}

export interface LogFilter {
  text: string;
  regex: boolean;
  /** Only lines at or above this level. */
  minLevel: "all" | "warn" | "error";
}

/** Compile the filter once; returns null for an invalid regex. */
export function compileFilter(filter: LogFilter): ((line: string) => boolean) | null {
  const text = filter.text.trim();
  let match: (line: string) => boolean = () => true;
  if (text) {
    if (filter.regex) {
      try {
        const re = new RegExp(text, "i");
        match = (line) => re.test(line);
      } catch {
        return null;
      }
    } else {
      const lower = text.toLowerCase();
      match = (line) => line.toLowerCase().includes(lower);
    }
  }
  if (filter.minLevel === "all") return match;
  const allowed: LogLevel[] = filter.minLevel === "error" ? ["error"] : ["error", "warn"];
  return (line) => allowed.includes(levelOf(line)) && match(line);
}

/** Append lines and drop the oldest beyond the cap (returns a new array). */
export function appendCapped(lines: string[], more: string[], cap = MAX_LOG_LINES): string[] {
  const all = lines.concat(more);
  return all.length > cap ? all.slice(all.length - cap) : all;
}

/** Split a line from `--prefix` output: "[pod/name/container] text". */
export function splitPrefix(line: string): { prefix: string | null; text: string } {
  const m = /^\[pod\/[^/\]]+\/([^\]]+)\] (.*)$/.exec(line);
  return m ? { prefix: m[1], text: m[2] } : { prefix: null, text: line };
}
