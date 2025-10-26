use crate::error::ErrorCode;
use crate::state::TokenConfig;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::Mint;
use mpl_token_metadata::instructions::{
    CreateMetadataAccountV3Cpi, CreateMetadataAccountV3CpiAccounts,
    CreateMetadataAccountV3InstructionArgs,
};
use mpl_token_metadata::types::DataV2;

#[derive(Accounts)]
pub struct CreateMetadata<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.config_bump
    )]
    pub config: Account<'info, TokenConfig>,

    /// CHECK: Metaplex will validate this PDA
    #[account(
        mut,
        seeds = [
            b"metadata",
            token_metadata_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = token_metadata_program.key()
    )]
    pub metadata: UncheckedAccount<'info>,

    #[account(
        mut,
        address = config.mint
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA derived from seeds, used as mint authority
    #[account(
        seeds = [b"mint-authority"],
        bump = config.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: This is the Metaplex Token Metadata Program
    #[account(
        address = mpl_token_metadata::ID
    )]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateMetadata>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    // Validate name
    require!(!name.is_empty(), ErrorCode::NameEmpty);
    require!(name.len() <= 32, ErrorCode::NameTooLong);

    // Validate symbol
    require!(!symbol.is_empty(), ErrorCode::SymbolEmpty);
    require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);

    // Validate URI
    require!(!uri.is_empty(), ErrorCode::UriEmpty);
    require!(uri.len() <= 200, ErrorCode::UriTooLong);

    // Validate URI format (must start with https:// or ipfs://)
    let uri_lower = uri.to_lowercase();
    require!(
        uri_lower.starts_with("https://") || uri_lower.starts_with("ipfs://"),
        ErrorCode::InvalidUriFormat
    );

    msg!("Creating metadata for token: {}", ctx.accounts.mint.key());
    msg!("Name: {}, Symbol: {}, URI: {}", name, symbol, uri);

    let data_v2 = DataV2 {
        name,
        symbol,
        uri,
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    let create_metadata_args = CreateMetadataAccountV3InstructionArgs {
        data: data_v2,
        is_mutable: true,
        collection_details: None,
    };

    // Create signer seeds with bump for PDA
    let seeds = &[
        b"mint-authority".as_ref(),
        &[ctx.accounts.config.mint_authority_bump],
    ];
    let signer = &[&seeds[..]];

    // Build the CPI using Metaplex's Cpi builder
    CreateMetadataAccountV3Cpi::new(
        &ctx.accounts.token_metadata_program.to_account_info(),
        CreateMetadataAccountV3CpiAccounts {
            metadata: &ctx.accounts.metadata.to_account_info(),
            mint: &ctx.accounts.mint.to_account_info(),
            mint_authority: &ctx.accounts.mint_authority.to_account_info(),
            payer: &ctx.accounts.payer.to_account_info(),
            update_authority: (&ctx.accounts.mint_authority.to_account_info(), true),
            system_program: &ctx.accounts.system_program.to_account_info(),
            rent: Some(&ctx.accounts.rent.to_account_info()),
        },
        create_metadata_args,
    )
    .invoke_signed(signer)?;

    msg!("✅ Metadata successfully created!");

    Ok(())
}
