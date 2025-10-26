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
    ArithmeticOverflow = 9,

    // Metadata-related errors
    #[msg("Token name is too long! Maximum 32 characters allowed.")]
    NameTooLong = 10,

    #[msg("Token symbol is too long! Maximum 10 characters allowed.")]
    SymbolTooLong = 11,

    #[msg("Token URI is too long! Maximum 200 characters allowed.")]
    UriTooLong = 12,

    #[msg("Token name cannot be empty!")]
    NameEmpty = 13,

    #[msg("Token symbol cannot be empty!")]
    SymbolEmpty = 14,

    #[msg("Token URI cannot be empty!")]
    UriEmpty = 15,

    #[msg("Invalid URI format! Must start with https:// or ipfs://")]
    InvalidUriFormat = 16,
}
