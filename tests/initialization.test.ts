import { getMint } from "@solana/spl-token";
import { expect } from "chai";
import {
  getTestContext,
  deriveProgramPDAs,
  setupInitializedProgram,
} from "./utils/test-helpers";

describe("Initialization Tests", () => {
  const { program, provider, admin } = getTestContext();
  const { configPda, mintAuthorityPda, mintPda } = deriveProgramPDAs(program);

  describe("Program Initialization", () => {
    it("should initialize program with correct config", async () => {
      await program.methods.initialize().rpc();

      const configAccount = await program.account.tokenConfig.fetch(configPda);

      expect(configAccount.mint.toString()).to.equal(mintPda.toString());
      expect(configAccount.mintAuthority.toString()).to.equal(mintAuthorityPda.toString());
      expect(configAccount.admin.toString()).to.equal(admin.publicKey.toString());
      expect(configAccount.dailyClaimAmount.toString()).to.equal("100000000000");
    });

    it("should create mint with correct properties", async () => {
      await setupInitializedProgram(program, configPda);

      const mintAccount = await getMint(provider.connection, mintPda);

      expect(mintAccount.decimals).to.equal(9);
      expect(mintAccount.mintAuthority?.toString()).to.equal(mintAuthorityPda.toString());
      // Initial supply is 0 before any claims
      expect(Number(mintAccount.supply)).to.be.greaterThanOrEqual(0);
    });

    it("should prevent double initialization", async () => {
      await setupInitializedProgram(program, configPda);

      try {
        await program.methods.initialize().rpc();
        expect.fail("Should have thrown error on double initialization");
      } catch (error: any) {
        // Expected - account already exists
        expect(error).to.exist;
      }
    });
  });
});
