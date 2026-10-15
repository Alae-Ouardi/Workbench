//! Row edits from the data grid. The UI describes changes (which row by its
//! primary key, which values); SQL is generated here, shown to the user as a
//! preview, and the exact prepared statements run in one transaction after
//! confirmation.

use std::collections::BTreeMap;

use mysql::prelude::Queryable;
use mysql::{Params, TxOpts, Value};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::schema;
use super::session::Sessions;
use super::values::{quote_ident, quote_literal, to_param};
use crate::util::blocking;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RowChange {
    /// Set `values` on the row identified by `key` (primary-key values).
    Update { key: BTreeMap<String, Option<String>>, values: BTreeMap<String, Option<String>> },
    Insert { values: BTreeMap<String, Option<String>> },
    Delete { key: BTreeMap<String, Option<String>> },
}

#[derive(Debug, Clone)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Value>,
    /// The same statement with literals inlined, for people to read.
    pub preview: String,
    /// Updates and deletes must touch exactly one row.
    pub single_row: bool,
}

#[derive(Debug, Serialize)]
pub struct PreparedBatch {
    pub batch_id: String,
    pub preview: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AppliedBatch {
    pub affected_rows: u64,
    pub last_insert_ids: Vec<u64>,
}

fn check_columns<'a>(names: impl Iterator<Item = &'a String>, known: &[String]) -> Result<(), String> {
    for n in names {
        if !known.contains(n) {
            return Err(format!("Unknown column {n}."));
        }
    }
    Ok(())
}

fn key_clause(key: &BTreeMap<String, Option<String>>, pk: &[String]) -> Result<(String, Vec<Value>, String), String> {
    if pk.is_empty() {
        return Err("This table has no primary key, so rows can't be edited safely here. Use the SQL editor.".into());
    }
    let given: Vec<&String> = key.keys().collect();
    if given.len() != pk.len() || !pk.iter().all(|c| key.contains_key(c)) {
        return Err("A row must be identified by its full primary key.".into());
    }
    let mut sql = Vec::new();
    let mut params = Vec::new();
    let mut preview = Vec::new();
    for col in pk {
        let value = &key[col];
        if value.is_none() {
            return Err("Primary key values cannot be NULL.".into());
        }
        sql.push(format!("{} = ?", quote_ident(col)));
        params.push(to_param(value));
        preview.push(format!("{} = {}", quote_ident(col), quote_literal(value)));
    }
    Ok((sql.join(" AND "), params, preview.join(" AND ")))
}

/// Turn one change into a statement. Pure, so it is unit-tested.
pub fn build(table: &str, change: &RowChange, columns: &[String], pk: &[String]) -> Result<Statement, String> {
    let t = quote_ident(table);
    match change {
        RowChange::Update { key, values } => {
            if values.is_empty() {
                return Err("Nothing to update.".into());
            }
            check_columns(values.keys(), columns)?;
            let (where_sql, where_params, where_preview) = key_clause(key, pk)?;
            let set_sql: Vec<String> = values.keys().map(|c| format!("{} = ?", quote_ident(c))).collect();
            let set_preview: Vec<String> = values.iter().map(|(c, v)| format!("{} = {}", quote_ident(c), quote_literal(v))).collect();
            let mut params: Vec<Value> = values.values().map(to_param).collect();
            params.extend(where_params);
            Ok(Statement {
                sql: format!("UPDATE {t} SET {} WHERE {where_sql} LIMIT 1", set_sql.join(", ")),
                params,
                preview: format!("UPDATE {t} SET {} WHERE {where_preview} LIMIT 1;", set_preview.join(", ")),
                single_row: true,
            })
        }
        RowChange::Insert { values } => {
            check_columns(values.keys(), columns)?;
            let cols: Vec<String> = values.keys().map(|c| quote_ident(c)).collect();
            if cols.is_empty() {
                return Ok(Statement { sql: format!("INSERT INTO {t} () VALUES ()"), params: vec![], preview: format!("INSERT INTO {t} () VALUES ();"), single_row: false });
            }
            let marks = vec!["?"; cols.len()].join(", ");
            let literals: Vec<String> = values.values().map(quote_literal).collect();
            Ok(Statement {
                sql: format!("INSERT INTO {t} ({}) VALUES ({marks})", cols.join(", ")),
                params: values.values().map(to_param).collect(),
                preview: format!("INSERT INTO {t} ({}) VALUES ({});", cols.join(", "), literals.join(", ")),
                single_row: false,
            })
        }
        RowChange::Delete { key } => {
            let (where_sql, params, where_preview) = key_clause(key, pk)?;
            Ok(Statement {
                sql: format!("DELETE FROM {t} WHERE {where_sql} LIMIT 1"),
                params,
                preview: format!("DELETE FROM {t} WHERE {where_preview} LIMIT 1;"),
                single_row: true,
            })
        }
    }
}

