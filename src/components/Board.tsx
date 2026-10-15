import { DndContext, PointerSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Status, Task } from "../types";
import { STATUSES, STATUS_LABELS } from "../types";
import { TaskCard } from "./TaskCard";

const COLUMN_ACCENTS: Record<Status, string> = {
  open: "border-t-sky-500",
  waiting: "border-t-amber-500",
  in_progress: "border-t-violet-500",
  review: "border-t-pink-500",
  done: "border-t-emerald-500",
};

interface BoardProps {
  tasks: Task[];
  showProject: boolean;
  onMove: (id: number, status: Status) => void;
  onOpen: (id: number) => void;
}

export function Board({ tasks, showProject, onMove, onOpen }: BoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const id = Number(active.id);
    const status = String(over.id) as Status;
    const task = tasks.find((t) => t.id === id);
    if (task && task.status !== status) {
      onMove(id, status);
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="grid h-full grid-cols-5 gap-3 overflow-x-auto p-4">
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasks.filter((t) => t.status === status)}
            showProject={showProject}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  );
}

interface ColumnProps {
  status: Status;
  tasks: Task[];
  showProject: boolean;
  onOpen: (id: number) => void;
}

function Column({ status, tasks, showProject, onOpen }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-44 flex-col rounded-xl border border-[var(--line-soft)] border-t-2 bg-[var(--panel-2)] ${
        COLUMN_ACCENTS[status]
      } ${isOver ? "ring-1 ring-sky-500/60" : ""}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-[var(--line-soft)] px-2 py-0.5 text-xs text-slate-400">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} showProject={showProject} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
