// Live pod logs: follow, container picker, previous run, timestamps, filter
// (text or regex, level), wrap, download. Lines are batched and virtualized.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText, k8s, onLogLine, onProcExit } from "../api";
import { appendCapped, compileFilter, levelOf, splitPrefix, type LogFilter } from "../logic/logs";
import type { EnvRef, K8sObject } from "../types";

const LEVEL_CLASS = { error: "text-rose-300", warn: "text-amber-200", debug: "text-slate-500", info: "text-slate-300" } as const;
const TAILS = [200, 1000, 5000, 20000];

export function LogsView({ env, pod }: { env: EnvRef; pod: K8sObject }) {
  const containers: string[] = (pod.spec?.containers ?? []).map((c: { name: string }) => c.name);
  const [container, setContainer] = useState<string | null>(containers.length === 1 ? containers[0] : null);
  const [follow, setFollow] = useState(true);
  const [previous, setPrevious] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [tail, setTail] = useState(1000);
  const [wrap, setWrap] = useState(false);
  const [filter, setFilter] = useState<LogFilter>({ text: "", regex: false, minLevel: "all" });
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "live" | "ended" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [stick, setStick] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let procId: number | null = null;
    let pending: string[] = [];
    const unlisten: (() => void)[] = [];
    setLines([]);
    setState("loading");
    setError(null);
    const flush = setInterval(() => {
      if (pending.length) {
        const batch = pending;
        pending = [];
        setLines((l) => appendCapped(l, batch));
      }
    }, 120);

    // Lines and the exit for a stream whose id isn't known yet (the start
    // call is still returning) are kept and replayed once it is.
    const early = new Map<number, { lines: string[]; exit?: string | null }>();
    const finish = (err: string | null) => {
      setState(err ? "error" : "ended");
      if (err) setError(err);
    };

    (async () => {
      const stopLines = await onLogLine((id, line) => {
        if (id === procId) pending.push(line);
        else if (procId === null) {
          const entry = early.get(id) ?? { lines: [] };
          entry.lines.push(line);
          early.set(id, entry);
        }
      });
      if (cancelled) return stopLines();
      unlisten.push(stopLines);
      const stopExit = await onProcExit((id, err) => {
        if (cancelled) return;
        if (id === procId) finish(err);
        else if (procId === null) early.set(id, { ...(early.get(id) ?? { lines: [] }), exit: err });
      });
      if (cancelled) return stopExit();
      unlisten.push(stopExit);
      try {
        const id = await k8s.logsStart(env, pod.metadata.name, { container, follow, previous, timestamps, tail });
        if (cancelled) return void k8s.procKill(id);
        procId = id;
        setState("live");
        const buffered = early.get(id);
        early.clear();
        if (buffered) {
          pending.push(...buffered.lines);
          if ("exit" in buffered) finish(buffered.exit ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setState("error");
          setError(errorText(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(flush);
      unlisten.forEach((u) => u());
      if (procId !== null) void k8s.procKill(procId);
    };
  }, [env.context, env.namespace, pod.metadata.name, container, follow, previous, timestamps, tail]); // eslint-disable-line react-hooks/exhaustive-deps

  const matcher = useMemo(() => compileFilter(filter), [filter]);
  const visible = useMemo(() => (matcher ? lines.filter(matcher) : lines), [lines, matcher]);

  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 19,
    overscan: 30,
  });

  useEffect(() => {
    if (stick && visible.length) virtual.scrollToIndex(visible.length - 1, { align: "end" });
  }, [visible.length, stick]); // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll() {
    const el = scroller.current;
    if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  async function download() {
    await invoke("save_text_file", { defaultName: `${pod.metadata.name}${container ? `-${container}` : ""}.log`, contents: visible.join("\n") + "\n" });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] px-3 py-2">
        {containers.length > 1 && (
          <select className="input w-auto py-1 text-xs" value={container ?? ""} onChange={(e) => setContainer(e.target.value || null)}>
            <option value="">All containers</option>
            {containers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <input
          className={`input w-auto min-w-[160px] flex-1 py-1 text-xs ${matcher === null ? "border-rose-500/60" : ""}`}
          placeholder={filter.regex ? "Regex filter…" : "Filter lines…"}
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <Toggle on={filter.regex} onClick={() => setFilter({ ...filter, regex: !filter.regex })} label=".*" title="Regular expression" />
        <select
          className="input w-auto py-1 text-xs"
          value={filter.minLevel}
          onChange={(e) => setFilter({ ...filter, minLevel: e.target.value as LogFilter["minLevel"] })}
        >
          <option value="all">All levels</option>
          <option value="warn">Warnings +</option>
          <option value="error">Errors</option>
        </select>
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        <Toggle on={follow} onClick={() => setFollow(!follow)} label="Follow" />
        <Toggle on={previous} onClick={() => setPrevious(!previous)} label="Previous" title="Logs of the previous (crashed) container" />
        <Toggle on={timestamps} onClick={() => setTimestamps(!timestamps)} label="Time" />
        <Toggle on={wrap} onClick={() => setWrap(!wrap)} label="Wrap" />
        <select className="input w-auto py-1 text-xs" value={tail} onChange={(e) => setTail(Number(e.target.value))} title="History to load">
          {TAILS.map((t) => (
            <option key={t} value={t}>
              last {t.toLocaleString()}
            </option>
          ))}
        </select>
        <button className="btn py-1 text-xs" onClick={() => void download()} disabled={!visible.length}>
          Save
        </button>
      </div>

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto bg-[var(--bg)] font-mono text-[11.5px] leading-[19px]">
        <div style={{ height: virtual.getTotalSize(), position: "relative", minWidth: wrap ? undefined : "max-content" }}>
          {virtual.getVirtualItems().map((v) => {
            const raw = visible[v.index];
            const { prefix, text } = splitPrefix(raw);
            const level = levelOf(text);
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={wrap ? virtual.measureElement : undefined}
                className={`absolute left-0 w-full px-3 hover:bg-[var(--line-soft)] ${wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"} ${
                  level ? LEVEL_CLASS[level] : "text-slate-300"
                }`}
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {prefix && <span className="mr-2 text-violet-300/70">{prefix}</span>}
                {text}
              </div>
            );
          })}
        </div>
        {visible.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-600">
            {state === "loading" ? "Connecting…" : filter.text ? "No line matches the filter." : "No log output yet."}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--line-soft)] px-3 py-1.5 text-[11px] text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${state === "live" ? "animate-pulse bg-emerald-400" : state === "error" ? "bg-rose-400" : "bg-slate-500"}`} />
        <span>{state === "live" ? (follow ? "Streaming" : "Loaded") : state === "ended" ? "Stream ended" : state === "error" ? "Failed" : "Connecting"}</span>
        <span className="num">
          {visible.length.toLocaleString()}
          {visible.length !== lines.length && ` of ${lines.length.toLocaleString()}`} lines
        </span>
        {error && <span className="truncate text-rose-300" title={error}>{error}</span>}
        {!stick && (
          <button className="ml-auto text-sky-300 hover:underline" onClick={() => setStick(true)}>
            Jump to latest ↓
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label, title }: { on: boolean; onClick: () => void; label: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`rounded-lg border px-2 py-1 text-[11px] ${
        on ? "border-[rgb(34_211_238/0.4)] bg-[rgb(34_211_238/0.12)] text-sky-200" : "border-[var(--line)] text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
