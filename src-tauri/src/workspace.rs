//! Tauri commands behind the TP Workspace views.
//!
//! Every read goes through the local snapshot cache: the frontend first asks
//! for the cached copy (`fresh: false`, instant, may be empty) and then for a
//! live one (`fresh: true`), which is fetched from TargetProcess and written
//! back to the cache. Network work runs on a blocking thread so a slow
//! TargetProcess instance never freezes the window.

use crate::util::blocking;
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use taskboard_core::tp::client::{today_in_offset, TpClient};
use taskboard_core::tp::{CacheEntry, TpCache, TpEntityState, WorkspacePrefs};
use taskboard_core::{TpSettings, TpUser};

/// How far back the sprint picker reaches.
const SPRINT_LOOKBACK_DAYS: i64 = 120;
/// Widest time range one calendar request may ask for.
const MAX_TIME_RANGE_DAYS: i64 = 93;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TpwQuery {
    Projects,
    Sprints { project_ids: Vec<i64> },
    SprintItems { sprint_id: i64 },
    MyWork,
    MyClosed { since: String },
    Overdue { project_ids: Vec<i64> },
    Times { from: String, to: String },
}

impl TpwQuery {
    fn cache_key(&self) -> String {
        match self {
            TpwQuery::Projects => "projects".into(),
            TpwQuery::Sprints { project_ids } => format!("sprints:{:?}", sorted(project_ids)),
            TpwQuery::SprintItems { sprint_id } => format!("sprint:{sprint_id}"),
            TpwQuery::MyWork => "my_work".into(),
            TpwQuery::MyClosed { since } => format!("my_closed:{since}"),
            TpwQuery::Overdue { project_ids } => format!("overdue:{:?}", sorted(project_ids)),
            TpwQuery::Times { from, to } => format!("times:{from}:{to}"),
        }
    }
}

fn sorted(ids: &[i64]) -> Vec<i64> {
    let mut ids = ids.to_vec();
    ids.sort_unstable();
    ids
}

#[derive(Debug, Clone, Serialize)]
pub struct TpwResult {
    pub payload: serde_json::Value,
    pub fetched_at: String,
    pub from_cache: bool,
}

fn result(entry: CacheEntry, from_cache: bool) -> TpwResult {
    TpwResult {
        payload: entry.payload,
        fetched_at: entry.fetched_at,
        from_cache,
    }
}

pub(crate) fn client(settings: &TpSettings) -> Result<TpClient, String> {
    TpClient::from_settings(settings).map_err(|e| e.to_string())
}

/// The token owner's id, from the settings cache or — once — from `/Context`.
pub(crate) fn current_user_id(settings: &mut TpSettings, client: &TpClient) -> Result<i64, String> {
    if let Some(id) = settings.cached_user_id {
        return Ok(id);
    }
    let user = client.get_context().map_err(|e| e.to_string())?;
    settings.cached_user_id = Some(user.id);
    settings.cached_user_name = user.name;
    settings.save().map_err(|e| e.to_string())?;
    Ok(user.id)
}

pub(crate) fn parse_day(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| format!("'{value}' is not a YYYY-MM-DD date"))
}

