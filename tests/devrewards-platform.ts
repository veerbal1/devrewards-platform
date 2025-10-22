import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DevrewardsPlatform } from "../target/types/devrewards_platform";
import { PublicKey } from "@solana/web3.js";
import { getMint, getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { expect } from "chai";

describe("devrewards-platform", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.DevrewardsPlatform as Program<DevrewardsPlatform>;
  const admin = provider.wallet as anchor.Wallet;

  // PDAs that we'll derive
  let configPda: PublicKey;
  let mintAuthorityPda: PublicKey;
  let mintPda: PublicKey;
  let userClaimPda: PublicKey;
  let userTokenAccount: PublicKey;

  before(async () => {
    // Derive PDAs
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint-authority")],
      program.programId
    );

    [mintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("devr-mint")],
      program.programId
    );

    [userClaimPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user-claim"), admin.publicKey.toBuffer()],
      program.programId
    );

    userTokenAccount = await getAssociatedTokenAddress(
      mintPda,
      admin.publicKey
    );
  });

  it("Initializes the DevRewards program", async () => {
    // Call the initialize instruction
    // Anchor auto-resolves PDAs, we only need to pass non-PDA signers
    await program.methods
      .initialize()
      .rpc();

    // Fetch and verify the config account
    const configAccount = await program.account.tokenConfig.fetch(configPda);

    expect(configAccount.mint.toString()).to.equal(mintPda.toString());
    expect(configAccount.mintAuthority.toString()).to.equal(mintAuthorityPda.toString());
    expect(configAccount.admin.toString()).to.equal(admin.publicKey.toString());
    expect(configAccount.dailyClaimAmount.toString()).to.equal("100000000000");

    // Fetch and verify the mint account
    const mintAccount = await getMint(provider.connection, mintPda);

    expect(mintAccount.decimals).to.equal(9);
    expect(mintAccount.mintAuthority?.toString()).to.equal(mintAuthorityPda.toString());
    expect(Number(mintAccount.supply)).to.equal(0);

    console.log("✅ DevRewards initialized successfully!");
    console.log("Mint:", mintPda.toString());
    console.log("Mint Authority:", mintAuthorityPda.toString());
    console.log("Config:", configPda.toString());
  });

  it("Claims tokens for the first time", async () => {
    // Call claim_tokens instruction
    const tx = await program.methods
      .claimTokens()
      .accounts({
        mint: mintPda,
        user: admin.publicKey,
      })
      .rpc();

    console.log("📝 Transaction signature:", tx);

    // Check user token balance
    const tokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    console.log("💰 Token balance:", tokenAccountInfo.amount.toString());
    expect(tokenAccountInfo.amount.toString()).to.equal("100000000000");

    // Check user claim account state
    const claimAccount = await program.account.userClaim.fetch(userClaimPda);
    console.log("👤 User:", claimAccount.user.toString());
    console.log("⏰ Last claim time:", claimAccount.lastClaimTime.toString());
    console.log("💎 Total claimed:", claimAccount.totalClaimed.toString());

    expect(claimAccount.user.toString()).to.equal(admin.publicKey.toString());
    expect(claimAccount.totalClaimed.toString()).to.equal("100000000000");
    expect(claimAccount.lastClaimTime.toNumber()).to.be.greaterThan(0);

    console.log("✅ First claim successful!");
  });

  it("Fails to claim again within 24 hours", async () => {
    try {
      await program.methods
        .claimTokens()
        .accounts({
          mint: mintPda,
          user: admin.publicKey,
        })
        .rpc();

      // If we get here, the test should fail
      expect.fail("Should have thrown an error for claiming too soon");
    } catch (error: any) {
      // Check if the error is the expected "ClaimTooSoon" error
      console.log("❌ Expected error caught:", error.error?.errorMessage || error.message);
      expect(error.error?.errorMessage || error.message).to.include("24 hours");
      console.log("✅ Cooldown protection working correctly!");
    }
  });

  it("Verifies user claim state", async () => {
    const claimAccount = await program.account.userClaim.fetch(userClaimPda);
    const lastClaimDate = new Date(claimAccount.lastClaimTime.toNumber() * 1000);

    console.log("📊 User Claim State:");
    console.log("   User:", claimAccount.user.toString());
    console.log("   Last Claim:", lastClaimDate.toLocaleString());
    console.log("   Total Claimed:", claimAccount.totalClaimed.toString());
    console.log("   Bump:", claimAccount.bump);

    const mintInfo = await getMint(provider.connection, mintPda);
    console.log("🪙 Total Supply:", mintInfo.supply.toString());

    expect(claimAccount.totalClaimed.toString()).to.equal(mintInfo.supply.toString());
    console.log("✅ State verified correctly!");
  });
});