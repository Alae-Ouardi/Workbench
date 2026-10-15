import type { StateColumn } from "../logic/work";
import { ItemCard } from "./ui";

/**
 * Kanban board: one column per workflow state, states across the top, items
 * stacked beneath. Shared by the Dashboard and My Work so both read the same.
 */
export function StateBoard({
  columns,
  childCounts,
  maxHeight = "calc(100vh - 300px)",
  taskStyle = "compact",
}: {
  columns: StateColumn[];
  childCounts?: Map<number, number>;
  maxHeight?: string;
  /** `full` when the board shows tasks and bugs on their own. */
  taskStyle?: "compact" | "full";
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border border-[rgb(34_211_238/0.5)] bg-[rgb(34_211_238/0.15)]" /> User story
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-sm border border-[#a78bfa] ${taskStyle === "full" ? "bg-[#a78bfa]/20" : "border-dashed"}`} /> Task
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-sm border border-[#fb7185] ${taskStyle === "full" ? "bg-[#fb7185]/20" : "border-dashed"}`} /> Bug
        </span>
        <span className="ml-auto">Click a card to change its state or log time</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const stories = col.items.filter((i) => i.entity_type === "UserStory").length;
          const bugs = col.items.filter((i) => i.entity_type === "Bug").length;
          const tasks = col.items.length - stories - bugs;
          return (
            <div key={col.key} className="glass flex min-w-[264px] max-w-[360px] flex-1 basis-0 flex-col overflow-hidden rounded-2xl">
              <div
                className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-3"
                style={{
                  background: col.isFinal
                    ? "linear-gradient(180deg, rgb(16 185 129 / 0.12), transparent)"
                    : "linear-gradient(180deg, var(--line-soft), transparent)",
                }}
              >
                <span className={`truncate text-[13px] font-semibold ${col.isFinal ? "text-emerald-400" : "text-slate-100"}`}>
                  {col.name}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {stories > 0 && (
                    <span className="num chip border-[rgb(34_211_238/0.35)] text-sky-300" title="User stories">
                      {stories} US
                    </span>
                  )}
                  {tasks > 0 && (
                    <span className="num chip border-[#a78bfa55] text-[#c4b5fd]" title="Tasks">
                      {tasks} T
                    </span>
                  )}
                  {bugs > 0 && (
                    <span className="num chip border-[#fb718555] text-[#fda4af]" title="Bugs">
                      {bugs} B
                    </span>
                  )}
                </span>
              </div>
              <div className="space-y-2 overflow-y-auto p-2" style={{ maxHeight }}>
                {col.items.length === 0 && (
                  <p className="rounded-xl border border-dashed border-[var(--line-soft)] px-3 py-6 text-center text-[11px] text-slate-600">
                    Nothing here
                  </p>
                )}
                {col.items.map((item) => (
                  <ItemCard key={item.id} item={item} childCount={childCounts?.get(item.id)} taskStyle={taskStyle} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
