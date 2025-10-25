use crate::constants::*;
use crate::error::ErrorCode;
use crate::events::UnstakeEvent;
use crate::state::{StakeAccount, StakeCounter, GlobalStats, TokenConfig};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(stake_count: u64)]
pub struct Unstake<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.config_bump
    )]
    pub config: Account<'info, TokenConfig>,

    #[account(
        seeds = [b"stake-counter", user.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, StakeCounter>,

    // User's stake account - to read stake data and close
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref(), &stake_count.to_le_bytes()],
        bump = stake_account.bump,
        has_one = user,  // Security: Ensure stake belongs to signer
        close = user  // Return rent to user after closing
    )]
    pub stake_account: Account<'info, StakeAccount>,

    // User's token account - destination for tokens + rewards
    #[account(mut, token::mint = config.mint, token::authority = user)]
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

    #[account(
        mut,
        seeds = [b"global-stats"],
        bump = global_stats.bump
    )]
    pub global_stats: Account<'info, GlobalStats>,

    // User who is unstaking
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Unstake>, stake_count: u64) -> Result<()> {
    let stake_account = &ctx.accounts.stake_account;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    let time_elapsed = current_time - stake_account.staked_at;

    require!(
        time_elapsed >= stake_account.lock_duration,
        ErrorCode::StillLocked
    );

    let staked_amount = stake_account.staked_amount;
    let lock_duration = stake_account.lock_duration;

    // Get the appropriate APY based on lock duration
    let (apy_numerator, apy_denominator) = get_apy_for_duration(lock_duration);
    let amount_with_apy = (staked_amount * apy_numerator) / apy_denominator;

    // CRITICAL FIX: Use lock_duration, NOT time_elapsed
    // User gets rewards for committed lock period only
    // Example: Lock for 30 days → Get 30 days reward (even if unstake after 60 days)
    let rewards = (amount_with_apy * lock_duration as u64) / SECONDS_PER_YEAR;

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

    // Update global stats
    let global_stats = &mut ctx.accounts.global_stats;
    global_stats.total_staked = global_stats
        .total_staked
        .checked_sub(staked_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    global_stats.total_rewards_paid = global_stats
        .total_rewards_paid
        .checked_add(rewards)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    // Emit event for off-chain tracking
    emit!(UnstakeEvent {
        user: stake_account.user,
        stake_index: stake_count,
        principal: staked_amount,
        rewards,
        total_withdrawn: total_amount,
        lock_duration,
        apy_numerator,
        apy_denominator,
        timestamp: clock.unix_timestamp,
    });

    msg!("✅ Tokens unstaked successfully!");
    msg!("User: {}", stake_account.user);
    msg!("Stake Index: #{}", stake_count);
    msg!("Principal: {} DEVR", staked_amount / 1_000_000_000);
    msg!("Rewards: {} DEVR", rewards / 1_000_000_000);
    msg!("Total returned: {} DEVR", total_amount / 1_000_000_000);
    msg!("Lock duration: {} days", lock_duration / 86400);
    msg!("Time staked: {} days", time_elapsed / 86400);
    msg!("APY Rate: {}%", (apy_numerator * 100) / apy_denominator);
    Ok(())
}
