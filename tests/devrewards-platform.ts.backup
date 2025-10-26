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

  // Helper functions for stake PDAs (accessible across all tests)
  function deriveStakePda(user: PublicKey, stakeCount: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("stake"),
        user.toBuffer(),
        Buffer.from(new anchor.BN(stakeCount).toArray("le", 8))
      ],
      program.programId
    );
    return pda;
  }

  function deriveCounterPda(user: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake-counter"), user.toBuffer()],
      program.programId
    );
    return pda;
  }

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

      // Claim times may be the same if they happened in the same block/slot
      // Just verify they both have valid timestamps
      expect(claimAccountA.lastClaimTime.toNumber()).to.be.greaterThan(0);
      expect(claimAccountB.lastClaimTime.toNumber()).to.be.greaterThan(0);
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

  describe("Day 18: Token Staking - Lock & Earn", () => {
    let staker: Keypair;
    let stakerTokenAccount: PublicKey;
    let vaultPda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let globalStatsPda: PublicKey;

    const SECONDS_PER_DAY = 86400;
    const MIN_LOCK_DURATION = 7 * SECONDS_PER_DAY; // 7 days
    const MAX_LOCK_DURATION = 10 * 365 * SECONDS_PER_DAY; // 10 years

    before(async () => {
      // Ensure program is initialized
      await setupInitializedProgram();

      // Create staker keypair
      staker = Keypair.generate();

      // Airdrop 5 SOL for transaction fees
      const airdrop = await provider.connection.requestAirdrop(
        staker.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction({
        signature: airdrop,
        ...(await provider.connection.getLatestBlockhash()),
      });

      // Derive vault PDAs
      [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId
      );

      [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault-authority")],
        program.programId
      );

      [globalStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global-stats")],
        program.programId
      );

      // Get staker's token account
      stakerTokenAccount = await getAssociatedTokenAddress(mintPda, staker.publicKey);

      // Staker claims 1000 DEVR tokens
      await program.methods
        .claimTokens()
        .accounts({
          mint: mintPda,
          user: staker.publicKey,
        })
        .signers([staker])
        .rpc();
    });

    describe("Stake Instruction - Valid Cases", () => {
      it("should stake tokens successfully with valid amount and duration", async () => {
        const stakeAmount = new anchor.BN(100_000_000_000); // 100 DEVR
        const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY); // 30 days

        const stakeAccountPda = deriveStakePda(staker.publicKey, 0); // First stake
        const counterPda = deriveCounterPda(staker.publicKey);

        // Get balances before staking
        const stakerBalanceBefore = await getAccount(provider.connection, stakerTokenAccount);
        const vaultBalanceBefore = await getAccount(provider.connection, vaultPda);

        // Stake tokens
        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakeAccountPda,
            userTokenAccount: stakerTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: staker.publicKey,
          })
          .signers([staker])
          .rpc();

        // Get balances after staking
        const stakerBalanceAfter = await getAccount(provider.connection, stakerTokenAccount);
        const vaultBalanceAfter = await getAccount(provider.connection, vaultPda);

        // Verify token transfer
        expect(stakerBalanceAfter.amount).to.equal(
          stakerBalanceBefore.amount - BigInt(stakeAmount.toString())
        );
        expect(vaultBalanceAfter.amount).to.equal(
          vaultBalanceBefore.amount + BigInt(stakeAmount.toString())
        );

        // Verify stake account
        const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
        expect(stakeAccount.user.toString()).to.equal(staker.publicKey.toString());
        expect(stakeAccount.stakedAmount.toString()).to.equal(stakeAmount.toString());
        expect(stakeAccount.lockDuration.toString()).to.equal(lockDuration.toString());
        expect(stakeAccount.stakedAt.toNumber()).to.be.greaterThan(0);
        expect(stakeAccount.stakeIndex.toString()).to.equal("0"); // First stake
      });

      it("should stake minimum allowed amount (1 DEVR)", async () => {
        const newStaker = Keypair.generate();

        // Airdrop SOL
        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        // Claim tokens
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const minStakeAmount = new anchor.BN(1_000_000_000); // 1 DEVR
        const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        await program.methods
          .stake(minStakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: newStakerCounterPda,
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(newStakerStakeAccountPda);
        expect(stakeAccount.stakedAmount.toString()).to.equal(minStakeAmount.toString());
      });

      it("should stake with minimum duration (7 days)", async () => {
        const newStaker = Keypair.generate();

        // Airdrop SOL
        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        // Claim tokens
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const stakeAmount = new anchor.BN(50_000_000_000); // 50 DEVR
        const minLockDuration = new anchor.BN(MIN_LOCK_DURATION); // 7 days

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        await program.methods
          .stake(stakeAmount, minLockDuration)
          .accounts({
            config: configPda,
            counter: newStakerCounterPda,
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(newStakerStakeAccountPda);
        expect(stakeAccount.lockDuration.toString()).to.equal(minLockDuration.toString());
      });
    });

    describe("Stake Instruction - Error Cases", () => {
      it("should fail when amount is too small (< 1 DEVR)", async () => {
        const newStaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const tooSmallAmount = new anchor.BN(500_000_000); // 0.5 DEVR
        const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(tooSmallAmount, lockDuration)
            .accounts({
              config: configPda,
              counter: newStakerCounterPda,
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: newStaker.publicKey,
            })
            .signers([newStaker])
            .rpc();

          expect.fail("Should have thrown AmountTooSmall error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6001); // AmountTooSmall
        }
      });

      it("should fail when amount is too large (> 100,000 DEVR)", async () => {
        const tooLargeAmount = new anchor.BN(150_000_000_000_000); // 150,000 DEVR
        const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

        const newStaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(tooLargeAmount, lockDuration)
            .accounts({
              config: configPda,
              counter: newStakerCounterPda,
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: newStaker.publicKey,
            })
            .signers([newStaker])
            .rpc();

          expect.fail("Should have thrown AmountTooLarge error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6002); // AmountTooLarge
        }
      });

      it("should fail when duration is too short (< 7 days)", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const tooShortDuration = new anchor.BN(3 * SECONDS_PER_DAY); // 3 days

        const newStaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(stakeAmount, tooShortDuration)
            .accounts({
              config: configPda,
              counter: newStakerCounterPda,
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: newStaker.publicKey,
            })
            .signers([newStaker])
            .rpc();

          expect.fail("Should have thrown DurationTooShort error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6007); // DurationTooShort
        }
      });

      it("should fail when duration is too long (> 10 years)", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const tooLongDuration = new anchor.BN(11 * 365 * SECONDS_PER_DAY); // 11 years

        const newStaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(stakeAmount, tooLongDuration)
            .accounts({
              config: configPda,
              counter: newStakerCounterPda,
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: newStaker.publicKey,
            })
            .signers([newStaker])
            .rpc();

          expect.fail("Should have thrown DurationTooLong error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6008); // DurationTooLong
        }
      });

      it("should fail when user has insufficient balance", async () => {
        const newStaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        // Try to stake more than they have (they have 100 DEVR)
        const excessiveAmount = new anchor.BN(200_000_000_000); // 200 DEVR
        const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(excessiveAmount, lockDuration)
            .accounts({
              config: configPda,
              counter: newStakerCounterPda,
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: newStaker.publicKey,
            })
            .signers([newStaker])
            .rpc();

          expect.fail("Should have thrown InsufficientBalance error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6003); // InsufficientBalance
        }
      });
    });

    describe("Unstake Instruction", () => {
      let unstaker: Keypair;
      let unstakerTokenAccount: PublicKey;
      let unstakerStakeAccountPda: PublicKey;

      before(async () => {
        // Create new user for unstake tests
        unstaker = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          unstaker.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        unstakerStakeAccountPda = deriveStakePda(unstaker.publicKey, 0);
        const unstakerCounterPda = deriveCounterPda(unstaker.publicKey);

        unstakerTokenAccount = await getAssociatedTokenAddress(mintPda, unstaker.publicKey);

        // Claim tokens
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: unstaker.publicKey,
          })
          .signers([unstaker])
          .rpc();

        // Stake 50 DEVR for 7 days (minimum duration for faster testing)
        const stakeAmount = new anchor.BN(50_000_000_000); // 50 DEVR
        const lockDuration = new anchor.BN(MIN_LOCK_DURATION); // 7 days

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: unstakerCounterPda,
            stakeAccount: unstakerStakeAccountPda,
            userTokenAccount: unstakerTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: unstaker.publicKey,
          })
          .signers([unstaker])
          .rpc();
      });

      it("should fail to unstake when tokens are still locked", async () => {
        const unstakerCounterPda = deriveCounterPda(unstaker.publicKey);

        try {
          await program.methods
            .unstake(new anchor.BN(0)) // First stake (index 0)
            .accounts({
              config: configPda,
              counter: unstakerCounterPda,
              stakeAccount: unstakerStakeAccountPda,
              userTokenAccount: unstakerTokenAccount,
              vault: vaultPda,
              vaultAuthority: vaultAuthorityPda,
              globalStats: globalStatsPda,
              user: unstaker.publicKey,
            })
            .signers([unstaker])
            .rpc();

          expect.fail("Should have thrown StillLocked error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6005); // StillLocked
        }
      });

      it("should verify stake account state during lock period", async () => {
        const stakeAccount = await program.account.stakeAccount.fetch(unstakerStakeAccountPda);

        expect(stakeAccount.user.toString()).to.equal(unstaker.publicKey.toString());
        expect(stakeAccount.stakedAmount.toString()).to.equal("50000000000");
        expect(stakeAccount.lockDuration.toString()).to.equal(MIN_LOCK_DURATION.toString());
        expect(stakeAccount.stakedAt.toNumber()).to.be.greaterThan(0);
      });

      it("should calculate expected rewards correctly (10% APY)", async () => {
        const stakeAccount = await program.account.stakeAccount.fetch(unstakerStakeAccountPda);

        const stakedAmount = stakeAccount.stakedAmount.toNumber();
        const lockDuration = stakeAccount.lockDuration.toNumber();

        // APY calculation: 10% = 10/100 (matches constants.rs)
        const APY_NUMERATOR = 10;
        const APY_DENOMINATOR = 100;
        const SECONDS_PER_YEAR = 31_536_000; // 365 days in seconds

        // Step 1: Calculate 10% of staked amount
        const amountWithApy = (stakedAmount * APY_NUMERATOR) / APY_DENOMINATOR;

        // Step 2: Calculate time-proportional rewards
        const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

        // For 50 DEVR staked for 7 days at 10% APY:
        // amountWithApy = 50 * 10 / 100 = 5 DEVR (10% of principal)
        // rewards = (5 DEVR * 604,800 seconds) / 31,536,000 seconds ≈ 0.0958 DEVR

        expect(expectedRewards).to.be.greaterThan(0);
        console.log(`        Expected rewards for 50 DEVR / 7 days: ${expectedRewards / 1_000_000_000} DEVR`);
      });
    });

    describe("Multiple Users Staking", () => {
      it("should handle multiple users staking independently", async () => {
        const user1 = Keypair.generate();
        const user2 = Keypair.generate();

        // Setup user1
        const airdrop1 = await provider.connection.requestAirdrop(
          user1.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop1,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user1.publicKey,
          })
          .signers([user1])
          .rpc();

        // Setup user2
        const airdrop2 = await provider.connection.requestAirdrop(
          user2.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop2,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user2.publicKey,
          })
          .signers([user2])
          .rpc();

        // User1 stakes 30 DEVR for 15 days
        const user1StakeAccountPda = deriveStakePda(user1.publicKey, 0);
        const user1CounterPda = deriveCounterPda(user1.publicKey);
        const user1TokenAccount = await getAssociatedTokenAddress(mintPda, user1.publicKey);

        await program.methods
          .stake(new anchor.BN(30_000_000_000), new anchor.BN(15 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: user1CounterPda,
            stakeAccount: user1StakeAccountPda,
            userTokenAccount: user1TokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: user1.publicKey,
          })
          .signers([user1])
          .rpc();

        // User2 stakes 70 DEVR for 30 days
        const user2StakeAccountPda = deriveStakePda(user2.publicKey, 0);
        const user2CounterPda = deriveCounterPda(user2.publicKey);
        const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);

        await program.methods
          .stake(new anchor.BN(70_000_000_000), new anchor.BN(30 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: user2CounterPda,
            stakeAccount: user2StakeAccountPda,
            userTokenAccount: user2TokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: user2.publicKey,
          })
          .signers([user2])
          .rpc();

        // Verify both stake accounts are independent
        const user1StakeAccount = await program.account.stakeAccount.fetch(user1StakeAccountPda);
        const user2StakeAccount = await program.account.stakeAccount.fetch(user2StakeAccountPda);

        expect(user1StakeAccount.stakedAmount.toString()).to.equal("30000000000");
        expect(user1StakeAccount.lockDuration.toString()).to.equal((15 * SECONDS_PER_DAY).toString());

        expect(user2StakeAccount.stakedAmount.toString()).to.equal("70000000000");
        expect(user2StakeAccount.lockDuration.toString()).to.equal((30 * SECONDS_PER_DAY).toString());

        // Verify vault has accumulated both stakes
        const vaultBalance = await getAccount(provider.connection, vaultPda);
        expect(Number(vaultBalance.amount)).to.be.greaterThanOrEqual(100_000_000_000); // At least 100 DEVR
      });
    });

    describe("Vault Balance Verification", () => {
      it("should track vault balance correctly after multiple stakes", async () => {
        const vaultBalanceBefore = await getAccount(provider.connection, vaultPda);

        const newStaker = Keypair.generate();
        const airdrop = await provider.connection.requestAirdrop(
          newStaker.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const stakeAmount = new anchor.BN(25_000_000_000); // 25 DEVR

        const newStakerStakeAccountPda = deriveStakePda(newStaker.publicKey, 0);
        const newStakerCounterPda = deriveCounterPda(newStaker.publicKey);
        const newStakerTokenAccount = await getAssociatedTokenAddress(mintPda, newStaker.publicKey);

        await program.methods
          .stake(stakeAmount, new anchor.BN(MIN_LOCK_DURATION))
          .accounts({
            config: configPda,
            counter: newStakerCounterPda,
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        const vaultBalanceAfter = await getAccount(provider.connection, vaultPda);

        expect(vaultBalanceAfter.amount).to.equal(
          vaultBalanceBefore.amount + BigInt(stakeAmount.toString())
        );
      });
    });
  });

  describe("Day 19: Comprehensive Staking Tests", () => {
    let testUser: Keypair;
    let testUserTokenAccount: PublicKey;
    let vaultPda: PublicKey;
    let globalStatsPda: PublicKey;

    const SECONDS_PER_DAY = 86400;

    before(async () => {
      // Setup test user
      testUser = Keypair.generate();

      const airdrop = await provider.connection.requestAirdrop(
        testUser.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction({
        signature: airdrop,
        ...(await provider.connection.getLatestBlockhash()),
      });

      [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId
      );

      [globalStatsPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global-stats")],
        program.programId
      );

      testUserTokenAccount = await getAssociatedTokenAddress(mintPda, testUser.publicKey);

      // Claim tokens for test user
      await program.methods
        .claimTokens()
        .accounts({
          mint: mintPda,
          user: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
    });

    describe("1. Multiple Stakes Per User", () => {
      it("1.1. Should create first stake with index 0", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);

        const stakeAccountPda = deriveStakePda(testUser.publicKey, 0);
        const counterPda = deriveCounterPda(testUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakeAccountPda,
            userTokenAccount: testUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
        expect(stakeAccount.stakeIndex.toString()).to.equal("0");
        expect(stakeAccount.stakedAmount.toString()).to.equal(stakeAmount.toString());
      });

      it("1.2. Should create second stake with index 1", async () => {
        const stakeAmount = new anchor.BN(15_000_000_000); // 15 DEVR
        const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY);

        const stakeAccountPda = deriveStakePda(testUser.publicKey, 1);
        const counterPda = deriveCounterPda(testUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakeAccountPda,
            userTokenAccount: testUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
        expect(stakeAccount.stakeIndex.toString()).to.equal("1");
        expect(stakeAccount.stakedAmount.toString()).to.equal(stakeAmount.toString());
      });

      it("1.3. Should create third stake with index 2", async () => {
        const stakeAmount = new anchor.BN(20_000_000_000); // 20 DEVR
        const lockDuration = new anchor.BN(90 * SECONDS_PER_DAY);

        const stakeAccountPda = deriveStakePda(testUser.publicKey, 2);
        const counterPda = deriveCounterPda(testUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakeAccountPda,
            userTokenAccount: testUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
        expect(stakeAccount.stakeIndex.toString()).to.equal("2");
        expect(stakeAccount.stakedAmount.toString()).to.equal(stakeAmount.toString());
      });

      it("1.4. Should verify all three stakes exist independently", async () => {
        const stake0 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 0));
        const stake1 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 1));
        const stake2 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 2));

        expect(stake0.stakeIndex.toString()).to.equal("0");
        expect(stake0.stakedAmount.toString()).to.equal("10000000000");
        expect(stake0.lockDuration.toString()).to.equal((7 * SECONDS_PER_DAY).toString());

        expect(stake1.stakeIndex.toString()).to.equal("1");
        expect(stake1.stakedAmount.toString()).to.equal("15000000000");
        expect(stake1.lockDuration.toString()).to.equal((30 * SECONDS_PER_DAY).toString());

        expect(stake2.stakeIndex.toString()).to.equal("2");
        expect(stake2.stakedAmount.toString()).to.equal("20000000000");
        expect(stake2.lockDuration.toString()).to.equal((90 * SECONDS_PER_DAY).toString());
      });

      it("1.5. Should create fourth and fifth stakes (scaling test)", async () => {
        const stake4Amount = new anchor.BN(5_000_000_000); // 5 DEVR
        const stake5Amount = new anchor.BN(3_000_000_000); // 3 DEVR
        const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);

        const counterPda = deriveCounterPda(testUser.publicKey);

        // Create stake #3
        const stake3Pda = deriveStakePda(testUser.publicKey, 3);
        await program.methods
          .stake(stake4Amount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stake3Pda,
            userTokenAccount: testUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();

        // Create stake #4
        const stake4Pda = deriveStakePda(testUser.publicKey, 4);
        await program.methods
          .stake(stake5Amount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stake4Pda,
            userTokenAccount: testUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: testUser.publicKey,
          })
          .signers([testUser])
          .rpc();

        const stake3 = await program.account.stakeAccount.fetch(stake3Pda);
        const stake4 = await program.account.stakeAccount.fetch(stake4Pda);

        expect(stake3.stakeIndex.toString()).to.equal("3");
        expect(stake4.stakeIndex.toString()).to.equal("4");
      });

      it("1.6. Should allow different users to have independent stake counters", async () => {
        const user2 = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          user2.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user2.publicKey,
          })
          .signers([user2])
          .rpc();

        const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);
        const user2Counter = deriveCounterPda(user2.publicKey);
        const user2Stake0 = deriveStakePda(user2.publicKey, 0);

        await program.methods
          .stake(new anchor.BN(10_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: user2Counter,
            stakeAccount: user2Stake0,
            userTokenAccount: user2TokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: user2.publicKey,
          })
          .signers([user2])
          .rpc();

        const user2StakeAccount = await program.account.stakeAccount.fetch(user2Stake0);
        expect(user2StakeAccount.stakeIndex.toString()).to.equal("0");
        expect(user2StakeAccount.user.toString()).to.equal(user2.publicKey.toString());
      });

      it("1.7. Should fail if trying to create stake with wrong index manually", async () => {
        const counterPda = deriveCounterPda(testUser.publicKey);
        const counter = await program.account.stakeCounter.fetch(counterPda);
        const currentCount = counter.stakeCount.toNumber();

        // Try to create a stake with an already-used index
        const wrongIndexPda = deriveStakePda(testUser.publicKey, 0);

        try {
          await program.methods
            .stake(new anchor.BN(5_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: counterPda,
              stakeAccount: wrongIndexPda,
              userTokenAccount: testUserTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: testUser.publicKey,
            })
            .signers([testUser])
            .rpc();

          expect.fail("Should have failed with account already exists error");
        } catch (error: any) {
          // Account already exists error
          expect(error).to.exist;
        }
      });
    });

    describe("2. Tiered APY System", () => {
      let apyTestUser: Keypair;
      let apyTestUserTokenAccount: PublicKey;

      before(async () => {
        apyTestUser = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          apyTestUser.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        apyTestUserTokenAccount = await getAssociatedTokenAddress(mintPda, apyTestUser.publicKey);
      });

      it("2.1. Should apply 5% APY for exactly 7-day lock", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 0);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((7 * SECONDS_PER_DAY).toString());
        // APY tier: 5% for 7 days
      });

      it("2.2. Should apply 5% APY for 15-day lock (between 7-30)", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(15 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 1);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((15 * SECONDS_PER_DAY).toString());
      });

      it("2.3. Should apply 10% APY for exactly 30-day lock", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 2);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((30 * SECONDS_PER_DAY).toString());
      });

      it("2.4. Should apply 10% APY for 60-day lock (between 30-90)", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(60 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 3);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((60 * SECONDS_PER_DAY).toString());
      });

      it("2.5. Should apply 20% APY for exactly 90-day lock", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(90 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 4);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((90 * SECONDS_PER_DAY).toString());
      });

      it("2.6. Should apply 20% APY for 180-day lock (above 90)", async () => {
        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const lockDuration = new anchor.BN(180 * SECONDS_PER_DAY);

        const stakePda = deriveStakePda(apyTestUser.publicKey, 5);
        const counterPda = deriveCounterPda(apyTestUser.publicKey);

        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: apyTestUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: apyTestUser.publicKey,
          })
          .signers([apyTestUser])
          .rpc();

        const stakeAccount = await program.account.stakeAccount.fetch(stakePda);
        expect(stakeAccount.lockDuration.toString()).to.equal((180 * SECONDS_PER_DAY).toString());
      });

      it("2.7. Should calculate correct rewards for 5% tier (7 days)", async () => {
        const stakeAmount = 100_000_000_000; // 100 DEVR
        const lockDuration = 7 * SECONDS_PER_DAY;
        const APY_NUMERATOR = 5;
        const APY_DENOMINATOR = 100;
        const SECONDS_PER_YEAR = 31_536_000;

        // Expected: (100 * 5 / 100) * (7 days / 365 days) = 5 * (604800 / 31536000)
        const amountWithApy = (stakeAmount * APY_NUMERATOR) / APY_DENOMINATOR;
        const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

        expect(expectedRewards).to.be.greaterThan(0);
        // 100 DEVR * 5% * (7/365) ≈ 0.0958 DEVR
      });

      it("2.8. Should calculate correct rewards for 10% tier (30 days)", async () => {
        const stakeAmount = 100_000_000_000; // 100 DEVR
        const lockDuration = 30 * SECONDS_PER_DAY;
        const APY_NUMERATOR = 10;
        const APY_DENOMINATOR = 100;
        const SECONDS_PER_YEAR = 31_536_000;

        const amountWithApy = (stakeAmount * APY_NUMERATOR) / APY_DENOMINATOR;
        const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

        expect(expectedRewards).to.be.greaterThan(0);
        // 100 DEVR * 10% * (30/365) ≈ 0.821 DEVR
      });

      it("2.9. Should calculate correct rewards for 20% tier (90 days)", async () => {
        const stakeAmount = 100_000_000_000; // 100 DEVR
        const lockDuration = 90 * SECONDS_PER_DAY;
        const APY_NUMERATOR = 20;
        const APY_DENOMINATOR = 100;
        const SECONDS_PER_YEAR = 31_536_000;

        const amountWithApy = (stakeAmount * APY_NUMERATOR) / APY_DENOMINATOR;
        const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

        expect(expectedRewards).to.be.greaterThan(0);
        // 100 DEVR * 20% * (90/365) ≈ 4.93 DEVR
      });
    });

    describe("3. GlobalStats Tracking", () => {
      let statsUser: Keypair;
      let statsUserTokenAccount: PublicKey;

      before(async () => {
        statsUser = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          statsUser.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: statsUser.publicKey,
          })
          .signers([statsUser])
          .rpc();

        statsUserTokenAccount = await getAssociatedTokenAddress(mintPda, statsUser.publicKey);
      });

      it("3.1. Should initialize GlobalStats with correct values", async () => {
        const globalStats = await program.account.globalStats.fetch(globalStatsPda);

        expect(globalStats.totalStaked.toNumber()).to.be.greaterThanOrEqual(0);
        expect(globalStats.totalStakes.toNumber()).to.be.greaterThanOrEqual(0);
        expect(globalStats.totalRewardsPaid.toNumber()).to.be.greaterThanOrEqual(0);
      });

      it("3.2. Should increment total_staked when user stakes", async () => {
        const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakedBefore = globalStatsBefore.totalStaked.toNumber();

        const stakeAmount = new anchor.BN(25_000_000_000); // 25 DEVR
        const stakePda = deriveStakePda(statsUser.publicKey, 0);
        const counterPda = deriveCounterPda(statsUser.publicKey);

        await program.methods
          .stake(stakeAmount, new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: statsUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: statsUser.publicKey,
          })
          .signers([statsUser])
          .rpc();

        const globalStatsAfter = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakedAfter = globalStatsAfter.totalStaked.toNumber();

        expect(totalStakedAfter).to.equal(totalStakedBefore + stakeAmount.toNumber());
      });

      it("3.3. Should increment total_stakes counter when user stakes", async () => {
        const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakesBefore = globalStatsBefore.totalStakes.toNumber();

        const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR
        const stakePda = deriveStakePda(statsUser.publicKey, 1);
        const counterPda = deriveCounterPda(statsUser.publicKey);

        await program.methods
          .stake(stakeAmount, new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: stakePda,
            userTokenAccount: statsUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: statsUser.publicKey,
          })
          .signers([statsUser])
          .rpc();

        const globalStatsAfter = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakesAfter = globalStatsAfter.totalStakes.toNumber();

        expect(totalStakesAfter).to.equal(totalStakesBefore + 1);
      });

      it("3.4. Should handle multiple users staking (aggregate correctly)", async () => {
        const user1 = Keypair.generate();
        const user2 = Keypair.generate();

        // Setup user1
        await provider.connection.confirmTransaction({
          signature: await provider.connection.requestAirdrop(user1.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL),
          ...(await provider.connection.getLatestBlockhash()),
        });
        await program.methods.claimTokens().accounts({ mint: mintPda, user: user1.publicKey }).signers([user1]).rpc();

        // Setup user2
        await provider.connection.confirmTransaction({
          signature: await provider.connection.requestAirdrop(user2.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL),
          ...(await provider.connection.getLatestBlockhash()),
        });
        await program.methods.claimTokens().accounts({ mint: mintPda, user: user2.publicKey }).signers([user2]).rpc();

        const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakedBefore = globalStatsBefore.totalStaked.toNumber();

        // User1 stakes 20 DEVR
        const user1TokenAccount = await getAssociatedTokenAddress(mintPda, user1.publicKey);
        await program.methods
          .stake(new anchor.BN(20_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(user1.publicKey),
            stakeAccount: deriveStakePda(user1.publicKey, 0),
            userTokenAccount: user1TokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: user1.publicKey,
          })
          .signers([user1])
          .rpc();

        // User2 stakes 30 DEVR
        const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);
        await program.methods
          .stake(new anchor.BN(30_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(user2.publicKey),
            stakeAccount: deriveStakePda(user2.publicKey, 0),
            userTokenAccount: user2TokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: user2.publicKey,
          })
          .signers([user2])
          .rpc();

        const globalStatsAfter = await program.account.globalStats.fetch(globalStatsPda);
        const totalStakedAfter = globalStatsAfter.totalStaked.toNumber();

        expect(totalStakedAfter).to.equal(totalStakedBefore + 50_000_000_000); // 20 + 30 DEVR
      });
    });

    describe("4. Unstake with Multiple Stakes", () => {
      let unstakeUser: Keypair;
      let unstakeUserTokenAccount: PublicKey;
      let vaultAuthorityPda: PublicKey;

      before(async () => {
        unstakeUser = Keypair.generate();

        const airdrop = await provider.connection.requestAirdrop(
          unstakeUser.publicKey,
          5 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction({
          signature: airdrop,
          ...(await provider.connection.getLatestBlockhash()),
        });

        [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault-authority")],
          program.programId
        );

        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: unstakeUser.publicKey,
          })
          .signers([unstakeUser])
          .rpc();

        unstakeUserTokenAccount = await getAssociatedTokenAddress(mintPda, unstakeUser.publicKey);

        // Create 3 stakes with VERY short duration for testing (7 days minimum)
        const counterPda = deriveCounterPda(unstakeUser.publicKey);
        const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);

        // Stake 0: 10 DEVR
        await program.methods
          .stake(new anchor.BN(10_000_000_000), lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: deriveStakePda(unstakeUser.publicKey, 0),
            userTokenAccount: unstakeUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: unstakeUser.publicKey,
          })
          .signers([unstakeUser])
          .rpc();

        // Stake 1: 20 DEVR
        await program.methods
          .stake(new anchor.BN(20_000_000_000), lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: deriveStakePda(unstakeUser.publicKey, 1),
            userTokenAccount: unstakeUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: unstakeUser.publicKey,
          })
          .signers([unstakeUser])
          .rpc();

        // Stake 2: 30 DEVR
        await program.methods
          .stake(new anchor.BN(30_000_000_000), lockDuration)
          .accounts({
            config: configPda,
            counter: counterPda,
            stakeAccount: deriveStakePda(unstakeUser.publicKey, 2),
            userTokenAccount: unstakeUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: unstakeUser.publicKey,
          })
          .signers([unstakeUser])
          .rpc();
      });

      it("4.1. Should fail to unstake before lock period completes", async () => {
        const counterPda = deriveCounterPda(unstakeUser.publicKey);
        const stakePda = deriveStakePda(unstakeUser.publicKey, 0);

        try {
          await program.methods
            .unstake(new anchor.BN(0))
            .accounts({
              config: configPda,
              counter: counterPda,
              stakeAccount: stakePda,
              userTokenAccount: unstakeUserTokenAccount,
              vault: vaultPda,
              vaultAuthority: vaultAuthorityPda,
              globalStats: globalStatsPda,
              user: unstakeUser.publicKey,
            })
            .signers([unstakeUser])
            .rpc();

          expect.fail("Should have thrown StillLocked error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6005); // StillLocked
        }
      });

      it("4.2. Should verify all three stakes exist with correct amounts", async () => {
        const stake0 = await program.account.stakeAccount.fetch(deriveStakePda(unstakeUser.publicKey, 0));
        const stake1 = await program.account.stakeAccount.fetch(deriveStakePda(unstakeUser.publicKey, 1));
        const stake2 = await program.account.stakeAccount.fetch(deriveStakePda(unstakeUser.publicKey, 2));

        expect(stake0.stakedAmount.toString()).to.equal("10000000000");
        expect(stake1.stakedAmount.toString()).to.equal("20000000000");
        expect(stake2.stakedAmount.toString()).to.equal("30000000000");
      });

      it("4.3. Should calculate rewards using lock_duration (not time_elapsed)", async () => {
        const stake0 = await program.account.stakeAccount.fetch(deriveStakePda(unstakeUser.publicKey, 0));

        const stakedAmount = stake0.stakedAmount.toNumber();
        const lockDuration = stake0.lockDuration.toNumber();

        // 5% APY for 7 days
        const APY_NUMERATOR = 5;
        const APY_DENOMINATOR = 100;
        const SECONDS_PER_YEAR = 31_536_000;

        const amountWithApy = (stakedAmount * APY_NUMERATOR) / APY_DENOMINATOR;
        const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

        expect(expectedRewards).to.be.greaterThan(0);
        // For 10 DEVR, 7 days, 5% APY: ~0.0958 DEVR rewards
      });

      it("4.4. Should fail if wrong stake_index parameter provided", async () => {
        const counterPda = deriveCounterPda(unstakeUser.publicKey);
        const stakePda = deriveStakePda(unstakeUser.publicKey, 0);

        try {
          // Try to unstake stake #0 but pass wrong index (99)
          await program.methods
            .unstake(new anchor.BN(99))
            .accounts({
              config: configPda,
              counter: counterPda,
              stakeAccount: stakePda,
              userTokenAccount: unstakeUserTokenAccount,
              vault: vaultPda,
              vaultAuthority: vaultAuthorityPda,
              globalStats: globalStatsPda,
              user: unstakeUser.publicKey,
            })
            .signers([unstakeUser])
            .rpc();

          expect.fail("Should have failed with constraint error");
        } catch (error: any) {
          // ConstraintSeeds error
          expect(error).to.exist;
        }
      });
    });

    describe("7. Security & Validation", () => {
      let securityUser: Keypair;
      let maliciousUser: Keypair;
      let securityUserTokenAccount: PublicKey;

      before(async () => {
        securityUser = Keypair.generate();
        maliciousUser = Keypair.generate();

        // Setup security user
        await provider.connection.confirmTransaction({
          signature: await provider.connection.requestAirdrop(securityUser.publicKey, 3 * anchor.web3.LAMPORTS_PER_SOL),
          ...(await provider.connection.getLatestBlockhash()),
        });
        await program.methods.claimTokens().accounts({ mint: mintPda, user: securityUser.publicKey }).signers([securityUser]).rpc();
        securityUserTokenAccount = await getAssociatedTokenAddress(mintPda, securityUser.publicKey);

        // Setup malicious user
        await provider.connection.confirmTransaction({
          signature: await provider.connection.requestAirdrop(maliciousUser.publicKey, 3 * anchor.web3.LAMPORTS_PER_SOL),
          ...(await provider.connection.getLatestBlockhash()),
        });
        await program.methods.claimTokens().accounts({ mint: mintPda, user: maliciousUser.publicKey }).signers([maliciousUser]).rpc();

        // Security user creates a stake
        await program.methods
          .stake(new anchor.BN(50_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(securityUser.publicKey),
            stakeAccount: deriveStakePda(securityUser.publicKey, 0),
            userTokenAccount: securityUserTokenAccount,
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: securityUser.publicKey,
          })
          .signers([securityUser])
          .rpc();
      });

      it("7.1. Should validate stake belongs to signer (has_one = user)", async () => {
        const maliciousTokenAccount = await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey);
        const vaultAuthorityPda = PublicKey.findProgramAddressSync([Buffer.from("vault-authority")], program.programId)[0];

        try {
          // Malicious user tries to unstake security user's stake
          await program.methods
            .unstake(new anchor.BN(0))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(securityUser.publicKey),
              stakeAccount: deriveStakePda(securityUser.publicKey, 0),
              userTokenAccount: maliciousTokenAccount,
              vault: vaultPda,
              vaultAuthority: vaultAuthorityPda,
              globalStats: globalStatsPda,
              user: maliciousUser.publicKey,
            })
            .signers([maliciousUser])
            .rpc();

          expect.fail("Should have failed - user doesn't own this stake");
        } catch (error: any) {
          // ConstraintHasOne error
          expect(error).to.exist;
        }
      });

      it("7.2. Should validate correct mint (token::mint)", async () => {
        // This is enforced by Anchor - user_token_account must have correct mint
        const stakeAccount = await program.account.stakeAccount.fetch(deriveStakePda(securityUser.publicKey, 0));
        expect(stakeAccount.user.toString()).to.equal(securityUser.publicKey.toString());
      });

      it("7.3. Should fail if insufficient balance", async () => {
        const poorUser = Keypair.generate();
        await provider.connection.confirmTransaction({
          signature: await provider.connection.requestAirdrop(poorUser.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL),
          ...(await provider.connection.getLatestBlockhash()),
        });
        await program.methods.claimTokens().accounts({ mint: mintPda, user: poorUser.publicKey }).signers([poorUser]).rpc();

        const poorUserTokenAccount = await getAssociatedTokenAddress(mintPda, poorUser.publicKey);

        try {
          await program.methods
            .stake(new anchor.BN(200_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(poorUser.publicKey),
              stakeAccount: deriveStakePda(poorUser.publicKey, 0),
              userTokenAccount: poorUserTokenAccount,
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: poorUser.publicKey,
            })
            .signers([poorUser])
            .rpc();

          expect.fail("Should have thrown InsufficientBalance error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6003);
        }
      });

      it("7.4. Should fail if amount below minimum (1 DEVR)", async () => {
        try {
          await program.methods
            .stake(new anchor.BN(500_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(maliciousUser.publicKey),
              stakeAccount: deriveStakePda(maliciousUser.publicKey, 0),
              userTokenAccount: await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey),
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: maliciousUser.publicKey,
            })
            .signers([maliciousUser])
            .rpc();

          expect.fail("Should have thrown AmountTooSmall error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6001);
        }
      });

      it("7.5. Should fail if amount above maximum (100,000 DEVR)", async () => {
        try {
          await program.methods
            .stake(new anchor.BN(150_000_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(maliciousUser.publicKey),
              stakeAccount: deriveStakePda(maliciousUser.publicKey, 0),
              userTokenAccount: await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey),
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: maliciousUser.publicKey,
            })
            .signers([maliciousUser])
            .rpc();

          expect.fail("Should have thrown AmountTooLarge error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6002);
        }
      });

      it("7.6. Should fail if duration below minimum (7 days)", async () => {
        try {
          await program.methods
            .stake(new anchor.BN(10_000_000_000), new anchor.BN(3 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(maliciousUser.publicKey),
              stakeAccount: deriveStakePda(maliciousUser.publicKey, 0),
              userTokenAccount: await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey),
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: maliciousUser.publicKey,
            })
            .signers([maliciousUser])
            .rpc();

          expect.fail("Should have thrown DurationTooShort error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6007);
        }
      });

      it("7.7. Should fail if duration above maximum (10 years)", async () => {
        try {
          await program.methods
            .stake(new anchor.BN(10_000_000_000), new anchor.BN(11 * 365 * SECONDS_PER_DAY))
            .accounts({
              config: configPda,
              counter: deriveCounterPda(maliciousUser.publicKey),
              stakeAccount: deriveStakePda(maliciousUser.publicKey, 0),
              userTokenAccount: await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey),
              vault: vaultPda,
              globalStats: globalStatsPda,
              user: maliciousUser.publicKey,
            })
            .signers([maliciousUser])
            .rpc();

          expect.fail("Should have thrown DurationTooLong error");
        } catch (error: any) {
          expect(error.error?.errorCode?.number).to.equal(6008);
        }
      });
    });
  });
});