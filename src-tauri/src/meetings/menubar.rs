//! The text next to the menu-bar icon: a timer during a call, otherwise the
//! hours logged today, plus how many meetings still need logging.

use chrono::{DateTime, Utc};

/// "5h 15m", "45m", "2h" — the same style as the rest of the app.
pub fn fmt_hours(hours: f64) -> String {
    let minutes = (hours * 60.0).round().max(0.0) as i64;
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m}m"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h {m}m"),
    }
}

/// "● 12:04" — or "● 1:02:09" past the hour — for a running call.
fn timer(since: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let secs = (now - since).num_seconds().max(0);
    let (h, m, s) = (secs / 3600, secs % 3600 / 60, secs % 60);
    if h > 0 { format!("● {h}:{m:02}:{s:02}") } else { format!("● {m}:{s:02}") }
}

pub fn title(live_since: Option<DateTime<Utc>>, now: DateTime<Utc>, today_hours: Option<f64>, pending: usize) -> String {
    let main = match (live_since, today_hours) {
        (Some(since), _) => Some(timer(since, now)),
        (None, Some(h)) => Some(fmt_hours(h)),
        (None, None) => None,
    };
    let waiting = (pending > 0).then(|| format!("{pending} to log"));
    [main, waiting].into_iter().flatten().collect::<Vec<_>>().join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_790_000_000 + minutes * 60, 0).unwrap()
    }

    #[test]
    fn formats_hours_like_the_app() {
        assert_eq!(fmt_hours(5.25), "5h 15m");
        assert_eq!(fmt_hours(0.75), "45m");
        assert_eq!(fmt_hours(2.0), "2h");
        assert_eq!(fmt_hours(0.0), "0m");
    }

    #[test]
    fn shows_the_timer_during_a_call() {
        assert_eq!(title(Some(at(0)), at(83), Some(4.0), 0), "● 1:23:00");
        assert_eq!(title(Some(at(0)), at(5), None, 2), "● 5:00 · 2 to log");
    }

    #[test]
    fn otherwise_shows_today_and_what_is_waiting() {
        assert_eq!(title(None, at(0), Some(5.25), 0), "5h 15m");
        assert_eq!(title(None, at(0), Some(5.25), 1), "5h 15m · 1 to log");
        assert_eq!(title(None, at(0), None, 0), "");
    }
}
