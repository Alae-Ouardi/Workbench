//! When a meeting starts and ends, from a stream of "is the microphone in use"
//! samples. Pure: the caller supplies the clock, so it is fully testable.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::collections::BTreeSet;

/// Shorter calls (a voice memo, a quick dictation) are not meetings.
pub const MIN_SECONDS: i64 = 60;
/// A microphone quiet for less than this (a reconnect, switching devices)
/// does not end the meeting.
pub const GRACE_SECONDS: i64 = 12;
/// A gap this long while the microphone is busy means the Mac slept: the call
/// before the gap is over and whatever follows is a new one.
pub const SLEEP_GAP_SECONDS: i64 = 120;

/// A finished stretch of microphone use.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Segment {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub apps: Vec<String>,
}

#[derive(Debug, Clone)]
struct Live {
    start: DateTime<Utc>,
    last_seen: DateTime<Utc>,
    apps: BTreeSet<String>,
}

#[derive(Debug, Default)]
pub struct Tracker {
    live: Option<Live>,
    /// Set by "stop tracking": ignore the microphone until it has been
    /// released for the grace period. Holds when it was last seen busy.
    suppressed_seen: Option<DateTime<Utc>>,
}

/// What the UI shows while a meeting is running.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiveState {
    pub active: bool,
    pub started_at: Option<DateTime<Utc>>,
    pub apps: Vec<String>,
    /// Detection is paused for the current call ("stop tracking").
    pub suppressed: bool,
}

impl Tracker {
    pub fn state(&self) -> LiveState {
        LiveState {
            active: self.live.is_some(),
            started_at: self.live.as_ref().map(|l| l.start),
            apps: self.live.as_ref().map(|l| l.apps.iter().cloned().collect()).unwrap_or_default(),
            suppressed: self.suppressed_seen.is_some(),
        }
    }

    pub fn is_live(&self) -> bool {
        self.live.is_some()
    }

    /// Feed one sample. Returns the meeting that just ended, if any.
    pub fn tick(&mut self, now: DateTime<Utc>, mic_active: bool, apps: &[String]) -> Option<Segment> {
        if let Some(seen) = self.suppressed_seen {
            if mic_active {
                self.suppressed_seen = Some(now);
                return None;
            }
            if now - seen < Duration::seconds(GRACE_SECONDS) {
                return None;
            }
            // Released for good: the next call is detected again.
            self.suppressed_seen = None;
        }

        if mic_active {
            if let Some(live) = &self.live {
                if now - live.last_seen > Duration::seconds(SLEEP_GAP_SECONDS) {
                    let end = live.last_seen;
                    let ended = self.finish(end);
                    self.live = Some(Live { start: now, last_seen: now, apps: apps.iter().cloned().collect() });
                    return ended;
                }
            }
            let live = self.live.get_or_insert_with(|| Live { start: now, last_seen: now, apps: BTreeSet::new() });
            live.last_seen = now;
            live.apps.extend(apps.iter().cloned());
            return None;
        }

        let live = self.live.as_ref()?;
        if now - live.last_seen < Duration::seconds(GRACE_SECONDS) {
            return None;
        }
        // Ended when the microphone was last seen busy (also right after the
        // Mac wakes from sleep, where `now` may be hours later).
        let end = live.last_seen;
        self.finish(end)
    }

    /// Close the current part now and start a new one (breakout rooms, a
    /// second meeting straight after the first).
    pub fn split(&mut self, now: DateTime<Utc>) -> Option<Segment> {
        let apps = self.live.as_ref()?.apps.clone();
        let ended = self.finish(now);
        self.live = Some(Live { start: now, last_seen: now, apps });
        ended
    }

    /// Stop tracking without leaving the call. Returns what was tracked.
    pub fn stop(&mut self, now: DateTime<Utc>) -> Option<Segment> {
        self.live.as_ref()?;
        self.suppressed_seen = Some(now);
        self.finish(now)
    }

    /// Detection turned off: drop the current meeting without logging it.
    pub fn reset(&mut self) {
        self.live = None;
        self.suppressed_seen = None;
    }

