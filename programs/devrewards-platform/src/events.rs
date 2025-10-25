use anchor_lang::prelude::*;

#[event]
pub struct StakeEvent {
    pub user: Pubkey,
    pub stake_index: u64,
    pub staked_amount: u64,
    pub lock_duration: i64,
    pub apy_numerator: u64,
    pub apy_denominator: u64,
    pub timestamp: i64,
}

#[event]
pub struct UnstakeEvent {
    pub user: Pubkey,
    pub stake_index: u64,
    pub principal: u64,
    pub rewards: u64,
    pub total_withdrawn: u64,
    pub lock_duration: i64,
    pub apy_numerator: u64,
    pub apy_denominator: u64,
    pub timestamp: i64,
}
