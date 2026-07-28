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
    handoff_updated_at TEXT,
    tp_user_story_id   INTEGER,
    tp_user_story_name TEXT NOT NULL DEFAULT '',
    tp_project_id      INTEGER,
    tp_process_id      INTEGER,
    tp_sync_enabled    INTEGER NOT NULL DEFAULT 0
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
    updated_at  TEXT NOT NULL,
    tp_entity_id    INTEGER,
    tp_entity_type  TEXT NOT NULL DEFAULT 'Task',
    estimate_points REAL NOT NULL DEFAULT 0,
    tp_sync_state   TEXT NOT NULL DEFAULT 'none'
                    CHECK (tp_sync_state IN ('none','pending','synced','error')),
    tp_sync_error   TEXT NOT NULL DEFAULT '',
    tp_time_logged  REAL NOT NULL DEFAULT 0
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

-- Outbound TargetProcess operations. Written by whichever process changed the
-- board (app, MCP server, CLI) and drained by the app's background worker or
-- `taskboard tp sync`. Drained in `id` order so a task's `create_entity`
-- always runs before its `set_state` / `log_time`.
CREATE TABLE IF NOT EXISTS tp_sync_queue (
    id              INTEGER PRIMARY KEY,
    kind            TEXT NOT NULL
                    CHECK (kind IN ('create_entity','set_state','log_time')),
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    payload         TEXT NOT NULL DEFAULT '{}',
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT NOT NULL DEFAULT '',
    next_attempt_at TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON task_dependencies(depends_on_id);
CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_tp_queue_due ON tp_sync_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_tp_queue_task ON tp_sync_queue(task_id);
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

    /// Column names of `table`, as reported by SQLite. Used by the migration
    /// tests to compare a migrated schema against a freshly created one.
    #[cfg(test)]
    pub(crate) fn raw_query_column_names(&self, table: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
        Ok(cols.collect::<std::result::Result<Vec<_>, _>>()?)
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
    // (column name, column definition) for everything beyond the original four.
    add_missing_columns(
        conn,
        "projects",
        &[
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
            // TargetProcess link: the user story this project's tasks live under,
            // plus the TP project and process ids needed to create entities and
            // resolve workflow states.
            ("tp_user_story_id", "INTEGER"),
            ("tp_user_story_name", "TEXT NOT NULL DEFAULT ''"),
            ("tp_project_id", "INTEGER"),
            ("tp_process_id", "INTEGER"),
            ("tp_sync_enabled", "INTEGER NOT NULL DEFAULT 0"),
        ],
    )?;
    add_missing_columns(
        conn,
        "tasks",
        &[
            ("tp_entity_id", "INTEGER"),
            ("tp_entity_type", "TEXT NOT NULL DEFAULT 'Task'"),
            ("estimate_points", "REAL NOT NULL DEFAULT 0"),
            (
                "tp_sync_state",
                "TEXT NOT NULL DEFAULT 'none' \
                 CHECK (tp_sync_state IN ('none','pending','synced','error'))",
            ),
            ("tp_sync_error", "TEXT NOT NULL DEFAULT ''"),
            ("tp_time_logged", "REAL NOT NULL DEFAULT 0"),
        ],
    )?;
    migrate_remove_path_unique(conn)?;
    Ok(())
}

/// `ALTER TABLE ... ADD COLUMN` for every entry not already present on `table`.
/// Definitions must be legal in an `ADD COLUMN` clause: no `PRIMARY KEY`, no
/// `UNIQUE`, no `REFERENCES` (with foreign keys on), and a non-null default for
/// any `NOT NULL` column.
fn add_missing_columns(conn: &Connection, table: &str, additions: &[(&str, &str)]) -> Result<()> {
    let existing: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
        cols.collect::<std::result::Result<_, _>>()?
    };
    for (name, def) in additions {
        if !existing.contains(*name) {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {def};"))?;
        }
    }
    Ok(())
}

/// Older databases were created with `path TEXT NOT NULL UNIQUE`. SQLite
/// cannot drop the auto-index created by an inline UNIQUE constraint, so we
/// recreate the table without that constraint and copy the data over.
fn migrate_remove_path_unique(conn: &Connection) -> Result<()> {
    let has_unique: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_index_list('projects') \
         WHERE \"unique\" = 1 AND name LIKE 'sqlite_autoindex_%'",
        [],
        |row| row.get(0),
    )?;
    if has_unique == 0 {
        return Ok(());
    }
    // Disable foreign keys so we can drop the old table while tasks reference it.
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    // The column list is spelled out on both sides so this stays correct as new
    // columns are appended by `migrate` (which runs before this).
    conn.execute_batch(
        "CREATE TABLE projects_new (
            id                 INTEGER PRIMARY KEY,
            name               TEXT NOT NULL,
            path               TEXT NOT NULL,
            created_at         TEXT NOT NULL,
            original_request   TEXT NOT NULL DEFAULT '',
            plan_summary       TEXT NOT NULL DEFAULT '',
            last_actor         TEXT NOT NULL DEFAULT '',
            last_session_id    TEXT NOT NULL DEFAULT '',
            handoff_note       TEXT NOT NULL DEFAULT '',
            current_task_id    INTEGER,
            handoff_updated_at TEXT,
            tp_user_story_id   INTEGER,
            tp_user_story_name TEXT NOT NULL DEFAULT '',
            tp_project_id      INTEGER,
            tp_process_id      INTEGER,
            tp_sync_enabled    INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO projects_new (
            id, name, path, created_at, original_request, plan_summary,
            last_actor, last_session_id, handoff_note, current_task_id,
            handoff_updated_at, tp_user_story_id, tp_user_story_name,
            tp_project_id, tp_process_id, tp_sync_enabled
        )
        SELECT
            id, name, path, created_at, original_request, plan_summary,
            last_actor, last_session_id, handoff_note, current_task_id,
            handoff_updated_at, tp_user_story_id, tp_user_story_name,
            tp_project_id, tp_process_id, tp_sync_enabled
        FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_new RENAME TO projects;",
    )?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
