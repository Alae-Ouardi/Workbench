import { useState } from "react";
import type { Burndown } from "../logic/burndown";
import { formatDay } from "../logic/dates";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 36 };

export function BurndownChart({ burndown, today }: { burndown: Burndown; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { points, total, unit } = burndown;
  const max = Math.max(total, ...points.map((p) => p.remaining ?? 0), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const ideal = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.ideal)}`).join(" ");
  const actualPts = points.map((p, i) => ({ i, v: p.remaining })).filter((p): p is { i: number; v: number } => p.v !== null);
  const actual = actualPts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ");
  const area = actualPts.length
    ? `${actual} L${x(actualPts[actualPts.length - 1].i)},${y(0)} L${x(actualPts[0].i)},${y(0)} Z`
    : "";
  const todayIndex = points.findIndex((p) => p.date === today);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f * 10) / 10);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sprint burndown">
        <defs>
          <linearGradient id="bd-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--acc-400)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--acc-400)" stopOpacity="0" />
          </linearGradient>
          <filter id="bd-glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line-soft)" />
            <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--ink-600)" className="num">
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--ink-600)">
              {formatDay(p.date).split(" ").slice(1).join(" ")}
            </text>
          ) : null,
        )}
        {todayIndex >= 0 && (
          <line
            x1={x(todayIndex)}
            x2={x(todayIndex)}
            y1={PAD.top}
            y2={y(0)}
            stroke="#a78bfa"
            strokeDasharray="2 4"
            strokeOpacity="0.7"
          />
        )}
        <path d={ideal} fill="none" stroke="var(--ink-600)" strokeWidth="1.5" strokeDasharray="5 5" />
        {area && <path d={area} fill="url(#bd-area)" />}
        {actual && <path d={actual} fill="none" stroke="var(--acc-400)" strokeWidth="2.5" filter="url(#bd-glow)" />}
        {actualPts.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 4.5 : 2.5} fill="var(--acc-300)" />
        ))}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - innerW / points.length / 2}
            y={PAD.top}
            width={innerW / points.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div className="glass-strong pointer-events-none absolute right-2 top-2 rounded-lg px-3 py-2 text-[11px]">
          <div className="font-semibold text-slate-200">{formatDay(hovered.date)}</div>
          <div className="num text-sky-300">
            Remaining {hovered.remaining ?? "—"} {unit === "effort" ? "pt" : "items"}
          </div>
          <div className="num text-slate-500">Ideal {hovered.ideal}</div>
        </div>
      )}
    </div>
  );
}
