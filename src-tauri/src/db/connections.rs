//! Saved database connections, grouped in client folders, stored in
//! `~/.workbench/connections.json`. No credentials are stored here: cluster
//! ones are read from the cluster secret on every connect, local passwords
//! live in the macOS Keychain (see `local`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::util::blocking;

pub const ENVIRONMENTS: &[&str] = &["latest", "review", "uat", "preprod", "prod"];
pub const DEFAULT_DOMAIN: &str = "omnevo";
pub const DEFAULT_SECRET: &str = "db-shifteo-services";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub name: String,
}

/// Where the database runs: behind a relay pod in a cluster, or reachable
/// directly (this Mac, Docker, a VPN host).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Cluster,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Connection {
    /// Missing in files saved before local connections existed: cluster.
    #[serde(default)]
    pub kind: Kind,
    pub id: String,
    pub folder_id: String,
    /// Display name; defaults to the environment in the UI.
    pub name: String,
    /// latest, review, uat, preprod or prod.
    pub env: String,
    pub client: String,
    /// Cluster: the tunnel's port on this Mac. Local: the database port.
    pub local_port: u16,
    /// Local only: database host, user and schema.
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub database: String,
    #[serde(default = "default_domain")]
    pub cluster_domain: String,
    /// Overrides the context derived from env/client (shared clusters).
    #[serde(default)]
    pub context: Option<String>,
    /// Overrides `<env>-<client>`.
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default = "default_secret")]
    pub secret: String,
}

fn default_domain() -> String {
    DEFAULT_DOMAIN.into()
}

fn default_secret() -> String {
    DEFAULT_SECRET.into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConnectionsFile {
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub connections: Vec<Connection>,
    /// Name of the relay pod; empty means `socat-<macOS user>`.
    #[serde(default)]
    pub relay_pod: String,
}

/// Where a connection points: the same rules as `omnevo-db-connector.sh`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Target {
    pub context: String,
    pub namespace: String,
}

/// The script's rule: an explicit context (the "shared cluster" option, e.g.
/// prod.euc1.omnevo.cloud) wins; otherwise prod/preprod use the client's own
/// cluster and other environments the integration one. Where a database
/// lives can't be told from the kubeconfig (a client may have its own context
/// yet keep its database on the shared cluster), so this is never guessed.
pub fn resolve(c: &Connection) -> Target {
    let domain = if c.cluster_domain.trim().is_empty() { DEFAULT_DOMAIN } else { c.cluster_domain.trim() };
    let context = match c.context.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(ctx) => ctx.to_string(),
        None => match c.env.as_str() {
            "preprod" | "prod" => format!("{}.{}.{domain}.cloud", c.env, c.client),
            _ => format!("integration.{domain}.cloud"),
        },
    };
    let namespace = c
        .namespace
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| format!("{}-{}", c.env, c.client));
    Target { context, namespace }
}

/// `socat-<user>` from the macOS user name, made a valid pod name.
pub fn default_relay_pod(user: &str) -> String {
    let clean: String = user
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = clean.trim_matches('-');
    format!("socat-{}", if trimmed.is_empty() { "taskboard" } else { trimmed })
}

pub fn relay_pod(file: &ConnectionsFile) -> String {
    let name = file.relay_pod.trim();
    if name.is_empty() {
        default_relay_pod(&std::env::var("USER").unwrap_or_default())
    } else {
        name.to_string()
    }
}

fn is_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 63 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !s.starts_with('-') && !s.ends_with('-')
}

/// Reject anything that would build a bad kubectl call or confuse the UI.
pub fn validate(file: &ConnectionsFile) -> Result<(), String> {
    for f in &file.folders {
        if f.name.trim().is_empty() {
            return Err("Folder names cannot be empty.".into());
        }
    }
    let mut ports = std::collections::HashMap::new();
    for c in &file.connections {
        let label = if c.name.trim().is_empty() { &c.env } else { &c.name };
        if !file.folders.iter().any(|f| f.id == c.folder_id) {
            return Err(format!("{label}: its folder no longer exists."));
        }
        if !ENVIRONMENTS.contains(&c.env.as_str()) {
            return Err(format!("{label}: environment must be one of {}.", ENVIRONMENTS.join(", ")));
        }
        match c.kind {
            Kind::Local => validate_local(c, label)?,
            Kind::Cluster => {
                validate_cluster(c, label)?;
                if let Some(other) = ports.insert(c.local_port, label.clone()) {
                    return Err(format!("{label} and {other} both use local port {}.", c.local_port));
                }
            }
        }
    }
    if !file.relay_pod.trim().is_empty() && !is_slug(file.relay_pod.trim()) {
        return Err("The relay pod name must be lowercase letters, digits or dashes.".into());
    }
    Ok(())
}

