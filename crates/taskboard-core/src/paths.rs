//! Where the app keeps its data: `~/.workbench`.
//!
//! It used to be `~/.taskboard`. The first time any Workbench program runs,
//! that folder is moved to `~/.workbench` and a link is left at the old path,
//! so a program still using the old path (an agent session started before the
//! rename) reads and writes the very same files — there is never a second
//! copy that could drift or push the same TargetProcess changes twice.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const DIR_NAME: &str = ".workbench";
pub const LEGACY_DIR_NAME: &str = ".taskboard";

/// What `migrate` found or did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Migration {
    /// Nothing to move: no old folder (a fresh install).
    Fresh,
    /// The old folder was moved and the old path now links to the new one.
    Moved,
    /// Already moved earlier (the old path is the link, or absent).
    AlreadyDone,
    /// Both exist as real folders — something recreated the old one. The new
    /// one is used and the old one is left untouched for the user to check.
    BothExist,
}

/// The data folder, migrating the old one on first use in this process.
/// This crate's own tests get a throwaway folder: they must never touch, let
/// alone move, the user's real data.
#[cfg(test)]
pub fn data_dir() -> PathBuf {
    std::env::temp_dir().join("workbench-core-tests")
}

/// The data folder, migrating the old one on first use in this process.
#[cfg(not(test))]
pub fn data_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        match migrate(&home) {
            Ok(Migration::BothExist) => eprintln!(
                "Both ~/{DIR_NAME} and ~/{LEGACY_DIR_NAME} exist; using ~/{DIR_NAME}. \
                 Check ~/{LEGACY_DIR_NAME} for anything not yet moved."
            ),
            Err(e) => eprintln!("could not move ~/{LEGACY_DIR_NAME} to ~/{DIR_NAME}: {e}"),
            Ok(_) => {}
        }
        home.join(DIR_NAME)
    })
    .clone()
}

fn is_real_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

/// Move `home/.taskboard` to `home/.workbench` and link the old name to it.
pub fn migrate(home: &Path) -> std::io::Result<Migration> {
    let new = home.join(DIR_NAME);
    let old = home.join(LEGACY_DIR_NAME);
    let old_is_dir = is_real_dir(&old);

    if new.exists() {
        if old_is_dir {
            return Ok(Migration::BothExist);
        }
        if std::fs::symlink_metadata(&old).is_err() {
            // Old path missing (e.g. removed by hand): restore the link for
            // programs that still use it. Losing a race here is harmless.
            let _ = link(&new, &old);
        }
        return Ok(Migration::AlreadyDone);
    }
    if !old_is_dir {
        return Ok(Migration::Fresh);
    }
    // Atomic on the same disk; open files keep working (they follow the inode).
    std::fs::rename(&old, &new)?;
    // If another process just recreated the old folder, leave it: data_dir
    // reports BothExist next time rather than overwriting anything.
    let _ = link(&new, &old);
    Ok(Migration::Moved)
}

#[cfg(unix)]
fn link(target: &Path, at: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, at)
}

#[cfg(not(unix))]
fn link(_target: &Path, _at: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn home() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn moves_the_old_folder_and_links_the_old_path() {
        let h = home();
        let old = h.path().join(LEGACY_DIR_NAME);
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("taskboard.db"), "data").unwrap();

        assert_eq!(migrate(h.path()).unwrap(), Migration::Moved);
        let new = h.path().join(DIR_NAME);
        assert_eq!(std::fs::read_to_string(new.join("taskboard.db")).unwrap(), "data");
        // The old path is now a link: writes through it land in the new folder.
        assert!(std::fs::symlink_metadata(&old).unwrap().file_type().is_symlink());
        std::fs::write(old.join("config.json"), "{}").unwrap();
        assert!(new.join("config.json").exists());
    }

    #[test]
    fn running_again_changes_nothing() {
        let h = home();
        std::fs::create_dir(h.path().join(LEGACY_DIR_NAME)).unwrap();
        migrate(h.path()).unwrap();
        assert_eq!(migrate(h.path()).unwrap(), Migration::AlreadyDone);
    }

    #[test]
    fn a_fresh_install_starts_in_the_new_folder() {
        let h = home();
        assert_eq!(migrate(h.path()).unwrap(), Migration::Fresh);
        assert!(!h.path().join(LEGACY_DIR_NAME).exists());
    }

    #[test]
    fn never_overwrites_when_both_folders_exist() {
        let h = home();
        std::fs::create_dir(h.path().join(LEGACY_DIR_NAME)).unwrap();
        std::fs::create_dir(h.path().join(DIR_NAME)).unwrap();
        std::fs::write(h.path().join(LEGACY_DIR_NAME).join("x"), "old").unwrap();
        assert_eq!(migrate(h.path()).unwrap(), Migration::BothExist);
        assert_eq!(std::fs::read_to_string(h.path().join(LEGACY_DIR_NAME).join("x")).unwrap(), "old");
    }

    #[test]
    fn restores_a_missing_link() {
        let h = home();
        std::fs::create_dir(h.path().join(DIR_NAME)).unwrap();
        assert_eq!(migrate(h.path()).unwrap(), Migration::AlreadyDone);
        assert!(std::fs::symlink_metadata(h.path().join(LEGACY_DIR_NAME)).unwrap().file_type().is_symlink());
    }
}