#[tauri::command]
pub async fn db_prepare_changes(sessions: State<'_, Sessions>, connection_id: String, table: String, changes: Vec<RowChange>) -> Result<PreparedBatch, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || {
        let mut conn = session.conn()?;
        let columns: Vec<String> = schema::columns(&mut conn, &table)?.into_iter().map(|c| c.name).collect();
        let pk = schema::primary_key(&mut conn, &table)?;
        let statements = changes.iter().map(|c| build(&table, c, &columns, &pk)).collect::<Result<Vec<_>, _>>()?;
        let preview = statements.iter().map(|s| s.preview.clone()).collect();
        let batch_id = session.store_batch(statements);
        Ok(PreparedBatch { batch_id, preview })
    })
    .await
}

/// Run a confirmed batch in one transaction; any surprise rolls it all back.
#[tauri::command]
pub async fn db_apply_changes(sessions: State<'_, Sessions>, connection_id: String, batch_id: String) -> Result<AppliedBatch, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || {
        let statements = session.take_batch(&batch_id).ok_or("These changes expired. Review them again.")?;
        let mut conn = session.conn()?;
        let mut tx = conn.start_transaction(TxOpts::default()).map_err(|e| e.to_string())?;
        let mut applied = AppliedBatch { affected_rows: 0, last_insert_ids: Vec::new() };
        for s in statements {
            tx.exec_drop(&s.sql, Params::Positional(s.params.clone())).map_err(|e| format!("{e}\nin: {}", s.preview))?;
            let affected = tx.affected_rows();
            if s.single_row && affected != 1 {
                return Err(format!(
                    "Expected to change 1 row but changed {affected} — the row may have been changed or deleted meanwhile. Nothing was saved.\nin: {}",
                    s.preview
                ));
            }
            applied.affected_rows += affected;
            if let Some(id) = tx.last_insert_id().filter(|id| *id > 0) {
                applied.last_insert_ids.push(id);
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(applied)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<String>> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.map(String::from))).collect()
    }

    fn cols() -> Vec<String> {
        vec!["id".into(), "name".into(), "note".into()]
    }

    #[test]
    fn builds_updates_with_params_and_a_readable_preview() {
        let change = RowChange::Update { key: map(&[("id", Some("7"))]), values: map(&[("name", Some("O'Brien")), ("note", None)]) };
        let s = build("users", &change, &cols(), &["id".into()]).unwrap();
        assert_eq!(s.sql, "UPDATE `users` SET `name` = ?, `note` = ? WHERE `id` = ? LIMIT 1");
        assert_eq!(s.params.len(), 3);
        assert_eq!(s.preview, "UPDATE `users` SET `name` = 'O''Brien', `note` = NULL WHERE `id` = 7 LIMIT 1;");
        assert!(s.single_row);
    }

    #[test]
    fn builds_inserts_and_deletes() {
        let ins = build("t", &RowChange::Insert { values: map(&[("name", Some("x"))]) }, &cols(), &["id".into()]).unwrap();
        assert_eq!(ins.sql, "INSERT INTO `t` (`name`) VALUES (?)");
        let del = build("t", &RowChange::Delete { key: map(&[("id", Some("3"))]) }, &cols(), &["id".into()]).unwrap();
        assert_eq!(del.preview, "DELETE FROM `t` WHERE `id` = 3 LIMIT 1;");
    }

    #[test]
    fn refuses_unsafe_changes() {
        let no_pk = RowChange::Delete { key: map(&[("id", Some("3"))]) };
        assert!(build("t", &no_pk, &cols(), &[]).unwrap_err().contains("no primary key"));
        let partial = RowChange::Delete { key: map(&[("id", Some("3"))]) };
        assert!(build("t", &partial, &cols(), &["id".into(), "name".into()]).is_err());
        let unknown = RowChange::Update { key: map(&[("id", Some("1"))]), values: map(&[("evil`col", Some("x"))]) };
        assert!(build("t", &unknown, &cols(), &["id".into()]).is_err());
        let null_key = RowChange::Delete { key: map(&[("id", None)]) };
        assert!(build("t", &null_key, &cols(), &["id".into()]).is_err());
    }
}
