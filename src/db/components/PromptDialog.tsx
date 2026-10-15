import { useState } from "react";

/** Small one-field dialog (folder names). */
export function PromptDialog({
  title,
  label,
  initial = "",
  confirmLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <form
        className="animate-rise w-[380px] rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-solid)] p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h2 className="text-[15px] font-semibold text-slate-50">{title}</h2>
        <label className="mt-3 block text-[11px] text-slate-500">
          {label}
          <input autoFocus className="input mt-1" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
