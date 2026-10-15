//! The online-meeting link in an event, wherever the invite put it: the
//! event's URL, its location or the notes (Teams puts it in the notes).

/// Hosts that mark a link as a meeting to join, most specific first.
const MEETING_HOSTS: &[&str] = &[
    "teams.microsoft.com/l/meetup-join",
    "teams.live.com/meet",
    "teams.microsoft.com/meet",
    "zoom.us/j/",
    "zoom.us/my/",
    "zoom.us/w/",
    "meet.google.com/",
    "webex.com/meet",
    "webex.com/join",
    ".webex.com/",
    "whereby.com/",
    "gotomeeting.com/join",
    "chime.aws/",
];

/// Characters that end a URL pasted in free text.
fn is_url_end(c: char) -> bool {
    c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | ')' | ']' | '|')
}

/// Every http(s) URL in a piece of text.
fn urls(text: &str) -> impl Iterator<Item = &str> {
    text.match_indices("http").filter_map(move |(i, _)| {
        let rest = &text[i..];
        if !(rest.starts_with("https://") || rest.starts_with("http://")) {
            return None;
        }
        let end = rest.find(is_url_end).unwrap_or(rest.len());
        Some(rest[..end].trim_end_matches(['.', ',', ';']))
    })
}

pub fn is_meeting_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    MEETING_HOSTS.iter().any(|h| lower.contains(h))
}

/// The first meeting link found in the URL, then the location, then notes.
pub fn join_url(url: Option<&str>, location: Option<&str>, notes: Option<&str>) -> Option<String> {
    [url, location, notes]
        .into_iter()
        .flatten()
        .flat_map(urls)
        .find(|u| is_meeting_link(u))
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_teams_links_in_notes() {
        let notes = "Join on your computer\n<https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d>\nMeeting ID: 123";
        assert_eq!(
            join_url(None, None, Some(notes)).as_deref(),
            Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d")
        );
    }

    #[test]
    fn prefers_the_event_url_then_location() {
        assert_eq!(
            join_url(Some("https://zoom.us/j/123"), Some("https://meet.google.com/abc-defg-hij"), None).as_deref(),
            Some("https://zoom.us/j/123")
        );
        assert_eq!(
            join_url(None, Some("Room 4 / https://meet.google.com/abc-defg-hij."), None).as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
    }

    #[test]
    fn ignores_ordinary_links() {
        assert_eq!(join_url(Some("https://example.com/agenda"), Some("Office"), Some("see https://wiki.example.com")), None);
        assert!(is_meeting_link("https://acme.webex.com/acme/j.php?MTID=x"));
        assert!(is_meeting_link("https://us02web.zoom.us/j/8765?pwd=x"));
    }
}
