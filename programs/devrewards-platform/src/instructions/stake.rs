use crate::constants::*;
use crate::error::ErrorCode;
use crate::state::StakeAccount;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(init, payer = user, space = StakeAccount::LEN, seeds = [b"stake", user.key().as_ref()], bump)]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64, lock_duration: i64) -> Result<()> {
    require!(amount >= MIN_STAKE_AMOUNT, ErrorCode::AmountTooSmall);
    require!(amount <= MAX_STAKE_AMOUNT, ErrorCode::AmountTooLarge);
    require!(
        lock_duration >= MIN_LOCK_DURATION,
        ErrorCode::DurationTooShort
    );
    require!(
        lock_duration <= MAX_LOCK_DURATION,
        ErrorCode::DurationTooLong
    );
    require!(
        ctx.accounts.user_token_account.amount >= amount,
        ErrorCode::InsufficientBalance
    );
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, amount)?;

    let stake_account = &mut ctx.accounts.stake_account;
    let clock = Clock::get()?;

    stake_account.user = ctx.accounts.user.key();
    stake_account.staked_amount = amount;
    stake_account.staked_at = clock.unix_timestamp;
    stake_account.lock_duration = lock_duration;
    stake_account.bump = ctx.bumps.stake_account;

    msg!("✅ Tokens staked successfully!");
    msg!("User: {}", stake_account.user);
    msg!("Amount: {} DEVR", amount / 1_000_000_000);
    msg!("Lock duration: {} days", lock_duration / 86400);
    msg!("Staked at: {}", stake_account.staked_at);
    msg!("Unlock at: {}", stake_account.staked_at + lock_duration);

    Ok(())
}
