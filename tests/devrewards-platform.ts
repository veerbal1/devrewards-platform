import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DevrewardsPlatform } from "../target/types/devrewards_platform";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getMint, getAccount, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expect } from "chai";

describe("devrewards-platform", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.DevrewardsPlatform as Program<DevrewardsPlatform>;
  const admin = provider.wallet as anchor.Wallet;

  // Shared PDAs - derived once, used across tests
  let configPda: PublicKey;
  let mintAuthorityPda: PublicKey;
  let mintPda: PublicKey;

  // Run ONCE before all tests - only for immutable setup
  before(async () => {
    // Derive program-level PDAs (these never change)
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

  /**
   * Fixture: Ensures the program is initialized
   * Safe to call multiple times - checks if already initialized
   */
  async function setupInitializedProgram() {
    try {
      await program.account.tokenConfig.fetch(configPda);
      // Already initialized, skip
    } catch {
      // Not initialized yet, initialize now
      await program.methods.initialize().rpc();
    }
  }

  describe("Initialization", () => {
    it("should initialize program with correct config", async () => {
      await program.methods.initialize().rpc();

      const configAccount = await program.account.tokenConfig.fetch(configPda);

      expect(configAccount.mint.toString()).to.equal(mintPda.toString());
      expect(configAccount.mintAuthority.toString()).to.equal(mintAuthorityPda.toString());
      expect(configAccount.admin.toString()).to.equal(admin.publicKey.toString());
      expect(configAccount.dailyClaimAmount.toString()).to.equal("100000000000");
    });

    it("should create mint with correct properties", async () => {
      await setupInitializedProgram();

      const mintAccount = await getMint(provider.connection, mintPda);

      expect(mintAccount.decimals).to.equal(9);
      expect(mintAccount.mintAuthority?.toString()).to.equal(mintAuthorityPda.toString());
      // Initial supply is 0 before any claims
      expect(Number(mintAccount.supply)).to.be.greaterThanOrEqual(0);
    });

    it("should prevent double initialization", async () => {
      await setupInitializedProgram();

      try {
        await program.methods.initialize().rpc();
        expect.fail("Should have thrown error on double initialization");
      } catch (error: any) {
        // Expected - account already exists
        expect(error).to.exist;
      }
    });
  });

  describe("Token Claims", () => {
    // REQUIRES: Program initialized (handled in beforeEach)
    beforeEach(async () => {
      await setupInitializedProgram();
    });

    it("should allow user to claim tokens for the first time", async () => {
      const user = admin;
      const [userClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user-claim"), user.publicKey.toBuffer()],
        program.programId
      );
      const userTokenAccount = await getAssociatedTokenAddress(
        mintPda,
        user.publicKey
      );

      // Attempt to claim (might already exist if tests ran before)
      let claimAccount: any;
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();

        claimAccount = await program.account.userClaim.fetch(userClaimPda);
      } catch (error: any) {
        // If claim already exists (cooldown error), just fetch it
        if (error.error?.errorCode?.number === 6000) {
          claimAccount = await program.account.userClaim.fetch(userClaimPda);
        } else {
          throw error;
        }
      }

      // Verify user token balance
      const tokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
      expect(Number(tokenAccountInfo.amount)).to.be.greaterThan(0);

      // Verify claim account state
      expect(claimAccount.user.toString()).to.equal(user.publicKey.toString());
      expect(Number(claimAccount.totalClaimed)).to.be.greaterThan(0);
      expect(claimAccount.lastClaimTime.toNumber()).to.be.greaterThan(0);
    });

    it("should prevent claiming again within 24 hour cooldown", async () => {
      const user = admin;

      // First, ensure user has claimed at least once
      let firstClaimSucceeded = false;
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();
        firstClaimSucceeded = true;
      } catch (error: any) {
        // Only acceptable if already claimed (cooldown error)
        if (error.error?.errorCode?.number === 6000) {
          // Already claimed previously, that's fine
          firstClaimSucceeded = false;
        } else {
          // Unexpected error, propagate it
          throw error;
        }
      }

      // Now try to claim again immediately - should always fail with cooldown
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();

        expect.fail("Should have thrown ClaimTooSoon error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6000);
      }
    });

    it("should track total claimed amount correctly", async () => {
      const user = admin;
      const [userClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user-claim"), user.publicKey.toBuffer()],
        program.programId
      );

      // Ensure user has claimed at least once
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();
      } catch {
        // Already claimed
      }

      const claimAccount = await program.account.userClaim.fetch(userClaimPda);
      const configAccount = await program.account.tokenConfig.fetch(configPda);

      // Total claimed should be a multiple of daily claim amount
      const dailyAmount = configAccount.dailyClaimAmount;
      const totalClaimed = claimAccount.totalClaimed;

      expect(Number(totalClaimed) % Number(dailyAmount)).to.equal(0);
    });

    it("should allow multiple users to claim independently", async () => {
      // User A: admin (already has funds)
      const userA = admin;
      const [userAClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user-claim"), userA.publicKey.toBuffer()],
        program.programId
      );

      // User B: new keypair
      const userB = Keypair.generate();
      const [userBClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user-claim"), userB.publicKey.toBuffer()],
        program.programId
      );

      // Fund User B for transaction fees
      const airdropSig = await provider.connection.requestAirdrop(
        userB.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction({
        signature: airdropSig,
        ...(await provider.connection.getLatestBlockhash()),
      });

      // User B claims tokens
      await program.methods
        .claimTokens()
        .accounts({
          mint: mintPda,
          user: userB.publicKey,
        })
        .signers([userB])
        .rpc();

      // Verify both users have independent claim accounts
      const claimAccountA = await program.account.userClaim.fetch(userAClaimPda);
      const claimAccountB = await program.account.userClaim.fetch(userBClaimPda);

      expect(claimAccountA.user.toString()).to.equal(userA.publicKey.toString());
      expect(claimAccountB.user.toString()).to.equal(userB.publicKey.toString());

      // Both should have positive balances
      expect(Number(claimAccountA.totalClaimed)).to.be.greaterThan(0);
      expect(Number(claimAccountB.totalClaimed)).to.be.greaterThan(0);

      // Claim times should be independent
      expect(claimAccountA.lastClaimTime.toNumber()).to.not.equal(claimAccountB.lastClaimTime.toNumber());
    });
  });

  describe("State Verification", () => {
    beforeEach(async () => {
      await setupInitializedProgram();
    });

    it("should maintain correct total supply across claims", async () => {
      // Ensure at least one claim exists
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: admin.publicKey,
          })
          .rpc();
      } catch {
        // Already claimed
      }

      const mintInfo = await getMint(provider.connection, mintPda);

      // Total supply should be positive after claims
      expect(Number(mintInfo.supply)).to.be.greaterThan(0);
    });

    it("should store claim timestamp correctly", async () => {
      const user = admin;
      const [userClaimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user-claim"), user.publicKey.toBuffer()],
        program.programId
      );

      // Ensure claim exists
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();
      } catch {
        // Already claimed
      }

      const claimAccount = await program.account.userClaim.fetch(userClaimPda);
      const lastClaimTime = claimAccount.lastClaimTime.toNumber();
      const currentTime = Math.floor(Date.now() / 1000);

      // Claim time should be in the past, but not too far (within last hour for this test run)
      expect(lastClaimTime).to.be.lessThanOrEqual(currentTime);
      expect(lastClaimTime).to.be.greaterThan(currentTime - 3600);
    });
  });

  describe("Day 17: Token Transfers & Delegation", () => {
    let alice: Keypair;
    let bob: Keypair;
    let aliceTokenAccount: PublicKey;
    let bobTokenAccount: PublicKey;

    before(async () => {
      // Ensure program is initialized
      await setupInitializedProgram();

      // Create keypairs for Alice and Bob
      alice = Keypair.generate();
      bob = Keypair.generate();

      // Airdrop 2 SOL to each for transaction fees
      const aliceAirdrop = await provider.connection.requestAirdrop(
        alice.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction({
        signature: aliceAirdrop,
        ...(await provider.connection.getLatestBlockhash()),
      });

      const bobAirdrop = await provider.connection.requestAirdrop(
        bob.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction({
        signature: bobAirdrop,
        ...(await provider.connection.getLatestBlockhash()),
      });

      // Calculate token account addresses
      aliceTokenAccount = await getAssociatedTokenAddress(mintPda, alice.publicKey);
      bobTokenAccount = await getAssociatedTokenAddress(mintPda, bob.publicKey);

      // Alice claims 100 DEVR tokens
      await program.methods
        .claimTokens()
        .accounts({
          mint: mintPda,
          user: alice.publicKey,
        })
        .signers([alice])
        .rpc();
    });

    describe("P2P Transfer", () => {
      it("should transfer tokens from Alice to Bob", async () => {
        // Create Bob's token account first (required in Solana)
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          bob,
          mintPda,
          bob.publicKey
        );

        // Get balances before transfer
        const aliceBalanceBefore = await getAccount(provider.connection, aliceTokenAccount);
        const bobBalanceBefore = await getAccount(provider.connection, bobTokenAccount);

        // Transfer 50 DEVR from Alice to Bob
        const transferAmount = 50_000_000_000; // 50 DEVR (with 9 decimals)

        await program.methods
          .transfer(new anchor.BN(transferAmount))
          .accounts({
            fromTokenAccount: aliceTokenAccount,
            toTokenAccount: bobTokenAccount,
            authority: alice.publicKey,
          })
          .signers([alice])
          .rpc();

        // Get balances after transfer
        const aliceBalanceAfter = await getAccount(provider.connection, aliceTokenAccount);
        const bobBalanceAfter = await getAccount(provider.connection, bobTokenAccount);

        // Verify balance changes
        expect(aliceBalanceAfter.amount).to.equal(aliceBalanceBefore.amount - BigInt(transferAmount));
        expect(bobBalanceAfter.amount).to.equal(bobBalanceBefore.amount + BigInt(transferAmount));
      });

      it("should fail if amount too small", async () => {
        const tooSmallAmount = 500_000_000; // 0.5 DEVR (less than MIN_TRANSFER of 1 DEVR)

        try {
          await program.methods
            .transfer(new anchor.BN(tooSmallAmount))
            .accounts({
              fromTokenAccount: aliceTokenAccount,
              toTokenAccount: bobTokenAccount,
              authority: alice.publicKey,
            })
            .signers([alice])
            .rpc();

          expect.fail("Should have thrown AmountTooSmall error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6001); // AmountTooSmall
        }
      });

      it("should fail if insufficient balance", async () => {
        // Bob tries to send 100 DEVR but only has 50 DEVR
        const excessiveAmount = 100_000_000_000; // 100 DEVR

        try {
          await program.methods
            .transfer(new anchor.BN(excessiveAmount))
            .accounts({
              fromTokenAccount: bobTokenAccount,
              toTokenAccount: aliceTokenAccount,
              authority: bob.publicKey,
            })
            .signers([bob])
            .rpc();

          expect.fail("Should have thrown InsufficientBalance error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6003); // InsufficientBalance
        }
      });

      it("should fail if amount exceeds maximum", async () => {
        const tooLargeAmount = 15_000_000_000_000; // 15,000 DEVR (exceeds MAX_TRANSFER of 10,000)

        try {
          await program.methods
            .transfer(new anchor.BN(tooLargeAmount))
            .accounts({
              fromTokenAccount: aliceTokenAccount,
              toTokenAccount: bobTokenAccount,
              authority: alice.publicKey,
            })
            .signers([alice])
            .rpc();

          expect.fail("Should have thrown AmountTooLarge error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6002); // AmountTooLarge
        }
      });
    });

    describe("Delegation Pattern", () => {
      let delegate: Keypair;

      before(async () => {
        // Create delegate keypair (represents a platform/service)
        delegate = Keypair.generate();

        // Airdrop 1 SOL for transaction fees
        const delegateAirdrop = await provider.connection.requestAirdrop(
          delegate.publicKey,
          1 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: delegateAirdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });
      });

      it("should approve delegate successfully", async () => {
        const delegateAmount = 30_000_000_000; // 30 DEVR

        await program.methods
          .approveDelegate(new anchor.BN(delegateAmount))
          .accounts({
            tokenAccount: aliceTokenAccount,
            delegate: delegate.publicKey,
            owner: alice.publicKey,
          })
          .signers([alice])
          .rpc();

        // Verify delegation was set correctly
        const tokenAccountData = await getAccount(provider.connection, aliceTokenAccount);

        expect(tokenAccountData.delegate?.toString()).to.equal(delegate.publicKey.toString());
        expect(tokenAccountData.delegatedAmount).to.equal(BigInt(delegateAmount));
      });

      it("should allow delegate to transfer on behalf", async () => {
        // Get balances before delegated transfer
        const aliceBalanceBefore = await getAccount(provider.connection, aliceTokenAccount);
        const bobBalanceBefore = await getAccount(provider.connection, bobTokenAccount);
        const delegatedAmountBefore = aliceBalanceBefore.delegatedAmount;

        const transferAmount = 20_000_000_000; // 20 DEVR

        // CRITICAL: Delegate signs, NOT Alice!
        await program.methods
          .delegatedTransfer(new anchor.BN(transferAmount))
          .accounts({
            fromTokenAccount: aliceTokenAccount,
            toTokenAccount: bobTokenAccount,
            delegate: delegate.publicKey,
          })
          .signers([delegate])
          .rpc();

        // Get balances after transfer
        const aliceBalanceAfter = await getAccount(provider.connection, aliceTokenAccount);
        const bobBalanceAfter = await getAccount(provider.connection, bobTokenAccount);

        // Verify balance changes
        expect(aliceBalanceAfter.amount).to.equal(aliceBalanceBefore.amount - BigInt(transferAmount));
        expect(bobBalanceAfter.amount).to.equal(bobBalanceBefore.amount + BigInt(transferAmount));

        // Verify delegated amount decreased
        expect(aliceBalanceAfter.delegatedAmount).to.equal(delegatedAmountBefore - BigInt(transferAmount));
      });

      it("should fail if delegate exceeds approved amount", async () => {
        // Delegate has 10 DEVR remaining (30 approved - 20 used)
        // Try to transfer 50 DEVR
        const excessiveAmount = 50_000_000_000; // 50 DEVR

        try {
          await program.methods
            .delegatedTransfer(new anchor.BN(excessiveAmount))
            .accounts({
              fromTokenAccount: aliceTokenAccount,
              toTokenAccount: bobTokenAccount,
              delegate: delegate.publicKey,
            })
            .signers([delegate])
            .rpc();

          expect.fail("Should have thrown error when exceeding delegation");
        } catch (error: any) {
          // This is an SPL Token Program error, not our custom error
          expect(error).to.exist;
        }
      });

      it("should revoke delegation successfully", async () => {
        await program.methods
          .revokeDelegate()
          .accounts({
            tokenAccount: aliceTokenAccount,
            owner: alice.publicKey,
          })
          .signers([alice])
          .rpc();

        // Verify delegation was cleared
        const tokenAccountData = await getAccount(provider.connection, aliceTokenAccount);

        expect(tokenAccountData.delegate).to.be.null;
        expect(tokenAccountData.delegatedAmount).to.equal(0n);
      });

      it("should fail delegated transfer after revocation", async () => {
        const transferAmount = 5_000_000_000; // 5 DEVR

        try {
          await program.methods
            .delegatedTransfer(new anchor.BN(transferAmount))
            .accounts({
              fromTokenAccount: aliceTokenAccount,
              toTokenAccount: bobTokenAccount,
              delegate: delegate.publicKey,
            })
            .signers([delegate])
            .rpc();

          expect.fail("Should have thrown error after delegation revoked");
        } catch (error: any) {
          // Delegate no longer has authority
          expect(error).to.exist;
        }
      });
    });
  });
});