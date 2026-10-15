//! Reading data: paged table rows with sort and filters (always bound
//! parameters, identifiers checked against the table's columns), and free
//! SQL from the editor with cancel support.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use mysql::prelude::Queryable;
use mysql::{Params, Value};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::State;

use super::schema;
use super::session::Sessions;
use super::values::{column_meta, quote_ident, to_json, ColumnMeta};
use crate::util::blocking;

/// Rows kept per result set; more are counted but not sent.
pub const MAX_ROWS: usize = 5_000;
const MAX_PAGE: u64 = 2_000;

#[derive(Debug, Clone, Serialize)]
pub struct ResultSet {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Json>>,
    /// More rows existed than were returned.
    pub truncated: bool,
    pub affected_rows: u64,
    pub last_insert_id: Option<u64>,
    pub info: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub column: String,
    /// =, !=, <, >, <=, >=, like, not like, is null, is not null, and the
/// text searches contains, not contains, starts with, ends with.
    pub op: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RowsRequest {
    pub table: String,
    pub offset: u64,
    pub limit: u64,
    pub sort: Option<(String, String)>,
    #[serde(default)]
    pub filters: Vec<Filter>,
}

#[derive(Debug, Serialize)]
pub struct RowsPage {
    pub result: ResultSet,
    pub total: u64,
    pub primary_key: Vec<String>,
}

/// `text` with LIKE's wildcards made literal, using `!` as the escape
/// character (a backslash would depend on the server's SQL mode).
fn escape_like(text: &str) -> String {
    text.chars()
        .flat_map(|c| match c {
            '!' | '%' | '_' => vec!['!', c],
            c => vec![c],
        })
        .collect()
}

/// WHERE clause and its parameters. Columns must exist in `known`.
pub fn where_clause(filters: &[Filter], known: &[String]) -> Result<(String, Vec<Value>), String> {
    let mut parts = Vec::new();
    let mut params = Vec::new();
    for f in filters {
        if !known.iter().any(|k| k == &f.column) {
            return Err(format!("Unknown column {}.", f.column));
        }
        let col = quote_ident(&f.column);
        let op = f.op.to_lowercase();
        match op.as_str() {
            "is null" => parts.push(format!("{col} IS NULL")),
            "is not null" => parts.push(format!("{col} IS NOT NULL")),
            "=" | "!=" | "<" | ">" | "<=" | ">=" | "like" | "not like" => {
                let sql_op = match op.as_str() {
                    "like" => "LIKE",
                    "not like" => "NOT LIKE",
                    other => other,
                };
                parts.push(format!("{col} {sql_op} ?"));
                params.push(Value::Bytes(f.value.clone().unwrap_or_default().into_bytes()));
            }
            "contains" | "not contains" | "starts with" | "ends with" => {
                // The typed text is matched literally: its % and _ are escaped.
                let text = escape_like(f.value.as_deref().unwrap_or(""));
                let (not, pattern) = match op.as_str() {
                    "contains" => ("", format!("%{text}%")),
                    "not contains" => ("NOT ", format!("%{text}%")),
                    "starts with" => ("", format!("{text}%")),
                    _ => ("", format!("%{text}")),
                };
                parts.push(format!("{col} {not}LIKE ? ESCAPE '!'"));
                params.push(Value::Bytes(pattern.into_bytes()));
            }
            other => return Err(format!("Unsupported filter operator {other}.")),
        }
    }
    let sql = if parts.is_empty() { String::new() } else { format!(" WHERE {}", parts.join(" AND ")) };
    Ok((sql, params))
}

fn collect(result: &mut mysql::QueryResult<'_, '_, '_, impl mysql::prelude::Protocol>, started: Instant) -> Result<Vec<ResultSet>, String> {
    let mut sets = Vec::new();
    while let Some(set) = result.iter() {
        let cols = set.columns().as_ref().to_vec();
        let meta = column_meta(&cols);
        let affected_rows = set.affected_rows();
        let last_insert_id = set.last_insert_id();
        let info = set.info_str().into_owned();
        let mut rows = Vec::new();
        let mut truncated = false;
        for row in set {
            let row = row.map_err(|e| e.to_string())?;
            if rows.len() >= MAX_ROWS {
                truncated = true;
                continue;
            }
            let values = row.unwrap();
            rows.push(values.into_iter().zip(meta.iter()).map(|(v, m)| to_json(v, m.kind)).collect());
        }
        sets.push(ResultSet { columns: meta, rows, truncated, affected_rows, last_insert_id, info, elapsed_ms: started.elapsed().as_millis() as u64 });
    }
    Ok(sets)
}

#[tauri::command]
pub async fn db_rows(sessions: State<'_, Sessions>, connection_id: String, request: RowsRequest) -> Result<RowsPage, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || {
        let mut conn = session.conn()?;
        let columns: Vec<String> = schema::columns(&mut conn, &request.table)?.into_iter().map(|c| c.name).collect();
        let primary_key = schema::primary_key(&mut conn, &request.table)?;
        let (where_sql, params) = where_clause(&request.filters, &columns)?;
        let table = quote_ident(&request.table);
        let order = match &request.sort {
            Some((col, dir)) if columns.contains(col) => format!(" ORDER BY {} {}", quote_ident(col), if dir == "desc" { "DESC" } else { "ASC" }),
            Some((col, _)) => return Err(format!("Unknown column {col}.")),
            None if !primary_key.is_empty() => format!(" ORDER BY {}", primary_key.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ")),
            None => String::new(),
        };
        let limit = request.limit.clamp(1, MAX_PAGE);
        let started = Instant::now();
        let total: Option<u64> = conn
            .exec_first(format!("SELECT COUNT(*) FROM {table}{where_sql}"), Params::Positional(params.clone()))
            .map_err(|e| e.to_string())?;
        let sql = format!("SELECT * FROM {table}{where_sql}{order} LIMIT {limit} OFFSET {}", request.offset);
        let mut result = conn.exec_iter(sql, Params::Positional(params)).map_err(|e| e.to_string())?;
        let mut sets = collect(&mut result, started)?;
        let result = sets.pop().ok_or("The query returned nothing.")?;
        Ok(RowsPage { result, total: total.unwrap_or(0), primary_key })
    })
    .await
}

