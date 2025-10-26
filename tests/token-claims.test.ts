import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, getMint } from "@solana/spl-token";
import { expect } from "chai";
import {
  getTestContext,
  deriveProgramPDAs,
  deriveUserClaimPda,
  setupInitializedProgram,
} from "./utils/test-helpers";

describe("Token Claims Tests", () => {
  const { program, provider, admin } = getTestContext();
  const { configPda, mintPda } = deriveProgramPDAs(program);

  beforeEach(async () => {
    await setupInitializedProgram(program, configPda);
  });

  describe("Token Claims", () => {
    it("should allow user to claim tokens for the first time", async () => {
      const user = admin;
      const userClaimPda = deriveUserClaimPda(user.publicKey, program);
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
      try {
        await program.methods
          .claimTokens()
          .accounts({
            mint: mintPda,
            user: user.publicKey,
          })
          .rpc();
      } catch (error: any) {
        // Only acceptable if already claimed (cooldown error)
        if (error.error?.errorCode?.number !== 6000) {
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
      const userClaimPda = deriveUserClaimPda(user.publicKey, program);

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
      const userAClaimPda = deriveUserClaimPda(userA.publicKey, program);

      // User B: new keypair
      const userB = Keypair.generate();
      const userBClaimPda = deriveUserClaimPda(userB.publicKey, program);

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
      const userClaimPda = deriveUserClaimPda(user.publicKey, program);

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
});