    fn finish(&mut self, end: DateTime<Utc>) -> Option<Segment> {
        let live = self.live.take()?;
        (end - live.start >= Duration::seconds(MIN_SECONDS)).then(|| Segment {
            start: live.start,
            end,
            apps: live.apps.into_iter().collect(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_790_000_000 + seconds, 0).unwrap()
    }

    /// Exactly these samples (a gap between them means the Mac slept).
    fn run_raw(tracker: &mut Tracker, samples: &[(i64, bool)]) -> Vec<Segment> {
        samples.iter().filter_map(|&(s, on)| tracker.tick(t(s), on, &[])).collect()
    }

    /// These samples, with the regular polls in between two busy ones filled in.
    fn run(tracker: &mut Tracker, samples: &[(i64, bool)]) -> Vec<Segment> {
        let mut all = Vec::new();
        for (i, &(s, on)) in samples.iter().enumerate() {
            if let Some(&(prev, true)) = i.checked_sub(1).and_then(|p| samples.get(p)) {
                if on {
                    all.extend((prev + 60..s).step_by(60).map(|x| (x, true)));
                }
            }
            all.push((s, on));
        }
        run_raw(tracker, &all)
    }

    #[test]
    fn a_call_ends_when_the_microphone_is_released() {
        let mut tr = Tracker::default();
        let done = run(&mut tr, &[(0, true), (600, true), (1800, true), (1803, false), (1820, false)]);
        assert_eq!(done, vec![Segment { start: t(0), end: t(1800), apps: vec![] }]);
        assert!(!tr.is_live());
    }

    #[test]
    fn a_short_gap_does_not_split_the_call() {
        let mut tr = Tracker::default();
        let done = run(&mut tr, &[(0, true), (300, true), (305, false), (310, true), (900, true), (930, false)]);
        assert_eq!(done.len(), 1);
        assert_eq!((done[0].start, done[0].end), (t(0), t(900)));
    }

    #[test]
    fn blips_under_a_minute_are_ignored() {
        let mut tr = Tracker::default();
        assert!(run(&mut tr, &[(0, true), (30, true), (60, false)]).is_empty());
        assert!(!tr.is_live());
    }

    #[test]
    fn sleeping_mid_call_ends_it_when_last_seen() {
        let mut tr = Tracker::default();
        let done = run_raw(&mut tr, &[(0, true), (60, true), (120, true), (9000, false)]);
        assert_eq!(done[0].end, t(120));
    }

    #[test]
    fn split_closes_one_part_and_starts_the_next() {
        let mut tr = Tracker::default();
        run(&mut tr, &[(0, true), (900, true)]);
        let first = tr.split(t(1000)).unwrap();
        assert_eq!((first.start, first.end), (t(0), t(1000)));
        assert_eq!(tr.state().started_at, Some(t(1000)));
        let done = run(&mut tr, &[(1000, true), (2000, true), (2020, false)]);
        assert_eq!((done[0].start, done[0].end), (t(1000), t(2000)));
    }

    #[test]
    fn stop_ignores_the_rest_of_the_call_however_long() {
        let mut tr = Tracker::default();
        run(&mut tr, &[(0, true), (600, true)]);
        assert_eq!(tr.stop(t(700)).unwrap().end, t(700));
        assert!(run(&mut tr, &[(710, true), (3000, true), (3005, false), (3008, true)]).is_empty());
        assert!(!tr.is_live());
        // Released past the grace period, then a new call is detected again.
        run(&mut tr, &[(3020, false), (3030, false), (3100, true)]);
        assert!(tr.is_live());
        assert_eq!(tr.state().started_at, Some(t(3100)));
    }

    #[test]
    fn a_sleep_gap_while_busy_starts_a_new_meeting() {
        let mut tr = Tracker::default();
        let done = run_raw(&mut tr, &[(0, true), (60, true), (120, true), (5000, true)]);
        assert_eq!((done[0].start, done[0].end), (t(0), t(120)));
        assert_eq!(tr.state().started_at, Some(t(5000)));
    }

    #[test]
    fn remembers_which_apps_used_the_microphone() {
        let mut tr = Tracker::default();
        tr.tick(t(0), true, &["com.microsoft.teams2".into()]);
        tr.tick(t(100), true, &["com.google.Chrome".into()]);
        let seg = tr.split(t(200)).unwrap();
        assert_eq!(seg.apps, vec!["com.google.Chrome".to_string(), "com.microsoft.teams2".to_string()]);
    }
}
