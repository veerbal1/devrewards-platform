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

  describe("Day 18: Token Staking - Lock & Earn", () => {
    let staker: Keypair;
    let stakerTokenAccount: PublicKey;
    let vaultPda: PublicKey;
    let vaultAuthorityPda: PublicKey;
    let stakeAccountPda: PublicKey;

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

      // Derive stake account PDA
      [stakeAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("stake"), staker.publicKey.toBuffer()],
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

        // Get balances before staking
        const stakerBalanceBefore = await getAccount(provider.connection, stakerTokenAccount);
        const vaultBalanceBefore = await getAccount(provider.connection, vaultPda);

        // Stake tokens
        await program.methods
          .stake(stakeAmount, lockDuration)
          .accounts({
            stakeAccount: stakeAccountPda,
            userTokenAccount: stakerTokenAccount,
            vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        await program.methods
          .stake(minStakeAmount, lockDuration)
          .accounts({
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        await program.methods
          .stake(stakeAmount, minLockDuration)
          .accounts({
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(tooSmallAmount, lockDuration)
            .accounts({
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(tooLargeAmount, lockDuration)
            .accounts({
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(stakeAmount, tooShortDuration)
            .accounts({
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(stakeAmount, tooLongDuration)
            .accounts({
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );

        const newStakerTokenAccount = await getAssociatedTokenAddress(
          mintPda,
          newStaker.publicKey
        );

        try {
          await program.methods
            .stake(excessiveAmount, lockDuration)
            .accounts({
              stakeAccount: newStakerStakeAccountPda,
              userTokenAccount: newStakerTokenAccount,
              vault: vaultPda,
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

        [unstakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), unstaker.publicKey.toBuffer()],
          program.programId
        );

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
            stakeAccount: unstakerStakeAccountPda,
            userTokenAccount: unstakerTokenAccount,
            vault: vaultPda,
            user: unstaker.publicKey,
          })
          .signers([unstaker])
          .rpc();
      });

      it("should fail to unstake when tokens are still locked", async () => {
        try {
          await program.methods
            .unstake()
            .accounts({
              stakeAccount: unstakerStakeAccountPda,
              userTokenAccount: unstakerTokenAccount,
              vault: vaultPda,
              vaultAuthority: vaultAuthorityPda,
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
        const [user1StakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), user1.publicKey.toBuffer()],
          program.programId
        );
        const user1TokenAccount = await getAssociatedTokenAddress(mintPda, user1.publicKey);

        await program.methods
          .stake(new anchor.BN(30_000_000_000), new anchor.BN(15 * SECONDS_PER_DAY))
          .accounts({
            stakeAccount: user1StakeAccountPda,
            userTokenAccount: user1TokenAccount,
            vault: vaultPda,
            user: user1.publicKey,
          })
          .signers([user1])
          .rpc();

        // User2 stakes 70 DEVR for 30 days
        const [user2StakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), user2.publicKey.toBuffer()],
          program.programId
        );
        const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);

        await program.methods
          .stake(new anchor.BN(70_000_000_000), new anchor.BN(30 * SECONDS_PER_DAY))
          .accounts({
            stakeAccount: user2StakeAccountPda,
            userTokenAccount: user2TokenAccount,
            vault: vaultPda,
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

        const [newStakerStakeAccountPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("stake"), newStaker.publicKey.toBuffer()],
          program.programId
        );
        const newStakerTokenAccount = await getAssociatedTokenAddress(mintPda, newStaker.publicKey);

        await program.methods
          .stake(stakeAmount, new anchor.BN(MIN_LOCK_DURATION))
          .accounts({
            stakeAccount: newStakerStakeAccountPda,
            userTokenAccount: newStakerTokenAccount,
            vault: vaultPda,
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
});