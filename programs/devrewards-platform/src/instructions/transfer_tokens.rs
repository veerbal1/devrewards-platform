use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

const MIN_TRANSFER: u64 = 1_000_000_000;
const MAX_TRANSFER: u64 = 10_000_000_000_000;

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
    require!(amount >= MIN_TRANSFER, ErrorCode::AmountTooSmall);

    require!(amount <= MAX_TRANSFER, ErrorCode::AmountTooLarge);

    require!(
        amount <= ctx.accounts.from_token_account.amount,
        ErrorCode::InsufficientBalance
    );

    require!(
        ctx.accounts.from_token_account.mint == ctx.accounts.to_token_account.mint,
        ErrorCode::MintMismatch
    );

    let cpi_accounts = Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_context = CpiContext::new(cpi_program, cpi_accounts);

    token::transfer(cpi_context, amount);

    msg!("✅ Transfer successful!");
    msg!("From: {}", ctx.accounts.from_token_account.key());
    msg!("To: {}", ctx.accounts.to_token_account.key());
    msg!("Amount: {} tokens", amount / 1_000_000_000);

    Ok(())
}
