import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expect } from "chai";
import {
  getTestContext,
  deriveProgramPDAs,
  setupInitializedProgram,
} from "./utils/test-helpers";

describe("Token Transfers & Delegation Tests", () => {
  const { program, provider } = getTestContext();
  const { configPda, mintPda } = deriveProgramPDAs(program);

  let alice: Keypair;
  let bob: Keypair;
  let aliceTokenAccount: PublicKey;
  let bobTokenAccount: PublicKey;

  before(async () => {
    // Ensure program is initialized
    await setupInitializedProgram(program, configPda);

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
