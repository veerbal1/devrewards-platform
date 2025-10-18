use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub mint_authority: Pubkey,
    pub admin: Pubkey,
    pub daily_claim_amount: u64,
    pub config_bump: u8,
    pub mint_authority_bump: u8,
    pub mint_bump: u8
}

impl TokenConfig {
    pub const LEN:usize =  8 + Self::INIT_SPACE;
}