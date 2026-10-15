//! The user's scheduled meetings, read from the Mac's calendars (EventKit).
//! Outlook/Exchange, Google and iCloud calendars all appear here once the
//! account is added to macOS. Read-only: nothing is ever written back.

pub mod links;
#[cfg(target_os = "macos")]
mod store;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::util::blocking;

#[derive(Debug, Clone, Serialize)]
pub struct CalendarInfo {
    pub id: String,
    pub title: String,
    /// "#rrggbb"
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Attendee {
    pub name: String,
    pub email: Option<String>,
    /// accepted, declined, tentative, pending, …
    pub status: String,
    pub is_me: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CalEvent {
    /// Unique per occurrence (recurring events share the calendar's id).
    pub id: String,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub all_day: bool,
    pub calendar: CalendarInfo,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub url: Option<String>,
    /// Teams/Zoom/Meet/… link to join, if the invite has one.
    pub join_url: Option<String>,
    pub organizer: Option<String>,
    pub attendees: Vec<Attendee>,
    /// The user's own answer to the invite, when they are an attendee.
    pub my_status: Option<String>,
}

/// Whether the app may read the calendars.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    /// Never asked: the app can ask.
    NotDetermined,
    /// Refused (or limited to adding events): must be changed in System Settings.
    Denied,
    Restricted,
    Granted,
}

/// Events overlapping `[from, to)`, sorted by start.
pub fn events(from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<CalEvent>, String> {
    if to <= from || (to - from).num_days() > 62 {
        return Err("Pick a range of up to two months.".into());
    }
    #[cfg(target_os = "macos")]
    {
        store::events(from, to)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Calendars are only available on macOS.".into())
    }
}

pub fn access() -> Access {
    #[cfg(target_os = "macos")]
    {
        store::access()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Access::Denied
    }
}

/// The scheduled meeting that overlaps a call the most, if any (all-day
/// events and ones the user declined don't count).
pub fn best_match(events: &[CalEvent], start: DateTime<Utc>, end: DateTime<Utc>) -> Option<&CalEvent> {
    events
        .iter()
        .filter(|e| !e.all_day && e.my_status.as_deref() != Some("declined"))
        .map(|e| (e, (e.end.min(end) - e.start.max(start)).num_seconds()))
        .filter(|(_, overlap)| *overlap > 0)
        .max_by_key(|(_, overlap)| *overlap)
        .map(|(e, _)| e)
}

/// Meetings to remind about now: starting within `lead_minutes`, not yet
/// started, and not reminded before (by id in `already`).
pub fn due_reminders<'a>(events: &'a [CalEvent], now: DateTime<Utc>, lead_minutes: u32, already: &[String]) -> Vec<&'a CalEvent> {
    let lead = chrono::Duration::minutes(lead_minutes as i64);
    events
        .iter()
        .filter(|e| !e.all_day && e.my_status.as_deref() != Some("declined"))
        .filter(|e| e.start > now && e.start - now <= lead)
        .filter(|e| !already.contains(&e.id))
        .collect()
}

#[tauri::command]
pub fn calendar_access() -> Access {
    access()
}

/// Ask macOS for access (shows the system prompt the first time).
#[tauri::command]
pub async fn calendar_request_access() -> Result<Access, String> {
    #[cfg(target_os = "macos")]
    {
        blocking(store::request_access).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Access::Denied)
    }
}

#[tauri::command]
pub async fn calendar_events(from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<CalEvent>, String> {
    blocking(move || events(from, to)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_790_000_000 + minutes * 60, 0).unwrap()
    }

    fn event(id: &str, start: i64, end: i64) -> CalEvent {
        CalEvent {
            id: id.into(),
            title: id.into(),
            start: at(start),
            end: at(end),
            all_day: false,
            calendar: CalendarInfo { id: "c".into(), title: "Work".into(), color: "#22d3ee".into() },
            location: None,
            notes: None,
            url: None,
            join_url: None,
            organizer: None,
            attendees: vec![],
            my_status: None,
        }
    }

    #[test]
    fn picks_the_meeting_overlapping_the_call_most() {
        let events = vec![event("standup", 0, 15), event("review", 15, 75), event("lunch", 120, 180)];
        // A call from 0:10 to 1:00 mostly overlaps the review.
        assert_eq!(best_match(&events, at(10), at(60)).map(|e| e.id.as_str()), Some("review"));
        assert!(best_match(&events, at(90), at(110)).is_none());
    }

    #[test]
    fn reminds_once_within_the_lead_time() {
        let events = vec![event("soon", 4, 30), event("later", 20, 30), event("started", -5, 30)];
        let due: Vec<_> = due_reminders(&events, at(0), 5, &[]).iter().map(|e| e.id.clone()).collect();
        assert_eq!(due, vec!["soon".to_string()]);
        assert!(due_reminders(&events, at(0), 5, &["soon".into()]).is_empty());
    }

    #[test]
    fn ignores_all_day_and_declined_events() {
        let mut all_day = event("holiday", 0, 1440);
        all_day.all_day = true;
        let mut declined = event("declined", 0, 60);
        declined.my_status = Some("declined".into());
        assert!(best_match(&[all_day, declined], at(5), at(50)).is_none());
    }
}
