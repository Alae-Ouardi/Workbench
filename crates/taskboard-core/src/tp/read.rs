//! Read-only TargetProcess queries behind the TP Workspace views (dashboard,
//! sprint stories, overdue, time calendar, my work).
//!
//! Every collection is queried per entity type (`UserStories`, `Tasks`,
//! `Bugs`) instead of through `Assignables`: the type-specific collections
//! accept the `UserStory` link in `include`, the polymorphic one does not.
//! Mappers are deliberately forgiving — TargetProcess omits fields it cannot
//! fill, and a missing value must never drop the whole item.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::tp::client::{str_field, TpClient};

/// Entity types the workspace shows, with their collection paths.
pub const WORK_ITEM_COLLECTIONS: [(&str, &str); 3] =
    [("UserStory", "UserStories"), ("Task", "Tasks"), ("Bug", "Bugs")];

/// How far back the overdue view looks for missed dates.
pub const OVERDUE_LOOKBACK_DAYS: i64 = 180;

const PROJECT_INCLUDE: &str = "[Id,Name,Abbreviation,Process[Id]]";
const SPRINT_INCLUDE: &str = "[Id,Name,StartDate,EndDate,Team[Id,Name]]";
const TIME_INCLUDE: &str =
    "[Id,Spent,Remain,Date,Description,Assignable[Id,Name,EntityType[Name]],Project[Id,Name]]";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpProject {
    pub id: i64,
    pub name: String,
    pub abbreviation: String,
    pub process_id: Option<i64>,
}

/// A team iteration (sprint).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpSprint {
    pub id: i64,
    pub name: String,
    /// `YYYY-MM-DD` in the instance's timezone.
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub team_id: Option<i64>,
    pub team_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpStateRef {
    pub id: i64,
    pub name: String,
    pub is_final: bool,
    pub numeric_priority: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpPerson {
    pub id: i64,
    pub name: String,
}

/// A user story, task or bug, flattened for display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpWorkItem {
    pub id: i64,
    /// `UserStory`, `Task` or `Bug`.
    pub entity_type: String,
    pub name: String,
    pub state: TpStateRef,
    pub project_id: Option<i64>,
    pub project_name: String,
    pub process_id: Option<i64>,
    pub team_name: String,
    pub sprint_id: Option<i64>,
    pub sprint_name: String,
    pub sprint_end_date: Option<String>,
    /// Parent story, for tasks and bugs.
    pub user_story_id: Option<i64>,
    pub user_story_name: String,
    pub effort: f64,
    pub effort_completed: f64,
    pub effort_to_do: f64,
    pub time_spent: f64,
    pub time_remain: f64,
    pub planned_end_date: Option<String>,
    /// When the item reached a final state.
    pub end_date: Option<String>,
    pub start_date: Option<String>,
    pub modify_date: Option<String>,
    pub assigned: Vec<TpPerson>,
    pub tags: Vec<String>,
}

/// One logged time entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TpTimeEntry {
    pub id: i64,
    /// `YYYY-MM-DD`, the calendar day TargetProcess files the entry under.
    pub date: String,
    pub spent: f64,
    pub remain: f64,
    pub description: String,
    pub entity_id: Option<i64>,
    pub entity_type: String,
    pub entity_name: String,
    pub project_id: Option<i64>,
    pub project_name: String,
}

/// `include` for a work-item collection. Stories have no parent story.
fn work_item_include(entity_type: &str) -> String {
    let parent = if entity_type == "UserStory" {
        ""
    } else {
        "UserStory[Id,Name],"
    };
    format!(
        "[Id,Name,EntityType[Name],EntityState[Id,Name,IsFinal,NumericPriority],\
         Project[Id,Name,Process[Id]],Team[Id,Name],TeamIteration[Id,Name,EndDate],{parent}\
         Effort,EffortCompleted,EffortToDo,TimeSpent,TimeRemain,\
         PlannedEndDate,StartDate,EndDate,ModifyDate,Tags,\
         Assignments[GeneralUser[Id,FirstName,LastName]]]"
    )
}

