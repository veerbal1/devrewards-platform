use anchor_lang::prelude::*;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};

#[derive(Accounts)]
pub struct RevokeDelegate<'info> {
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    
    pub owner: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RevokeDelegate>) -> Result<()> {
    let cpi_accounts = Revoke {
        source: ctx.accounts.token_account.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::revoke(cpi_ctx)?;
    
    msg!("✅ Delegation revoked!");
    msg!("Token account: {}", ctx.accounts.token_account.key());
    msg!("Delegate removed successfully");
    
    Ok(())
}