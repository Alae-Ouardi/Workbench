use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::Result;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id                 INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    path               TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    original_request   TEXT NOT NULL DEFAULT '',
    plan_summary       TEXT NOT NULL DEFAULT '',
    last_actor         TEXT NOT NULL DEFAULT '',
    last_session_id    TEXT NOT NULL DEFAULT '',
    handoff_note       TEXT NOT NULL DEFAULT '',
    current_task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    handoff_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','waiting','in_progress','review','done')),
    kind        TEXT NOT NULL DEFAULT 'task'
                CHECK (kind IN ('task','bug')),
    assignee    TEXT NOT NULL DEFAULT '',
    priority    TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low','normal','high','urgent')),
    position    REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author      TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor       TEXT NOT NULL,
    kind        TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON task_dependencies(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
"#;

pub struct Db {
    pub(crate) conn: Connection,
}

impl Db {
    /// Open (and create if needed) the database at `path`, enabling WAL mode
    /// for safe concurrent access from multiple processes.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Db { conn })
    }

    /// Open the user-global database: `$TASKBOARD_DB` if set, otherwise
    /// `~/.taskboard/taskboard.db`.
    pub fn open_default() -> Result<Self> {
        Self::open(&Self::default_path())
    }

    pub fn default_path() -> PathBuf {
        if let Ok(p) = std::env::var("TASKBOARD_DB") {
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".taskboard")
            .join("taskboard.db")
    }

    /// In-memory database for tests.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        Ok(Db { conn })
    }
}

/// Add columns introduced after the initial release to databases created by an
/// older version. `CREATE TABLE IF NOT EXISTS` never alters an existing table,
/// so we add any missing columns here. Idempotent.
fn migrate(conn: &Connection) -> Result<()> {
    let existing: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(projects)")?;
        let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
        cols.collect::<std::result::Result<_, _>>()?
    };
    // (column name, column definition) for everything beyond the original four.
    let additions = [
        ("original_request", "TEXT NOT NULL DEFAULT ''"),
        ("plan_summary", "TEXT NOT NULL DEFAULT ''"),
        ("last_actor", "TEXT NOT NULL DEFAULT ''"),
        ("last_session_id", "TEXT NOT NULL DEFAULT ''"),
        ("handoff_note", "TEXT NOT NULL DEFAULT ''"),
        // SQLite cannot ALTER ADD a column with a REFERENCES clause, so the FK
        // is only enforced for freshly-created DBs (via SCHEMA). For migrated
        // DBs current_task_id is a plain INTEGER, which is fine for our use.
        ("current_task_id", "INTEGER"),
        ("handoff_updated_at", "TEXT"),
    ];
    for (name, def) in additions {
        if !existing.contains(name) {
            conn.execute_batch(&format!("ALTER TABLE projects ADD COLUMN {name} {def};"))?;
        }
    }
    migrate_remove_path_unique(conn)?;
    Ok(())
}

/// Older databases were created with `path TEXT NOT NULL UNIQUE`. Remove that
/// unique index so multiple request-projects can point to the same folder.
fn migrate_remove_path_unique(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'projects'
           AND sql LIKE '%UNIQUE%(%path%)%'",
    )?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    drop(stmt);
    for name in names {
        conn.execute(&format!("DROP INDEX IF EXISTS {name}"), [])?;
    }
    Ok(())
}

pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
