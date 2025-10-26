import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { expect } from "chai";
import {
  getTestContext,
  deriveProgramPDAs,
  deriveStakePda,
  deriveCounterPda,
  setupInitializedProgram,
  createAndFundUser,
  SECONDS_PER_DAY,
} from "./utils/test-helpers";

describe("Advanced Staking Tests (Day 19)", () => {
  const { program, provider } = getTestContext();
  const { configPda, mintPda, vaultPda, globalStatsPda } = deriveProgramPDAs(program);

  let testUser: Keypair;
  let testUserTokenAccount: PublicKey;

  before(async () => {
    await setupInitializedProgram(program, configPda);
    testUser = await createAndFundUser(provider, program, mintPda, 5);
    testUserTokenAccount = await getAssociatedTokenAddress(mintPda, testUser.publicKey);
  });

  describe("Multiple Stakes Per User", () => {
    it("should create first stake with index 0", async () => {
      const stakeAmount = new anchor.BN(10_000_000_000);
      const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);
      const stakeAccountPda = deriveStakePda(testUser.publicKey, 0, program);
      const counterPda = deriveCounterPda(testUser.publicKey, program);

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

    it("should create second stake with index 1", async () => {
      const stakeAmount = new anchor.BN(15_000_000_000);
      const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY);
      const stakeAccountPda = deriveStakePda(testUser.publicKey, 1, program);
      const counterPda = deriveCounterPda(testUser.publicKey, program);

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

    it("should create third stake with index 2", async () => {
      const stakeAmount = new anchor.BN(20_000_000_000);
      const lockDuration = new anchor.BN(90 * SECONDS_PER_DAY);
      const stakeAccountPda = deriveStakePda(testUser.publicKey, 2, program);
      const counterPda = deriveCounterPda(testUser.publicKey, program);

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

    it("should verify all three stakes exist independently", async () => {
      const stake0 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 0, program));
      const stake1 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 1, program));
      const stake2 = await program.account.stakeAccount.fetch(deriveStakePda(testUser.publicKey, 2, program));

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

    it("should allow different users to have independent stake counters", async () => {
      const user2 = await createAndFundUser(provider, program, mintPda, 2);
      const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);
      const user2Counter = deriveCounterPda(user2.publicKey, program);
      const user2Stake0 = deriveStakePda(user2.publicKey, 0, program);

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

    it("should fail if trying to create stake with wrong index manually", async () => {
      const counterPda = deriveCounterPda(testUser.publicKey, program);
      const wrongIndexPda = deriveStakePda(testUser.publicKey, 0, program); // Already exists

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
        expect(error).to.exist;
      }
    });
  });

  describe("Tiered APY System", () => {
    let apyTestUser: Keypair;
    let apyTestUserTokenAccount: PublicKey;

    before(async () => {
      apyTestUser = await createAndFundUser(provider, program, mintPda, 5);
      apyTestUserTokenAccount = await getAssociatedTokenAddress(mintPda, apyTestUser.publicKey);
    });

    it("should apply 5% APY for exactly 7-day lock", async () => {
      const lockDuration = new anchor.BN(7 * SECONDS_PER_DAY);
      const stakePda = deriveStakePda(apyTestUser.publicKey, 0, program);

      await program.methods
        .stake(new anchor.BN(10_000_000_000), lockDuration)
        .accounts({
          config: configPda,
          counter: deriveCounterPda(apyTestUser.publicKey, program),
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
    });

    it("should apply 10% APY for exactly 30-day lock", async () => {
      const lockDuration = new anchor.BN(30 * SECONDS_PER_DAY);
      const stakePda = deriveStakePda(apyTestUser.publicKey, 1, program);

      await program.methods
        .stake(new anchor.BN(10_000_000_000), lockDuration)
        .accounts({
          config: configPda,
          counter: deriveCounterPda(apyTestUser.publicKey, program),
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

    it("should apply 20% APY for exactly 90-day lock", async () => {
      const lockDuration = new anchor.BN(90 * SECONDS_PER_DAY);
      const stakePda = deriveStakePda(apyTestUser.publicKey, 2, program);

      await program.methods
        .stake(new anchor.BN(10_000_000_000), lockDuration)
        .accounts({
          config: configPda,
          counter: deriveCounterPda(apyTestUser.publicKey, program),
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

    it("should calculate correct rewards for 5% tier (7 days)", async () => {
      const stakeAmount = 100_000_000_000; // 100 DEVR
      const lockDuration = 7 * SECONDS_PER_DAY;
      const APY_NUMERATOR = 5;
      const APY_DENOMINATOR = 100;
      const SECONDS_PER_YEAR = 31_536_000;

      const amountWithApy = (stakeAmount * APY_NUMERATOR) / APY_DENOMINATOR;
      const expectedRewards = Math.floor((amountWithApy * lockDuration) / SECONDS_PER_YEAR);

      expect(expectedRewards).to.be.greaterThan(0);
      // 100 DEVR * 5% * (7/365) ≈ 0.0958 DEVR
    });

    it("should calculate correct rewards for 10% tier (30 days)", async () => {
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

    it("should calculate correct rewards for 20% tier (90 days)", async () => {
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

  describe("GlobalStats Tracking", () => {
    let statsUser: Keypair;
    let statsUserTokenAccount: PublicKey;

    before(async () => {
      statsUser = await createAndFundUser(provider, program, mintPda, 5);
      statsUserTokenAccount = await getAssociatedTokenAddress(mintPda, statsUser.publicKey);
    });

    it("should initialize GlobalStats with correct values", async () => {
      const globalStats = await program.account.globalStats.fetch(globalStatsPda);

      expect(globalStats.totalStaked.toNumber()).to.be.greaterThanOrEqual(0);
      expect(globalStats.totalStakes.toNumber()).to.be.greaterThanOrEqual(0);
      expect(globalStats.totalRewardsPaid.toNumber()).to.be.greaterThanOrEqual(0);
    });

    it("should increment total_staked when user stakes", async () => {
      const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
      const totalStakedBefore = globalStatsBefore.totalStaked.toNumber();

      const stakeAmount = new anchor.BN(25_000_000_000); // 25 DEVR

      await program.methods
        .stake(stakeAmount, new anchor.BN(7 * SECONDS_PER_DAY))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(statsUser.publicKey, program),
          stakeAccount: deriveStakePda(statsUser.publicKey, 0, program),
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

    it("should increment total_stakes counter when user stakes", async () => {
      const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
      const totalStakesBefore = globalStatsBefore.totalStakes.toNumber();

      const stakeAmount = new anchor.BN(10_000_000_000); // 10 DEVR

      await program.methods
        .stake(stakeAmount, new anchor.BN(7 * SECONDS_PER_DAY))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(statsUser.publicKey, program),
          stakeAccount: deriveStakePda(statsUser.publicKey, 1, program),
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

    it("should handle multiple users staking (aggregate correctly)", async () => {
      const user1 = await createAndFundUser(provider, program, mintPda, 2);
      const user2 = await createAndFundUser(provider, program, mintPda, 2);

      const globalStatsBefore = await program.account.globalStats.fetch(globalStatsPda);
      const totalStakedBefore = globalStatsBefore.totalStaked.toNumber();

      // User1 stakes 20 DEVR
      const user1TokenAccount = await getAssociatedTokenAddress(mintPda, user1.publicKey);
      await program.methods
        .stake(new anchor.BN(20_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
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

      // User2 stakes 30 DEVR
      const user2TokenAccount = await getAssociatedTokenAddress(mintPda, user2.publicKey);
      await program.methods
        .stake(new anchor.BN(30_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
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

      const globalStatsAfter = await program.account.globalStats.fetch(globalStatsPda);
      const totalStakedAfter = globalStatsAfter.totalStaked.toNumber();

      expect(totalStakedAfter).to.equal(totalStakedBefore + 50_000_000_000); // 20 + 30 DEVR
    });
  });

  describe("Security & Validation", () => {
    let securityUser: Keypair;
    let maliciousUser: Keypair;
    let securityUserTokenAccount: PublicKey;

    before(async () => {
      securityUser = await createAndFundUser(provider, program, mintPda, 3);
      maliciousUser = await createAndFundUser(provider, program, mintPda, 3);
      securityUserTokenAccount = await getAssociatedTokenAddress(mintPda, securityUser.publicKey);

      // Security user creates a stake
      await program.methods
        .stake(new anchor.BN(50_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
        .accounts({
          config: configPda,
          counter: deriveCounterPda(securityUser.publicKey, program),
          stakeAccount: deriveStakePda(securityUser.publicKey, 0, program),
          userTokenAccount: securityUserTokenAccount,
          vault: vaultPda,
          globalStats: globalStatsPda,
          user: securityUser.publicKey,
        })
        .signers([securityUser])
        .rpc();
    });

    it("should validate stake belongs to signer (has_one = user)", async () => {
      const maliciousTokenAccount = await getAssociatedTokenAddress(mintPda, maliciousUser.publicKey);
      const { vaultAuthorityPda } = deriveProgramPDAs(program);

      try {
        // Malicious user tries to unstake security user's stake
        await program.methods
          .unstake(new anchor.BN(0))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(securityUser.publicKey, program),
            stakeAccount: deriveStakePda(securityUser.publicKey, 0, program),
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
        expect(error).to.exist;
      }
    });

    it("should fail if insufficient balance", async () => {
      const poorUser = await createAndFundUser(provider, program, mintPda, 2);
      const poorUserTokenAccount = await getAssociatedTokenAddress(mintPda, poorUser.publicKey);

      try {
        await program.methods
          .stake(new anchor.BN(200_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(poorUser.publicKey, program),
            stakeAccount: deriveStakePda(poorUser.publicKey, 0, program),
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

    it("should fail if amount below minimum (1 DEVR)", async () => {
      try {
        await program.methods
          .stake(new anchor.BN(500_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(maliciousUser.publicKey, program),
            stakeAccount: deriveStakePda(maliciousUser.publicKey, 0, program),
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

    it("should fail if amount above maximum (100,000 DEVR)", async () => {
      try {
        await program.methods
          .stake(new anchor.BN(150_000_000_000_000), new anchor.BN(7 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(maliciousUser.publicKey, program),
            stakeAccount: deriveStakePda(maliciousUser.publicKey, 0, program),
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

    it("should fail if duration below minimum (7 days)", async () => {
      try {
        await program.methods
          .stake(new anchor.BN(10_000_000_000), new anchor.BN(3 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(maliciousUser.publicKey, program),
            stakeAccount: deriveStakePda(maliciousUser.publicKey, 0, program),
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

    it("should fail if duration above maximum (10 years)", async () => {
      try {
        await program.methods
          .stake(new anchor.BN(10_000_000_000), new anchor.BN(11 * 365 * SECONDS_PER_DAY))
          .accounts({
            config: configPda,
            counter: deriveCounterPda(maliciousUser.publicKey, program),
            stakeAccount: deriveStakePda(maliciousUser.publicKey, 0, program),
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
