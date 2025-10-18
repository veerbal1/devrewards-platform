use crate::state::TokenConfig;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = TokenConfig::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, TokenConfig>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = mint_authority,
        seeds = [b"devr-mint"],
        bump
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA derived from seeds, used as mint authority
    #[account(
        seeds = [b"mint-authority"],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.mint = ctx.accounts.mint.key();
    config.mint_authority = ctx.accounts.mint_authority.key();
    config.admin = ctx.accounts.admin.key();
    config.daily_claim_amount = 100_000_000_000;
    config.config_bump = ctx.bumps.config;
    config.mint_authority_bump = ctx.bumps.mint_authority;
    config.mint_bump = ctx.bumps.mint;

    msg!("DevRewards initialized!");
    msg!("Mint: {}", config.mint);
    msg!("Authority: {}", config.mint_authority);
    Ok(())
}
