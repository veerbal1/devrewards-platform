use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Token, TokenAccount};

#[derive(Accounts)]
pub struct ApproveDelegate<'info> {
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,

    /// CHECK: Unchecked
    pub delegate: UncheckedAccount<'info>,

    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ApproveDelegate>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::AmountTooSmall);

    require!(
        ctx.accounts.token_account.amount >= amount,
        ErrorCode::InsufficientBalance
    );

    let cpi_accounts = Approve {
        to: ctx.accounts.token_account.to_account_info(),
        delegate: ctx.accounts.delegate.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::approve(cpi_ctx, amount)?;

    msg!("✅ Delegation approved!");
    msg!("Delegate: {}", ctx.accounts.delegate.key());
    msg!("Approved amount: {} tokens", amount / 1_000_000_000);
    msg!("Token account: {}", ctx.accounts.token_account.key());
    Ok(())
}
