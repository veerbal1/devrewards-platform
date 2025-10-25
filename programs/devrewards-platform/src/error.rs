use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You must wait 24 hours between claims!")]
    ClaimTooSoon = 0,

    #[msg("Transfer amount is too small! Minimum 1 token required.")]
    AmountTooSmall = 1,

    #[msg("Transfer amount exceeds maximum limit!")]
    AmountTooLarge = 2,

    #[msg("Insufficient balance in your account!")]
    InsufficientBalance = 3,

    #[msg("Token accounts must have the same mint!")]
    MintMismatch = 4,

    #[msg("Tokens are still locked! Please wait until the lock period has ended before unstaking.")]
    StillLocked = 5,

    #[msg("Vault does not have enough tokens to complete this transaction. Please contact the administrator.")]
    InsufficientVaultBalance = 6,

    #[msg("Staking duration is too short! Minimum duration required.")]
    DurationTooShort = 7,

    #[msg("Staking duration exceeds maximum allowed period!")]
    DurationTooLong = 8,

    #[msg("Arithmetic overflow occurred during calculation!")]
    ArithmeticOverflow = 9
}
