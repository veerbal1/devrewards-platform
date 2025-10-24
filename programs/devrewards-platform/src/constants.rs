// Staking Constants

// APY Configuration
// 10% APY = 10/100 = 0.10
pub const APY_NUMERATOR: u64 = 10;
pub const APY_DENOMINATOR: u64 = 100;

// Time Constants
pub const SECONDS_PER_YEAR: u64 = 31_536_000; // 365 days in seconds

// Lock Duration Limits
pub const MIN_LOCK_DURATION: i64 = 604_800;      // 7 days in seconds
pub const MAX_LOCK_DURATION: i64 = 315_360_000;  // 10 years in seconds

// Stake Amount Limits (with 9 decimals)
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000_000;         // 1 DEVR
pub const MAX_STAKE_AMOUNT: u64 = 100_000_000_000_000;   // 100,000 DEVR