use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub mint_authority: Pubkey,
    pub admin: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub daily_claim_amount: u64,
    pub config_bump: u8,
    pub mint_authority_bump: u8,
    pub mint_bump: u8,
    pub vault_bump: u8,
    pub vault_authority_bump: u8,
    pub global_stats_bump: u8
}

impl TokenConfig {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct UserClaim {
    pub user: Pubkey,         // Kis user ne claim kiya
    pub last_claim_time: i64, // Unix timestamp
    pub total_claimed: u64,   // Kitna total claim kiya (analytics ke liye)
    pub bump: u8,             // PDA bump
}

impl UserClaim {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub user: Pubkey,
    pub staked_amount: u64,
    pub staked_at: i64,
    pub lock_duration: i64,
    pub stake_index: u64,
    pub bump: u8,
}

impl StakeAccount {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct StakeCounter {
    pub stake_count: u64, // 8 bytes - Total stakes created
    pub bump: u8,         // 1 byte - PDA bump
}

impl StakeCounter {
    pub const LEN: usize = 8 + Self::INIT_SPACE; // discriminator + stake_count + bump
}

#[account]
#[derive(InitSpace)]
pub struct GlobalStats {
    pub total_staked: u64,       // Total DEVR staked across all users
    pub total_stakes: u64,       // Total stake positions
    pub total_rewards_paid: u64, // Total rewards distributed
    pub bump: u8,
}

impl GlobalStats {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}
