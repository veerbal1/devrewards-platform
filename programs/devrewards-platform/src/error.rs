use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You must wait 24 hours between claims!")]
    ClaimTooSoon,
}
