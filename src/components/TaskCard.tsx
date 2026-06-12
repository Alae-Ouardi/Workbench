import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../types";

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-500",
  normal: "bg-sky-500",
  high: "bg-amber-500",
  urgent: "bg-red-500",
};

const ASSIGNEE_COLORS: Record<string, string> = {
  "claude-code": "bg-orange-900/60 text-orange-300",
  codex: "bg-teal-900/60 text-teal-300",
  opencode: "bg-violet-900/60 text-violet-300",
  me: "bg-emerald-900/60 text-emerald-300",
};

interface TaskCardProps {
  task: Task;
  showProject: boolean;
  onOpen: (id: number) => void;
}

export function TaskCard({ task, showProject, onOpen }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      className={`group cursor-pointer rounded-lg border border-[#222837] bg-[#141927] p-3 shadow-sm transition-colors hover:border-[#3b4357] ${
        isDragging ? "opacity-80 shadow-xl" : ""
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLORS[task.priority]}`}
          title={`priority: ${task.priority}`}
        />
        <span className="text-xs text-slate-500">#{task.id}</span>
        {task.kind === "bug" && (
          <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">
            bug
          </span>
        )}
        {showProject && (
          <span className="ml-auto truncate text-[10px] text-slate-500">{task.project_name}</span>
        )}
      </div>
      <div className="text-sm leading-snug text-slate-200">{task.title}</div>
      {task.assignee && (
        <div className="mt-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              ASSIGNEE_COLORS[task.assignee] ?? "bg-slate-800 text-slate-300"
            }`}
          >
            {task.assignee}
          </span>
        </div>
      )}
    </div>
  );
}
