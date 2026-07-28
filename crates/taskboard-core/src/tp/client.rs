//! Blocking TargetProcess REST client.
//!
//! Ported from the TimeAgent Electron app's `src/tpclient.js`, which encodes a
//! number of quirks learned the hard way against a real instance. Each is
//! called out at the point where it matters:
//!
//! * authentication is a query parameter, not a header;
//! * `format=json` must be on every request;
//! * the query string is percent-encoded by hand, because encoding spaces as
//!   `+` makes TargetProcess's OData `where` parser reject the filter;
//! * updates are `POST` to the entity's own URL, not `PUT`/`PATCH`;
//! * a write is only successful if the response body carries an `Id`, since
//!   TargetProcess can answer 200 with a non-entity payload.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::tp::config::TpSettings;

const API_PREFIX: &str = "api/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// TargetProcess caps `take` at 1000 and silently truncates beyond it.
const MAX_TAKE: usize = 1000;

/// The user a token belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpUser {
    pub id: i64,
    pub name: String,
    pub email: String,
}

/// A user story a TaskBoard project can be linked to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpUserStory {
    pub id: i64,
    pub name: String,
    pub state_name: String,
    pub project_id: Option<i64>,
    pub project_name: String,
    /// Process the story's project uses — needed to resolve workflow states.
    pub process_id: Option<i64>,
}

/// One workflow state of a process, for a single entity type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpEntityState {
    pub id: i64,
    pub name: String,
    pub is_final: bool,
    pub numeric_priority: f64,
}

pub struct TpClient {
    base_url: String,
    token: String,
    agent: ureq::Agent,
}

