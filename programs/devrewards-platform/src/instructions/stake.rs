use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::StakeEvent;
use crate::state::{GlobalStats, StakeAccount, StakeCounter, TokenConfig};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.config_bump
    )]
    pub config: Account<'info, TokenConfig>,

    #[account(
        init_if_needed,
        payer = user,
        space = StakeCounter::LEN,
        seeds = [b"stake-counter", user.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, StakeCounter>,

    #[account(init, payer = user, space = StakeAccount::LEN, seeds = [b"stake", user.key().as_ref(), &counter.stake_count.to_le_bytes()], bump)]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(mut, token::mint = config.mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"global-stats"],
        bump = global_stats.bump
    )]
    pub global_stats: Account<'info, GlobalStats>,

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

    let (apy_numerator, apy_denominator) = get_apy_for_duration(lock_duration);

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_ctx, amount)?;

    let stake_account = &mut ctx.accounts.stake_account;
    let counter = &mut ctx.accounts.counter;
    let clock = Clock::get()?;

    stake_account.user = ctx.accounts.user.key();
    stake_account.staked_amount = amount;
    stake_account.staked_at = clock.unix_timestamp;
    stake_account.lock_duration = lock_duration;
    stake_account.bump = ctx.bumps.stake_account;
    stake_account.stake_index = counter.stake_count;

    let global_stats = &mut ctx.accounts.global_stats;
    global_stats.total_staked = global_stats
        .total_staked
        .checked_add(amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    global_stats.total_stakes = global_stats
        .total_stakes
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    counter.stake_count = counter
        .stake_count
        .checked_add(1)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    if counter.bump == 0 {
        counter.bump = ctx.bumps.counter;
    }

    emit!(StakeEvent {
        user: ctx.accounts.user.key(),
        stake_index: stake_account.stake_index,
        staked_amount: amount,
        lock_duration,
        apy_numerator,
        apy_denominator,
        timestamp: clock.unix_timestamp,
    });

    msg!("✅ Stake successful!");
    msg!("Stake index: {}", stake_account.stake_index);
    msg!("Amount: {} DEVR", amount / 1_000_000_000);
    msg!("Duration: {} days", lock_duration / 86400);
    msg!("APY: {}%", (apy_numerator * 100) / apy_denominator);

    Ok(())
}