/// `Project.Id in (1,2)` — or nothing when no project filter is set.
pub fn project_clause(project_ids: &[i64]) -> Option<String> {
    if project_ids.is_empty() {
        return None;
    }
    let ids: Vec<String> = project_ids.iter().map(i64::to_string).collect();
    Some(format!("(Project.Id in ({}))", ids.join(",")))
}

/// Join clauses with `and`. TargetProcess rejects a nested `or`, so callers
/// that need one run two queries instead.
pub fn and_all(clauses: &[Option<String>]) -> String {
    clauses
        .iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join(" and ")
}

fn date_literal(date: NaiveDate) -> String {
    format!("'{}'", date.format("%Y-%m-%d"))
}

impl TpClient {
    pub fn list_projects(&self) -> Result<Vec<TpProject>> {
        let items = self.get_all_items(
            "Projects",
            &[
                ("where", "IsActive eq 'true'".to_string()),
                ("include", PROJECT_INCLUDE.to_string()),
                ("orderBy", "Name".to_string()),
            ],
        )?;
        Ok(items.iter().map(project_from_json).collect())
    }

    /// Sprints that ended no earlier than `since`, newest first. Covers the
    /// running sprint plus recent ones for the sprint picker.
    ///
    /// With `project_ids`, only sprints holding stories of those projects are
    /// kept. A team iteration belongs to a team, not a project, so the link is
    /// found through the projects' stories.
    pub fn list_sprints(&self, since: NaiveDate, project_ids: &[i64]) -> Result<Vec<TpSprint>> {
        let items = self.get_all_items(
            "TeamIterations",
            &[
                ("where", format!("EndDate gte {}", date_literal(since))),
                ("include", SPRINT_INCLUDE.to_string()),
                ("orderByDesc", "StartDate".to_string()),
            ],
        )?;
        let sprints: Vec<TpSprint> = items
            .iter()
            .map(|i| sprint_from_json(i, self.tz_offset_minutes))
            .collect();
        let Some(projects) = project_clause(project_ids) else {
            return Ok(sprints);
        };
        let stories = self.get_all_items(
            "UserStories",
            &[
                (
                    "where",
                    and_all(&[
                        Some(projects),
                        Some(format!("(TeamIteration.EndDate gte {})", date_literal(since))),
                    ]),
                ),
                ("include", "[Id,TeamIteration[Id]]".to_string()),
            ],
        )?;
        let used: std::collections::HashSet<i64> = stories
            .iter()
            .filter_map(|s| id_of(s.get("TeamIteration")))
            .collect();
        Ok(keep_sprints(sprints, &used))
    }

    /// Run one `where` against every work-item collection and merge the results.
    pub fn query_work_items(&self, where_clause: &str) -> Result<Vec<TpWorkItem>> {
        self.query_collections(where_clause, &["UserStory", "Task", "Bug"])
    }

    /// Like [`query_work_items`](Self::query_work_items), limited to `types`.
    pub fn query_collections(&self, where_clause: &str, types: &[&str]) -> Result<Vec<TpWorkItem>> {
        let mut all = Vec::new();
        for (entity_type, collection) in WORK_ITEM_COLLECTIONS {
            if !types.contains(&entity_type) {
                continue;
            }
            let mut query = vec![("include", work_item_include(entity_type))];
            if !where_clause.is_empty() {
                query.push(("where", where_clause.to_string()));
            }
            let items = self.get_all_items(collection, &query)?;
            all.extend(items.iter().map(|i| work_item_from_json(i, entity_type, self.tz_offset_minutes)));
        }
        Ok(all)
    }

    /// Everything on a sprint's board. Tasks and bugs do not inherit their
    /// story's sprint in TargetProcess, so those under a sprint story are
    /// fetched through the story as well and merged in.
    pub fn sprint_items(&self, sprint_id: i64) -> Result<Vec<TpWorkItem>> {
        let direct = self.query_work_items(&format!("TeamIteration.Id eq {sprint_id}"))?;
        let via_story = self.query_collections(
            &format!("UserStory.TeamIteration.Id eq {sprint_id}"),
            &["Task", "Bug"],
        )?;
        Ok(dedupe_by_id(direct.into_iter().chain(via_story).collect()))
    }

