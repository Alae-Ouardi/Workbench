//! TargetProcess connection settings.
//!
//! Split in two on purpose: everything non-secret lives in a JSON file next to
//! the database (`~/.workbench/config.json`) so it is easy to inspect and back
//! up, while the access token goes to the OS secret store. Both the app and the
//! short-lived MCP/CLI process read through here, so there is one source of
//! truth for how to reach TargetProcess.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const KEYRING_SERVICE: &str = "net.omnevo.taskboard";
const KEYRING_ACCOUNT: &str = "tp-token";

/// Non-secret TargetProcess settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TpSettings {
    /// Instance base URL, e.g. `https://yourco.tpondemand.com`. Empty = not configured.
    pub base_url: String,
    /// Master switch. When false nothing is queued and nothing is pushed.
    pub enabled: bool,
    /// Minutes east of UTC for the TargetProcess instance's timezone. Note this
    /// is the opposite sign of JavaScript's `getTimezoneOffset()`.
    pub tz_offset_minutes: i32,
    /// TargetProcess state name a completed task moves to.
    pub done_state_name: String,
    /// TargetProcess state name a task moves to on `in_progress`. Empty = don't
    /// sync that transition. Defaults to a common workflow name so this syncs
    /// out of the box; the field exists because instances name states differently.
    pub in_progress_state_name: String,
    /// TargetProcess state name a task moves to on `review`. Empty = don't sync
    /// that transition. Same default-on behavior as `in_progress_state_name`.
    pub review_state_name: String,
    /// Cached id of the token's owner, so we don't call `/Context` on every sync.
    /// Cleared whenever the URL or token changes.
    pub cached_user_id: Option<i64>,
    /// Cached display name of the token's owner, for the settings UI.
    pub cached_user_name: String,
}

impl Default for TpSettings {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            enabled: false,
            tz_offset_minutes: system_tz_offset_minutes(),
            done_state_name: "Done".to_string(),
            in_progress_state_name: "In Progress".to_string(),
            review_state_name: "In Review".to_string(),
            cached_user_id: None,
            cached_user_name: String::new(),
        }
    }
}

impl TpSettings {
    /// `~/.workbench/config.json`, or `$TASKBOARD_CONFIG` when set. Derived from
    /// the database location so the config always sits beside the data.
    pub fn default_path() -> PathBuf {
        if let Ok(p) = std::env::var("TASKBOARD_CONFIG") {
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
        crate::db::Db::default_path()
            .parent()
            .map(|d| d.join("config.json"))
            .unwrap_or_else(|| PathBuf::from("config.json"))
    }

    pub fn load() -> Self {
        Self::load_from(&Self::default_path())
    }

    /// Read settings from `path`. A missing or unreadable file yields defaults —
    /// a corrupt config must not stop the board from working.
    pub fn load_from(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        self.save_to(&Self::default_path())
    }

    /// Write atomically (temp file + rename) with owner-only permissions, so a
    /// crash mid-write can't leave a truncated config behind.
    pub fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        write_owner_only(&tmp, &serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Base URL with any trailing slashes removed, ready for path joining.
    pub fn normalized_base_url(&self) -> &str {
        self.base_url.trim_end_matches('/')
    }

    /// True when the URL looks usable. Callers still need a token.
    pub fn has_valid_url(&self) -> bool {
        let u = self.normalized_base_url();
        (u.starts_with("https://") || u.starts_with("http://")) && u.len() > 8
    }

    /// URL that opens an entity (task, bug or user story) in the browser.
    /// TargetProcess resolves the type from the id, so one form covers all.
    pub fn entity_url(&self, entity_id: i64) -> String {
        format!("{}/entity/{}", self.normalized_base_url(), entity_id)
    }

    /// Apply an update from the settings UI. Changing the URL invalidates the
    /// cached user, which belongs to whatever instance was configured before.
    pub fn apply_update(&mut self, incoming: TpSettings) {
        let url_changed = incoming.normalized_base_url() != self.normalized_base_url();
        self.base_url = incoming.base_url;
        self.enabled = incoming.enabled;
        self.tz_offset_minutes = incoming.tz_offset_minutes;
        self.done_state_name = if incoming.done_state_name.trim().is_empty() {
            "Done".to_string()
        } else {
            incoming.done_state_name
        };
        self.in_progress_state_name = incoming.in_progress_state_name;
        self.review_state_name = incoming.review_state_name;
        if url_changed {
            self.clear_cached_user();
        }
    }

    pub fn clear_cached_user(&mut self) {
        self.cached_user_id = None;
        self.cached_user_name = String::new();
    }

    /// The TargetProcess state name for a TaskBoard status, or `None` when this
    /// transition should not be pushed.
    pub fn state_name_for(&self, status: crate::types::Status) -> Option<&str> {
        let name = match status {
            crate::types::Status::Done => self.done_state_name.trim(),
            crate::types::Status::InProgress => self.in_progress_state_name.trim(),
            crate::types::Status::Review => self.review_state_name.trim(),
            // `open` and `waiting` have no natural TargetProcess counterpart:
            // a freshly created entity already sits in the initial state.
            crate::types::Status::Open | crate::types::Status::Waiting => "",
        };
        (!name.is_empty()).then_some(name)
    }
}

/// Why no token could be read: none saved, or the Keychain refused access
/// (macOS asks again for each new build of a program).
pub fn token_problem() -> String {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map(|e| e.get_password()) {
        Ok(Err(keyring::Error::NoEntry)) | Ok(Ok(_)) => {
            "no access token stored — add one in Workbench › Settings".to_string()
        }
        Ok(Err(e)) | Err(e) => format!(
            "macOS Keychain did not let this program read the TargetProcess token ({e}). \
             The token is still saved: allow access when macOS asks (Always Allow), \
             or restart the agent session so it uses the current build."
        ),
    }
}

/// Read the access token from the OS secret store, falling back to a
/// owner-only file for environments without a usable keychain (CI, headless).
pub fn load_token() -> Option<String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => match entry.get_password() {
            Ok(token) if !token.is_empty() => return Some(token),
            // NoEntry is the normal "not configured yet" case.
            Ok(_) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return token_from_fallback_file(),
        },
        Err(_) => return token_from_fallback_file(),
    }
    token_from_fallback_file()
}

