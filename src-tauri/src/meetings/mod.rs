//! Meeting time tracking. A background thread watches the microphone; when a
//! call ends the meeting joins a to-log list (kept on disk), the window comes
//! forward with the logging popup and a notification is shown. Recurring
//! entries are logged once per working day by the same thread.

pub mod holidays;
mod menubar;
mod mic;
pub mod recurring;
pub mod settings;
pub mod tracker;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use taskboard_core::tp::client::today_in_offset;
use taskboard_core::TpSettings;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;

use crate::util::blocking;
use crate::workspace::{client, current_user_id};
use settings::MeetingSettings;
use tracker::{LiveState, Segment, Tracker};

/// Microphone checks: relaxed while idle, closer together during a call.
const IDLE_POLL: Duration = Duration::from_secs(8);
const LIVE_POLL: Duration = Duration::from_secs(3);
/// Recurring entries and today's hours are checked this often (and shortly
/// after launch).
const BACKGROUND_EVERY: Duration = Duration::from_secs(5 * 60);
const RECURRING_FIRST: Duration = Duration::from_secs(45);
/// Logged meetings kept for the "logged recently" list.
const LOGGED_KEEP_DAYS: i64 = 14;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PendingMeeting {
    pub id: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    #[serde(default)]
    pub apps: Vec<String>,
    /// The scheduled meeting this call matched, from the calendar.
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoggedMeeting {
    pub id: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub hours: f64,
    pub task_id: i64,
    #[serde(default)]
    pub description: String,
    pub time_id: i64,
    /// "meeting" or "recurring".
    #[serde(default = "meeting_kind")]
    pub kind: String,
}

/// The scheduled meeting's title, else "Meeting 10:02–10:47" in local time.
fn default_description(m: &PendingMeeting) -> String {
    if let Some(title) = m.title.as_deref().filter(|t| !t.trim().is_empty()) {
        return title.trim().to_string();
    }
    let local = |t: DateTime<Utc>| t.with_timezone(&chrono::Local).format("%H:%M").to_string();
    format!("Meeting {}–{}", local(m.start), local(m.end))
}

fn recurring_description(label: &str) -> &str {
    if label.trim().is_empty() { "Recurring time" } else { label }
}

fn meeting_kind() -> String {
    "meeting".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct MeetingsFile {
    settings: MeetingSettings,
    pending: Vec<PendingMeeting>,
    logged: Vec<LoggedMeeting>,
    recurring_done: Vec<String>,
}

fn path() -> Option<PathBuf> {
    Some(taskboard_core::paths::data_dir().join("meetings.json"))
}

fn timeagent_settings() -> Option<MeetingSettings> {
    let raw = std::fs::read_to_string(dirs::data_dir()?.join("TimeAgent").join("settings.json")).ok()?;
    settings::from_timeagent(&raw)?.validated().ok()
}

fn load_file() -> MeetingsFile {
    let raw = path().and_then(|p| std::fs::read_to_string(p).ok());
    let mut file = match raw.as_deref().map(serde_json::from_str::<MeetingsFile>) {
        Some(Ok(file)) => file,
        Some(Err(e)) => {
            // Unreadable (hand-edited?): keep a copy rather than overwrite it.
            eprintln!("meetings.json is unreadable ({e}); keeping it as meetings.json.bak");
            if let Some(p) = path() {
                let _ = std::fs::rename(&p, p.with_extension("json.bak"));
            }
            MeetingsFile::default()
        }
        None => MeetingsFile::default(),
    };
    if !file.settings.imported {
        // First run: start from TimeAgent's values when it is set up here.
        if let Some(imported) = timeagent_settings() {
            file.settings = imported;
        }
        file.settings.imported = true;
        if let Err(e) = save_file(&file) {
            eprintln!("could not save meeting settings: {e}");
        }
    }
    file
}

fn save_file(file: &MeetingsFile) -> Result<(), String> {
    let path = path().ok_or("no home directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[derive(Default)]
pub struct Meetings {
    file: Mutex<MeetingsFile>,
    tracker: Mutex<Tracker>,
    /// One recurring run at a time (the timer and "Log today's now").
    recurring: Mutex<()>,
    /// Hours logged on a day, as last read from TargetProcess.
    today_hours: Mutex<Option<(chrono::NaiveDate, f64)>>,
    /// What the menu bar shows now, to skip redundant updates.
    menubar_title: Mutex<String>,
}

pub type MeetingsState = Arc<Meetings>;

impl Meetings {
    pub fn load() -> Self {
        Self { file: Mutex::new(load_file()), ..Default::default() }
    }

    fn file(&self) -> MutexGuard<'_, MeetingsFile> {
        self.file.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn tracker(&self) -> MutexGuard<'_, Tracker> {
        self.tracker.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Change the file and write it back. The in-memory copy is changed even
    /// when the write fails, so nothing already sent to TargetProcess is
    /// offered again.
    fn update<T>(&self, f: impl FnOnce(&mut MeetingsFile) -> T) -> Result<T, String> {
        let mut file = self.file();
        let out = f(&mut file);
        save_file(&file)?;
        Ok(out)
    }

    /// `update`, logging rather than returning a failed write.
    fn update_logged<T>(&self, f: impl FnOnce(&mut MeetingsFile) -> T) -> T {
        let mut file = self.file();
        let out = f(&mut file);
        if let Err(e) = save_file(&file) {
            eprintln!("could not save meetings: {e}");
        }
        out
    }

    fn settings(&self) -> MeetingSettings {
        self.file().settings.clone()
    }
}

/// The list the popup and the Meetings view show.
#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub live: LiveState,
    pub pending: Vec<PendingMeeting>,
    pub logged: Vec<LoggedMeeting>,
}

fn overview(m: &Meetings) -> Overview {
    let file = m.file();
    Overview { live: m.tracker().state(), pending: file.pending.clone(), logged: file.logged.clone() }
}

fn emit_changed(app: &AppHandle, m: &Meetings) {
    let _ = app.emit("meetings-changed", overview(m));
}

/// Queue a finished meeting and get the user's attention.
/// The title of the calendar event a call took place in, if the calendar is
/// readable and one matches.
fn scheduled_title(start: DateTime<Utc>, end: DateTime<Utc>) -> Option<String> {
    if crate::calendar::access() != crate::calendar::Access::Granted {
        return None;
    }
    let pad = chrono::Duration::hours(2);
    let events = crate::calendar::events(start - pad, end + pad).ok()?;
    crate::calendar::best_match(&events, start, end).map(|e| e.title.clone())
}

fn meeting_ended(app: &AppHandle, m: &Meetings, seg: Segment) {
    let title = scheduled_title(seg.start, seg.end);
    let meeting = PendingMeeting { id: seg.start.timestamp_millis().to_string(), start: seg.start, end: seg.end, apps: seg.apps, title };
    m.update_logged(|f| {
        if !f.pending.iter().any(|p| p.id == meeting.id) {
            f.pending.push(meeting.clone());
        }
    });
    emit_changed(app, m);
    let _ = app.emit("meeting-ended", &meeting);

    let minutes = (meeting.end - meeting.start).num_minutes();
    let _ = app
        .notification()
        .builder()
        .title("Meeting ended")
        .body(match &meeting.title {
            Some(t) => format!("{t} · {minutes} min — choose where to log it"),
            None => format!("{minutes} min — choose where to log it"),
        })
        .show();
    // The menu-bar panel floats over every app; the main window also has the
    // full popup ready for when it is opened.
    crate::tray::show_today(app);
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Re-read today's logged hours from TargetProcess.
fn refresh_today_hours(m: &Meetings) -> Result<(), String> {
    let mut tp = TpSettings::load();
    let client = client(&tp)?;
    let today = today_in_offset(Utc::now(), tp.tz_offset_minutes);
    let user_id = current_user_id(&mut tp, &client)?;
    let entries = client.times(user_id, today, today).map_err(|e| e.to_string())?;
    *lock(&m.today_hours) = Some((today, entries.iter().map(|t| t.spent).sum()));
    Ok(())
}

fn update_menubar(app: &AppHandle, m: &Meetings) {
    // Built under the title lock, so two threads can't apply them out of order.
    let mut shown = lock(&m.menubar_title);
    let live = m.tracker().state();
    let pending = m.file().pending.len();
    let today = today_in_offset(Utc::now(), TpSettings::load().tz_offset_minutes);
    // Yesterday's total (offline past midnight) is not shown as today's.
    let hours = (*lock(&m.today_hours)).filter(|(day, _)| *day == today).map(|(_, h)| h);
    let text = menubar::title(live.started_at, Utc::now(), hours, pending);
    if *shown != text {
        crate::tray::set_title(app, &text);
        *shown = text;
    }
}

/// After time was logged: refresh today's hours off the calling thread.
fn refresh_menubar_soon(app: &AppHandle, m: &MeetingsState) {
    let (app, m) = (app.clone(), Arc::clone(m));
    std::thread::spawn(move || {
        if let Err(e) = refresh_today_hours(&m) {
            eprintln!("today's hours: {e}");
        }
        update_menubar(&app, &m);
    });
}

fn poll_microphone(app: &AppHandle, m: &Meetings) {
    let enabled = m.file().settings.enabled;
    let before = m.tracker().state();
    let ended = if enabled {
        let (active, apps) = mic::sample();
        m.tracker().tick(Utc::now(), active, &apps)
    } else {
        m.tracker().reset();
        None
    };
    let after = m.tracker().state();
    if after != before {
        let _ = app.emit("meeting-state", &after);
    }
    if let Some(seg) = ended {
        meeting_ended(app, m, seg);
    }
    update_menubar(app, m);
}

/// Log whatever recurring time is due today. Returns one line per entry logged.
fn run_recurring(m: &Meetings) -> Result<Vec<String>, String> {
    let _one_at_a_time = m.recurring.lock().unwrap_or_else(|e| e.into_inner());
    let settings = m.settings();
    if settings.recurring.is_empty() {
        return Ok(Vec::new());
    }
    let mut tp = TpSettings::load();
    let client = client(&tp)?;
    let today = today_in_offset(Utc::now(), tp.tz_offset_minutes);
    let due: Vec<_> = {
        let file = m.file();
        recurring::due(&settings, today, &file.recurring_done).into_iter().cloned().collect()
    };
    if due.is_empty() {
        return Ok(Vec::new());
    }
    let user_id = current_user_id(&mut tp, &client)?;
    let existing = client.times(user_id, today, today).map_err(|e| e.to_string())?;
    let mut done = Vec::new();
    for entry in due {
        let key = recurring::ledger_key(today, entry.task_id);
        if existing.iter().any(|t| t.entity_id == Some(entry.task_id)) {
            m.update_logged(|f| f.recurring_done.push(key));
            continue;
        }
        let time_id = client
            .log_time(entry.task_id, entry.hours, recurring_description(&entry.label), today, tp.tz_offset_minutes)
            .map_err(|e| e.to_string())?;
        let now = Utc::now();
        m.update_logged(|f| {
            f.recurring_done.push(key);
            recurring::prune(&mut f.recurring_done, today);
            f.logged.push(LoggedMeeting {
                id: format!("recurring-{}-{}", today, entry.task_id),
                start: now,
                end: now,
                hours: entry.hours,
                task_id: entry.task_id,
                description: entry.label.clone(),
                time_id,
                kind: "recurring".into(),
            });
        });
        let label = if entry.label.is_empty() { format!("#{}", entry.task_id) } else { entry.label.clone() };
        done.push(format!("{label} ({}h)", entry.hours));
    }
    Ok(done)
}

fn recurring_tick(app: &AppHandle, m: &Meetings) {
    match run_recurring(m) {
        Ok(done) if !done.is_empty() => {
            emit_changed(app, m);
            let _ = app.notification().builder().title("Recurring time logged").body(done.join(", ")).show();
        }
        Ok(_) => {}
        // Not configured or offline: try again next round, quietly.
        Err(e) => eprintln!("recurring time: {e}"),
    }
}

/// How often upcoming meetings are checked for a reminder.
const REMINDER_POLL: Duration = Duration::from_secs(30);

fn remind_upcoming(app: &AppHandle, m: &Meetings, reminded: &mut Vec<String>) {
    let lead = m.settings().reminder_minutes;
    if lead == 0 || crate::calendar::access() != crate::calendar::Access::Granted {
        return;
    }
    let now = Utc::now();
    let Ok(events) = crate::calendar::events(now, now + chrono::Duration::minutes(lead as i64 + 1)) else { return };
    for e in crate::calendar::due_reminders(&events, now, lead, reminded) {
        let minutes = (e.start - now).num_minutes().max(1);
        let at = e.start.with_timezone(&chrono::Local).format("%H:%M");
        let join = if e.join_url.is_some() { " · Join from the menu bar" } else { "" };
        let _ = app.notification().builder().title(&e.title).body(format!("Starts at {at} (in {minutes} min){join}")).show();
        reminded.push(e.id.clone());
    }
    // Only recent ids matter: an event can't be due twice.
    if reminded.len() > 200 {
        reminded.drain(..100);
    }
}

/// Run `f` forever on its own thread, surviving a panic in one round.
fn spawn_loop(name: &str, first_wait: Duration, mut f: impl FnMut() -> Duration + Send + 'static) {
    std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            std::thread::sleep(first_wait);
            loop {
                let wait = std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut f)).unwrap_or(IDLE_POLL);
                std::thread::sleep(wait);
            }
        })
        .expect("could not start a meetings thread");
}

