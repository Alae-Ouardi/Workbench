//! Converting MySQL values for the UI, and quoting for SQL previews.
//! Statements that run always use bound parameters; quoting here only builds
//! the human-readable preview and identifier names.

use mysql::consts::{ColumnFlags, ColumnType};
use mysql::{Column, Value};
use serde::Serialize;
use serde_json::Value as Json;

/// Largest integer JavaScript represents exactly.
const JS_SAFE: i64 = (1 << 53) - 1;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ColumnMeta {
    pub name: String,
    /// number, text, date, datetime, time, json, binary, other
    pub kind: &'static str,
    pub table: String,
}

pub fn column_kind(col: &Column) -> &'static str {
    use ColumnType::*;
    let binary = col.flags().contains(ColumnFlags::BINARY_FLAG) && col.character_set() == 63;
    match col.column_type() {
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_LONG | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_INT24 | MYSQL_TYPE_YEAR
        | MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE | MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL | MYSQL_TYPE_BIT => "number",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_DATETIME2 | MYSQL_TYPE_TIMESTAMP2 => "datetime",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_BLOB | MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB | MYSQL_TYPE_STRING
        | MYSQL_TYPE_VAR_STRING | MYSQL_TYPE_VARCHAR
            if binary =>
        {
            "binary"
        }
        MYSQL_TYPE_GEOMETRY => "binary",
        _ => "text",
    }
}

pub fn column_meta(cols: &[Column]) -> Vec<ColumnMeta> {
    cols.iter()
        .map(|c| ColumnMeta { name: c.name_str().into_owned(), kind: column_kind(c), table: c.org_table_str().into_owned() })
        .collect()
}

/// A cell for the UI: null, a number when it fits in JS, otherwise text.
/// Binary data that isn't UTF-8 is shown as hex (`0x…`).
pub fn to_json(value: Value, kind: &str) -> Json {
    match value {
        Value::NULL => Json::Null,
        Value::Int(i) if i.unsigned_abs() <= JS_SAFE as u64 => Json::from(i),
        Value::Int(i) => Json::from(i.to_string()),
        Value::UInt(u) if u <= JS_SAFE as u64 => Json::from(u),
        Value::UInt(u) => Json::from(u.to_string()),
        Value::Float(f) => Json::from(f as f64),
        Value::Double(f) => Json::from(f),
        Value::Bytes(bytes) => match String::from_utf8(bytes) {
            Ok(text) if kind != "binary" => Json::from(text),
            Ok(text) => Json::from(hex(text.as_bytes())),
            Err(e) => Json::from(hex(e.as_bytes())),
        },
        Value::Date(y, m, d, h, mi, s, us) => {
            let base = format!("{y:04}-{m:02}-{d:02}");
            if kind == "date" {
                Json::from(base)
            } else if us > 0 {
                Json::from(format!("{base} {h:02}:{mi:02}:{s:02}.{us:06}"))
            } else {
                Json::from(format!("{base} {h:02}:{mi:02}:{s:02}"))
            }
        }
        Value::Time(neg, days, h, m, s, us) => {
            let hours = days * 24 + h as u32;
            let sign = if neg { "-" } else { "" };
            let frac = if us > 0 { format!(".{us:06}") } else { String::new() };
            Json::from(format!("{sign}{hours:02}:{m:02}:{s:02}{frac}"))
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    let shown = &bytes[..bytes.len().min(512)];
    let mut out = String::with_capacity(2 + shown.len() * 2);
    out.push_str("0x");
    for b in shown {
        out.push_str(&format!("{b:02X}"));
    }
    if bytes.len() > shown.len() {
        out.push('…');
    }
    out
}

/// `name` → `` `name` `` with embedded backticks doubled.
pub fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// A literal for previews: NULL, bare numbers, or a quoted string.
pub fn quote_literal(value: &Option<String>) -> String {
    match value {
        None => "NULL".into(),
        Some(v) if is_plain_number(v) => v.clone(),
        Some(v) => format!("'{}'", v.replace('\\', "\\\\").replace('\'', "''")),
    }
}

fn is_plain_number(v: &str) -> bool {
    let digits = v.strip_prefix('-').unwrap_or(v);
    !digits.is_empty()
        && digits.len() <= 18
        && digits.chars().filter(|c| *c == '.').count() <= 1
        && digits.chars().all(|c| c.is_ascii_digit() || c == '.')
        && !digits.starts_with('.')
        && !digits.ends_with('.')
        && !(digits.len() > 1 && digits.starts_with('0') && !digits.starts_with("0."))
}

/// Bind value for a cell edit (text from the UI, None for NULL).
pub fn to_param(value: &Option<String>) -> Value {
    match value {
        None => Value::NULL,
        Some(v) => Value::Bytes(v.clone().into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_values_for_the_ui() {
        assert_eq!(to_json(Value::NULL, "text"), Json::Null);
        assert_eq!(to_json(Value::Int(42), "number"), Json::from(42));
        assert_eq!(to_json(Value::Int(i64::MIN), "number"), Json::from(i64::MIN.to_string()));
        assert_eq!(to_json(Value::UInt(u64::MAX), "number"), Json::from(u64::MAX.to_string()));
        assert_eq!(to_json(Value::Bytes(b"hello".to_vec()), "text"), Json::from("hello"));
        assert_eq!(to_json(Value::Bytes(vec![0xff, 0x00]), "text"), Json::from("0xFF00"));
        assert_eq!(to_json(Value::Bytes(b"ab".to_vec()), "binary"), Json::from("0x6162"));
        assert_eq!(to_json(Value::Date(2026, 10, 12, 0, 0, 0, 0), "date"), Json::from("2026-10-12"));
        assert_eq!(to_json(Value::Date(2026, 10, 12, 9, 5, 7, 120), "datetime"), Json::from("2026-10-12 09:05:07.000120"));
        assert_eq!(to_json(Value::Time(true, 1, 2, 3, 4, 0), "time"), Json::from("-26:03:04"));
    }

    #[test]
    fn quotes_identifiers_and_literals() {
        assert_eq!(quote_ident("order"), "`order`");
        assert_eq!(quote_ident("we`ird"), "`we``ird`");
        assert_eq!(quote_literal(&None), "NULL");
        assert_eq!(quote_literal(&Some("12".into())), "12");
        assert_eq!(quote_literal(&Some("-3.5".into())), "-3.5");
        assert_eq!(quote_literal(&Some("007".into())), "'007'");
        assert_eq!(quote_literal(&Some("1e5".into())), "'1e5'");
        assert_eq!(quote_literal(&Some("O'Brien \\ x".into())), "'O''Brien \\\\ x'");
    }
}
