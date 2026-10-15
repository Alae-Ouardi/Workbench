//! Reading resources: lists, YAML, describe, usage and single secret values.

use std::collections::HashMap;

use base64::Engine;
use serde::Serialize;
use serde_json::Value;

use super::kubectl::{self, check_kind, check_name, cluster_scoped, slim, QUICK, SLOW};
use crate::util::blocking;

fn scope<'a>(kind: &str, namespace: &'a str) -> Option<&'a str> {
    (!cluster_scoped(kind)).then_some(namespace)
}

pub fn list(context: &str, namespace: &str, kind: &str) -> Result<Vec<Value>, String> {
    let kind = check_kind(kind)?;
    let json = kubectl::run_json(context, scope(kind, namespace), &["get", kind])?;
    let items = json.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(items.into_iter().map(slim).collect())
}

#[tauri::command]
pub async fn k8s_list(context: String, namespace: String, kind: String) -> Result<Vec<Value>, String> {
    blocking(move || list(&context, &namespace, &kind)).await
}

#[tauri::command]
pub async fn k8s_get(context: String, namespace: String, kind: String, name: String) -> Result<Value, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        let name = check_name(&name)?;
        kubectl::run_json(&context, scope(kind, &namespace), &["get", kind, name]).map(slim)
    })
    .await
}

/// The object as YAML for editing (kubectl hides managed fields by default).
#[tauri::command]
pub async fn k8s_get_yaml(context: String, namespace: String, kind: String, name: String) -> Result<String, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        if kind == "secrets" {
            // Secret values are revealed one key at a time, never as a whole.
            return Err("Secrets are shown key by key in the Data tab.".into());
        }
        let name = check_name(&name)?;
        kubectl::run(&context, scope(kind, &namespace), &["get", kind, name, "-o", "yaml"], SLOW)
    })
    .await
}

#[tauri::command]
pub async fn k8s_describe(context: String, namespace: String, kind: String, name: String) -> Result<String, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        let name = check_name(&name)?;
        kubectl::run(&context, scope(kind, &namespace), &["describe", kind, name], SLOW)
    })
    .await
}

/// Events about one object, oldest first.
#[tauri::command]
pub async fn k8s_events_for(context: String, namespace: String, name: String) -> Result<Vec<Value>, String> {
    blocking(move || {
        let name = check_name(&name)?;
        let selector = format!("involvedObject.name={name}");
        let json = kubectl::run_json(&context, Some(&namespace), &["get", "events", "--field-selector", &selector])?;
        let mut items = json.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        items.sort_by_key(|e| event_time(e).to_string());
        Ok(items.into_iter().map(slim).collect())
    })
    .await
}

fn event_time(event: &Value) -> &str {
    ["lastTimestamp", "eventTime", "firstTimestamp"]
        .iter()
        .find_map(|k| event.get(*k).and_then(Value::as_str))
        .or_else(|| event.pointer("/metadata/creationTimestamp").and_then(Value::as_str))
        .unwrap_or("")
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Usage {
    pub name: String,
    /// Millicores.
    pub cpu_m: u64,
    /// Bytes.
    pub memory: u64,
}

fn parse_cpu(raw: &str) -> u64 {
    if let Some(m) = raw.strip_suffix('m') {
        m.parse().unwrap_or(0)
    } else if let Some(n) = raw.strip_suffix('n') {
        n.parse::<u64>().map(|v| v / 1_000_000).unwrap_or(0)
    } else {
        raw.parse::<f64>().map(|c| (c * 1000.0) as u64).unwrap_or(0)
    }
}

fn parse_memory(raw: &str) -> u64 {
    const UNITS: &[(&str, u64)] = &[
        ("Ki", 1 << 10),
        ("Mi", 1 << 20),
        ("Gi", 1 << 30),
        ("Ti", 1 << 40),
        ("K", 1_000),
        ("M", 1_000_000),
        ("G", 1_000_000_000),
    ];
    for (suffix, factor) in UNITS {
        if let Some(n) = raw.strip_suffix(suffix) {
            return n.parse::<u64>().map(|v| v * factor).unwrap_or(0);
        }
    }
    raw.parse().unwrap_or(0)
}

fn parse_top(raw: &str) -> Vec<Usage> {
    raw.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            // pods: NAME CPU MEM; nodes: NAME CPU CPU% MEM MEM%
            let (name, cpu, mem) = match cols.len() {
                3 => (cols[0], cols[1], cols[2]),
                5 => (cols[0], cols[1], cols[3]),
                _ => return None,
            };
            Some(Usage { name: name.to_string(), cpu_m: parse_cpu(cpu), memory: parse_memory(mem) })
        })
        .collect()
}

/// CPU and memory per pod (or node). Empty when metrics-server is missing.
#[tauri::command]
pub async fn k8s_top(context: String, namespace: String, kind: String) -> Result<Vec<Usage>, String> {
    blocking(move || {
        let target = if kind == "nodes" { "nodes" } else { "pods" };
        let ns = (target == "pods").then_some(namespace.as_str());
        match kubectl::run(&context, ns, &["top", target, "--no-headers"], QUICK) {
            Ok(raw) => Ok(parse_top(&raw)),
            Err(e) if e.to_lowercase().contains("metrics") => Ok(Vec::new()),
            Err(e) => Err(e),
        }
    })
    .await
}

/// One decoded secret value, fetched only when the user reveals or copies it.
#[tauri::command]
pub async fn k8s_secret_value(context: String, namespace: String, name: String, key: String) -> Result<String, String> {
    blocking(move || {
        let name = check_name(&name)?;
        let json = kubectl::run_json(&context, Some(&namespace), &["get", "secret", name])?;
        let data: HashMap<String, String> = json
            .get("data")
            .and_then(|d| serde_json::from_value(d.clone()).ok())
            .unwrap_or_default();
        let encoded = data.get(&key).ok_or_else(|| format!("{name} has no key {key}"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| format!("could not decode {key}: {e}"))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_top_output() {
        let pods = parse_top("api-1   12m   140Mi\nworker  1   1Gi\n");
        assert_eq!(pods[0], Usage { name: "api-1".into(), cpu_m: 12, memory: 140 << 20 });
        assert_eq!(pods[1].cpu_m, 1000);
        let nodes = parse_top("node-a  250m  6%  3500Mi  22%\n");
        assert_eq!(nodes[0].memory, 3500 << 20);
    }

    #[test]
    fn parses_quantities() {
        assert_eq!(parse_cpu("500000000n"), 500);
        assert_eq!(parse_memory("2Gi"), 2 << 30);
        assert_eq!(parse_memory("123"), 123);
    }
}
