use anchor_lang::prelude::*;
use instructions::*;

declare_id!("8PZ8EXjLqDxeRHUEL7o53eVceh5MgwPT6aJWZUu5AjTq");

mod state;
mod instructions;
mod error;

#[program]
pub mod devrewards_platform {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        instructions::claim_tokens::handler(ctx)
    }
}