fn validate_cluster(c: &Connection, label: &str) -> Result<(), String> {
    if !is_slug(&c.client) {
        return Err(format!("{label}: the client must be lowercase letters, digits or dashes."));
    }
    if c.local_port < 1024 {
        return Err(format!("{label}: pick a local port of 1024 or above."));
    }
    if let Some(ns) = c.namespace.as_deref().filter(|s| !s.trim().is_empty()) {
        if !is_slug(ns.trim()) {
            return Err(format!("{label}: the namespace is not a valid name."));
        }
    }
    if let Some(ctx) = c.context.as_deref() {
        if ctx.trim().starts_with('-') || ctx.chars().any(char::is_control) {
            return Err(format!("{label}: the context is not a valid name."));
        }
    }
    if !is_slug(&c.secret) && !c.secret.contains('.') {
        return Err(format!("{label}: the secret name is not valid."));
    }
    Ok(())
}

fn validate_local(c: &Connection, label: &str) -> Result<(), String> {
    let host = c.host.trim();
    if host.is_empty() || host.contains(char::is_whitespace) || host.chars().any(char::is_control) {
        return Err(format!("{label}: enter the database host, e.g. 127.0.0.1."));
    }
    if c.local_port == 0 {
        return Err(format!("{label}: enter the database port."));
    }
    if c.user.trim().is_empty() {
        return Err(format!("{label}: enter the database user."));
    }
    if c.database.trim().is_empty() {
        return Err(format!("{label}: enter the database name."));
    }
    Ok(())
}

fn path() -> Result<PathBuf, String> {
    Ok(taskboard_core::paths::data_dir().join("connections.json"))
}

