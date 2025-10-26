import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { DevrewardsPlatform } from "../../target/types/devrewards_platform";
import { PublicKey, Keypair } from "@solana/web3.js";

export const SECONDS_PER_DAY = 86400;
export const MIN_LOCK_DURATION = 7 * SECONDS_PER_DAY; // 7 days
export const MAX_LOCK_DURATION = 10 * 365 * SECONDS_PER_DAY; // 10 years

/**
 * Gets the program, provider, and admin wallet
 */
export function getTestContext() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.DevrewardsPlatform as Program<DevrewardsPlatform>;
  const admin = provider.wallet as anchor.Wallet;

  return { program, provider, admin };
}

/**
 * Derives all program-level PDAs
 */
export function deriveProgramPDAs(program: Program<DevrewardsPlatform>) {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint-authority")],
    program.programId
  );

  const [mintPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("devr-mint")],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority")],
    program.programId
  );

  const [globalStatsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-stats")],
    program.programId
  );

  return {
    configPda,
    mintAuthorityPda,
    mintPda,
    vaultPda,
    vaultAuthorityPda,
    globalStatsPda,
  };
}

/**
 * Derives stake account PDA for a user
 */
export function deriveStakePda(
  user: PublicKey,
  stakeCount: number,
  program: Program<DevrewardsPlatform>
): PublicKey {
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

/**
 * Derives stake counter PDA for a user
 */
export function deriveCounterPda(
  user: PublicKey,
  program: Program<DevrewardsPlatform>
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake-counter"), user.toBuffer()],
    program.programId
  );
  return pda;
}

/**
 * Derives user claim PDA
 */
export function deriveUserClaimPda(
  user: PublicKey,
  program: Program<DevrewardsPlatform>
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user-claim"), user.toBuffer()],
    program.programId
  );
  return pda;
}

/**
 * Ensures the program is initialized (safe to call multiple times)
 */
export async function setupInitializedProgram(
  program: Program<DevrewardsPlatform>,
  configPda: PublicKey
) {
  try {
    await program.account.tokenConfig.fetch(configPda);
    // Already initialized, skip
  } catch {
    // Not initialized yet, initialize now
    await program.methods.initialize().rpc();
  }
}

/**
 * Creates and funds a new test user with SOL and claims tokens
 */
export async function createAndFundUser(
  provider: anchor.AnchorProvider,
  program: Program<DevrewardsPlatform>,
  mintPda: PublicKey,
  solAmount: number = 5
): Promise<Keypair> {
  const user = Keypair.generate();

  // Airdrop SOL
  const airdrop = await provider.connection.requestAirdrop(
    user.publicKey,
    solAmount * anchor.web3.LAMPORTS_PER_SOL
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
      user: user.publicKey,
    })
    .signers([user])
    .rpc();

  return user;
}

/**
 * Creates and funds a user with only SOL (no token claim)
 */
export async function createAndFundUserWithoutTokens(
  provider: anchor.AnchorProvider,
  solAmount: number = 2
): Promise<Keypair> {
  const user = Keypair.generate();

  const airdrop = await provider.connection.requestAirdrop(
    user.publicKey,
    solAmount * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction({
    signature: airdrop,
    ...(await provider.connection.getLatestBlockhash()),
  });

  return user;
}
