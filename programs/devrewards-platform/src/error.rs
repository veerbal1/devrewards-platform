use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You must wait 24 hours between claims!")]
    ClaimTooSoon = 0,

    #[msg("Transfer amount is too small! Minimum 1 token required.")]
    AmountTooSmall,

    #[msg("Transfer amount exceeds maximum limit!")]
    AmountTooLarge,

    #[msg("Insufficient balance in your account!")]
    InsufficientBalance,

    #[msg("Token accounts must have the same mint!")]
    MintMismatch,
}
