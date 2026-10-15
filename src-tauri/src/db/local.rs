//! Passwords of local database connections, kept in the macOS Keychain next to
//! the TargetProcess token. They never reach `connections.json` or the UI:
//! the form can only set, clear or ask whether one is saved.

use crate::util::blocking;

const SERVICE: &str = "net.omnevo.taskboard";

fn account(connection_id: &str) -> String {
    let id: String = connection_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    format!("db-local-{id}")
}

fn entry(connection_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account(connection_id)).map_err(|e| format!("macOS Keychain is unavailable: {e}"))
}

/// The saved password, or empty when none is saved (a passwordless user).
pub fn password(connection_id: &str) -> Result<String, String> {
    match entry(connection_id)?.get_password() {
        Ok(p) => Ok(p),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("macOS Keychain did not give access to the database password ({e}). Allow access when macOS asks.")),
    }
}

/// Only "no entry" counts as not saved: when the Keychain refuses access the
/// form must not suggest the password is gone.
pub fn has_password(connection_id: &str) -> bool {
    !matches!(entry(connection_id).map(|e| e.get_password()), Ok(Err(keyring::Error::NoEntry)))
}

/// Save the password; an empty one removes it.
pub fn set_password(connection_id: &str, password: &str) -> Result<(), String> {
    let entry = entry(connection_id)?;
    if password.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Could not remove the password from the Keychain: {e}")),
        };
    }
    entry.set_password(password).map_err(|e| format!("Could not save the password in the Keychain: {e}"))
}

#[tauri::command]
pub async fn db_local_password_set(connection_id: String, password: String) -> Result<(), String> {
    blocking(move || set_password(&connection_id, &password)).await
}

#[tauri::command]
pub async fn db_local_password_saved(connection_id: String) -> Result<bool, String> {
    blocking(move || Ok(has_password(&connection_id))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_only_keep_safe_characters() {
        assert_eq!(account("ab12-x"), "db-local-ab12-x");
        assert_eq!(account("a b/../c"), "db-local-abc");
    }
}
