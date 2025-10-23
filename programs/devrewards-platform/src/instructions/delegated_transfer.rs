use crate::error::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

const MIN_TRANSFER: u64 = 1_000_000_000;      // 1 token minimum
const MAX_TRANSFER: u64 = 10_000_000_000_000; // 10,000 tokens maximum

#[derive(Accounts)]
pub struct DelegatedTransfer<'info> {
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,
    pub delegate: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DelegatedTransfer>, amount: u64) -> Result<()> {
    require!(amount >= MIN_TRANSFER, ErrorCode::AmountTooSmall);
    require!(amount <= MAX_TRANSFER, ErrorCode::AmountTooLarge);
    
    require!(
        ctx.accounts.from_token_account.mint == ctx.accounts.to_token_account.mint,
        ErrorCode::MintMismatch
    );
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.from_token_account.to_account_info(),
        to: ctx.accounts.to_token_account.to_account_info(),
        authority: ctx.accounts.delegate.to_account_info(), // ⬅️ DELEGATE hai authority!
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    // Transfer call (SPL Token Program validates delegation)
    token::transfer(cpi_ctx, amount)?;
    
    msg!("✅ Delegated transfer successful!");
    msg!("Delegate: {}", ctx.accounts.delegate.key());
    msg!("From: {}", ctx.accounts.from_token_account.key());
    msg!("To: {}", ctx.accounts.to_token_account.key());
    msg!("Amount: {} tokens", amount / 1_000_000_000);
    
    Ok(())
}