    /// Open items assigned to `user_id`.
    pub fn my_work(&self, user_id: i64) -> Result<Vec<TpWorkItem>> {
        self.query_work_items(&format!(
            "(AssignedUser.Id eq {user_id}) and (EntityState.IsFinal eq 'false')"
        ))
    }

    /// Items assigned to the user that were closed on or after `since`.
    pub fn my_closed(&self, user_id: i64, since: NaiveDate) -> Result<Vec<TpWorkItem>> {
        self.query_work_items(&format!(
            "(AssignedUser.Id eq {user_id}) and (EntityState.IsFinal eq 'true') and (EndDate gte {})",
            date_literal(since)
        ))
    }

    /// Open items whose planned end has passed, plus open items left in a sprint
    /// that already ended. Two queries because the parser rejects a nested `or`.
    ///
    /// Bounded to the last [`OVERDUE_LOOKBACK_DAYS`]: an instance accumulates
    /// years of abandoned items nobody will act on, and paging through all of
    /// them would make the view unusably slow.
    pub fn overdue(&self, today: NaiveDate, project_ids: &[i64]) -> Result<Vec<TpWorkItem>> {
        let open = Some("(EntityState.IsFinal eq 'false')".to_string());
        let projects = project_clause(project_ids);
        let since = date_literal(today - chrono::Duration::days(OVERDUE_LOOKBACK_DAYS));
        let late = self.query_work_items(&and_all(&[
            open.clone(),
            Some(format!("(PlannedEndDate lt {})", date_literal(today))),
            Some(format!("(PlannedEndDate gte {since})")),
            projects.clone(),
        ]))?;
        let stranded = self.query_work_items(&and_all(&[
            open,
            Some(format!("(TeamIteration.EndDate lt {})", date_literal(today))),
            Some(format!("(TeamIteration.EndDate gte {since})")),
            projects,
        ]))?;
        Ok(dedupe_by_id(late.into_iter().chain(stranded).collect()))
    }

    /// Time logged by `user_id` between `from` and `to`, inclusive.
    ///
    /// The upper bound is `< to + 1 day` rather than `<= to`: entries carry a
    /// time of day (this app logs at noon), and `<= 'to'` compares against
    /// midnight, which would drop the whole last day.
    pub fn times(&self, user_id: i64, from: NaiveDate, to: NaiveDate) -> Result<Vec<TpTimeEntry>> {
        let items = self.get_all_items(
            "Times",
            &[
                (
                    "where",
                    format!(
                        "(User.Id eq {user_id}) and (Date gte {}) and (Date lt {})",
                        date_literal(from),
                        date_literal(to + chrono::Duration::days(1))
                    ),
                ),
                ("include", TIME_INCLUDE.to_string()),
                ("orderBy", "Date".to_string()),
            ],
        )?;
        Ok(items.iter().map(|i| time_from_json(i, self.tz_offset_minutes)).collect())
    }

    /// Workflow states for an item's process, for the quick state switcher.
    pub fn states_for(&self, process_id: i64, entity_type: &str) -> Result<Vec<crate::tp::TpEntityState>> {
        self.fetch_entity_states(process_id, entity_type)
    }

    /// Move a story, task or bug to a state. Unlike `set_entity_state`, which
    /// only knows the Task/Bug collections the board mirrors, this also covers
    /// user stories.
    pub fn set_work_item_state(&self, entity_type: &str, entity_id: i64, state_id: i64) -> Result<()> {
        let response = self.post_json(
            &format!("{}/{entity_id}", work_item_collection(entity_type)?),
            serde_json::json!({ "EntityState": { "Id": state_id } }),
        )?;
        crate::tp::client::require_id(&response, "state was not changed")?;
        Ok(())
    }
}

/// Collection path for a work-item type, rejecting anything else so a bad
/// value from the UI can never build an arbitrary URL.
pub fn work_item_collection(entity_type: &str) -> Result<&'static str> {
    WORK_ITEM_COLLECTIONS
        .iter()
        .find(|(t, _)| *t == entity_type)
        .map(|(_, c)| *c)
        .ok_or_else(|| crate::error::Error::Tp(format!("unsupported entity type '{entity_type}'")))
}

