//! Meeting and recurring-time settings, kept in `~/.workbench/meetings.json`
//! alongside the to-log list. The first time they are read, values from an
//! existing TimeAgent setup are imported if there is one.

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::holidays;

/// A saved choice for the end-of-meeting popup ("Sprint review → #1234").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Shortcut {
    pub id: String,
    pub name: String,
    pub task_id: i64,
    #[serde(default)]
    pub description: String,
}

/// Time logged automatically once per working day (e.g. the daily standup).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecurringEntry {
    pub id: String,
    pub label: String,
    pub task_id: i64,
    pub hours: f64,
}

/// The user's confirmation of one religious-holiday estimate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HolidayChoice {
    pub key: String,
    pub date: String,
    pub on: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MeetingSettings {
    /// Watch the microphone for meetings.
    pub enabled: bool,
    /// Logged by the "Daily" button.
    pub daily_task_id: i64,
    /// Pre-selected in "Choose task".
    pub meetings_task_id: i64,
    /// Every meeting counts for at least this long…
    pub min_minutes: u32,
    /// …and is rounded up to a multiple of this.
    pub step_minutes: u32,
    pub shortcuts: Vec<Shortcut>,
    pub recurring: Vec<RecurringEntry>,
    /// ISO weekdays off (6 = Saturday, 7 = Sunday).
    pub weekly_off: Vec<u32>,
    /// Personal days off, YYYY-MM-DD.
    pub days_off: Vec<String>,
    /// "none" or "morocco".
    pub region: String,
    pub holiday_choices: Vec<HolidayChoice>,
    /// Set once the TimeAgent import has been attempted.
    pub imported: bool,
    /// Notify this many minutes before a scheduled meeting; 0 turns it off.
    pub reminder_minutes: u32,
}

impl Default for MeetingSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            daily_task_id: 0,
            meetings_task_id: 0,
            min_minutes: 30,
            step_minutes: 15,
            shortcuts: Vec::new(),
            recurring: Vec::new(),
            weekly_off: vec![6, 7],
            days_off: Vec::new(),
            region: "none".into(),
            holiday_choices: Vec::new(),
            imported: false,
            reminder_minutes: 5,
        }
    }
}

