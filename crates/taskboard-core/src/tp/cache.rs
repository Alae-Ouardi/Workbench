//! Local snapshot cache for the TP Workspace views.
//!
//! Kept in its own SQLite file (`tp-cache.db` beside the board database) rather
//! than in `taskboard.db`: it is disposable, rewritten on every refresh, and has
//! nothing to do with the board the CLI and MCP server share.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::Result;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS tp_cache (
    key        TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"#;

/// A cached payload and when it was fetched (RFC 3339, UTC).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CacheEntry {
    pub payload: serde_json::Value,
    pub fetched_at: String,
}

pub struct TpCache {
    conn: Connection,
}

impl TpCache {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn open_default() -> Result<Self> {
        Self::open(&Self::default_path())
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// `$TASKBOARD_TP_CACHE`, or `tp-cache.db` next to the board database.
    pub fn default_path() -> PathBuf {
        if let Ok(p) = std::env::var("TASKBOARD_TP_CACHE") {
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
        crate::db::Db::default_path().with_file_name("tp-cache.db")
    }

    pub fn get(&self, key: &str) -> Result<Option<CacheEntry>> {
        let row = self
            .conn
            .query_row(
                "SELECT payload, fetched_at FROM tp_cache WHERE key = ?1",
                [key],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?;
        // An unreadable payload is treated as a miss, not an error: the next
        // refresh simply overwrites it.
        Ok(row.and_then(|(payload, fetched_at)| {
            serde_json::from_str(&payload)
                .ok()
                .map(|payload| CacheEntry { payload, fetched_at })
        }))
    }

    pub fn put(&self, key: &str, payload: &serde_json::Value) -> Result<CacheEntry> {
        let fetched_at = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO tp_cache (key, payload, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
                                            fetched_at = excluded.fetched_at",
            rusqlite::params![key, payload.to_string(), fetched_at],
        )?;
        Ok(CacheEntry {
            payload: payload.clone(),
            fetched_at,
        })
    }

    /// Drop everything — used when the instance URL or token changes, since
    /// cached data then belongs to a different account.
    pub fn clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM tp_cache", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_are_a_miss() {
        let cache = TpCache::open_in_memory().unwrap();
        assert_eq!(cache.get("nope").unwrap(), None);
    }

    #[test]
    fn put_then_get_round_trips_and_overwrites() {
        let cache = TpCache::open_in_memory().unwrap();
        cache.put("sprint:1", &json!([1, 2])).unwrap();
        cache.put("sprint:1", &json!([3])).unwrap();
        let entry = cache.get("sprint:1").unwrap().unwrap();
        assert_eq!(entry.payload, json!([3]));
        assert!(!entry.fetched_at.is_empty());
    }

    #[test]
    fn clear_empties_the_cache() {
        let cache = TpCache::open_in_memory().unwrap();
        cache.put("a", &json!({})).unwrap();
        cache.clear().unwrap();
        assert_eq!(cache.get("a").unwrap(), None);
    }

    #[test]
    fn cache_survives_reopening_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tp-cache.db");
        TpCache::open(&path).unwrap().put("k", &json!("v")).unwrap();
        let reopened = TpCache::open(&path).unwrap();
        assert_eq!(reopened.get("k").unwrap().unwrap().payload, json!("v"));
    }
}
