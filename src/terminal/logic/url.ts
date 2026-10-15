// What the address bar turns typed text into.

/** Ports offered on a new browser pane (common dev servers). */
export const DEV_PORTS: { port: number; hint: string }[] = [
  { port: 3000, hint: "React / Next / Rails" },
  { port: 4200, hint: "Angular" },
  { port: 5173, hint: "Vite" },
  { port: 8000, hint: "Django / Laravel" },
  { port: 8080, hint: "Spring / generic" },
  { port: 8081, hint: "Expo / alt" },
  { port: 6006, hint: "Storybook" },
  { port: 8888, hint: "Jupyter" },
];

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/.*)?$/i;

/**
 * "3000" → http://localhost:3000, "localhost:5173/app" → http://…,
 * "github.com/x" → https://github.com/x, words → a web search.
 */
export function toUrl(input: string): string | null {
  const url = guess(input);
  if (!url) return null;
  try {
    // Catch what the browser would refuse anyway (e.g. "http://").
    return new URL(url).host || url.startsWith("about:") ? url : null;
  } catch {
    return null;
  }
}

function guess(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{2,5}$/.test(text)) return `http://localhost:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  if (LOCAL.test(text)) return `http://${text}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/** Short label for a tab or title bar: host[:port] and path. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
