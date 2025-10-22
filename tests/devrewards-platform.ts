import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DevrewardsPlatform } from "../target/types/devrewards_platform";
import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
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
});