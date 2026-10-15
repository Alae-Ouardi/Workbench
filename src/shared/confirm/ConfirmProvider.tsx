// The single place every cluster or database change is confirmed. Callers
// `await confirm({...})` and proceed only on true. Production-like targets get
// a red dialog that spells out exactly where the change will land.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { envTier, isProdLike, TIER_STYLE, type EnvTier } from "../envKind";
import { useOverlay } from "../overlay";

export interface ConfirmRequest {
  /** What will happen, e.g. "Delete pod api-7f9c". */
  title: string;
  /** Where: cluster / namespace or connection / table, shown as chips. */
  target: { label: string; value: string }[];
  /** Names used to work out the environment tier (namespace first). */
  envNames?: (string | null | undefined)[];
  /** Extra body: SQL preview, diff summary… */
  detail?: ReactNode;
  confirmLabel?: string;
  /** Destructive (delete, drop): red button even outside production. */
  destructive?: boolean;
}

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs a ConfirmProvider");
  return confirm;
}

interface Pending {
  request: ConfirmRequest;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<Confirm>(
    (request) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          current?.resolve(false);
          return { request, resolve };
        });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog request={pending.request} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: (ok: boolean) => void }) {
  useOverlay();
  const tier: EnvTier = envTier(...(request.envNames ?? []));
  const prod = isProdLike(tier);
  const danger = prod || request.destructive;
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // On production the safe choice has focus, so a stray Enter cancels.
    (prod ? cancelButton : confirmButton).current?.focus();
    // Capture phase, and stop it: Esc closes this dialog only, not the view behind.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, prod]);

  const tierStyle = TIER_STYLE[tier];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => onClose(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(e) => e.stopPropagation()}
        className="animate-rise w-[520px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border bg-[var(--panel-solid)] shadow-2xl"
        style={{ borderColor: prod ? "rgb(251 113 133 / 0.55)" : "var(--line-strong)" }}
      >
        {prod && (
          <div className="flex items-center gap-2 bg-rose-500/15 px-5 py-2.5 text-[12px] font-semibold text-rose-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
            This change goes to {tierStyle.label === "PROD" ? "PRODUCTION" : tierStyle.label}
          </div>
        )}
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-slate-100">{request.title}</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tier !== "other" && (
              <span className="chip num font-semibold" style={{ color: tierStyle.color, borderColor: `${tierStyle.color}66` }}>
                {tierStyle.label}
              </span>
            )}
            {request.target.map((t) => (
              <span key={t.label} className="chip">
                <span className="text-slate-500">{t.label}</span>
                <span className="num text-slate-200">{t.value}</span>
              </span>
            ))}
          </div>
          {request.detail && <div className="mt-3 max-h-[40vh] overflow-auto">{request.detail}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
          <button ref={cancelButton} className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            ref={confirmButton}
            className={danger ? "btn border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30" : "btn btn-primary"}
            onClick={() => onClose(true)}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
