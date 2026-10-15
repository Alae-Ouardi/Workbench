//! Keep the access token out of messages. TargetProcess takes the token in the
//! request URL, and network errors quote that URL in full — so every error
//! text is scrubbed before it is shown, logged or saved.

const KEYS: &[&str] = &["access_token=", "access_token%3D", "access_token%3d"];
const MASK: &str = "[redacted]";

/// Characters that end a query-string value quoted inside free text.
fn ends_value(c: char) -> bool {
    c == '&' || c.is_whitespace() || matches!(c, '"' | '\'' | ')' | '>' | ']' | ',' | ';')
}

/// `text` with the value after every `access_token=` replaced by a mask.
pub fn redact_token(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let found = KEYS.iter().filter_map(|k| rest.find(k).map(|i| (i, k.len()))).min_by_key(|(i, _)| *i);
        let Some((at, key_len)) = found else {
            out.push_str(rest);
            return out;
        };
        let value_start = at + key_len;
        out.push_str(&rest[..value_start]);
        out.push_str(MASK);
        let tail = &rest[value_start..];
        let value_len = tail.find(ends_value).unwrap_or(tail.len());
        rest = &tail[value_len..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_tokens_in_urls_and_messages() {
        let msg = "https://acme.tpondemand.com/api/v1/Times?format=json&access_token=MTIzNDU2Nzg5MA==&take=1000: Connection Failed";
        let clean = redact_token(msg);
        assert!(!clean.contains("MTIzNDU2Nzg5MA"));
        assert_eq!(clean, "https://acme.tpondemand.com/api/v1/Times?format=json&access_token=[redacted]&take=1000: Connection Failed");
    }

    #[test]
    fn masks_every_occurrence_and_encoded_forms() {
        let clean = redact_token("a access_token=x1 b \"access_token%3Dy2\" end access_token=z3");
        assert!(!clean.contains("x1") && !clean.contains("y2") && !clean.contains("z3"));
        assert_eq!(clean.matches("[redacted]").count(), 3);
    }

    #[test]
    fn leaves_other_text_alone() {
        assert_eq!(redact_token("HTTP 400: Description should be specified."), "HTTP 400: Description should be specified.");
    }
}
