//! Moroccan public holidays. Civil ones fall on the same date every year;
//! religious ones follow the lunar calendar, so we ship estimates per year that
//! the user confirms or moves by a day in settings.

use serde::Serialize;

const FIXED: &[(u32, u32, &str)] = &[
    (1, 1, "New Year's Day"),
    (1, 11, "Proclamation of Independence"),
    (1, 14, "Amazigh New Year"),
    (5, 1, "Labour Day"),
    (7, 30, "Throne Day"),
    (8, 14, "Oued Ed-Dahab Day"),
    (8, 20, "Revolution Day"),
    (8, 21, "Youth Day"),
    (11, 6, "Green March Day"),
    (11, 18, "Independence Day"),
];

/// Estimates; each may move by a day with the moon sighting.
const RELIGIOUS: &[(i32, &str, &[&str])] = &[
    (2026, "Eid al-Fitr", &["2026-03-20", "2026-03-21"]),
    (2026, "Eid al-Adha", &["2026-05-26", "2026-05-27"]),
    (2026, "Islamic New Year", &["2026-06-16"]),
    (2026, "Prophet's Birthday", &["2026-08-25", "2026-08-26"]),
    (2027, "Eid al-Fitr", &["2027-03-09", "2027-03-10", "2027-03-11"]),
    (2027, "Eid al-Adha", &["2027-05-16", "2027-05-17"]),
    (2027, "Islamic New Year", &["2027-06-06"]),
    (2027, "Prophet's Birthday", &["2027-08-15"]),
    (2028, "Eid al-Fitr", &["2028-02-26", "2028-02-27"]),
    (2028, "Eid al-Adha", &["2028-05-05", "2028-05-06"]),
    (2028, "Islamic New Year", &["2028-05-25"]),
    (2028, "Prophet's Birthday", &["2028-08-03"]),
];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Holiday {
    pub date: String,
    pub name: String,
    /// Religious holidays are keyed so the user's confirmation sticks:
    /// "year|name|index". Civil holidays have none.
    pub key: Option<String>,
}

pub fn fixed(year: i32) -> Vec<Holiday> {
    FIXED
        .iter()
        .map(|(m, d, name)| Holiday { date: format!("{year:04}-{m:02}-{d:02}"), name: name.to_string(), key: None })
        .collect()
}

pub fn religious(year: i32) -> Vec<Holiday> {
    RELIGIOUS
        .iter()
        .filter(|(y, _, _)| *y == year)
        .flat_map(|(_, name, dates)| {
            dates.iter().enumerate().map(move |(i, date)| Holiday {
                date: date.to_string(),
                name: name.to_string(),
                key: Some(format!("{year}|{name}|{i}")),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_holidays_repeat_every_year() {
        let h = fixed(2031);
        assert_eq!(h.len(), 10);
        assert_eq!(h[0].date, "2031-01-01");
        assert!(h.iter().any(|d| d.date == "2031-11-18"));
    }

    #[test]
    fn religious_estimates_have_stable_keys() {
        let h = religious(2027);
        assert_eq!(h[0].key.as_deref(), Some("2027|Eid al-Fitr|0"));
        assert_eq!(h.len(), 7);
        assert!(religious(2040).is_empty());
    }
}
