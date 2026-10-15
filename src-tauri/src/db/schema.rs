//! What's in the database: tables and views, columns, indexes. Read from
//! information_schema for the connection's current database.

use std::collections::BTreeMap;

use mysql::prelude::Queryable;
use serde::Serialize;
use tauri::State;

use super::session::Sessions;
use crate::util::blocking;

/// TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, TABLE_COMMENT
type TableRow = (String, String, Option<u64>, Option<u64>, Option<u64>, Option<String>);
/// COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
type ColumnRow = (String, String, String, String, Option<String>, String, String);

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
    /// Approximate for InnoDB.
    pub rows: Option<u64>,
    pub size_bytes: Option<u64>,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    /// Full type, e.g. `varchar(255)` or `int unsigned`.
    pub column_type: String,
    pub nullable: bool,
    /// PRI, UNI, MUL or empty.
    pub key: String,
    pub default: Option<String>,
    /// auto_increment, on update …
    pub extra: String,
    pub comment: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub columns: Vec<String>,
}

pub fn tables(conn: &mut mysql::PooledConn) -> Result<Vec<TableInfo>, String> {
    let rows: Vec<TableRow> = conn
        .query(
            "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, TABLE_COMMENT \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
        )
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(name, kind, rows, data, index, comment)| TableInfo {
            name,
            kind: if kind.contains("VIEW") { "view".into() } else { "table".into() },
            rows,
            size_bytes: data.map(|d| d + index.unwrap_or(0)),
            comment: comment.unwrap_or_default(),
        })
        .collect())
}

pub fn columns(conn: &mut mysql::PooledConn, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let rows: Vec<ColumnRow> = conn
        .exec(
            "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT \
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            (table,),
        )
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err(format!("Table {table} was not found."));
    }
    Ok(rows
        .into_iter()
        .map(|(name, column_type, nullable, key, default, extra, comment)| ColumnInfo {
            name,
            column_type,
            nullable: nullable == "YES",
            key,
            default,
            extra,
            comment,
        })
        .collect())
}

pub fn indexes(conn: &mut mysql::PooledConn, table: &str) -> Result<Vec<IndexInfo>, String> {
    let rows: Vec<(String, i64, String)> = conn
        .exec(
            "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
            (table,),
        )
        .map_err(|e| e.to_string())?;
    let mut by_name: BTreeMap<String, IndexInfo> = BTreeMap::new();
    for (name, non_unique, column) in rows {
        by_name
            .entry(name.clone())
            .or_insert_with(|| IndexInfo { name, unique: non_unique == 0, columns: Vec::new() })
            .columns
            .push(column);
    }
    let mut list: Vec<IndexInfo> = by_name.into_values().collect();
    list.sort_by_key(|i| (i.name != "PRIMARY", i.name.clone()));
    Ok(list)
}

/// Primary-key columns in key order (empty when the table has none).
pub fn primary_key(conn: &mut mysql::PooledConn, table: &str) -> Result<Vec<String>, String> {
    Ok(indexes(conn, table)?.into_iter().find(|i| i.name == "PRIMARY").map(|i| i.columns).unwrap_or_default())
}

#[tauri::command]
pub async fn db_tables(sessions: State<'_, Sessions>, connection_id: String) -> Result<Vec<TableInfo>, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || tables(&mut session.conn()?)).await
}

#[derive(Serialize)]
pub struct TableDetail {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
}

#[tauri::command]
pub async fn db_table_detail(sessions: State<'_, Sessions>, connection_id: String, table: String) -> Result<TableDetail, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || {
        let mut conn = session.conn()?;
        Ok(TableDetail { columns: columns(&mut conn, &table)?, indexes: indexes(&mut conn, &table)? })
    })
    .await
}

/// Table → column names, for SQL autocompletion.
#[tauri::command]
pub async fn db_completion_schema(sessions: State<'_, Sessions>, connection_id: String) -> Result<BTreeMap<String, Vec<String>>, String> {
    let session = sessions.get(&connection_id)?;
    blocking(move || {
        let rows: Vec<(String, String)> = session
            .conn()?
            .query(
                "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
            )
            .map_err(|e| e.to_string())?;
        let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (table, column) in rows {
            map.entry(table).or_default().push(column);
        }
        Ok(map)
    })
    .await
}