/// Start the microphone watcher and, on its own thread so a slow
/// TargetProcess never delays detection, the recurring logger.
pub fn start(app: AppHandle, meetings: MeetingsState) {
    refresh_menubar_soon(&app, &meetings);
    let (poll_app, poll_meetings) = (app.clone(), Arc::clone(&meetings));
    spawn_loop("meetings-mic", Duration::ZERO, move || {
        poll_microphone(&poll_app, &poll_meetings);
        if poll_meetings.tracker().is_live() { LIVE_POLL } else { IDLE_POLL }
    });
    // The menu-bar timer ticks every second during a call.
    let (tick_app, tick_meetings) = (app.clone(), Arc::clone(&meetings));
    spawn_loop("meetings-menubar", Duration::ZERO, move || {
        if tick_meetings.tracker().is_live() {
            update_menubar(&tick_app, &tick_meetings);
            Duration::from_secs(1)
        } else {
            Duration::from_secs(2)
        }
    });
    // Reminders before scheduled meetings.
    let (remind_app, remind_meetings) = (app.clone(), Arc::clone(&meetings));
    let mut reminded: Vec<String> = Vec::new();
    spawn_loop("calendar-reminders", Duration::from_secs(10), move || {
        remind_upcoming(&remind_app, &remind_meetings, &mut reminded);
        REMINDER_POLL
    });
    spawn_loop("meetings-background", RECURRING_FIRST, move || {
        recurring_tick(&app, &meetings);
        // Offline or not configured: keep the last known hours.
        if let Err(e) = refresh_today_hours(&meetings) {
            eprintln!("today's hours: {e}");
        }
        update_menubar(&app, &meetings);
        BACKGROUND_EVERY
    });
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn meeting_overview(meetings: State<'_, MeetingsState>) -> Overview {
    overview(&meetings)
}

/// Close the current part and start a new one.
#[tauri::command]
pub fn meeting_split(app: AppHandle, meetings: State<'_, MeetingsState>) {
    let ended = meetings.tracker().split(Utc::now());
    let _ = app.emit("meeting-state", meetings.tracker().state());
    if let Some(seg) = ended {
        meeting_ended(&app, &meetings, seg);
    }
}

/// Stop tracking the current call without leaving it.
#[tauri::command]
pub fn meeting_stop(app: AppHandle, meetings: State<'_, MeetingsState>) {
    let ended = meetings.tracker().stop(Utc::now());
    let _ = app.emit("meeting-state", meetings.tracker().state());
    if let Some(seg) = ended {
        meeting_ended(&app, &meetings, seg);
    }
}

/// Log a finished meeting to a TargetProcess item, dated on the meeting's day.
#[tauri::command]
pub async fn meeting_log(
    app: AppHandle,
    meetings: State<'_, MeetingsState>,
    id: String,
    task_id: i64,
    hours: f64,
    description: String,
) -> Result<LoggedMeeting, String> {
    if task_id <= 0 {
        return Err("Choose a task to log to.".into());
    }
    if !hours.is_finite() || hours <= 0.0 || hours > 12.0 {
        return Err("Hours must be between 0 and 12.".into());
    }
    // Claim the meeting first, so a double click can't log it twice.
    let meeting = meetings.update_logged(|f| {
        let i = f.pending.iter().position(|p| p.id == id)?;
        Some(f.pending.remove(i))
    });
    let meeting = meeting.ok_or("This meeting was already logged or dismissed.")?;
    // TargetProcess refuses time without a description.
    let description = match description.trim() {
        "" => default_description(&meeting),
        text => text.to_string(),
    };
    emit_changed(&app, &meetings);
    let claimed = meeting.clone();
    let sent = blocking(move || {
        let tp = TpSettings::load();
        let day = today_in_offset(claimed.start, tp.tz_offset_minutes);
        client(&tp)?
            .log_time(task_id, hours, description.trim(), day, tp.tz_offset_minutes)
            .map_err(|e| e.to_string())
            .map(|time_id| (time_id, description))
    })
    .await;
    let (time_id, description) = match sent {
        Ok(ok) => ok,
        Err(e) => {
            // Not logged: put it back so it can be tried again.
            meetings.update_logged(|f| f.pending.push(meeting));
            emit_changed(&app, &meetings);
            return Err(e);
        }
    };
    let logged = LoggedMeeting {
        id: meeting.id,
        start: meeting.start,
        end: meeting.end,
        hours,
        task_id,
        description: description.trim().to_string(),
        time_id,
        kind: meeting_kind(),
    };
    let cutoff = Utc::now() - chrono::Duration::days(LOGGED_KEEP_DAYS);
    meetings.update_logged(|f| {
        f.logged.retain(|l| l.end >= cutoff);
        f.logged.push(logged.clone());
        f.pending.sort_by_key(|p| p.start);
    });
    refresh_menubar_soon(&app, &meetings);
    emit_changed(&app, &meetings);
    Ok(logged)
}

/// Forget a finished meeting without logging it.
#[tauri::command]
pub fn meeting_dismiss(app: AppHandle, meetings: State<'_, MeetingsState>, id: String) -> Result<(), String> {
    meetings.update(|f| f.pending.retain(|p| p.id != id))?;
    emit_changed(&app, &meetings);
    update_menubar(&app, &meetings);
    Ok(())
}

#[tauri::command]
pub fn meeting_settings_get(meetings: State<'_, MeetingsState>) -> MeetingSettings {
    meetings.settings()
}

#[tauri::command]
pub fn meeting_settings_save(
    app: AppHandle,
    meetings: State<'_, MeetingsState>,
    settings: MeetingSettings,
) -> Result<MeetingSettings, String> {
    let settings = MeetingSettings { imported: true, ..settings }.validated()?;
    meetings.update(|f| f.settings = settings.clone())?;
    if !settings.enabled {
        meetings.tracker().reset();
        let _ = app.emit("meeting-state", meetings.tracker().state());
    }
    Ok(settings)
}

#[derive(Serialize)]
pub struct HolidayList {
    pub fixed: Vec<holidays::Holiday>,
    pub religious: Vec<holidays::Holiday>,
}

#[tauri::command]
pub fn meeting_holidays(year: i32) -> HolidayList {
    HolidayList { fixed: holidays::fixed(year), religious: holidays::religious(year) }
}

/// Log today's recurring entries now instead of waiting for the next check.
#[tauri::command]
pub async fn meeting_run_recurring(app: AppHandle, meetings: State<'_, MeetingsState>) -> Result<Vec<String>, String> {
    let m = Arc::clone(&meetings);
    let done = blocking(move || run_recurring(&m)).await?;
    emit_changed(&app, &meetings);
    refresh_menubar_soon(&app, &meetings);
    Ok(done)
}

/// Time was logged elsewhere in the app: update today's hours in the menu bar.
#[tauri::command]
pub fn menubar_refresh(app: AppHandle, meetings: State<'_, MeetingsState>) {
    refresh_menubar_soon(&app, &meetings);
}