/// Running editor queries: query id → MySQL connection id, for KILL QUERY.
#[derive(Default)]
pub struct RunningQueries(Mutex<HashMap<String, (String, u32)>>);

/// Statements that only read. Several statements must all read; when in
/// doubt (odd quoting) the answer is "no", which only asks for confirmation.
pub fn is_read_only(sql: &str) -> bool {
    // MySQL runs the contents of /*! … */ comments: never treat them as inert.
    if sql.contains("/*!") {
        return false;
    }
    let parts: Vec<&str> = sql.split(';').filter(|p| !strip_comments(p).trim().is_empty()).collect();
    !parts.is_empty() && parts.iter().all(|p| is_read_only_statement(p))
}

fn is_read_only_statement(sql: &str) -> bool {
    // Collapse whitespace so "INTO\nOUTFILE" or "DELETE\tFROM" can't slip by.
    let lower = strip_comments(sql).split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let first = lower.split(' ').next().unwrap_or("");
    let reads = matches!(first, "select" | "show" | "describe" | "desc" | "explain" | "with" | "use" | "help");
    let writes_file = lower.contains(" into outfile") || lower.contains(" into dumpfile");
    let cte_writes = first == "with" && ["update ", "delete ", "insert "].iter().any(|k| lower.contains(k));
    reads && !writes_file && !cte_writes
}

