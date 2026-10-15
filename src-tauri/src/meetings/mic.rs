//! Is a microphone in use right now, and by which apps? Read straight from
//! CoreAudio device state: nothing is recorded and no microphone permission is
//! needed.

#[cfg(target_os = "macos")]
mod ffi {
    use std::ffi::c_void;

    pub type AudioObjectId = u32;
    pub type OsStatus = i32;

    #[repr(C)]
    pub struct PropertyAddress {
        pub selector: u32,
        pub scope: u32,
        pub element: u32,
    }

    /// A CoreAudio selector or scope: four ASCII characters packed big-endian.
    pub const fn code(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
    }

    pub const SYSTEM_OBJECT: AudioObjectId = 1;
    pub const ELEMENT_MAIN: u32 = 0;
    pub const SCOPE_GLOBAL: u32 = code(b"glob");
    pub const SCOPE_INPUT: u32 = code(b"inpt");
    pub const HARDWARE_DEVICES: u32 = code(b"dev#");
    pub const DEVICE_RUNNING_SOMEWHERE: u32 = code(b"gone");
    pub const DEVICE_STREAM_CONFIGURATION: u32 = code(b"slay");
    /// macOS 14+: the processes using audio, and which of them record.
    pub const HARDWARE_PROCESSES: u32 = code(b"prs#");
    pub const PROCESS_RUNNING_INPUT: u32 = code(b"piri");
    pub const PROCESS_BUNDLE_ID: u32 = code(b"pbid");

    pub const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        pub fn AudioObjectGetPropertyDataSize(
            object: AudioObjectId,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            out_size: *mut u32,
        ) -> OsStatus;
        pub fn AudioObjectGetPropertyData(
            object: AudioObjectId,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            io_size: *mut u32,
            out_data: *mut c_void,
        ) -> OsStatus;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFStringGetCString(s: *const c_void, buffer: *mut u8, size: isize, encoding: u32) -> u8;
        pub fn CFRelease(cf: *const c_void);
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::ffi::*;
    use std::ffi::c_void;

    fn address(selector: u32, scope: u32) -> PropertyAddress {
        PropertyAddress { selector, scope, element: ELEMENT_MAIN }
    }

    fn data_size(object: AudioObjectId, selector: u32, scope: u32) -> Option<u32> {
        let mut size = 0u32;
        // SAFETY: the address and out-pointer are valid for the duration of the call.
        let status = unsafe {
            AudioObjectGetPropertyDataSize(object, &address(selector, scope), 0, std::ptr::null(), &mut size)
        };
        (status == 0).then_some(size)
    }

    fn object_list(object: AudioObjectId, selector: u32) -> Vec<AudioObjectId> {
        let Some(size) = data_size(object, selector, SCOPE_GLOBAL) else { return Vec::new() };
        let count = size as usize / std::mem::size_of::<AudioObjectId>();
        if count == 0 {
            return Vec::new();
        }
        let mut ids = vec![0 as AudioObjectId; count];
        let mut size = (count * std::mem::size_of::<AudioObjectId>()) as u32;
        // SAFETY: `ids` holds `size` bytes, which CoreAudio never exceeds.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                &address(selector, SCOPE_GLOBAL),
                0,
                std::ptr::null(),
                &mut size,
                ids.as_mut_ptr() as *mut c_void,
            )
        };
        if status != 0 {
            return Vec::new();
        }
        ids.truncate(size as usize / std::mem::size_of::<AudioObjectId>());
        ids
    }

    fn read_u32(object: AudioObjectId, selector: u32) -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        // SAFETY: `value` is a u32 and `size` says so.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                &address(selector, SCOPE_GLOBAL),
                0,
                std::ptr::null(),
                &mut size,
                &mut value as *mut u32 as *mut c_void,
            )
        };
        (status == 0).then_some(value)
    }

    /// Whether the device has input streams (a microphone, not just speakers).
    fn has_input(device: AudioObjectId) -> bool {
        let Some(size) = data_size(device, DEVICE_STREAM_CONFIGURATION, SCOPE_INPUT) else { return false };
        if size < 4 {
            return false;
        }
        // An AudioBufferList; its first field is the buffer count. u64 keeps
        // the allocation aligned for the structs that follow.
        let mut buf = vec![0u64; (size as usize).div_ceil(8)];
        let mut size = size;
        // SAFETY: `buf` holds at least `size` bytes.
        let status = unsafe {
            AudioObjectGetPropertyData(
                device,
                &address(DEVICE_STREAM_CONFIGURATION, SCOPE_INPUT),
                0,
                std::ptr::null(),
                &mut size,
                buf.as_mut_ptr() as *mut c_void,
            )
        };
        status == 0 && (buf[0] as u32) > 0
    }

    fn in_use() -> bool {
        object_list(SYSTEM_OBJECT, HARDWARE_DEVICES)
            .into_iter()
            .any(|d| has_input(d) && read_u32(d, DEVICE_RUNNING_SOMEWHERE).unwrap_or(0) != 0)
    }

    fn bundle_id(process: AudioObjectId) -> Option<String> {
        let mut cf: *const c_void = std::ptr::null();
        let mut size = std::mem::size_of::<*const c_void>() as u32;
        // SAFETY: CoreAudio writes one CFStringRef, which we own and release.
        let status = unsafe {
            AudioObjectGetPropertyData(
                process,
                &address(PROCESS_BUNDLE_ID, SCOPE_GLOBAL),
                0,
                std::ptr::null(),
                &mut size,
                &mut cf as *mut *const c_void as *mut c_void,
            )
        };
        if status != 0 || cf.is_null() {
            return None;
        }
        let mut buf = [0u8; 256];
        // SAFETY: `cf` is a valid CFString; the buffer length is passed.
        let ok = unsafe { CFStringGetCString(cf, buf.as_mut_ptr(), buf.len() as isize, CF_STRING_ENCODING_UTF8) };
        // SAFETY: released exactly once.
        unsafe { CFRelease(cf) };
        if ok == 0 {
            return None;
        }
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        let id = String::from_utf8_lossy(&buf[..end]).trim().to_string();
        (!id.is_empty()).then_some(id)
    }

    /// Is a call on, and which apps are recording? On macOS 14+ the
    /// per-process view is used: a headset's input device is "running" while
    /// it only plays music, so the device alone would report false meetings.
    /// Older systems fall back to the device check.
    pub fn sample() -> (bool, Vec<String>) {
        let processes = object_list(SYSTEM_OBJECT, HARDWARE_PROCESSES);
        if processes.is_empty() {
            return (in_use(), Vec::new());
        }
        let recording: Vec<AudioObjectId> =
            processes.into_iter().filter(|&p| read_u32(p, PROCESS_RUNNING_INPUT).unwrap_or(0) != 0).collect();
        let mut apps: Vec<String> = recording.iter().copied().filter_map(bundle_id).collect();
        apps.sort();
        apps.dedup();
        (!recording.is_empty(), apps)
    }
}

#[cfg(target_os = "macos")]
pub use imp::sample;

#[cfg(not(target_os = "macos"))]
pub fn sample() -> (bool, Vec<String>) {
    (false, Vec::new())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::ffi::code;

    #[test]
    fn selectors_pack_like_coreaudio() {
        // kAudioHardwarePropertyDevices = 'dev#' = 0x64657623
        assert_eq!(code(b"dev#"), 0x6465_7623);
        assert_eq!(code(b"glob"), 0x676c_6f62);
    }

    #[test]
    fn querying_the_microphone_does_not_crash() {
        let _ = super::sample();
    }
}
