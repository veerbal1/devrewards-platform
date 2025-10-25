use anchor_lang::prelude::*;
use instructions::*;

declare_id!("8PZ8EXjLqDxeRHUEL7o53eVceh5MgwPT6aJWZUu5AjTq");

mod constants;
mod error;
mod instructions;
mod state;
mod events;

#[program]
pub mod devrewards_platform {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        instructions::claim_tokens::handler(ctx)
    }

    pub fn transfer(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
        instructions::transfer_tokens::handler(ctx, amount)
    }

    pub fn approve_delegate(ctx: Context<ApproveDelegate>, amount: u64) -> Result<()> {
        instructions::approve_delegate::handler(ctx, amount)
    }

    pub fn delegated_transfer(ctx: Context<DelegatedTransfer>, amount: u64) -> Result<()> {
        instructions::delegated_transfer::handler(ctx, amount)
    }

    pub fn revoke_delegate(ctx: Context<RevokeDelegate>) -> Result<()> {
        instructions::revoke_delegate::handler(ctx)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, lock_duration: i64) -> Result<()> {
        instructions::stake::handler(ctx, amount, lock_duration)
    }

    pub fn unstake(ctx: Context<Unstake>, stake_count: u64) -> Result<()> {
        instructions::unstake::handler(ctx, stake_count)
    }
}