fn strip_comments(sql: &str) -> String {
    let mut out = String::new();
    for line in sql.lines() {
        let line = line.trim_start();
        if line.starts_with("--") || line.starts_with('#') {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    // Block comments at the start.
    let mut s = out.trim_start().to_string();
    while s.starts_with("/*") {
        match s.find("*/") {
            Some(end) => s = s[end + 2..].trim_start().to_string(),
            None => break,
        }
    }
    s
}

#[tauri::command]
pub async fn db_query(
    sessions: State<'_, Sessions>,
    running: State<'_, std::sync::Arc<RunningQueries>>,
    connection_id: String,
    query_id: String,
    sql: String,
    allow_writes: bool,
) -> Result<Vec<ResultSet>, String> {
    if !allow_writes && !is_read_only(&sql) {
        return Err("This statement changes data and needs confirmation.".into());
    }
    let session = sessions.get(&connection_id)?;
    let running = running.inner().clone();
    blocking(move || {
        let mut conn = session.conn()?;
        running.0.lock().unwrap().insert(query_id.clone(), (connection_id, conn.connection_id()));
        let started = Instant::now();
        let outcome = conn.query_iter(&sql).map_err(|e| e.to_string()).and_then(|mut r| collect(&mut r, started));
        running.0.lock().unwrap().remove(&query_id);
        outcome
    })
    .await
}

#[tauri::command]
pub async fn db_cancel(sessions: State<'_, Sessions>, running: State<'_, std::sync::Arc<RunningQueries>>, query_id: String) -> Result<(), String> {
    let Some((connection_id, thread)) = running.0.lock().unwrap().get(&query_id).cloned() else {
        return Ok(());
    };
    let session = sessions.get(&connection_id)?;
    // A separate connection: the pool may be full of the very query to stop.
    blocking(move || session.side_conn()?.query_drop(format!("KILL QUERY {thread}")).map_err(|e| e.to_string())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(column: &str, op: &str, value: Option<&str>) -> Filter {
        Filter { column: column.into(), op: op.into(), value: value.map(String::from) }
    }

    #[test]
    fn builds_parameterised_filters() {
        let known = vec!["id".to_string(), "name".to_string()];
        let (sql, params) = where_clause(&[f("name", "like", Some("%ab%")), f("id", "is not null", None)], &known).unwrap();
        assert_eq!(sql, " WHERE `name` LIKE ? AND `id` IS NOT NULL");
        assert_eq!(params.len(), 1);
        assert!(where_clause(&[f("password; DROP", "=", Some("x"))], &known).is_err());
        assert!(where_clause(&[f("id", "OR 1=1 --", Some("x"))], &known).is_err());
        assert_eq!(where_clause(&[], &known).unwrap().0, "");
    }

    #[test]
    fn text_search_filters_match_literally() {
        let known = vec!["name".to_string()];
        let (sql, params) = where_clause(&[f("name", "contains", Some("50%_off!"))], &known).unwrap();
        assert_eq!(sql, " WHERE `name` LIKE ? ESCAPE '!'");
        assert_eq!(params, vec![Value::Bytes(b"%50!%!_off!!%".to_vec())]);
        let (sql, params) = where_clause(&[f("name", "not contains", Some("x")), f("name", "starts with", Some("ab")), f("name", "ends with", Some("yz"))], &known).unwrap();
        assert_eq!(sql, " WHERE `name` NOT LIKE ? ESCAPE '!' AND `name` LIKE ? ESCAPE '!' AND `name` LIKE ? ESCAPE '!'");
        assert_eq!(params, vec![Value::Bytes(b"%x%".to_vec()), Value::Bytes(b"ab%".to_vec()), Value::Bytes(b"%yz".to_vec())]);
    }

    #[test]
    fn recognises_read_only_statements() {
        assert!(is_read_only("SELECT * FROM t"));
        assert!(is_read_only("  -- note\n show tables"));
        assert!(is_read_only("/* hi */ explain select 1"));
        assert!(!is_read_only("UPDATE t SET a = 1"));
        assert!(!is_read_only("delete from t"));
        assert!(!is_read_only("select * from t into outfile '/tmp/x'"));
        assert!(!is_read_only("WITH x AS (SELECT 1) DELETE FROM t"));
        assert!(!is_read_only(""));
        assert!(is_read_only("select 1; select 2;"));
        assert!(!is_read_only("select 1; delete from t"));
        assert!(!is_read_only("SELECT 1; /*!50000 DELETE FROM t */"));
        assert!(!is_read_only("select * from t into\noutfile '/tmp/x'"));
        assert!(!is_read_only("select * from t INTO DUMPFILE '/tmp/x'"));
        assert!(!is_read_only("WITH x AS (SELECT 1) DELETE\nFROM t"));
    }
}
