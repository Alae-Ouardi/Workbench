//! Preferences for the TP Workspace views.
//!
//! Stored in `workspace.json` beside `config.json` instead of inside
//! `TpSettings`: the existing settings screen saves the whole `TpSettings`
//! object, and a field it does not know about would be reset on every save.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspacePrefs {
    /// TargetProcess project ids pre-selected in the filter bar (e.g. ILS, Evo).
    pub default_project_ids: Vec<i64>,
    /// Accent colour per TargetProcess project id, as `#rrggbb`.
    pub project_colors: BTreeMap<String, String>,
    /// Background refresh interval, in minutes.
    pub refresh_minutes: u32,
    /// Hours a working day should have logged before it stops being flagged.
    pub daily_target_hours: f64,
    /// Hours a week should have logged.
    pub weekly_target_hours: f64,
    /// Hours a month should have logged. `None` = derived from the weekly
    /// target and the number of working days in the month.
    pub monthly_target_hours: Option<f64>,
    /// ISO weekdays that count as working days (1 = Monday … 7 = Sunday).
    pub working_days: Vec<u8>,
    /// `dark`, `light` or `system`.
    pub theme: String,
}

impl Default for WorkspacePrefs {
    fn default() -> Self {
        Self {
            default_project_ids: Vec::new(),
            project_colors: BTreeMap::new(),
            refresh_minutes: 10,
            daily_target_hours: 8.0,
            weekly_target_hours: 40.0,
            monthly_target_hours: None,
            working_days: vec![1, 2, 3, 4, 5],
            theme: "dark".to_string(),
        }
    }
}

const MIN_REFRESH_MINUTES: u32 = 1;
const MAX_REFRESH_MINUTES: u32 = 240;

impl WorkspacePrefs {
    pub fn default_path() -> PathBuf {
        crate::tp::config::TpSettings::default_path().with_file_name("workspace.json")
    }

    pub fn load() -> Self {
        Self::load_from(&Self::default_path())
    }

    /// A missing or corrupt file yields defaults rather than an error.
    pub fn load_from(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Self>(&s).ok())
            .map(Self::sanitized)
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        self.save_to(&Self::default_path())
    }

    pub fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.clone().sanitized())?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Clamp everything to a usable range so a hand-edited file or a bad form
    /// value can't produce a zero-second refresh loop or a 30-hour day.
    pub fn sanitized(mut self) -> Self {
        self.refresh_minutes = self
            .refresh_minutes
            .clamp(MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES);
        if !self.daily_target_hours.is_finite() || self.daily_target_hours <= 0.0 {
            self.daily_target_hours = 8.0;
        }
        self.daily_target_hours = self.daily_target_hours.min(24.0);
        if !self.weekly_target_hours.is_finite() || self.weekly_target_hours <= 0.0 {
            self.weekly_target_hours = 40.0;
        }
        self.weekly_target_hours = self.weekly_target_hours.min(24.0 * 7.0);
        self.monthly_target_hours = self
            .monthly_target_hours
            .filter(|h| h.is_finite() && *h > 0.0)
            .map(|h| h.min(24.0 * 31.0));
        self.working_days.retain(|d| (1..=7).contains(d));
        self.working_days.sort_unstable();
        self.working_days.dedup();
        if !matches!(self.theme.as_str(), "dark" | "light" | "system") {
            self.theme = "dark".to_string();
        }
        self.project_colors.retain(|_, c| is_hex_color(c));
        self.default_project_ids.retain(|id| *id > 0);
        self
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_a_normal_work_week() {
        let p = WorkspacePrefs::default();
        assert_eq!(p.working_days, vec![1, 2, 3, 4, 5]);
        assert_eq!(p.daily_target_hours, 8.0);
        assert_eq!(p.weekly_target_hours, 40.0);
        assert_eq!(p.monthly_target_hours, None);
        assert_eq!(p.refresh_minutes, 10);
    }

    #[test]
    fn sanitizing_clamps_bad_values() {
        let mut colors = BTreeMap::new();
        colors.insert("3".to_string(), "#00ffaa".to_string());
        colors.insert("4".to_string(), "red; background:url(x)".to_string());
        let p = WorkspacePrefs {
            default_project_ids: vec![3, -1, 0],
            project_colors: colors,
            refresh_minutes: 0,
            daily_target_hours: f64::NAN,
            weekly_target_hours: -1.0,
            monthly_target_hours: Some(0.0),
            working_days: vec![5, 1, 9, 1, 0],
            theme: "neon".to_string(),
        }
        .sanitized();
        assert_eq!(p.refresh_minutes, 1);
        assert_eq!(p.daily_target_hours, 8.0);
        assert_eq!(p.weekly_target_hours, 40.0);
        assert_eq!(p.monthly_target_hours, None);
        assert_eq!(p.working_days, vec![1, 5]);
        assert_eq!(p.theme, "dark");
        assert_eq!(p.default_project_ids, vec![3]);
        assert_eq!(p.project_colors.len(), 1);
    }

    #[test]
    fn missing_or_corrupt_files_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        assert_eq!(WorkspacePrefs::load_from(&path), WorkspacePrefs::default());
        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(WorkspacePrefs::load_from(&path), WorkspacePrefs::default());
    }

    #[test]
    fn partial_files_keep_unspecified_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        std::fs::write(&path, r#"{"daily_target_hours": 7.5}"#).unwrap();
        let p = WorkspacePrefs::load_from(&path);
        assert_eq!(p.daily_target_hours, 7.5);
        assert_eq!(p.working_days, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.json");
        let p = WorkspacePrefs {
            default_project_ids: vec![3, 7],
            theme: "light".into(),
            ..Default::default()
        };
        p.save_to(&path).unwrap();
        assert_eq!(WorkspacePrefs::load_from(&path), p);
    }
}
