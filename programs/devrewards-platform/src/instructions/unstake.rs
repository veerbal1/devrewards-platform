use crate::constants::*;
use crate::error::ErrorCode;
use crate::state::StakeAccount;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Unstake<'info> {
    // User's stake account - to read stake data and close
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = stake_account.bump,
        close = user  // Return rent to user after closing
    )]
    pub stake_account: Account<'info, StakeAccount>,

    // User's token account - destination for tokens + rewards
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    // Program's vault - source of tokens
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    // Vault authority PDA - needed to sign withdrawal
    /// CHECK: PDA derived from seeds, used to sign vault transfers
    #[account(
        seeds = [b"vault-authority"],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    // User who is unstaking
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Unstake>) -> Result<()> {
    let stake_account = &ctx.accounts.stake_account;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    let time_elapsed = current_time - stake_account.staked_at;

    require!(
        time_elapsed >= stake_account.lock_duration,
        ErrorCode::StillLocked
    );

    let staked_amount = stake_account.staked_amount;

    // Get the appropriate APY based on lock duration
    let (apy_numerator, apy_denominator) = get_apy_for_duration(stake_account.lock_duration);
    let amount_with_apy = (staked_amount * apy_numerator) / apy_denominator;

    let rewards = (amount_with_apy * time_elapsed as u64) / SECONDS_PER_YEAR;

    let total_amount = staked_amount + rewards;

    require!(
        ctx.accounts.vault.amount >= total_amount,
        ErrorCode::InsufficientVaultBalance
    );

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();

    let seeds = &[b"vault-authority".as_ref(), &[ctx.bumps.vault_authority]];

    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);

    token::transfer(cpi_ctx, total_amount)?;

    msg!("✅ Tokens unstaked successfully!");
    msg!("User: {}", stake_account.user);
    msg!("Principal: {} DEVR", staked_amount / 1_000_000_000);
    msg!("Rewards: {} DEVR", rewards / 1_000_000_000);
    msg!("Total returned: {} DEVR", total_amount / 1_000_000_000);
    msg!("Time staked: {} days", time_elapsed / 86400);
    Ok(())
}
