import { useCallback, useEffect, useState } from "react";
import {
  tpClearToken,
  tpGetSettings,
  tpSaveSettings,
  tpSetToken,
  tpTestConnection,
} from "../api";
import type { TpSettings, TpSettingsView } from "../types";
import { resetTpBaseUrl } from "./tp/TpChip";
import { SyncQueuePanel } from "./tp/SyncQueuePanel";

/** Blank means "don't sync this transition", which is the default. */
const OPTIONAL_STATE_HINT = "leave empty to not sync";

export function SettingsView() {
  const [view, setView] = useState<TpSettingsView | null>(null);
  const [draft, setDraft] = useState<TpSettings | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(() => {
    tpGetSettings()
      .then((s) => {
        setView(s);
        setDraft(stripDerived(s));
      })
      .catch((e) => setMessage({ kind: "err", text: String(e) }));
  }, []);

  useEffect(load, [load]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!draft || !view) {
    return <p className="p-6 text-sm text-slate-500">Loading settings…</p>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(stripDerived(view));

  return (
    <div className="mx-auto max-w-2xl space-y-6 overflow-y-auto p-6">
      <header>
        <h1 className="text-base font-semibold text-slate-100">TargetProcess</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Link a project to a user story and its tasks are mirrored into TargetProcess:
          finishing a task moves the entity to your done state and logs the task's estimate
          as time spent.
        </p>
      </header>

      {message && (
        <p
          className={`rounded-md border px-3 py-2 text-xs ${
            message.kind === "ok"
              ? "border-emerald-900 bg-emerald-950/40 text-emerald-400"
              : "border-red-900 bg-red-950/40 text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* --- connection --- */}
      <section className="space-y-3 rounded-lg border border-[#1c2230] bg-[#0d1018] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Connection
        </h2>

        <Field label="Instance URL" hint="e.g. https://yourco.tpondemand.com">
          <input
            value={draft.base_url}
            onChange={(e) => setDraft({ ...draft, base_url: e.target.value })}
            placeholder="https://yourco.tpondemand.com"
            className={inputClass}
          />
        </Field>

        <Field
          label="Access token"
          hint="TargetProcess → My Profile → Access Tokens. Stored in your macOS Keychain, never in a file."
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={view.token_set ? "•••••••••• saved" : "paste your access token"}
              className={inputClass}
            />
            <button
              disabled={!token.trim() || busy !== null}
              onClick={() =>
                run("token", async () => {
                  const next = await tpSetToken(token);
                  setToken("");
                  setView(next);
                  setMessage({ kind: "ok", text: "Token saved to the Keychain." });
                })
              }
              className={primaryButton}
            >
              Save
            </button>
            {view.token_set && (
              <button
                disabled={busy !== null}
                onClick={() =>
                  run("token", async () => {
                    const next = await tpClearToken();
                    setView(next);
                    setMessage({ kind: "ok", text: "Token removed." });
                  })
                }
                className={ghostButton}
              >
                Remove
              </button>
            )}
          </div>
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button
            disabled={busy !== null}
            onClick={() =>
              run("test", async () => {
                // Test against what is saved, so an unsaved URL can't mislead.
                if (dirty) await tpSaveSettings(draft);
                const user = await tpTestConnection();
                resetTpBaseUrl();
                load();
                setMessage({
                  kind: "ok",
                  text: `Connected as ${user.name || user.email || `#${user.id}`}.`,
                });
              })
            }
            className={primaryButton}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          {view.cached_user_name && (
            <span className="text-xs text-slate-500">
              Token owner: <span className="text-slate-300">{view.cached_user_name}</span>
            </span>
          )}
        </div>
      </section>

      {/* --- sync behaviour --- */}
      <section className="space-y-3 rounded-lg border border-[#1c2230] bg-[#0d1018] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Sync
        </h2>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="mt-0.5 accent-sky-600"
          />
          <span>
            <span className="block text-xs text-slate-300">Push changes to TargetProcess</span>
            <span className="block text-[10px] text-slate-600">
              Off keeps everything local. Work still queues, and is pushed when you turn this
              back on.
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Done state" hint="required">
            <input
              value={draft.done_state_name}
              onChange={(e) => setDraft({ ...draft, done_state_name: e.target.value })}
              placeholder="Done"
              className={inputClass}
            />
          </Field>
          <Field label="In progress state" hint={OPTIONAL_STATE_HINT}>
            <input
              value={draft.in_progress_state_name}
              onChange={(e) => setDraft({ ...draft, in_progress_state_name: e.target.value })}
              placeholder="In Progress"
              className={inputClass}
            />
          </Field>
          <Field label="Review state" hint={OPTIONAL_STATE_HINT}>
            <input
              value={draft.review_state_name}
              onChange={(e) => setDraft({ ...draft, review_state_name: e.target.value })}
              placeholder="In Review"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Timezone offset (minutes east of UTC)"
          hint="Used to date time entries. Defaults to this machine's offset."
        >
          <input
            type="number"
            step={15}
            value={draft.tz_offset_minutes}
            onChange={(e) =>
              setDraft({ ...draft, tz_offset_minutes: Number(e.target.value) || 0 })
            }
            className={`${inputClass} w-32`}
          />
        </Field>

        <div className="flex items-center gap-3 pt-1">
          <button
            disabled={!dirty || busy !== null}
            onClick={() =>
              run("save", async () => {
                const next = await tpSaveSettings(draft);
                setView(next);
                setDraft(stripDerived(next));
                resetTpBaseUrl();
                setMessage({ kind: "ok", text: "Settings saved." });
              })
            }
            className={primaryButton}
          >
            {busy === "save" ? "Saving…" : "Save settings"}
          </button>
          {dirty && <span className="text-[10px] text-amber-500">Unsaved changes</span>}
        </div>
      </section>

      <SyncQueuePanel />
    </div>
  );
}

/** Drop the derived fields so `draft` matches what the backend accepts. */
function stripDerived(view: TpSettingsView): TpSettings {
  const { token_set: _t, base_url_normalized: _b, ...settings } = view;
  return settings;
}

const inputClass =
  "w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-2.5 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-600";
const primaryButton =
  "rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-40 disabled:hover:bg-sky-700";
const ghostButton =
  "rounded-md border border-[#2a3040] px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 disabled:opacity-40";

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-slate-600">{hint}</span>}
    </label>
  );
}
