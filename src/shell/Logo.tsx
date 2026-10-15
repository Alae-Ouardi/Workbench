// Workbench mark: a rounded tile with a bench whose braced legs form a W,
// and the workspaces' tools on top — a block, a database and a clock. Same
// geometry as the app icon (`src-tauri/icons/icon.svg`), so the Dock and the
// UI stay in step.

import { useId } from "react";

export function LogoMark({ size = 28, glow = true }: { size?: number; glow?: boolean }) {
  const id = useId().replace(/:/g, "");
  const fg = `url(#${id}-fg)`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Workbench" role="img">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b1224" />
          <stop offset="100%" stopColor="#05070d" />
        </linearGradient>
        <linearGradient id={`${id}-fg`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        {glow && (
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}-bg)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" fill="none" stroke={fg} strokeOpacity="0.55" />
      <g filter={glow ? `url(#${id}-glow)` : undefined}>
        <rect x="14" y="21.5" width="9" height="9" rx="2" fill={fg} />
        <path d="M27.5 18.5c0-1.7 2.2-2.8 4.5-2.8s4.5 1.1 4.5 2.8v10.2c0 1.7-2.2 2.8-4.5 2.8s-4.5-1.1-4.5-2.8z" fill={fg} />
        <ellipse cx="32" cy="18.5" rx="4.5" ry="2" fill="#0b1224" fillOpacity="0.55" />
        <circle cx="45" cy="25" r="5.6" fill="none" stroke={fg} strokeWidth="2.2" />
        <path d="M45 22v3.4l2.2 1.4" fill="none" stroke="#e0fbff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="10" y="32" width="44" height="5" rx="2.5" fill={fg} />
        <path d="M15 38.5 21.5 50 32 41 42.5 50 49 38.5" fill="none" stroke={fg} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="51.5" cy="13" r="2" fill="#e0fbff" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={30} />
      <div className="leading-none">
        <div className="text-[13px] font-semibold tracking-tight text-slate-100">Workbench</div>
        <div className="num mt-0.5 text-[10px] uppercase tracking-[0.2em] text-sky-400">your workday</div>
      </div>
    </div>
  );
}