fn is_day(s: &str) -> bool {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

impl MeetingSettings {
    /// Reject what would log the wrong time; tidy the rest.
    pub fn validated(mut self) -> Result<Self, String> {
        if self.step_minutes == 0 || self.step_minutes > 240 {
            return Err("The rounding step must be between 1 and 240 minutes.".into());
        }
        if self.reminder_minutes > 120 {
            return Err("Reminders can be at most 2 hours before.".into());
        }
        if self.min_minutes > 480 {
            return Err("The minimum must be 8 hours or less.".into());
        }
        if self.daily_task_id < 0 || self.meetings_task_id < 0 {
            return Err("Task ids must be positive.".into());
        }
        for s in &self.shortcuts {
            if s.name.trim().is_empty() || s.task_id <= 0 {
                return Err("Every shortcut needs a name and a task id.".into());
            }
        }
        for r in &self.recurring {
            if r.task_id <= 0 || !(r.hours > 0.0 && r.hours <= 8.0) {
                return Err("Every recurring entry needs a task id and between 0 and 8 hours.".into());
            }
        }
        if let Some(bad) = self.days_off.iter().find(|d| !is_day(d)) {
            return Err(format!("'{bad}' is not a YYYY-MM-DD date."));
        }
        if self.holiday_choices.iter().any(|c| !is_day(&c.date)) {
            return Err("Holiday dates must be YYYY-MM-DD.".into());
        }
        if !matches!(self.region.as_str(), "none" | "morocco") {
            self.region = "none".into();
        }
        self.weekly_off.retain(|d| (1..=7).contains(d));
        self.weekly_off.sort_unstable();
        self.weekly_off.dedup();
        self.days_off.sort();
        self.days_off.dedup();
        Ok(self)
    }

    /// Every day off in a year: personal days plus the region's holidays
    /// (religious ones as confirmed or moved by the user).
    pub fn days_off_in(&self, year: i32) -> BTreeSet<String> {
        let mut out: BTreeSet<String> = self.days_off.iter().cloned().collect();
        if self.region == "morocco" {
            out.extend(holidays::fixed(year).into_iter().map(|h| h.date));
            for h in holidays::religious(year) {
                let key = h.key.unwrap_or_default();
                match self.holiday_choices.iter().find(|c| c.key == key) {
                    Some(c) if c.on => {
                        out.insert(c.date.clone());
                    }
                    Some(_) => {}
                    None => {
                        out.insert(h.date);
                    }
                }
            }
        }
        out
    }

    pub fn is_working_day(&self, day: NaiveDate) -> bool {
        !self.weekly_off.contains(&day.weekday().number_from_monday())
            && !self.days_off_in(day.year()).contains(&day.format("%Y-%m-%d").to_string())
    }
}

/// Values from a TimeAgent `settings.json`, if present and readable. Only the
/// meeting and day-off fields are taken; its token and account are not.
pub fn from_timeagent(raw: &str) -> Option<MeetingSettings> {
    let j: serde_json::Value = serde_json::from_str(raw).ok()?;
    let int = |k: &str| j.get(k).and_then(|v| v.as_i64());
    let mut s = MeetingSettings {
        daily_task_id: int("dailyTaskId").unwrap_or(0).max(0),
        meetings_task_id: int("meetingsTaskId").unwrap_or(0).max(0),
        ..Default::default()
    };
    if let Some(m) = int("meetingMinMinutes") {
        s.min_minutes = m.clamp(0, 480) as u32;
    }
    if let Some(m) = int("meetingStepMinutes") {
        s.step_minutes = m.clamp(1, 240) as u32;
    }
    if let Some(days) = j.get("weeklyOff").and_then(|v| v.as_array()) {
        // TimeAgent counts 0 = Sunday … 6 = Saturday.
        s.weekly_off = days.iter().filter_map(|d| d.as_u64()).map(|d| if d == 0 { 7 } else { d as u32 }).collect();
    }
    if let Some(days) = j.get("daysOff").and_then(|v| v.as_array()) {
        s.days_off = days.iter().filter_map(|d| d.as_str()).filter(|d| is_day(d)).map(String::from).collect();
    }
    if j.get("region").and_then(|v| v.as_str()) == Some("morocco") {
        s.region = "morocco".into();
    }
    let list = |k: &str| j.get(k).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let text = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    s.holiday_choices = list("religiousSlots")
        .iter()
        .filter_map(|v| {
            let (key, date) = (text(v, "key"), text(v, "date"));
            (!key.is_empty() && is_day(&date)).then(|| HolidayChoice { key, date, on: v.get("on").and_then(|x| x.as_bool()).unwrap_or(true) })
        })
        .collect();
    s.recurring = list("recurring")
        .iter()
        .enumerate()
        .filter_map(|(i, v)| {
            let task_id = v.get("taskId").and_then(|x| x.as_i64()).unwrap_or(0);
            let hours = v.get("hours").and_then(|x| x.as_f64()).unwrap_or(0.0);
            (task_id > 0 && hours > 0.0 && hours <= 8.0).then(|| RecurringEntry {
                id: format!("imported-r{i}"),
                label: text(v, "label"),
                task_id,
                hours,
            })
        })
        .collect();
    s.shortcuts = list("dynamicMeetings")
        .iter()
        .enumerate()
        .filter_map(|(i, v)| {
            let task_id = v.get("taskId").and_then(|x| x.as_i64()).unwrap_or(0);
            let name = text(v, "name");
            (task_id > 0 && !name.trim().is_empty()).then(|| Shortcut {
                id: format!("imported-s{i}"),
                name,
                task_id,
                description: text(v, "description"),
            })
        })
        .collect();
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekends_personal_days_and_holidays_are_off() {
        let mut s = MeetingSettings { days_off: vec!["2026-10-14".into()], ..Default::default() };
        let day = |d: &str| NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap();
        assert!(s.is_working_day(day("2026-10-13")));
        assert!(!s.is_working_day(day("2026-10-14")));
        assert!(!s.is_working_day(day("2026-10-17"))); // Saturday
        assert!(s.is_working_day(day("2026-11-18")));
        s.region = "morocco".into();
        assert!(!s.is_working_day(day("2026-11-18")));
    }

    #[test]
    fn a_moved_religious_holiday_replaces_the_estimate() {
        let s = MeetingSettings {
            region: "morocco".into(),
            holiday_choices: vec![HolidayChoice { key: "2026|Islamic New Year|0".into(), date: "2026-06-17".into(), on: true }],
            ..Default::default()
        };
        let off = s.days_off_in(2026);
        assert!(off.contains("2026-06-17"));
        assert!(!off.contains("2026-06-16"));
    }

    #[test]
    fn imports_timeagent_settings() {
        let raw = r#"{"tpURL":"https://x","dailyTaskId":11,"meetingsTaskId":22,"meetingMinMinutes":15,
            "meetingStepMinutes":5,"weeklyOff":[0,6],"daysOff":["2026-12-24","bad"],"region":"morocco",
            "recurring":[{"id":"a","label":"Daily","taskId":11,"hours":0.25},{"taskId":0,"hours":1}],
            "dynamicMeetings":[{"id":"b","name":"Review","taskId":33,"description":"sprint review"}]}"#;
        let s = from_timeagent(raw).unwrap();
        assert_eq!((s.daily_task_id, s.meetings_task_id, s.min_minutes, s.step_minutes), (11, 22, 15, 5));
        assert_eq!(s.weekly_off, vec![7, 6]);
        assert_eq!(s.days_off, vec!["2026-12-24".to_string()]);
        assert_eq!(s.region, "morocco");
        assert_eq!(s.recurring.len(), 1);
        assert_eq!(s.shortcuts[0].name, "Review");
        assert!(s.validated().is_ok());
        assert!(from_timeagent("not json").is_none());
    }

    #[test]
    fn validation_rejects_what_would_log_wrong_time() {
        let bad = MeetingSettings { step_minutes: 0, ..Default::default() };
        assert!(bad.validated().is_err());
        let bad = MeetingSettings {
            recurring: vec![RecurringEntry { id: "x".into(), label: "".into(), task_id: 1, hours: 12.0 }],
            ..Default::default()
        };
        assert!(bad.validated().is_err());
    }
}
