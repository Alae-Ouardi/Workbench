//! EventKit access. One event store, owned by its own thread (creating one is
//! slow, and the store is not thread-safe); everything else sends it jobs.

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use block2::RcBlock;
use chrono::{DateTime, Utc};
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_app_kit::NSColorSpace;
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEvent, EKEventStore, EKParticipant, EKParticipantStatus};
use objc2_foundation::{NSDate, NSError, NSString};

use super::{links, Access, Attendee, CalEvent, CalendarInfo};

/// The store, and whether it was created after access was granted (a store
/// made before that sees no calendars, even once access is allowed).
struct Worker {
    store: Retained<EKEventStore>,
    authorized: bool,
}

type Job = Box<dyn FnOnce(&mut Worker) + Send>;

/// Longest the user may take to answer the permission prompt.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(180);
/// Notes are shown, not archived: keep them to a readable size.
const MAX_NOTES: usize = 6000;

fn worker() -> &'static Sender<Job> {
    static SENDER: OnceLock<Sender<Job>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("calendar".into())
            .spawn(move || {
                // SAFETY: plain allocation of an EventKit store on this thread.
                let mut worker = Worker { store: unsafe { EKEventStore::new() }, authorized: access() == Access::Granted };
                for job in rx {
                    job(&mut worker);
                }
            })
            .expect("could not start the calendar thread");
        tx
    })
}

/// Run `f` on the calendar thread and wait for its answer.
fn with_store<T: Send + 'static>(f: impl FnOnce(&EKEventStore) -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    worker()
        .send(Box::new(move |w: &mut Worker| {
            // Access granted since the store was made (prompt answered late,
            // or allowed in System Settings): start a fresh one.
            if !w.authorized && access() == Access::Granted {
                // SAFETY: as above.
                w.store = unsafe { EKEventStore::new() };
                w.authorized = true;
            }
            let _ = tx.send(f(&w.store));
        }))
        .map_err(|_| "The calendar reader stopped.".to_string())?;
    rx.recv().map_err(|_| "The calendar reader stopped.".to_string())
}

pub fn access() -> Access {
    // SAFETY: a class method with no preconditions.
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    match status {
        EKAuthorizationStatus::FullAccess => Access::Granted,
        EKAuthorizationStatus::NotDetermined => Access::NotDetermined,
        EKAuthorizationStatus::Restricted => Access::Restricted,
        // Denied, or "add events only", which can't read anything.
        _ => Access::Denied,
    }
}

pub fn request_access() -> Result<Access, String> {
    if access() != Access::NotDetermined {
        return Ok(access());
    }
    let (tx, rx) = mpsc::channel::<bool>();
    with_store(move |store| {
        let block = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            let _ = tx.send(granted.as_bool());
        });
        // SAFETY: the block lives until the call returns; EventKit copies it.
        unsafe { store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _) };
    })?;
    // The next query notices the new access and rebuilds the store.
    let _ = rx.recv_timeout(PROMPT_TIMEOUT);
    Ok(access())
}

fn text(s: Option<Retained<NSString>>) -> Option<String> {
    s.map(|s| s.to_string()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn instant(date: &NSDate) -> DateTime<Utc> {
    let secs = date.timeIntervalSince1970();
    DateTime::from_timestamp(secs.floor() as i64, 0).unwrap_or_default()
}

fn hex_color(color: &objc2_app_kit::NSColor) -> String {
    let srgb = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace());
    let Some(c) = srgb else { return "#94a3b8".into() };
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(c.redComponent()), byte(c.greenComponent()), byte(c.blueComponent()))
}

fn status_name(status: EKParticipantStatus) -> &'static str {
    match status {
        EKParticipantStatus::Accepted => "accepted",
        EKParticipantStatus::Declined => "declined",
        EKParticipantStatus::Tentative => "tentative",
        EKParticipantStatus::Pending => "pending",
        EKParticipantStatus::Delegated => "delegated",
        _ => "unknown",
    }
}

fn attendee(p: &EKParticipant) -> Attendee {
    // SAFETY: plain property reads on a live participant.
    unsafe {
        let email = p
            .URL()
            .absoluteString()
            .map(|s| s.to_string())
            .and_then(|s| s.strip_prefix("mailto:").map(String::from));
        Attendee {
            name: text(p.name()).or_else(|| email.clone()).unwrap_or_else(|| "Unknown".into()),
            email,
            status: status_name(p.participantStatus()).into(),
            is_me: p.isCurrentUser(),
        }
    }
}

fn convert(e: &EKEvent) -> CalEvent {
    // SAFETY: plain property reads on a live event, on the store's thread.
    unsafe {
        let start = instant(&e.startDate());
        let end = instant(&e.endDate());
        let calendar = e.calendar().map(|c| CalendarInfo {
            id: c.calendarIdentifier().to_string(),
            title: c.title().to_string(),
            color: hex_color(&c.color()),
        });
        let location = text(e.location());
        let mut notes = text(e.notes());
        if let Some(n) = notes.as_mut() {
            if n.len() > MAX_NOTES {
                let cut = (0..=MAX_NOTES).rev().find(|i| n.is_char_boundary(*i)).unwrap_or(0);
                n.truncate(cut);
                n.push('…');
            }
        }
        let url = e.URL().and_then(|u| u.absoluteString()).map(|s| s.to_string());
        let attendees: Vec<Attendee> = e.attendees().map(|list| list.iter().map(|p| attendee(&p)).collect()).unwrap_or_default();
        let base_id = e.eventIdentifier().map(|s| s.to_string()).unwrap_or_else(|| e.calendarItemIdentifier().to_string());
        CalEvent {
            id: format!("{base_id}|{}", start.timestamp()),
            title: text(Some(e.title())).unwrap_or_else(|| "(No title)".into()),
            start,
            end,
            all_day: e.isAllDay(),
            calendar: calendar.unwrap_or(CalendarInfo { id: String::new(), title: "Calendar".into(), color: "#94a3b8".into() }),
            join_url: links::join_url(url.as_deref(), location.as_deref(), notes.as_deref()),
            location,
            notes,
            url,
            organizer: e.organizer().and_then(|o| text(o.name())),
            my_status: attendees.iter().find(|a| a.is_me).map(|a| a.status.clone()),
            attendees,
        }
    }
}

pub fn events(from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<CalEvent>, String> {
    if access() != Access::Granted {
        return Err("Workbench doesn't have access to your calendars yet.".into());
    }
    with_store(move |store| {
        let start = NSDate::dateWithTimeIntervalSince1970(from.timestamp() as f64);
        let end = NSDate::dateWithTimeIntervalSince1970(to.timestamp() as f64);
        // SAFETY: valid dates; `None` means every calendar.
        let found = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
            store.eventsMatchingPredicate(&predicate)
        };
        let mut list: Vec<CalEvent> = found.iter().map(|e| convert(&e)).collect();
        list.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
        list
    })
}