impl TpClient {
    /// Build a client from stored settings. Errors when the instance is not
    /// configured, so callers get one clear message instead of a 401 later.
    pub fn from_settings(settings: &TpSettings) -> Result<Self> {
        if !settings.has_valid_url() {
            return Err(Error::TpNotConfigured(
                "no instance URL set — add one in Settings".to_string(),
            ));
        }
        let token = crate::tp::config::load_token().unwrap_or_default();
        if token.is_empty() {
            return Err(Error::TpNotConfigured(
                "no access token stored — add one in Settings".to_string(),
            ));
        }
        Ok(Self::new(settings.normalized_base_url(), &token))
    }

    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            agent: ureq::AgentBuilder::new()
                // Without an explicit timeout a stalled DNS or TLS handshake
                // hangs the caller forever; in TimeAgent that froze the app.
                .timeout(REQUEST_TIMEOUT)
                .build(),
        }
    }

    // ---------------------------------------------------------------- requests

    /// Full request URL for `path`, with `format=json` and the access token
    /// always present.
    fn url(&self, path: &str, query: &[(&str, String)]) -> String {
        let mut qs = format!("format=json&access_token={}", encode_component(&self.token));
        for (key, value) in query {
            qs.push('&');
            qs.push_str(&encode_component(key));
            qs.push('=');
            qs.push_str(&encode_component(value));
        }
        format!("{}/{}/{}?{}", self.base_url, API_PREFIX, path, qs)
    }

    fn get_json(&self, path: &str, query: &[(&str, String)]) -> Result<serde_json::Value> {
        self.send(self.agent.get(&self.url(path, query)), None)
    }

    /// TargetProcess uses POST both to create and to update; the entity's own
    /// URL (`Tasks/123`) is the update endpoint.
    fn post_json(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value> {
        self.send(self.agent.post(&self.url(path, &[])), Some(body))
    }

    fn send(
        &self,
        request: ureq::Request,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let request = request.set("Accept", "application/json");
        let outcome = match body {
            Some(body) => request.send_json(body),
            None => request.call(),
        };
        match outcome {
            Ok(response) => {
                let text = response
                    .into_string()
                    .map_err(|e| Error::Tp(format!("could not read response: {e}")))?;
                if text.trim().is_empty() {
                    return Ok(serde_json::Value::Object(Default::default()));
                }
                serde_json::from_str(&text)
                    .map_err(|e| Error::Tp(format!("invalid JSON response: {e}: {}", clip(&text))))
            }
            // Keep the status code first in the message: `Error::is_retryable`
            // parses it to decide whether replaying could ever help.
            Err(ureq::Error::Status(code, response)) => {
                let text = response.into_string().unwrap_or_default();
                Err(Error::Tp(format!("HTTP {code}: {}", clip(&text))))
            }
            Err(e) => Err(Error::Tp(e.to_string())),
        }
    }

    /// Page through a collection. A single request would silently stop at
    /// `MAX_TAKE` items.
    fn get_all_items(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<Vec<serde_json::Value>> {
        let mut items = Vec::new();
        let mut skip = 0usize;
        loop {
            let mut q = query.to_vec();
            q.push(("take", MAX_TAKE.to_string()));
            q.push(("skip", skip.to_string()));
            let page = self.get_json(path, &q)?;
            let batch = page
                .get("Items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let count = batch.len();
            items.extend(batch);
            if count < MAX_TAKE {
                break;
            }
            skip += MAX_TAKE;
        }
        Ok(items)
    }

    // ------------------------------------------------------------------ whoami

    /// The token's owner. TargetProcess exposes this via `/Context`, not
    /// `/Users/current`.
    pub fn get_context(&self) -> Result<TpUser> {
        let obj = self.get_json("Context", &[])?;
        let user = obj
            .get("LoggedUser")
            .ok_or_else(|| Error::Tp("response had no LoggedUser".to_string()))?;
        let id = user
            .get("Id")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| Error::Tp("could not read the logged-in user from the token".into()))?;
        let first = str_field(user, "FirstName");
        let last = str_field(user, "LastName");
        Ok(TpUser {
            id,
            name: format!("{first} {last}").trim().to_string(),
            email: str_field(user, "Email"),
        })
    }

    // ------------------------------------------------------------ user stories

    const USER_STORY_INCLUDE: &'static str =
        "[Id,Name,EntityState[Name],Project[Id,Name,Process[Id]]]";

    /// Search user stories by name, or fetch one directly when the query is an
    /// id or a pasted `…/entity/<id>` URL.
    pub fn search_user_stories(&self, query: &str) -> Result<Vec<TpUserStory>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        if let Some(id) = parse_entity_id(query) {
            // An exact id is unambiguous; return just that story (if it exists).
            return Ok(self.get_user_story(id).ok().into_iter().collect());
        }
        let items = self.get_all_items(
            "UserStories",
            &[
                (
                    "where",
                    format!("Name contains '{}'", escape_odata_literal(query)),
                ),
                ("include", Self::USER_STORY_INCLUDE.to_string()),
                ("orderByDesc", "Id".to_string()),
            ],
        )?;
        Ok(items.iter().take(50).map(user_story_from_json).collect())
    }

    pub fn get_user_story(&self, id: i64) -> Result<TpUserStory> {
        let obj = self.get_json(
            &format!("UserStories/{id}"),
            &[("include", Self::USER_STORY_INCLUDE.to_string())],
        )?;
        if obj.get("Id").and_then(|v| v.as_i64()).is_none() {
            return Err(Error::Tp(format!("user story #{id} not found")));
        }
        Ok(user_story_from_json(&obj))
    }

    // ---------------------------------------------------------------- entities

    /// Create a Task (or Bug) under a user story. Returns the new entity id.
    ///
    /// Both collections accept a `UserStory` link, which is what puts the entity
    /// under the story on the board.
    pub fn create_entity(
        &self,
        entity_type: &str,
        user_story_id: i64,
        tp_project_id: Option<i64>,
        name: &str,
        description: &str,
    ) -> Result<i64> {
        let mut body = serde_json::json!({
            "Name": name,
            "UserStory": { "Id": user_story_id },
        });
        if !description.trim().is_empty() {
            body["Description"] = serde_json::Value::String(description.to_string());
        }
        if let Some(pid) = tp_project_id {
            body["Project"] = serde_json::json!({ "Id": pid });
        }
        let response = self.post_json(&collection_of(entity_type), body)?;
        require_id(&response, "entity was not created")
    }

    /// Workflow states of `entity_type` in `process_id`, ordered as the process
    /// orders them.
    ///
    /// One request per entity type on purpose: TargetProcess's parser rejects a
    /// nested `or` inside an `and`, so `(A) and ((B) or (C))` is not an option.
    /// Task and Bug state ids also differ within the same process.
    pub fn fetch_entity_states(
        &self,
        process_id: i64,
        entity_type: &str,
    ) -> Result<Vec<TpEntityState>> {
        let obj = self.get_json(
            "EntityStates",
            &[
                (
                    "where",
                    // Singular entity-type name here, though the collection
                    // paths are plural.
                    format!(
                        "(Process.Id eq {process_id}) and (EntityType.Name eq '{}')",
                        escape_odata_literal(entity_type)
                    ),
                ),
                ("include", "[Id,Name,NumericPriority,IsFinal]".to_string()),
                ("take", "200".to_string()),
            ],
        )?;
        let mut states: Vec<TpEntityState> = obj
            .get("Items")
            .and_then(|v| v.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|s| {
                        Some(TpEntityState {
                            id: s.get("Id")?.as_i64()?,
                            name: str_field(s, "Name"),
                            is_final: s.get("IsFinal").and_then(|v| v.as_bool()).unwrap_or(false),
                            numeric_priority: s
                                .get("NumericPriority")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        states.sort_by(|a, b| {
            a.numeric_priority
                .partial_cmp(&b.numeric_priority)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(states)
    }

    /// Move an entity to a state. Workflow legality is left to the server.
    pub fn set_entity_state(&self, entity_type: &str, entity_id: i64, state_id: i64) -> Result<()> {
        let response = self.post_json(
            &format!("{}/{}", collection_of(entity_type), entity_id),
            serde_json::json!({ "EntityState": { "Id": state_id } }),
        )?;
        require_id(&response, "state was not changed")?;
        Ok(())
    }

    // ------------------------------------------------------------------- times

    /// Log a time entry against any assignable entity. Returns the entry id.
    ///
    /// No `User` field is sent: TargetProcess attributes the entry to the access
    /// token's owner. `Assignable` is the polymorphic link that works for tasks,
    /// bugs and user stories alike — there is no `Task: {Id}` form.
    pub fn log_time(
        &self,
        entity_id: i64,
        hours: f64,
        description: &str,
        date: chrono::NaiveDate,
        tz_offset_minutes: i32,
    ) -> Result<i64> {
        let mut body = serde_json::json!({
            "Spent": hours,
            // Sent on create only, so TargetProcess does not recompute the
            // remaining effort from our value.
            "Remain": 0,
            "Date": tp_date_literal(date, tz_offset_minutes),
            "Assignable": { "Id": entity_id },
        });
        // Omitted entirely rather than sent as "" — TP stores the empty string.
        if !description.trim().is_empty() {
            body["Description"] = serde_json::Value::String(description.to_string());
        }
        let response = self.post_json("Times", body)?;
        require_id(&response, "time entry was not created")
    }
}

/// Pick the state a completed task should move to: the configured name if the
/// process has it, otherwise the earliest final state.
pub fn resolve_done_state<'a>(
    states: &'a [TpEntityState],
    preferred_name: &str,
) -> Result<&'a TpEntityState> {
    let preferred = preferred_name.trim();
    if !preferred.is_empty() {
        if let Some(state) = states
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case(preferred))
        {
            return Ok(state);
        }
    }
    states
        .iter()
        .filter(|s| s.is_final)
        .min_by(|a, b| {
            a.numeric_priority
                .partial_cmp(&b.numeric_priority)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .ok_or_else(|| {
            Error::Tp(format!(
                "no state named '{preferred}' and no final state in this workflow \
                 (available: {})",
                state_names(states)
            ))
        })
}

/// Find a state by name, for the optional in-progress / review mappings.
pub fn find_state_by_name<'a>(
    states: &'a [TpEntityState],
    name: &str,
) -> Result<&'a TpEntityState> {
    states
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case(name.trim()))
        .ok_or_else(|| {
            Error::Tp(format!(
                "this workflow has no state named '{name}' (available: {})",
                state_names(states)
            ))
        })
}

fn state_names(states: &[TpEntityState]) -> String {
    if states.is_empty() {
        return "none".to_string();
    }
    states
        .iter()
        .map(|s| s.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// `Tasks` / `Bugs` from `Task` / `Bug`.
pub fn collection_of(entity_type: &str) -> String {
    match entity_type {
        "Bug" => "Bugs".to_string(),
        _ => "Tasks".to_string(),
    }
}

/// TargetProcess dates use the legacy Microsoft JSON format
/// `/Date(<epoch millis><±HHMM>)/`.
///
/// The millis are anchored to **noon** on the target calendar day, so if our
/// idea of the instance's UTC offset is off by a few hours the entry still lands
/// on the intended day instead of slipping to the one either side.
fn tp_date_literal(date: chrono::NaiveDate, tz_offset_minutes: i32) -> String {
    let noon = date.and_hms_opt(12, 0, 0).expect("12:00 is always valid");
    let ms = noon.and_utc().timestamp_millis() - (tz_offset_minutes as i64) * 60_000;
    let sign = if tz_offset_minutes >= 0 { '+' } else { '-' };
    let abs = tz_offset_minutes.abs();
    format!("/Date({ms}{sign}{:02}{:02})/", abs / 60, abs % 60)
}

/// Today's date in a timezone `tz_offset_minutes` east of UTC.
pub fn today_in_offset(
    now_utc: chrono::DateTime<chrono::Utc>,
    tz_offset_minutes: i32,
) -> chrono::NaiveDate {
    (now_utc + chrono::Duration::minutes(tz_offset_minutes as i64)).date_naive()
}

/// A TargetProcess write only succeeded if the response carries an `Id`; the
/// status code alone is not enough.
fn require_id(response: &serde_json::Value, context: &str) -> Result<i64> {
    response
        .get("Id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| Error::Tp(format!("{context}: {}", clip(&response.to_string()))))
}

/// Accept a bare id or a pasted TargetProcess URL (`…/entity/1234`).
pub fn parse_entity_id(input: &str) -> Option<i64> {
    let trimmed = input.trim().trim_end_matches('/');
    if let Ok(id) = trimmed.trim_start_matches('#').parse::<i64>() {
        return (id > 0).then_some(id);
    }
    trimmed
        .rsplit('/')
        .find(|seg| !seg.is_empty())
        .and_then(|seg| seg.split(['?', '#']).next())
        .and_then(|seg| seg.parse::<i64>().ok())
        .filter(|&id| id > 0)
}

/// Single quotes are the string delimiter in OData literals and are escaped by
/// doubling. Anything else is passed through and percent-encoded later.
fn escape_odata_literal(value: &str) -> String {
    value.replace('\'', "''")
}

/// Percent-encode one query component.
///
/// Written out rather than pulled from a helper because the usual
/// form-encoding turns spaces into `+`, which TargetProcess's `where` parser
/// rejects outright. Spaces must be `%20`.
fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Truncate a server message so an HTML error page can't flood the UI or logs.
fn clip(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= 200 {
        return trimmed.to_string();
    }
    trimmed.chars().take(200).collect::<String>() + "…"
}

fn str_field(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn user_story_from_json(item: &serde_json::Value) -> TpUserStory {
    let project = item.get("Project");
    TpUserStory {
        id: item.get("Id").and_then(|v| v.as_i64()).unwrap_or(0),
        name: str_field(item, "Name"),
        state_name: item
            .get("EntityState")
            .map(|s| str_field(s, "Name"))
            .unwrap_or_default(),
        project_id: project.and_then(|p| p.get("Id")).and_then(|v| v.as_i64()),
        project_name: project.map(|p| str_field(p, "Name")).unwrap_or_default(),
        process_id: project
            .and_then(|p| p.get("Process"))
            .and_then(|pr| pr.get("Id"))
            .and_then(|v| v.as_i64()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDate, TimeZone, Utc};

    fn client() -> TpClient {
        TpClient::new("https://acme.tpondemand.com/", "tok en/1")
    }

    #[test]
    fn url_always_carries_format_and_token() {
        let url = client().url("Context", &[]);
        assert_eq!(
            url,
            "https://acme.tpondemand.com/api/v1/Context?format=json&access_token=tok%20en%2F1"
        );
    }

    #[test]
    fn query_encodes_spaces_as_percent20_not_plus() {
        let url = client().url("UserStories", &[("where", "Name contains 'foo'".into())]);
        assert!(
            url.contains("where=Name%20contains%20%27foo%27"),
            "spaces must be %20 or TargetProcess rejects the filter: {url}"
        );
        assert!(
            !url.contains('+'),
            "a '+' would be parsed as a space: {url}"
        );
    }

    #[test]
    fn odata_literals_escape_single_quotes_by_doubling() {
        assert_eq!(escape_odata_literal("Alae's story"), "Alae''s story");
        assert_eq!(escape_odata_literal("plain"), "plain");
    }

    #[test]
    fn collection_names_are_pluralised_per_entity_type() {
        assert_eq!(collection_of("Task"), "Tasks");
        assert_eq!(collection_of("Bug"), "Bugs");
        // Anything unexpected falls back to Tasks rather than building a bad URL.
        assert_eq!(collection_of(""), "Tasks");
    }

    #[test]
    fn entity_ids_are_parsed_from_ids_and_urls() {
        assert_eq!(parse_entity_id("1234"), Some(1234));
        assert_eq!(parse_entity_id(" #1234 "), Some(1234));
        assert_eq!(
            parse_entity_id("https://acme.tpondemand.com/entity/1234"),
            Some(1234)
        );
        assert_eq!(
            parse_entity_id("https://acme.tpondemand.com/entity/1234/"),
            Some(1234)
        );
        assert_eq!(
            parse_entity_id("https://acme.tpondemand.com/entity/1234?tab=comments"),
            Some(1234)
        );
        assert_eq!(parse_entity_id("login screen"), None);
        assert_eq!(parse_entity_id(""), None);
        assert_eq!(parse_entity_id("0"), None);
        assert_eq!(parse_entity_id("-5"), None);
    }

    #[test]
    fn tp_date_is_noon_anchored_in_the_given_offset() {
        let day = NaiveDate::from_ymd_opt(2026, 7, 28).unwrap();

        // UTC: noon on the 28th.
        assert_eq!(tp_date_literal(day, 0), "/Date(1785240000000+0000)/");
        assert_eq!(
            Utc.timestamp_millis_opt(1785240000000)
                .unwrap()
                .to_rfc3339(),
            "2026-07-28T12:00:00+00:00"
        );

        // +60 minutes: the same wall-clock noon, so one hour earlier in UTC.
        assert_eq!(tp_date_literal(day, 60), "/Date(1785236400000+0100)/");
        // Half-hour zones must render as minutes, not a fraction.
        assert_eq!(tp_date_literal(day, 330), "/Date(1785220200000+0530)/");
        // Negative offsets keep the sign on the suffix and shift the other way.
        assert_eq!(tp_date_literal(day, -300), "/Date(1785258000000-0500)/");
    }

    /// The point of anchoring at noon: even a 12-hour disagreement about the
    /// instance's offset leaves the entry on the intended calendar day.
    #[test]
    fn noon_anchor_survives_an_offset_disagreement() {
        let day = NaiveDate::from_ymd_opt(2026, 7, 28).unwrap();
        let literal = tp_date_literal(day, 0);
        let ms: i64 = literal
            .trim_start_matches("/Date(")
            .split(['+', '-'])
            .next()
            .unwrap()
            .parse()
            .unwrap();
        for wrong_offset_hours in [-11, -6, 0, 6, 11] {
            let interpreted =
                Utc.timestamp_millis_opt(ms).unwrap() + chrono::Duration::hours(wrong_offset_hours);
            assert_eq!(
                interpreted.date_naive(),
                day,
                "a {wrong_offset_hours}h disagreement moved the entry off the day"
            );
        }
    }

    #[test]
    fn today_respects_the_configured_offset() {
        // 23:30 UTC is already the next day at +0100.
        let now = Utc.with_ymd_and_hms(2026, 7, 28, 23, 30, 0).unwrap();
        assert_eq!(
            today_in_offset(now, 0),
            NaiveDate::from_ymd_opt(2026, 7, 28).unwrap()
        );
        assert_eq!(
            today_in_offset(now, 60),
            NaiveDate::from_ymd_opt(2026, 7, 29).unwrap()
        );
        // 00:30 UTC is still the previous day at -0500.
        let early = Utc.with_ymd_and_hms(2026, 7, 28, 0, 30, 0).unwrap();
        assert_eq!(
            today_in_offset(early, -300),
            NaiveDate::from_ymd_opt(2026, 7, 27).unwrap()
        );
    }

    fn state(id: i64, name: &str, is_final: bool, priority: f64) -> TpEntityState {
        TpEntityState {
            id,
            name: name.to_string(),
            is_final,
            numeric_priority: priority,
        }
    }

    #[test]
    fn done_state_prefers_the_configured_name_case_insensitively() {
        let states = vec![
            state(1, "Open", false, 0.0),
            state(2, "In Progress", false, 1.0),
            state(3, "Done", true, 2.0),
        ];
        assert_eq!(resolve_done_state(&states, "done").unwrap().id, 3);
        assert_eq!(resolve_done_state(&states, "  DONE ").unwrap().id, 3);
    }

    #[test]
    fn done_state_falls_back_to_the_earliest_final_state() {
        let states = vec![
            state(1, "Open", false, 0.0),
            // Deliberately out of order to prove the priority sort is used.
            state(3, "Rejected", true, 9.0),
            state(2, "Completed", true, 3.0),
        ];
        let resolved = resolve_done_state(&states, "Done").unwrap();
        assert_eq!(resolved.name, "Completed");
    }

    #[test]
    fn done_state_errors_when_the_workflow_has_no_final_state() {
        let states = vec![state(1, "Open", false, 0.0)];
        let err = resolve_done_state(&states, "Done").unwrap_err().to_string();
        assert!(err.contains("no final state"), "{err}");
        assert!(err.contains("Open"), "should list what is available: {err}");

        let err = resolve_done_state(&[], "Done").unwrap_err().to_string();
        assert!(err.contains("none"), "{err}");
    }

    #[test]
    fn find_state_by_name_reports_the_available_states() {
        let states = vec![state(1, "Open", false, 0.0), state(2, "Done", true, 1.0)];
        assert_eq!(find_state_by_name(&states, "open").unwrap().id, 1);
        let err = find_state_by_name(&states, "Grooming")
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Grooming") && err.contains("Open, Done"),
            "{err}"
        );
    }

    #[test]
    fn writes_require_an_id_in_the_response() {
        assert_eq!(
            require_id(&serde_json::json!({ "Id": 55 }), "nope").unwrap(),
            55
        );
        // TargetProcess can answer 200 with something that is not an entity.
        let err = require_id(&serde_json::json!({ "Message": "no" }), "not created")
            .unwrap_err()
            .to_string();
        assert!(err.contains("not created"), "{err}");
    }

    #[test]
    fn server_messages_are_clipped() {
        let long = "x".repeat(500);
        let clipped = clip(&long);
        assert_eq!(clipped.chars().count(), 201); // 200 + ellipsis
        assert_eq!(clip("  short  "), "short");
    }

    #[test]
    fn user_story_json_maps_nested_project_and_process() {
        let story = user_story_from_json(&serde_json::json!({
            "Id": 12,
            "Name": "Login screen",
            "EntityState": { "Name": "In Progress" },
            "Project": { "Id": 3, "Name": "Evo", "Process": { "Id": 9 } }
        }));
        assert_eq!(
            story,
            TpUserStory {
                id: 12,
                name: "Login screen".into(),
                state_name: "In Progress".into(),
                project_id: Some(3),
                project_name: "Evo".into(),
                process_id: Some(9),
            }
        );

        // Missing nested objects must not panic — TP omits fields it can't fill.
        let sparse = user_story_from_json(&serde_json::json!({ "Id": 1 }));
        assert_eq!(sparse.project_id, None);
        assert_eq!(sparse.process_id, None);
        assert_eq!(sparse.state_name, "");
    }
}
