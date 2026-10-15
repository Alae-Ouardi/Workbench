//! Recurring time (the daily standup, a weekly sync…) logged automatically
//! once per working day. A local ledger stops it logging twice, and a look at
//! the day's TargetProcess entries stops it duplicating time logged by hand
//! or by another app.

use chrono::NaiveDate;

use super::settings::{MeetingSettings, RecurringEntry};

/// Ledger key for one entry on one day.
pub fn ledger_key(day: NaiveDate, task_id: i64) -> String {
    format!("{}|{task_id}", day.format("%Y-%m-%d"))
}

/// The entries still to log today; none on days off.
pub fn due<'a>(settings: &'a MeetingSettings, today: NaiveDate, done: &[String]) -> Vec<&'a RecurringEntry> {
    if !settings.is_working_day(today) {
        return Vec::new();
    }
    settings
        .recurring
        .iter()
        .filter(|r| r.task_id > 0 && r.hours > 0.0 && !done.contains(&ledger_key(today, r.task_id)))
        .collect()
}

/// Keep the ledger to recent days so it doesn't grow forever.
pub fn prune(done: &mut Vec<String>, today: NaiveDate) {
    let cutoff = (today - chrono::Duration::days(14)).format("%Y-%m-%d").to_string();
    done.retain(|k| k.as_str() >= cutoff.as_str());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn settings() -> MeetingSettings {
        MeetingSettings {
            recurring: vec![
                RecurringEntry { id: "a".into(), label: "Daily".into(), task_id: 11, hours: 0.25 },
                RecurringEntry { id: "b".into(), label: "Sync".into(), task_id: 12, hours: 0.5 },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn logs_each_entry_once_per_working_day() {
        let s = settings();
        let today = day("2026-10-13");
        assert_eq!(due(&s, today, &[]).len(), 2);
        let done = vec![ledger_key(today, 11)];
        assert_eq!(due(&s, today, &done).iter().map(|r| r.task_id).collect::<Vec<_>>(), vec![12]);
    }

    #[test]
    fn nothing_on_days_off() {
        assert!(due(&settings(), day("2026-10-17"), &[]).is_empty());
    }

    #[test]
    fn prunes_old_ledger_entries() {
        let mut done = vec!["2026-09-01|11".to_string(), "2026-10-12|11".to_string()];
        prune(&mut done, day("2026-10-13"));
        assert_eq!(done, vec!["2026-10-12|11".to_string()]);
    }
}
