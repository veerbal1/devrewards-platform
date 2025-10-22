use crate::error::ErrorCode;
use crate::state::{TokenConfig, UserClaim};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{mint_to, Mint, MintTo, Token, TokenAccount},
};

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.config_bump
    )]
    pub config: Account<'info, TokenConfig>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserClaim::LEN,
        seeds = [b"user-claim", user.key().as_ref()],
        bump
    )]
    pub user_claim: Account<'info, UserClaim>,

    #[account(mut, address = config.mint)]
    pub mint: Account<'info, Mint>,

    /// CHECK: This is a PDA used as the mint authority, validated by seeds and bump
    #[account(
        seeds = [b"mint-authority"],
        bump = config.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimTokens>) -> Result<()> {
    let user_claim = &mut ctx.accounts.user_claim;
    let config = &ctx.accounts.config;
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // Check cooldown (skip check for first-time claimers)
    if user_claim.last_claim_time != 0 {
        let time_elapsed = current_time - user_claim.last_claim_time;

        if time_elapsed < 86400 {
            msg!("Time remaining: {} seconds", 86400 - time_elapsed);
            return Err(error!(ErrorCode::ClaimTooSoon));
        }
    }

    // Setup CPI accounts for minting tokens
    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    // Create signer seeds with bump for PDA
    let seeds = &[
        b"mint-authority".as_ref(),
        &[config.mint_authority_bump],
    ];
    let signer = &[&seeds[..]];

    // Mint tokens to user's token account
    mint_to(
        cpi_ctx.with_signer(signer),
        config.daily_claim_amount
    )?;

    // Update user claim state
    if user_claim.user == Pubkey::default() {
        user_claim.user = ctx.accounts.user.key();
        user_claim.bump = ctx.bumps.user_claim;
    }

    user_claim.last_claim_time = current_time;
    user_claim.total_claimed += config.daily_claim_amount;

    msg!("Tokens claimed successfully!");
    msg!("Amount claimed: {}", config.daily_claim_amount);
    msg!("Total claimed: {}", user_claim.total_claimed);
    msg!("Next claim available in 24 hours");

    Ok(())
}