fn to_json<T: Serialize>(value: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn fetch(query: &TpwQuery) -> Result<serde_json::Value, String> {
    let mut settings = TpSettings::load();
    let client = client(&settings)?;
    let today = today_in_offset(chrono::Utc::now(), settings.tz_offset_minutes);
    let tp = |e: taskboard_core::Error| e.to_string();
    match query {
        TpwQuery::Projects => to_json(client.list_projects().map_err(tp)?),
        TpwQuery::Sprints { project_ids } => to_json(
            client
                .list_sprints(today - Duration::days(SPRINT_LOOKBACK_DAYS), project_ids)
                .map_err(tp)?,
        ),
        TpwQuery::SprintItems { sprint_id } => to_json(client.sprint_items(*sprint_id).map_err(tp)?),
        TpwQuery::MyWork => {
            let user_id = current_user_id(&mut settings, &client)?;
            to_json(client.my_work(user_id).map_err(tp)?)
        }
        TpwQuery::MyClosed { since } => {
            let since = parse_day(since)?;
            if (today - since).num_days() > MAX_TIME_RANGE_DAYS {
                return Err(format!("closed items are limited to the last {MAX_TIME_RANGE_DAYS} days"));
            }
            let user_id = current_user_id(&mut settings, &client)?;
            to_json(client.my_closed(user_id, since).map_err(tp)?)
        }
        TpwQuery::Overdue { project_ids } => to_json(client.overdue(today, project_ids).map_err(tp)?),
        TpwQuery::Times { from, to } => {
            let (from, to) = (parse_day(from)?, parse_day(to)?);
            if to < from || (to - from).num_days() > MAX_TIME_RANGE_DAYS {
                return Err(format!("time range must be 0–{MAX_TIME_RANGE_DAYS} days"));
            }
            let user_id = current_user_id(&mut settings, &client)?;
            to_json(client.times(user_id, from, to).map_err(tp)?)
        }
    }
}

/// Read workspace data. `fresh: false` returns the cached copy (or `null`);
/// `fresh: true` fetches from TargetProcess and refreshes the cache.
#[tauri::command]
pub async fn tpw_query(query: TpwQuery, fresh: bool) -> Result<Option<TpwResult>, String> {
    blocking(move || {
        let cache = TpCache::open_default().map_err(|e| e.to_string())?;
        let key = query.cache_key();
        if !fresh {
            return Ok(cache.get(&key).map_err(|e| e.to_string())?.map(|e| result(e, true)));
        }
        let payload = fetch(&query)?;
        let entry = cache.put(&key, &payload).map_err(|e| e.to_string())?;
        Ok(Some(result(entry, false)))
    })
    .await
}

/// Who the token belongs to, without a network call when it is cached.
#[tauri::command]
pub async fn tpw_me() -> Result<TpUser, String> {
    blocking(|| {
        let mut settings = TpSettings::load();
        let client = client(&settings)?;
        let id = current_user_id(&mut settings, &client)?;
        Ok(TpUser {
            id,
            name: settings.cached_user_name.clone(),
            email: String::new(),
        })
    })
    .await
}

#[tauri::command]
pub async fn tpw_states(process_id: i64, entity_type: String) -> Result<Vec<TpEntityState>, String> {
    blocking(move || {
        taskboard_core::tp::read::work_item_collection(&entity_type).map_err(|e| e.to_string())?;
        client(&TpSettings::load())?
            .states_for(process_id, &entity_type)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn tpw_set_state(entity_type: String, entity_id: i64, state_id: i64) -> Result<(), String> {
    blocking(move || {
        client(&TpSettings::load())?
            .set_work_item_state(&entity_type, entity_id, state_id)
            .map_err(|e| e.to_string())
    })
    .await
}

/// Log time against a story, task or bug. Returns the new entry id.
#[tauri::command]
pub async fn tpw_log_time(
    entity_id: i64,
    hours: f64,
    description: String,
    date: String,
) -> Result<i64, String> {
    blocking(move || {
        if !hours.is_finite() || hours <= 0.0 || hours > 24.0 {
            return Err("hours must be between 0 and 24".to_string());
        }
        if description.trim().is_empty() {
            return Err("Add a description: TargetProcess requires one on every time entry.".to_string());
        }
        let day = parse_day(&date)?;
        let settings = TpSettings::load();
        client(&settings)?
            .log_time(entity_id, hours, &description, day, settings.tz_offset_minutes)
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn tpw_get_prefs() -> WorkspacePrefs {
    WorkspacePrefs::load()
}

#[tauri::command]
pub fn tpw_save_prefs(prefs: WorkspacePrefs) -> Result<WorkspacePrefs, String> {
    let prefs = prefs.sanitized();
    prefs.save().map_err(|e| e.to_string())?;
    Ok(prefs)
}

/// Forget all cached workspace data — called when the account changes.
pub fn clear_cache() {
    if let Ok(cache) = TpCache::open_default() {
        let _ = cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queries_deserialize_from_tagged_json() {
        let q: TpwQuery =
            serde_json::from_str(r#"{"kind":"sprint_items","sprint_id":133}"#).unwrap();
        assert_eq!(q.cache_key(), "sprint:133");
        let q: TpwQuery = serde_json::from_str(r#"{"kind":"my_work"}"#).unwrap();
        assert_eq!(q.cache_key(), "my_work");
    }

    #[test]
    fn overdue_cache_key_ignores_project_order() {
        let a = TpwQuery::Overdue { project_ids: vec![7, 3] };
        let b = TpwQuery::Overdue { project_ids: vec![3, 7] };
        assert_eq!(a.cache_key(), b.cache_key());
        let c: TpwQuery = serde_json::from_str(r#"{"kind":"sprints","project_ids":[3]}"#).unwrap();
        assert_eq!(c.cache_key(), "sprints:[3]");
    }

    #[test]
    fn days_must_be_iso_dates() {
        assert!(parse_day("2026-10-12").is_ok());
        assert!(parse_day("12/10/2026").is_err());
    }
}
