//! Live resource lists: one long-running `kubectl get --watch` per open list.
//! Each change is forwarded as a `k8s-watch` event; when kubectl exits (server
//! timeout, network drop, stop) a `k8s-watch-end` event says so and the UI
//! restarts it if the list is still open.

use std::io::Read;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use super::kubectl::{self, check_kind, cluster_scoped, slim};
use crate::proc::Procs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WatchEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub object: Value,
}

#[derive(Clone, Serialize)]
struct WatchPayload {
    watch_id: u32,
    events: Vec<WatchEvent>,
}

#[derive(Clone, Serialize)]
struct WatchEnd {
    watch_id: u32,
    error: Option<String>,
}

/// kubectl sends ADDED for every existing object on start, then changes.
/// Events are batched per read so a big initial burst is one IPC message.
const MAX_BATCH: usize = 64;

/// Split a buffer holding concatenated JSON documents into complete events
/// and the unparsed remainder (a document still arriving).
pub fn drain_events(buffer: &mut String) -> Vec<WatchEvent> {
    let mut events = Vec::new();
    let mut consumed = 0;
    'outer: loop {
        let mut stream = serde_json::Deserializer::from_str(&buffer[consumed..]).into_iter::<WatchEvent>();
        let base = consumed;
        loop {
            match stream.next() {
                Some(Ok(event)) => {
                    consumed = base + stream.byte_offset();
                    events.push(WatchEvent { object: slim(event.object), ..event });
                }
                Some(Err(e)) if e.is_eof() => break 'outer,
                Some(Err(_)) => {
                    // Skip a malformed document up to the next line break, then go on.
                    let rest = &buffer[consumed..];
                    match rest.find('\n') {
                        Some(i) => {
                            consumed += i + 1;
                            continue 'outer;
                        }
                        None => break 'outer,
                    }
                }
                None => break 'outer,
            }
        }
    }
    buffer.drain(..consumed);
    let leading = buffer.len() - buffer.trim_start().len();
    buffer.drain(..leading);
    events
}

/// Move the complete UTF-8 prefix of `bytes` into `text`, keeping a
/// multi-byte character split across reads for the next round.
fn take_utf8(bytes: &mut Vec<u8>, text: &mut String) {
    let valid = match std::str::from_utf8(bytes) {
        Ok(s) => s.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => {
            text.push_str(&String::from_utf8_lossy(bytes));
            bytes.clear();
            return;
        }
    };
    text.push_str(std::str::from_utf8(&bytes[..valid]).unwrap_or_default());
    bytes.drain(..valid);
}

#[tauri::command]
pub async fn k8s_watch_start(
    app: AppHandle,
    procs: State<'_, Procs>,
    context: String,
    namespace: String,
    kind: String,
) -> Result<u32, String> {
    crate::util::ensure_env().await?;
    let kind = check_kind(&kind)?;
    let ns = (!cluster_scoped(kind)).then_some(namespace.as_str());
    let cmd = kubectl::kubectl(
        &context,
        ns,
        &["get", kind, "--watch", "--output-watch-events", "-o", "json", "--request-timeout=0"],
    )?;
    let events_app = app.clone();
    procs.spawn(
        cmd,
        move |watch_id, mut stdout| {
            let mut buffer = String::new();
            let mut bytes: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 64 * 1024];
            loop {
                let n = match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                bytes.extend_from_slice(&chunk[..n]);
                take_utf8(&mut bytes, &mut buffer);
                let events = drain_events(&mut buffer);
                for batch in events.chunks(MAX_BATCH) {
                    let _ = events_app.emit("k8s-watch", WatchPayload { watch_id, events: batch.to_vec() });
                }
            }
        },
        move |exit| {
            let error = (!exit.killed && exit.code != Some(0))
                .then(|| kubectl::friendly(crate::proc::clean_error(&exit.stderr).unwrap_or_else(|| "the watch stopped".into())));
            let _ = app.emit("k8s-watch-end", WatchEnd { watch_id: exit.id, error });
        },
    )
}

#[tauri::command]
pub async fn k8s_watch_stop(procs: State<'_, Procs>, watch_id: u32) -> Result<(), String> {
    let procs = procs.inner().clone();
    crate::util::blocking(move || {
        procs.kill(watch_id);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drains_complete_documents_and_keeps_partial_ones() {
        let mut buf = String::from(
            "{\"type\":\"ADDED\",\"object\":{\"kind\":\"Pod\",\"metadata\":{\"name\":\"a\",\"managedFields\":[]}}}\n{\"type\":\"MODIFIED\",\"obj",
        );
        let events = drain_events(&mut buf);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "ADDED");
        assert!(events[0].object["metadata"].get("managedFields").is_none());
        assert!(buf.starts_with("{\"type\":\"MODIFIED\""));
        buf.push_str("ect\":{\"kind\":\"Pod\",\"metadata\":{\"name\":\"a\"}}}");
        let events = drain_events(&mut buf);
        assert_eq!(events[0].kind, "MODIFIED");
        assert!(buf.trim().is_empty());
    }

    #[test]
    fn handles_pretty_printed_documents() {
        let mut buf = String::from("{\n  \"type\": \"DELETED\",\n  \"object\": {\"kind\": \"Pod\"}\n}\n{\n  \"type\": \"ADDED\",\n  \"object\": {}\n}\n");
        let events = drain_events(&mut buf);
        assert_eq!(events.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["DELETED", "ADDED"]);
    }

    #[test]
    fn keeps_split_characters_for_the_next_read() {
        let mut bytes = "é".as_bytes()[..1].to_vec();
        let mut text = String::new();
        take_utf8(&mut bytes, &mut text);
        assert!(text.is_empty());
        bytes.push("é".as_bytes()[1]);
        take_utf8(&mut bytes, &mut text);
        assert_eq!(text, "é");
    }

    #[test]
    fn skips_garbage_lines() {
        let mut buf = String::from("not json\n{\"type\":\"ADDED\",\"object\":{}}");
        assert_eq!(drain_events(&mut buf).len(), 1);
    }
}