pub fn save_token(token: &str) -> Result<()> {
    let token = token.trim();
    if token.is_empty() {
        return clear_token();
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        if entry.set_password(token).is_ok() {
            // Drop any older fallback copy so there is only one stored secret.
            let _ = std::fs::remove_file(fallback_token_path());
            return Ok(());
        }
    }
    write_fallback_token(token)
}

pub fn clear_token() -> Result<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(Error::Tp(format!("could not clear stored token: {e}"))),
        }
    }
    let path = fallback_token_path();
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn fallback_token_path() -> PathBuf {
    TpSettings::default_path().with_file_name("tp-token.secret")
}

fn token_from_fallback_file() -> Option<String> {
    std::fs::read_to_string(fallback_token_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_fallback_token(token: &str) -> Result<()> {
    let path = fallback_token_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_owner_only(&path, token.as_bytes())
}

/// Write `contents` to `path` with owner-only permissions.
///
/// The mode is set as the file is created, not afterwards: creating it with the
/// process umask first and tightening it later leaves a window in which another
/// local user can read a token.
#[cfg(unix)]
fn write_owner_only(path: &Path, contents: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // `mode` only applies when the file is created, so an existing file with
    // looser permissions still needs tightening.
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    file.write_all(contents)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn write_owner_only(path: &Path, contents: &[u8]) -> Result<()> {
    std::fs::write(path, contents)?;
    Ok(())
}

/// The machine's current UTC offset in minutes east of UTC.
fn system_tz_offset_minutes() -> i32 {
    use chrono::Offset;
    chrono::Local::now().offset().fix().local_minus_utc() / 60
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Status;

    #[test]
    fn defaults_are_disabled_with_done_state() {
        let s = TpSettings::default();
        assert!(!s.enabled);
        assert_eq!(s.done_state_name, "Done");
        assert!(!s.has_valid_url());
        assert_eq!(s.cached_user_id, None);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let mut s = TpSettings::default();
        s.base_url = "https://acme.tpondemand.com/".to_string();
        s.enabled = true;
        s.tz_offset_minutes = 60;
        s.cached_user_id = Some(42);
        s.save_to(&path).unwrap();

        let loaded = TpSettings::load_from(&path);
        assert_eq!(loaded, s);
        assert_eq!(loaded.normalized_base_url(), "https://acme.tpondemand.com");
    }

    /// Regression guard: a secret must never exist on disk world-readable, not
    /// even momentarily, and not when overwriting a loose pre-existing file.
    #[cfg(unix)]
    #[test]
    fn secrets_are_written_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();

        let fresh = dir.path().join("fresh.secret");
        write_owner_only(&fresh, b"tok").unwrap();
        assert_eq!(
            std::fs::metadata(&fresh).unwrap().permissions().mode() & 0o777,
            0o600
        );

        // An existing world-readable file gets tightened rather than trusted.
        let loose = dir.path().join("loose.secret");
        std::fs::write(&loose, b"old").unwrap();
        std::fs::set_permissions(&loose, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_owner_only(&loose, b"new").unwrap();
        assert_eq!(
            std::fs::metadata(&loose).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read_to_string(&loose).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn saved_config_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        TpSettings::default().save_to(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn missing_or_corrupt_config_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.json");
        assert_eq!(TpSettings::load_from(&missing), TpSettings::default());

        let corrupt = dir.path().join("corrupt.json");
        std::fs::write(&corrupt, "{ not json").unwrap();
        assert_eq!(TpSettings::load_from(&corrupt), TpSettings::default());
    }

    #[test]
    fn partial_config_keeps_defaults_for_absent_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("partial.json");
        std::fs::write(&path, r#"{"base_url":"https://acme.tpondemand.com"}"#).unwrap();
        let s = TpSettings::load_from(&path);
        assert_eq!(s.base_url, "https://acme.tpondemand.com");
        assert_eq!(s.done_state_name, "Done"); // serde(default) filled it in
        assert!(!s.enabled);
    }

    #[test]
    fn url_validation_rejects_junk() {
        let mut s = TpSettings::default();
        for bad in ["", "acme.tpondemand.com", "ftp://acme", "https://"] {
            s.base_url = bad.to_string();
            assert!(!s.has_valid_url(), "{bad} should be rejected");
        }
        s.base_url = "https://acme.tpondemand.com".to_string();
        assert!(s.has_valid_url());
    }

    #[test]
    fn entity_url_strips_trailing_slashes() {
        let mut s = TpSettings::default();
        s.base_url = "https://acme.tpondemand.com///".to_string();
        assert_eq!(s.entity_url(123), "https://acme.tpondemand.com/entity/123");
    }

    #[test]
    fn changing_the_url_invalidates_the_cached_user() {
        let mut s = TpSettings::default();
        s.base_url = "https://one.tpondemand.com".to_string();
        s.cached_user_id = Some(7);
        s.cached_user_name = "Alae".to_string();

        // Same URL with a trailing slash is not a change.
        let mut same = s.clone();
        same.base_url = "https://one.tpondemand.com/".to_string();
        let mut kept = s.clone();
        kept.apply_update(same);
        assert_eq!(kept.cached_user_id, Some(7));

        let mut other = s.clone();
        other.base_url = "https://two.tpondemand.com".to_string();
        let mut cleared = s.clone();
        cleared.apply_update(other);
        assert_eq!(cleared.cached_user_id, None);
        assert_eq!(cleared.cached_user_name, "");
    }

    #[test]
    fn blank_done_state_falls_back_to_done() {
        let mut s = TpSettings::default();
        let mut incoming = TpSettings::default();
        incoming.done_state_name = "   ".to_string();
        s.apply_update(incoming);
        assert_eq!(s.done_state_name, "Done");
    }

    /// The whole open → in_progress → review → done flow syncs out of the box,
    /// matching the board's own status flow, so enabling the master switch is
    /// enough — no per-status setup required for the common case.
    #[test]
    fn every_reachable_status_syncs_by_default() {
        let s = TpSettings::default();
        assert_eq!(s.state_name_for(Status::InProgress), Some("In Progress"));
        assert_eq!(s.state_name_for(Status::Review), Some("In Review"));
        assert_eq!(s.state_name_for(Status::Done), Some("Done"));
        // Open/waiting have no TargetProcess counterpart: a freshly created
        // entity already sits in the initial workflow state.
        assert_eq!(s.state_name_for(Status::Open), None);
        assert_eq!(s.state_name_for(Status::Waiting), None);
    }

    #[test]
    fn blanking_a_state_name_turns_off_that_transition() {
        let mut s = TpSettings::default();
        s.in_progress_state_name = "   ".to_string(); // whitespace counts as blank
        s.review_state_name = String::new();
        assert_eq!(s.state_name_for(Status::InProgress), None);
        assert_eq!(s.state_name_for(Status::Review), None);
        // Done still has its required, non-blankable default.
        assert_eq!(s.state_name_for(Status::Done), Some("Done"));
    }
}
