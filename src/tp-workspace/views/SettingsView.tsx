import { useEffect, useState } from "react";
import { tpGetSettings, tpSaveSettings, tpSetToken, tpTestConnection } from "../../api";
import type { TpSettingsView } from "../../types";
import { forgetTpBaseUrl } from "../api";
import { ViewHeader } from "../components/ui";
import { todayIso, WEEKDAYS } from "../logic/dates";
import { formatHours } from "../logic/duration";
import { monthTarget } from "../logic/timesheet";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../WorkspaceContext";
import type { WorkspacePrefs } from "../types";

export function WorkspaceSettingsView({ onConnectionChanged }: { onConnectionChanged: () => void }) {
  return (
    <div className="max-w-3xl space-y-4">
      <ViewHeader title="Settings" subtitle="Connect TargetProcess and tune the workspace to how you work." />
      <ConnectionCard onConnectionChanged={onConnectionChanged} />
      <PreferencesCard />
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass animate-rise rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[180px_1fr] items-start gap-4">
      <span>
        <span className="block text-xs font-medium text-slate-300">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
      </span>
      <span>{children}</span>
    </label>
  );
}

function ConnectionCard({ onConnectionChanged }: { onConnectionChanged: () => void }) {
  const [view, setView] = useState<TpSettingsView | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    tpGetSettings()
      .then((s) => {
        setView(s);
        setUrl(s.base_url);
      })
      .catch((e) => setMessage({ ok: false, text: String(e) }));
  }, []);

  async function saveAndTest() {
    if (!view) return;
    const trimmed = url.trim();
    if (!/^https?:\/\/.{4,}/.test(trimmed)) {
      setMessage({ ok: false, text: "Enter the full instance address, e.g. https://yourco.tpondemand.com" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { token_set: _t, base_url_normalized: _b, ...settings } = view;
      let next = await tpSaveSettings({ ...settings, base_url: trimmed });
      if (token.trim()) next = await tpSetToken(token.trim());
      setView(next);
      setToken("");
      forgetTpBaseUrl();
      const user = await tpTestConnection();
      setMessage({ ok: true, text: `Connected as ${user.name || user.email}` });
      onConnectionChanged();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="TargetProcess connection"
      hint="Shared with the TaskBoard sync. The access token is stored in the macOS Keychain, never in a file the app writes."
    >
      <Row label="Instance URL">
        <input className="input" placeholder="https://yourco.tpondemand.com" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Row>
      <Row label="Access token" hint={view?.token_set ? "A token is stored. Paste a new one to replace it." : "TP → your profile → Access Tokens"}>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={view?.token_set ? "••••••••••••  (stored)" : "Paste your access token"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Row>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy || !view} onClick={() => void saveAndTest()}>
          {busy ? "Connecting…" : "Save & test connection"}
        </button>
        {view?.cached_user_name && !message && <span className="text-xs text-slate-500">Signed in as {view.cached_user_name}</span>}
        {message && <span className={`text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>{message.text}</span>}
      </div>
    </Card>
  );
}

function PreferencesCard() {
  const { prefs, savePrefs } = usePrefs();
  const { projects, projectColor } = useWorkspace();
  const [draft, setDraft] = useState<WorkspacePrefs>(prefs);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => setDraft(prefs), [prefs]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  function toggleIn<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function save() {
    try {
      await savePrefs(draft);
      setSaved("Saved");
    } catch (e) {
      setSaved(String(e));
    }
    setTimeout(() => setSaved(null), 2000);
  }

  return (
    <Card title="Workspace preferences" hint="Stored locally beside your board database.">
      <Row label="Default projects" hint="Pre-selected in the filter bar and used to scope the overdue list.">
        <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
          {projects.length === 0 && <span className="text-xs text-slate-500">Connect first to load projects.</span>}
          {projects.map((p) => {
            const on = draft.default_project_ids.includes(p.id);
            return (
              <span key={p.id} className={`chip gap-1.5 ${on ? "border-[var(--acc-500)] text-sky-300" : ""}`}>
                <input
                  type="color"
                  value={draft.project_colors[String(p.id)] ?? toHex(projectColor(p.id))}
                  onChange={(e) =>
                    setDraft({ ...draft, project_colors: { ...draft.project_colors, [String(p.id)]: e.target.value } })
                  }
                  className="h-3 w-3 cursor-pointer appearance-none overflow-hidden rounded-full border-0 bg-transparent p-0"
                  title="Project colour"
                />
                <button type="button" onClick={() => setDraft({ ...draft, default_project_ids: toggleIn(draft.default_project_ids, p.id) })}>
                  {p.abbreviation || p.name}
                </button>
              </span>
            );
          })}
        </div>
      </Row>
      <Row label="Daily target" hint="Days below this are flagged on the time calendar.">
        <div className="flex items-center gap-2">
          <input
            className="input num w-24"
            type="number"
            step="0.25"
            min="0.25"
            max="24"
            value={draft.daily_target_hours}
            onChange={(e) => setDraft({ ...draft, daily_target_hours: Number(e.target.value) })}
          />
          <span className="text-xs text-slate-500">hours · {formatHours(draft.daily_target_hours || 0)}</span>
        </div>
      </Row>
      <Row label="Weekly target">
        <div className="flex items-center gap-2">
          <input
            className="input num w-24"
            type="number"
            step="0.5"
            min="0.5"
            max="168"
            value={draft.weekly_target_hours}
            onChange={(e) => setDraft({ ...draft, weekly_target_hours: Number(e.target.value) })}
          />
          <span className="text-xs text-slate-500">hours · {formatHours(draft.weekly_target_hours || 0)}</span>
        </div>
      </Row>
      <Row label="Monthly target" hint="Leave empty to derive it from the weekly target and the month's working days.">
        <div className="flex items-center gap-2">
          <input
            className="input num w-24"
            type="number"
            step="0.5"
            min="0"
            placeholder="auto"
            value={draft.monthly_target_hours ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, monthly_target_hours: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
          <span className="text-xs text-slate-500">
            {draft.monthly_target_hours
              ? `hours · ${formatHours(draft.monthly_target_hours)}`
              : `auto · ${formatHours(monthTarget(todayIso(), draft.weekly_target_hours, draft.working_days, null))} this month`}
          </span>
        </div>
      </Row>
      <Row label="Working days">
        <div className="flex gap-1">
          {WEEKDAYS.map((d, i) => {
            const on = draft.working_days.includes(i + 1);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDraft({ ...draft, working_days: toggleIn(draft.working_days, i + 1).sort() })}
                className={`chip ${on ? "border-[var(--acc-500)] text-sky-300" : "text-slate-600"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Auto-refresh" hint="How often live data is pulled in the background.">
        <select
          className="input w-40"
          value={draft.refresh_minutes}
          onChange={(e) => setDraft({ ...draft, refresh_minutes: Number(e.target.value) })}
        >
          {[2, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              every {m} min
            </option>
          ))}
        </select>
      </Row>
      <Row label="Theme">
        <div className="flex rounded-lg border border-[var(--line)] p-0.5">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setDraft({ ...draft, theme: t })}
              className={`flex-1 rounded-md px-3 py-1 text-xs capitalize ${draft.theme === t ? "bg-[var(--line)] text-slate-100" : "text-slate-500"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Row>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
          Save preferences
        </button>
        {saved && <span className="text-xs text-emerald-400">{saved}</span>}
      </div>
    </Card>
  );
}

/** `<input type=color>` only accepts #rrggbb. */
function toHex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#22d3ee";
}