fn keep_sprints(sprints: Vec<TpSprint>, ids: &std::collections::HashSet<i64>) -> Vec<TpSprint> {
    sprints.into_iter().filter(|s| ids.contains(&s.id)).collect()
}

fn dedupe_by_id(items: Vec<TpWorkItem>) -> Vec<TpWorkItem> {
    let mut seen = std::collections::HashSet::new();
    items.into_iter().filter(|i| seen.insert(i.id)).collect()
}

// ------------------------------------------------------------------- mapping

/// Parse a legacy `/Date(<ms>±HHMM)/` literal into a calendar day.
///
/// The day is taken in the offset carried by the literal — the instance's own
/// timezone — so a time entry filed under Monday stays on Monday whatever the
/// viewer's timezone is. `fallback_offset_minutes` is used when the literal has
/// no offset.
pub fn parse_tp_date(literal: &str, fallback_offset_minutes: i32) -> Option<NaiveDate> {
    let inner = literal
        .trim()
        .strip_prefix("/Date(")?
        .strip_suffix(")/")?;
    // The offset sign is the first '+' or '-' after the leading digit, so a
    // negative timestamp (before 1970) keeps its own minus.
    let split_at = inner
        .char_indices()
        .skip(1)
        .find(|(_, c)| *c == '+' || *c == '-')
        .map(|(i, _)| i);
    let (ms_part, offset_minutes) = match split_at {
        Some(i) => {
            let (ms, off) = inner.split_at(i);
            (ms, parse_offset(off)?)
        }
        None => (inner, fallback_offset_minutes),
    };
    let ms: i64 = ms_part.parse().ok()?;
    let utc = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)?;
    Some((utc + chrono::Duration::minutes(offset_minutes as i64)).date_naive())
}

/// `+0130` → 90, `-0500` → -300.
fn parse_offset(raw: &str) -> Option<i32> {
    let (sign, digits) = match raw.as_bytes().first()? {
        b'+' => (1, &raw[1..]),
        b'-' => (-1, &raw[1..]),
        _ => return None,
    };
    if digits.len() != 4 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let hours: i32 = digits[..2].parse().ok()?;
    let minutes: i32 = digits[2..].parse().ok()?;
    Some(sign * (hours * 60 + minutes))
}

fn date_field(value: &serde_json::Value, key: &str, tz: i32) -> Option<String> {
    let literal = value.get(key)?.as_str()?;
    parse_tp_date(literal, tz).map(|d| d.format("%Y-%m-%d").to_string())
}

fn id_of(value: Option<&serde_json::Value>) -> Option<i64> {
    value?.get("Id")?.as_i64()
}