pub fn load() -> Result<ConnectionsFile, String> {
    let path = path()?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("{} is unreadable: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConnectionsFile::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn save(file: &ConnectionsFile) -> Result<(), String> {
    validate(file)?;
    let path = path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_connections_get() -> Result<ConnectionsFile, String> {
    blocking(load).await
}

#[tauri::command]
pub async fn db_connections_save(file: ConnectionsFile) -> Result<(), String> {
    blocking(move || {
        let before = load().unwrap_or_default();
        save(&file)?;
        // A deleted local connection takes its Keychain password with it.
        for gone in removed_local(&before, &file) {
            let _ = super::local::set_password(&gone, "");
        }
        Ok(())
    })
    .await
}

/// Local connections in `before` that `after` no longer has.
fn removed_local(before: &ConnectionsFile, after: &ConnectionsFile) -> Vec<String> {
    before
        .connections
        .iter()
        .filter(|c| c.kind == Kind::Local && !after.connections.iter().any(|a| a.id == c.id))
        .map(|c| c.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(env: &str, client: &str) -> Connection {
        Connection {
            kind: Kind::Cluster,
            id: "c".into(),
            folder_id: "f".into(),
            name: String::new(),
            env: env.into(),
            client: client.into(),
            local_port: 3307,
            cluster_domain: "omnevo".into(),
            context: None,
            namespace: None,
            secret: DEFAULT_SECRET.into(),
            host: String::new(),
            user: String::new(),
            database: String::new(),
        }
    }

    fn local() -> Connection {
        Connection { kind: Kind::Local, local_port: 3306, host: "127.0.0.1".into(), user: "root".into(), database: "shop".into(), client: String::new(), ..conn("latest", "") }
    }

    #[test]
    fn older_files_load_as_cluster_connections() {
        let raw = r#"{"folders":[{"id":"f","name":"Acme"}],"connections":[{"id":"c","folder_id":"f","name":"","env":"review","client":"acme","local_port":3307}]}"#;
        let file: ConnectionsFile = serde_json::from_str(raw).unwrap();
        assert_eq!(file.connections[0].kind, Kind::Cluster);
        assert!(validate(&file).is_ok());
    }

    #[test]
    fn finds_deleted_local_connections() {
        let folder = Folder { id: "f".into(), name: "Acme".into() };
        let before = ConnectionsFile { folders: vec![folder.clone()], connections: vec![local(), conn("review", "acme")], relay_pod: String::new() };
        let after = ConnectionsFile { connections: vec![], ..before.clone() };
        assert_eq!(removed_local(&before, &after), vec!["c".to_string()]);
        assert!(removed_local(&before, &before).is_empty());
    }

    #[test]
    fn local_connections_validate_their_own_fields() {
        let folder = Folder { id: "f".into(), name: "Acme".into() };
        let file = |c: Connection| ConnectionsFile { folders: vec![folder.clone()], connections: vec![c], relay_pod: String::new() };
        assert!(validate(&file(local())).is_ok());
        assert!(validate(&file(Connection { host: " ".into(), ..local() })).is_err());
        assert!(validate(&file(Connection { user: String::new(), ..local() })).is_err());
        assert!(validate(&file(Connection { database: String::new(), ..local() })).is_err());
        // Two local databases may share the standard port.
        let mut two = file(local());
        two.connections.push(Connection { id: "d".into(), ..local() });
        assert!(validate(&two).is_ok());
    }

    #[test]
    fn resolves_like_the_connector_script() {
        assert_eq!(resolve(&conn("review", "acme")), Target { context: "integration.omnevo.cloud".into(), namespace: "review-acme".into() });
        assert_eq!(resolve(&conn("prod", "acme")).context, "prod.acme.omnevo.cloud");
        assert_eq!(resolve(&conn("preprod", "acme")).context, "preprod.acme.omnevo.cloud");
        let mut shared = conn("prod", "acme");
        shared.context = Some("prod.euc1.omnevo.cloud".into());
        shared.namespace = Some("  ".into());
        assert_eq!(resolve(&shared), Target { context: "prod.euc1.omnevo.cloud".into(), namespace: "prod-acme".into() });
        let mut blank_domain = conn("latest", "acme");
        blank_domain.cluster_domain = String::new();
        assert_eq!(resolve(&blank_domain).context, "integration.omnevo.cloud");
    }

    #[test]
    fn relay_pod_names_are_valid() {
        assert_eq!(default_relay_pod("Jane.Doe_2"), "socat-jane-doe-2");
        assert_eq!(default_relay_pod("..."), "socat-taskboard");
    }

    #[test]
    fn validation_catches_mistakes() {
        let folder = Folder { id: "f".into(), name: "Acme".into() };
        let ok = ConnectionsFile { folders: vec![folder.clone()], connections: vec![conn("review", "acme")], relay_pod: String::new() };
        assert!(validate(&ok).is_ok());

        let mut bad_env = ok.clone();
        bad_env.connections[0].env = "staging".into();
        assert!(validate(&bad_env).is_err());

        let mut clash = ok.clone();
        let mut second = conn("prod", "acme");
        second.id = "d".into();
        clash.connections.push(second);
        assert!(validate(&clash).unwrap_err().contains("3307"));

        let mut orphan = ok.clone();
        orphan.folders.clear();
        assert!(validate(&orphan).is_err());

        let mut flag = ok.clone();
        flag.connections[0].context = Some("--kubeconfig=x".into());
        assert!(validate(&flag).is_err());
    }

    #[test]
    fn old_files_get_defaults() {
        let raw = r#"{"folders":[{"id":"f","name":"Acme"}],"connections":[{"id":"c","folder_id":"f","name":"","env":"review","client":"acme","local_port":3307}]}"#;
        let file: ConnectionsFile = serde_json::from_str(raw).unwrap();
        assert_eq!(file.connections[0].cluster_domain, "omnevo");
        assert_eq!(file.connections[0].secret, DEFAULT_SECRET);
    }
}
