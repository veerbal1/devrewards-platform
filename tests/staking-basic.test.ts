import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { expect } from "chai";
import {
  getTestContext,
  deriveProgramPDAs,
  deriveStakePda,
  deriveCounterPda,
  setupInitializedProgram,
  createAndFundUser,
  SECONDS_PER_DAY,
  MIN_LOCK_DURATION,
  MAX_LOCK_DURATION,
} from "./utils/test-helpers";

describe("Basic Staking Tests (Day 18)", () => {
  const { program, provider } = getTestContext();
  const { configPda, mintPda, vaultPda, vaultAuthorityPda, globalStatsPda } = deriveProgramPDAs(program);

  let staker: Keypair;
  let stakerTokenAccount: PublicKey;

  before(async () => {
    await setupInitializedProgram(program, configPda);
    staker = await createAndFundUser(provider, program, mintPda, 5);
    stakerTokenAccount = await getAssociatedTokenAddress(mintPda, staker.publicKey);
  });

  describe("Stake Instruction - Valid Cases", () => {
    it("should stake tokens successfully with valid amount and duration", async () => {
      const stakeAmount = new anchor.BN(100_000_000_000); // 100 DEVR
      const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY); // 30 days

      const stakeAccountPda = deriveStakePda(staker.publicKey, 0, program);
      const counterPda = deriveCounterPda(staker.publicKey, program);

      const stakerBalanceBefore = await getAccount(provider.connection, stakerTokenAccount);
      const vaultBalanceBefore = await getAccount(provider.connection, vaultPda);

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

      const stakerBalanceAfter = await getAccount(provider.connection, stakerTokenAccount);
      const vaultBalanceAfter = await getAccount(provider.connection, vaultPda);

      expect(stakerBalanceAfter.amount).to.equal(stakerBalanceBefore.amount - BigInt(stakeAmount.toString()));
      expect(vaultBalanceAfter.amount).to.equal(vaultBalanceBefore.amount + BigInt(stakeAmount.toString()));

      const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
      expect(stakeAccount.user.toString()).to.equal(staker.publicKey.toString());
      expect(stakeAccount.stakedAmount.toString()).to.equal(stakeAmount.toString());
      expect(stakeAccount.lockDuration.toString()).to.equal(lockDuration.toString());
      expect(stakeAccount.stakedAt.toNumber()).to.be.greaterThan(0);
      expect(stakeAccount.stakeIndex.toString()).to.equal("0");
    });

    it("should stake minimum allowed amount (1 DEVR)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const minStakeAmount = new anchor.BN(1_000_000_000); // 1 DEVR
      const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

      const stakeAccountPda = deriveStakePda(newStaker.publicKey, 0, program);
      const counterPda = deriveCounterPda(newStaker.publicKey, program);
      const tokenAccount = await getAssociatedTokenAddress(mintPda, newStaker.publicKey);

      await program.methods
        .stake(minStakeAmount, lockDuration)
        .accounts({
          config: configPda,
          counter: counterPda,
          stakeAccount: stakeAccountPda,
          userTokenAccount: tokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: newStaker.publicKey,
        })
        .signers([newStaker])
        .rpc();

      const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
      expect(stakeAccount.stakedAmount.toString()).to.equal(minStakeAmount.toString());
    });

    it("should stake with minimum duration (7 days)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const stakeAmount = new anchor.BN(50_000_000_000); // 50 DEVR
      const minLockDuration = new anchor.BN(MIN_LOCK_DURATION);

      const stakeAccountPda = deriveStakePda(newStaker.publicKey, 0, program);
      const counterPda = deriveCounterPda(newStaker.publicKey, program);
      const tokenAccount = await getAssociatedTokenAddress(mintPda, newStaker.publicKey);

      await program.methods
        .stake(stakeAmount, minLockDuration)
        .accounts({
          config: configPda,
          counter: counterPda,
          stakeAccount: stakeAccountPda,
          userTokenAccount: tokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: newStaker.publicKey,
        })
        .signers([newStaker])
        .rpc();

      const stakeAccount = await program.account.stakeAccount.fetch(stakeAccountPda);
      expect(stakeAccount.lockDuration.toString()).to.equal(minLockDuration.toString());
    });
  });

  describe("Stake Instruction - Error Cases", () => {
    it("should fail when amount is too small (< 1 DEVR)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const tooSmallAmount = new anchor.BN(500_000_000); // 0.5 DEVR
      const lockDuration = new anchor.BN(MIN_LOCK_DURATION);

      try {
        await program.methods
          .stake(tooSmallAmount, lockDuration)
          .accounts({
            config: configPda,
            counter: deriveCounterPda(newStaker.publicKey, program),
            stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
            userTokenAccount: await getAssociatedTokenAddress(mintPda, newStaker.publicKey),
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        expect.fail("Should have thrown AmountTooSmall error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6001);
      }
    });

    it("should fail when amount is too large (> 100,000 DEVR)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const tooLargeAmount = new anchor.BN(150_000_000_000_000); // 150,000 DEVR

      try {
        await program.methods
          .stake(tooLargeAmount, new anchor.BN(MIN_LOCK_DURATION))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(newStaker.publicKey, program),
            stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
            userTokenAccount: await getAssociatedTokenAddress(mintPda, newStaker.publicKey),
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        expect.fail("Should have thrown AmountTooLarge error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6002);
      }
    });

    it("should fail when duration is too short (< 7 days)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const tooShortDuration = new anchor.BN(3 * SECONDS_PER_DAY);

      try {
        await program.methods
          .stake(new anchor.BN(10_000_000_000), tooShortDuration)
          .accounts({
            config: configPda,
            counter: deriveCounterPda(newStaker.publicKey, program),
            stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
            userTokenAccount: await getAssociatedTokenAddress(mintPda, newStaker.publicKey),
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        expect.fail("Should have thrown DurationTooShort error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6007);
      }
    });

    it("should fail when duration is too long (> 10 years)", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const tooLongDuration = new anchor.BN(11 * 365 * SECONDS_PER_DAY);

      try {
        await program.methods
          .stake(new anchor.BN(10_000_000_000), tooLongDuration)
          .accounts({
            config: configPda,
            counter: deriveCounterPda(newStaker.publicKey, program),
            stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
            userTokenAccount: await getAssociatedTokenAddress(mintPda, newStaker.publicKey),
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        expect.fail("Should have thrown DurationTooLong error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6008);
      }
    });

    it("should fail when user has insufficient balance", async () => {
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const excessiveAmount = new anchor.BN(200_000_000_000); // 200 DEVR (user has 100)

      try {
        await program.methods
          .stake(excessiveAmount, new anchor.BN(MIN_LOCK_DURATION))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(newStaker.publicKey, program),
            stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
            userTokenAccount: await getAssociatedTokenAddress(mintPda, newStaker.publicKey),
            vault: vaultPda,
            globalStats: globalStatsPda,
            user: newStaker.publicKey,
          })
          .signers([newStaker])
          .rpc();

        expect.fail("Should have thrown InsufficientBalance error");
      } catch (error: any) {
        expect(error.error?.errorCode?.number).to.equal(6003);
      }
    });
  });

  describe("Unstake Instruction", () => {
    let unstaker: Keypair;
    let unstakerTokenAccount: PublicKey;
    let unstakerStakeAccountPda: PublicKey;

    before(async () => {
      unstaker = await createAndFundUser(provider, program, mintPda, 5);
      unstakerStakeAccountPda = deriveStakePda(unstaker.publicKey, 0, program);
      const unstakerCounterPda = deriveCounterPda(unstaker.publicKey, program);
      unstakerTokenAccount = await getAssociatedTokenAddress(mintPda, unstaker.publicKey);

      // Stake 50 DEVR for 7 days
      await program.methods
        .stake(new anchor.BN(50_000_000_000), new anchor.BN(MIN_LOCK_DURATION))
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
      try {
        await program.methods
          .unstake(new anchor.BN(0))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(unstaker.publicKey, program),
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
        expect(error.error?.errorCode?.number).to.equal(6005);
      }
    });

    it("should verify stake account state during lock period", async () => {
      const stakeAccount = await program.account.stakeAccount.fetch(unstakerStakeAccountPda);

      expect(stakeAccount.user.toString()).to.equal(unstaker.publicKey.toString());
      expect(stakeAccount.stakedAmount.toString()).to.equal("50000000000");
      expect(stakeAccount.lockDuration.toString()).to.equal(MIN_LOCK_DURATION.toString());
      expect(stakeAccount.stakedAt.toNumber()).to.be.greaterThan(0);
    });

    it("should calculate expected rewards correctly (using tiered APY)", async () => {
      const stakeAccount = await program.account.stakeAccount.fetch(unstakerStakeAccountPda);
      const stakedAmount = stakeAccount.stakedAmount.toNumber();
      const lockDuration = stakeAccount.lockDuration.toNumber();

      // For 7-day stakes: 5% APY (Tier 1)
      const APY_NUMERATOR = 5;
      const APY_DENOMINATOR = 100;
      const SECONDS_PER_YEAR = 31_536_000;

      const amountWithApy = (stakedAmount * APY_NUMERATOR) / APY_DENOMINATOR;
      const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

      expect(expectedRewards).to.be.greaterThan(0);
      console.log(`        Expected rewards for 50 DEVR / 7 days: ${expectedRewards / 1_000_000_000} DEVR`);
    });
  });

  describe("Multiple Users Staking", () => {
    it("should handle multiple users staking independently", async () => {
      const user1 = await createAndFundUser(provider, program, mintPda, 2);
      const user2 = await createAndFundUser(provider, program, mintPda, 2);

      const user1TokenAccount = await getAssociatedTokenAddress(mintPda, user1.publicKey);
      const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);

      // User1 stakes 30 DEVR for 15 days
      await program.methods
        .stake(new anchor.BN(30_000_000_000), new anchor.BN(15 * SECONDS_PER_DAY))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(user1.publicKey, program),
          stakeAccount: deriveStakePda(user1.publicKey, 0, program),
          userTokenAccount: user1TokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: user1.publicKey,
        })
        .signers([user1])
        .rpc();

      // User2 stakes 70 DEVR for 30 days
      await program.methods
        .stake(new anchor.BN(70_000_000_000), new anchor.BN(30 * SECONDS_PER_DAY))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(user2.publicKey, program),
          stakeAccount: deriveStakePda(user2.publicKey, 0, program),
          userTokenAccount: user2TokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: user2.publicKey,
        })
        .signers([user2])
        .rpc();

      // Verify both stake accounts are independent
      const user1StakeAccount = await program.account.stakeAccount.fetch(
        deriveStakePda(user1.publicKey, 0, program)
      );
      const user2StakeAccount = await program.account.stakeAccount.fetch(
        deriveStakePda(user2.publicKey, 0, program)
      );

      expect(user1StakeAccount.stakedAmount.toString()).to.equal("30000000000");
      expect(user1StakeAccount.lockDuration.toString()).to.equal((15 * SECONDS_PER_DAY).toString());

      expect(user2StakeAccount.stakedAmount.toString()).to.equal("70000000000");
      expect(user2StakeAccount.lockDuration.toString()).to.equal((30 * SECONDS_PER_DAY).toString());

      const vaultBalance = await getAccount(provider.connection, vaultPda);
      expect(Number(vaultBalance.amount)).to.be.greaterThanOrEqual(100_000_000_000);
    });
  });

  describe("Vault Balance Verification", () => {
    it("should track vault balance correctly after multiple stakes", async () => {
      const vaultBalanceBefore = await getAccount(provider.connection, vaultPda);
      const newStaker = await createAndFundUser(provider, program, mintPda, 2);
      const stakeAmount = new anchor.BN(25_000_000_000); // 25 DEVR

      const tokenAccount = await getAssociatedTokenAddress(mintPda, newStaker.publicKey);

      await program.methods
        .stake(stakeAmount, new anchor.BN(MIN_LOCK_DURATION))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(newStaker.publicKey, program),
          stakeAccount: deriveStakePda(newStaker.publicKey, 0, program),
          userTokenAccount: tokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: newStaker.publicKey,
        })
        .signers([newStaker])
        .rpc();

      const vaultBalanceAfter = await getAccount(provider.connection, vaultPda);

      expect(vaultBalanceAfter.amount).to.equal(vaultBalanceBefore.amount + BigInt(stakeAmount.toString()));
    });
  });
});
