#[cfg(target_os = "macos")]
mod probe {
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    const ITEM_NOT_FOUND: i32 = -25300;

    struct SyntheticEntry {
        service: String,
        account: String,
        armed: bool,
    }

    impl SyntheticEntry {
        fn delete(&mut self) -> Result<(), String> {
            delete_generic_password(&self.service, &self.account)
                .map_err(|error| format!("delete failed: OSStatus {}", error.code()))?;
            self.armed = false;
            Ok(())
        }
    }

    impl Drop for SyntheticEntry {
        fn drop(&mut self) {
            // Error paths must only remove this run's synthetic entry, never an account entry.
            if self.armed {
                if let Err(error) = delete_generic_password(&self.service, &self.account) {
                    eprintln!(
                        "Synthetic Keychain cleanup failed: OSStatus {}",
                        error.code()
                    );
                }
            }
        }
    }

    fn expect_absent(entry: &SyntheticEntry) -> Result<(), String> {
        match get_generic_password(&entry.service, &entry.account) {
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(format!("read failed: OSStatus {}", error.code())),
            Ok(_) => {
                Err("Synthetic entry unexpectedly exists; no existing value was changed.".into())
            }
        }
    }

    pub fn run() -> Result<(), String> {
        // The probe is deliberately opt-in: ordinary builds and tests must not touch Keychain.
        if std::env::var("WORKBENCH_ALLOW_KEYCHAIN_PROBE").as_deref() != Ok("1") {
            return Err(
                "Set WORKBENCH_ALLOW_KEYCHAIN_PROBE=1 to run this synthetic-only probe.".into(),
            );
        }

        let mut entry = SyntheticEntry {
            service: format!("local.contentworkbench.probe.{}", uuid::Uuid::new_v4()),
            account: uuid::Uuid::new_v4().to_string(),
            armed: false,
        };
        expect_absent(&entry)?;
        let initial = uuid::Uuid::new_v4().to_string();
        set_generic_password(&entry.service, &entry.account, initial.as_bytes())
            .map_err(|error| format!("write failed: OSStatus {}", error.code()))?;
        entry.armed = true;
        let received = get_generic_password(&entry.service, &entry.account)
            .map_err(|error| format!("read failed: OSStatus {}", error.code()))?;
        if received != initial.as_bytes() {
            return Err("Synthetic Keychain value did not round-trip.".into());
        }

        let updated = uuid::Uuid::new_v4().to_string();
        set_generic_password(&entry.service, &entry.account, updated.as_bytes())
            .map_err(|error| format!("update failed: OSStatus {}", error.code()))?;
        let received = get_generic_password(&entry.service, &entry.account)
            .map_err(|error| format!("read after update failed: OSStatus {}", error.code()))?;
        if received != updated.as_bytes() {
            return Err("Synthetic Keychain update did not round-trip.".into());
        }
        entry.delete()?;
        expect_absent(&entry)?;
        println!(
            "{}",
            serde_json::json!({
                "passed": true,
                "platform": "macos",
                "probe": "synthetic-keychain-roundtrip",
                "checks": {"write": true, "read": true, "update": true, "delete": true, "absentAfterDelete": true},
                "scope": "Local Keychain API only; signed upgrades and real platform credentials are unverified."
            })
        );
        Ok(())
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    if let Err(error) = probe::run() {
        eprintln!("Keychain probe failed: {error}");
        std::process::exit(1);
    }
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("This Keychain probe requires macOS.");
        std::process::exit(1);
    }
}
