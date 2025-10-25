// constants.rs - UPDATED FOR DAY 19

// ==================== TIERED APY CONFIGURATION ====================

// Time Thresholds (in seconds)
pub const SECONDS_IN_SEVEN_DAYS: i64 = 604_800;    // 7 days
pub const SECONDS_IN_THIRTY_DAYS: i64 = 2_592_000;  // 30 days
pub const SECONDS_IN_NINETY_DAYS: i64 = 7_776_000;  // 90 days

// APY Tiers
// Tier 1: 7-29 days → 5% APY
pub const TIER_1_APY_NUMERATOR: u64 = 5;
pub const TIER_1_APY_DENOMINATOR: u64 = 100;

// Tier 2: 30-89 days → 10% APY
pub const TIER_2_APY_NUMERATOR: u64 = 10;
pub const TIER_2_APY_DENOMINATOR: u64 = 100;

// Tier 3: 90+ days → 20% APY
pub const TIER_3_APY_NUMERATOR: u64 = 20;
pub const TIER_3_APY_DENOMINATOR: u64 = 100;

// ==================== TIME CONSTANTS ====================
pub const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 days in seconds

// ==================== LOCK DURATION LIMITS ====================
pub const MIN_LOCK_DURATION: i64 = 604_800;      // 7 days in seconds
pub const MAX_LOCK_DURATION: i64 = 315_360_000;  // 10 years in seconds

// ==================== STAKE AMOUNT LIMITS ====================
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000_000;         // 1 DEVR (9 decimals)
pub const MAX_STAKE_AMOUNT: u64 = 100_000_000_000_000;   // 100,000 DEVR

// ==================== APY CALCULATION HELPER ====================
/// Returns (numerator, denominator) based on lock duration
pub fn get_apy_for_duration(lock_duration: i64) -> (u64, u64) {
    if lock_duration >= SECONDS_IN_NINETY_DAYS {
        (TIER_3_APY_NUMERATOR, TIER_3_APY_DENOMINATOR) // 20%
    } else if lock_duration >= SECONDS_IN_THIRTY_DAYS {
        (TIER_2_APY_NUMERATOR, TIER_2_APY_DENOMINATOR) // 10%
    } else {
        (TIER_1_APY_NUMERATOR, TIER_1_APY_DENOMINATOR) // 5%
    }
}

// ==================== TESTS ====================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apy_tier_1() {
        let (num, denom) = get_apy_for_duration(SECONDS_IN_SEVEN_DAYS);
        assert_eq!(num, 5);
        assert_eq!(denom, 100);
    }

    #[test]
    fn test_apy_tier_2() {
        let (num, denom) = get_apy_for_duration(SECONDS_IN_THIRTY_DAYS);
        assert_eq!(num, 10);
        assert_eq!(denom, 100);
    }

    #[test]
    fn test_apy_tier_3() {
        let (num, denom) = get_apy_for_duration(SECONDS_IN_NINETY_DAYS);
        assert_eq!(num, 20);
        assert_eq!(denom, 100);
    }

    #[test]
    fn test_boundary_cases() {
        // Just below 30 days → 5%
        let (num, _) = get_apy_for_duration(SECONDS_IN_THIRTY_DAYS - 1);
        assert_eq!(num, 5);

        // Just below 90 days → 10%
        let (num, _) = get_apy_for_duration(SECONDS_IN_NINETY_DAYS - 1);
        assert_eq!(num, 10);
    }
}