fn num(value: &serde_json::Value, key: &str) -> f64 {
    value.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

fn name_of(value: Option<&serde_json::Value>) -> String {
    value.map(|v| str_field(v, "Name")).unwrap_or_default()
}

fn person_from_json(value: &serde_json::Value) -> Option<TpPerson> {
    let id = value.get("Id")?.as_i64()?;
    let name = format!("{} {}", str_field(value, "FirstName"), str_field(value, "LastName"))
        .trim()
        .to_string();
    Some(TpPerson { id, name })
}

/// TargetProcess returns collections as `{ "Items": [...] }` in includes; plain
/// arrays are accepted too.
fn collection_items(value: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    match value {
        Some(serde_json::Value::Array(items)) => items.clone(),
        Some(v) => v
            .get("Items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Who an item is assigned to, from `Assignments` (one per person and role).
/// `AssignedUser` is only a fallback: in large list pages TargetProcess
/// returns it empty for some items that do have an assignee.
fn assignees(item: &serde_json::Value) -> Vec<TpPerson> {
    let via_assignments: Vec<serde_json::Value> = collection_items(item.get("Assignments"))
        .iter()
        .filter_map(|a| a.get("GeneralUser").cloned())
        .collect();
    let people = if via_assignments.is_empty() { collection_items(item.get("AssignedUser")) } else { via_assignments };
    let mut out: Vec<TpPerson> = Vec::new();
    for p in people.iter().filter_map(person_from_json) {
        if !out.iter().any(|q| q.id == p.id) {
            out.push(p);
        }
    }
    out
}

/// Tags come back as one comma-separated string.
fn parse_tags(value: &serde_json::Value) -> Vec<String> {
    str_field(value, "Tags")
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

pub fn project_from_json(item: &serde_json::Value) -> TpProject {
    TpProject {
        id: item.get("Id").and_then(|v| v.as_i64()).unwrap_or(0),
        name: str_field(item, "Name"),
        abbreviation: str_field(item, "Abbreviation"),
        process_id: id_of(item.get("Process")),
    }
}

pub fn sprint_from_json(item: &serde_json::Value, tz: i32) -> TpSprint {
    TpSprint {
        id: item.get("Id").and_then(|v| v.as_i64()).unwrap_or(0),
        name: str_field(item, "Name"),
        start_date: date_field(item, "StartDate", tz),
        end_date: date_field(item, "EndDate", tz),
        team_id: id_of(item.get("Team")),
        team_name: name_of(item.get("Team")),
    }
}

pub fn work_item_from_json(item: &serde_json::Value, fallback_type: &str, tz: i32) -> TpWorkItem {
    let state = item.get("EntityState");
    let project = item.get("Project");
    let sprint = item.get("TeamIteration");
    let story = item.get("UserStory");
    let entity_type = item
        .get("EntityType")
        .map(|t| str_field(t, "Name"))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| fallback_type.to_string());
    TpWorkItem {
        id: item.get("Id").and_then(|v| v.as_i64()).unwrap_or(0),
        entity_type,
        name: str_field(item, "Name"),
        state: TpStateRef {
            id: id_of(state).unwrap_or(0),
            name: name_of(state),
            is_final: state
                .and_then(|s| s.get("IsFinal"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            numeric_priority: state.map(|s| num(s, "NumericPriority")).unwrap_or(0.0),
        },
        project_id: id_of(project),
        project_name: name_of(project),
        process_id: project.and_then(|p| id_of(p.get("Process"))),
        team_name: name_of(item.get("Team")),
        sprint_id: id_of(sprint),
        sprint_name: name_of(sprint),
        sprint_end_date: sprint.and_then(|s| date_field(s, "EndDate", tz)),
        user_story_id: id_of(story),
        user_story_name: name_of(story),
        effort: num(item, "Effort"),
        effort_completed: num(item, "EffortCompleted"),
        effort_to_do: num(item, "EffortToDo"),
        time_spent: num(item, "TimeSpent"),
        time_remain: num(item, "TimeRemain"),
        planned_end_date: date_field(item, "PlannedEndDate", tz),
        end_date: date_field(item, "EndDate", tz),
        start_date: date_field(item, "StartDate", tz),
        modify_date: date_field(item, "ModifyDate", tz),
        assigned: assignees(item),
        tags: parse_tags(item),
    }
}

pub fn time_from_json(item: &serde_json::Value, tz: i32) -> TpTimeEntry {
    let assignable = item.get("Assignable");
    let project = item.get("Project");
    TpTimeEntry {
        id: item.get("Id").and_then(|v| v.as_i64()).unwrap_or(0),
        date: date_field(item, "Date", tz).unwrap_or_default(),
        spent: num(item, "Spent"),
        remain: num(item, "Remain"),
        description: str_field(item, "Description"),
        entity_id: id_of(assignable),
        entity_type: assignable
            .and_then(|a| a.get("EntityType"))
            .map(|t| str_field(t, "Name"))
            .unwrap_or_default(),
        entity_name: name_of(assignable),
        project_id: id_of(project),
        project_name: name_of(project),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn day(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn tp_dates_use_the_offset_in_the_literal() {
        // 2026-07-27T23:30:00Z is already the 28th at +0100.
        let ms = 1_785_195_000_000i64;
        assert_eq!(parse_tp_date(&format!("/Date({ms}+0100)/"), 0), Some(day(2026, 7, 28)));
        assert_eq!(parse_tp_date(&format!("/Date({ms}+0000)/"), 0), Some(day(2026, 7, 27)));
        assert_eq!(parse_tp_date(&format!("/Date({ms}-0500)/"), 0), Some(day(2026, 7, 27)));
    }

    #[test]
    fn tp_dates_without_an_offset_use_the_fallback() {
        let ms = 1_785_195_000_000i64;
        assert_eq!(parse_tp_date(&format!("/Date({ms})/"), 60), Some(day(2026, 7, 28)));
        assert_eq!(parse_tp_date(&format!("/Date({ms})/"), 0), Some(day(2026, 7, 27)));
    }

    #[test]
    fn tp_dates_handle_half_hour_offsets_and_negative_millis() {
        assert_eq!(parse_tp_date("/Date(0+0530)/", 0), Some(day(1970, 1, 1)));
        assert_eq!(parse_tp_date("/Date(-86400000+0000)/", 0), Some(day(1969, 12, 31)));
    }

    #[test]
    fn malformed_tp_dates_are_rejected() {
        for bad in ["", "2026-07-28", "/Date(abc)/", "/Date(1+01)/", "/Date(1+0100"] {
            assert_eq!(parse_tp_date(bad, 0), None, "{bad}");
        }
    }

    #[test]
    fn project_clause_lists_ids_or_nothing() {
        assert_eq!(project_clause(&[]), None);
        assert_eq!(project_clause(&[3, 7]).unwrap(), "(Project.Id in (3,7))");
    }

    #[test]
    fn and_all_skips_missing_clauses() {
        assert_eq!(
            and_all(&[Some("(A)".into()), None, Some("(B)".into())]),
            "(A) and (B)"
        );
        assert_eq!(and_all(&[None]), "");
    }

    #[test]
    fn only_tasks_and_bugs_include_the_parent_story() {
        assert!(!work_item_include("UserStory").contains("UserStory["));
        assert!(work_item_include("Task").contains("UserStory[Id,Name]"));
        assert!(work_item_include("Bug").contains("UserStory[Id,Name]"));
    }

    #[test]
    fn work_item_maps_every_nested_field() {
        let item = work_item_from_json(
            &json!({
                "Id": 42,
                "Name": "Login form",
                "EntityType": { "Name": "Task" },
                "EntityState": { "Id": 5, "Name": "In Progress", "IsFinal": false, "NumericPriority": 2.0 },
                "Project": { "Id": 3, "Name": "Evo", "Process": { "Id": 9 } },
                "Team": { "Id": 1, "Name": "Core" },
                "TeamIteration": { "Id": 133, "Name": "Sprint 133", "EndDate": "/Date(1785240000000+0000)/" },
                "UserStory": { "Id": 40, "Name": "Auth" },
                "Effort": 5.0, "EffortCompleted": 2.0, "EffortToDo": 3.0,
                "TimeSpent": 2.5, "TimeRemain": 3.0,
                "PlannedEndDate": "/Date(1785240000000+0000)/",
                "Tags": "blocked, frontend ,",
                "AssignedUser": { "Items": [{ "Id": 7, "FirstName": "Sam", "LastName": "Lee" }] }
            }),
            "UserStory",
            0,
        );
        assert_eq!(item.entity_type, "Task");
        assert_eq!(item.state.name, "In Progress");
        assert_eq!(item.process_id, Some(9));
        assert_eq!(item.sprint_id, Some(133));
        assert_eq!(item.sprint_end_date.as_deref(), Some("2026-07-28"));
        assert_eq!(item.user_story_name, "Auth");
        assert_eq!(item.effort_to_do, 3.0);
        assert_eq!(item.planned_end_date.as_deref(), Some("2026-07-28"));
        assert_eq!(item.tags, vec!["blocked", "frontend"]);
        assert_eq!(item.assigned, vec![TpPerson { id: 7, name: "Sam Lee".into() }]);
    }

    #[test]
    fn dates_without_an_offset_use_the_instance_timezone() {
        // 23:30 UTC with no offset is already the next day at +0100.
        let item = work_item_from_json(
            &json!({ "Id": 1, "PlannedEndDate": "/Date(1785195000000)/" }),
            "Task",
            60,
        );
        assert_eq!(item.planned_end_date.as_deref(), Some("2026-07-28"));
    }

    #[test]
    fn sparse_work_items_do_not_panic() {
        let item = work_item_from_json(&json!({ "Id": 1 }), "Bug", 0);
        assert_eq!(item.entity_type, "Bug");
        assert_eq!(item.state.id, 0);
        assert!(!item.state.is_final);
        assert!(item.assigned.is_empty());
    }

    #[test]
    fn assignees_come_from_assignments_once_per_person() {
        let raw = serde_json::json!({
            "Id": 5, "Name": "x",
            "Assignments": { "Items": [
                { "GeneralUser": { "Id": 7, "FirstName": "Sam", "LastName": "Lee" } },
                { "GeneralUser": { "Id": 7, "FirstName": "Sam", "LastName": "Lee" } },
                { "GeneralUser": { "Id": 9, "FirstName": "Kim", "LastName": "Park" } }
            ]},
            "AssignedUser": { "Items": [] }
        });
        let item = work_item_from_json(&raw, "Task", 0);
        assert_eq!(item.assigned.iter().map(|p| p.id).collect::<Vec<_>>(), vec![7, 9]);
        assert!(item.tags.is_empty());
        assert_eq!(item.sprint_end_date, None);
    }

    #[test]
    fn time_entries_keep_the_tp_calendar_day() {
        let entry = time_from_json(&json!({
            "Id": 9,
            "Spent": 1.5,
            "Remain": 0,
            "Date": "/Date(1785193200000+0200)/",
            "Description": "pairing",
            "Assignable": { "Id": 42, "Name": "Login form", "EntityType": { "Name": "Task" } },
            "Project": { "Id": 3, "Name": "Evo" }
        }), 0);
        // 2026-07-27T23:00:00Z is 01:00 on the 28th at +0200.
        assert_eq!(entry.date, "2026-07-28");
        assert_eq!(entry.spent, 1.5);
        assert_eq!(entry.entity_type, "Task");
        assert_eq!(entry.project_name, "Evo");
    }

    #[test]
    fn sprints_and_projects_map_their_ids() {
        let sprint = sprint_from_json(&json!({
            "Id": 133, "Name": "Sprint 133",
            "StartDate": "/Date(1785240000000+0000)/",
            "Team": { "Id": 4, "Name": "Core" }
        }), 0);
        assert_eq!(sprint.start_date.as_deref(), Some("2026-07-28"));
        assert_eq!(sprint.end_date, None);
        assert_eq!(sprint.team_name, "Core");

        let project = project_from_json(&json!({
            "Id": 3, "Name": "Evo", "Abbreviation": "EVO", "Process": { "Id": 9 }
        }));
        assert_eq!(project.process_id, Some(9));
        assert_eq!(project.abbreviation, "EVO");
    }

    #[test]
    fn work_item_collections_are_whitelisted() {
        assert_eq!(work_item_collection("UserStory").unwrap(), "UserStories");
        assert_eq!(work_item_collection("Task").unwrap(), "Tasks");
        assert_eq!(work_item_collection("Bug").unwrap(), "Bugs");
        assert!(work_item_collection("Users/1").is_err());
        assert!(work_item_collection("").is_err());
    }

    #[test]
    fn only_sprints_used_by_the_projects_are_kept() {
        let sprint = |id| sprint_from_json(&json!({ "Id": id, "Name": format!("S{id}") }), 0);
        let used: std::collections::HashSet<i64> = [2].into_iter().collect();
        let kept = keep_sprints(vec![sprint(1), sprint(2), sprint(3)], &used);
        assert_eq!(kept.iter().map(|s| s.id).collect::<Vec<_>>(), vec![2]);
    }

    #[test]
    fn overdue_results_are_deduplicated() {
        let a = work_item_from_json(&json!({ "Id": 1 }), "Task", 0);
        let b = work_item_from_json(&json!({ "Id": 2 }), "Task", 0);
        let merged = dedupe_by_id(vec![a.clone(), b, a]);
        assert_eq!(merged.iter().map(|i| i.id).collect::<Vec<_>>(), vec![1, 2]);
    }
}
