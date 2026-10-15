//! Cluster contexts and their namespaces — the data behind the environment
//! search. Only context names and cluster names are read from the
//! kubeconfig; credentials never are.

use serde::Serialize;

use super::kubectl::{self, QUICK};
use crate::util::blocking;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ContextInfo {
    pub name: String,
    pub cluster: String,
    /// Namespace set on the context in the kubeconfig, if any.
    pub namespace: Option<String>,
}

const CONTEXTS_TEMPLATE: &str = "{range .contexts[*]}{.name}{\"\\t\"}{.context.cluster}{\"\\t\"}{.context.namespace}{\"\\n\"}{end}";

fn parse_contexts(raw: &str) -> Vec<ContextInfo> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            let cluster = parts.next().unwrap_or("").trim();
            let namespace = parts.next().map(str::trim).filter(|s| !s.is_empty());
            Some(ContextInfo {
                name: name.to_string(),
                cluster: cluster.to_string(),
                namespace: namespace.map(String::from),
            })
        })
        .collect()
}

fn list_contexts() -> Result<Vec<ContextInfo>, String> {
    let mut cmd = crate::env::command("kubectl");
    cmd.args(["config", "view", "-o", &format!("jsonpath={CONTEXTS_TEMPLATE}")]);
    let raw = crate::proc::run(cmd, QUICK).map_err(kubectl::friendly)?;
    let mut contexts = parse_contexts(&raw);
    contexts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(contexts)
}

fn list_namespaces(context: &str) -> Result<Vec<String>, String> {
    let raw = kubectl::run(context, None, &["get", "namespaces", "-o", "jsonpath={.items[*].metadata.name}"], QUICK)?;
    let mut names: Vec<String> = raw.split_whitespace().map(String::from).collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub async fn k8s_contexts() -> Result<Vec<ContextInfo>, String> {
    blocking(list_contexts).await
}

#[tauri::command]
pub async fn k8s_namespaces(context: String) -> Result<Vec<String>, String> {
    blocking(move || list_namespaces(&context)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_context_lines() {
        let raw = "integration.example.cloud\tintegration\t\nprod.x\tprod-cluster\tdefault\n\n";
        let parsed = parse_contexts(raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].namespace, None);
        assert_eq!(parsed[1].namespace.as_deref(), Some("default"));
        assert_eq!(parsed[1].cluster, "prod-cluster");
    }
}
