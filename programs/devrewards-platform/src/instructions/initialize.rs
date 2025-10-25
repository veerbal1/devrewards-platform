use crate::state::{GlobalStats, TokenConfig};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

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

    // NEW: Vault token account - shared pool for all staked tokens
    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = vault_authority,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // NEW: Vault authority PDA - controls vault transfers
    /// CHECK: PDA derived from seeds, used as vault authority
    #[account(
        seeds = [b"vault-authority"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(init, seeds=[b"global-stats"], bump, payer = admin, space = GlobalStats::INIT_SPACE)]
    pub global_stats: Account<'info, GlobalStats>,

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
    config.vault = ctx.accounts.vault.key();
    config.vault_authority = ctx.accounts.vault_authority.key();
    config.daily_claim_amount = 100_000_000_000;
    config.config_bump = ctx.bumps.config;
    config.mint_authority_bump = ctx.bumps.mint_authority;
    config.mint_bump = ctx.bumps.mint;
    config.vault_bump = ctx.bumps.vault;
    config.vault_authority_bump = ctx.bumps.vault_authority;
    ctx.accounts.global_stats.bump = ctx.bumps.global_stats;

    msg!("✅ DevRewards initialized!");
    msg!("Mint: {}", config.mint);
    msg!("Mint Authority: {}", config.mint_authority);
    msg!("Vault: {}", ctx.accounts.vault.key());
    msg!("Vault Authority: {}", ctx.accounts.vault_authority.key());

    Ok(())
}
