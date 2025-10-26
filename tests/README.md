# DevRewards Platform Test Suite

This directory contains the test suite for the DevRewards Platform, organized into multiple focused test files for better maintainability and clarity.

## Test Structure

### Core Test Files

#### `initialization.test.ts`
Tests for program initialization functionality:
- Program config initialization
- Mint creation and properties
- Double initialization prevention

#### `token-claims.test.ts`
Tests for token claiming functionality:
- First-time token claims
- 24-hour cooldown enforcement
- Total claimed amount tracking
- Multi-user claim independence
- State verification (supply, timestamps)

#### `transfers.test.ts`
Tests for token transfers and delegation:
- **P2P Transfers**
  - Basic token transfers
  - Amount validation (min/max)
  - Insufficient balance handling
- **Delegation Pattern**
  - Delegate approval
  - Delegated transfers
  - Delegation limits
  - Delegation revocation

#### `staking-basic.test.ts` (Day 18)
Basic staking functionality tests:
- **Stake Instruction - Valid Cases**
  - Successful staking with valid parameters
  - Minimum amount staking (1 DEVR)
  - Minimum duration staking (7 days)
- **Stake Instruction - Error Cases**
  - Amount too small/large validation
  - Duration too short/long validation
  - Insufficient balance handling
- **Unstake Instruction**
  - Lock period enforcement
  - Stake account state verification
  - Reward calculations
- **Multi-User Staking**
  - Independent user stakes
  - Vault balance tracking

#### `staking-advanced.test.ts` (Day 19)
Advanced staking features and comprehensive tests:
- **Multiple Stakes Per User**
  - Index-based stake tracking
  - Multiple concurrent stakes
  - Independent user counters
  - Stake index validation
- **Tiered APY System**
  - 5% APY for 7-29 day locks
  - 10% APY for 30-89 day locks
  - 20% APY for 90+ day locks
  - APY-based reward calculations
- **GlobalStats Tracking**
  - Total staked amount tracking
  - Total stakes counter
  - Total rewards paid tracking
  - Multi-user aggregation
- **Security & Validation**
  - Ownership validation
  - Balance verification
  - Amount/duration constraints
  - Malicious action prevention

### Utility Files

#### `utils/test-helpers.ts`
Shared utilities and helper functions:
- **Context & Setup**
  - `getTestContext()` - Get program, provider, and admin
  - `setupInitializedProgram()` - Ensure program initialization
- **PDA Derivation**
  - `deriveProgramPDAs()` - Derive all program-level PDAs
  - `deriveStakePda()` - Derive stake account PDA
  - `deriveCounterPda()` - Derive stake counter PDA
  - `deriveUserClaimPda()` - Derive user claim PDA
- **User Management**
  - `createAndFundUser()` - Create user with SOL and tokens
  - `createAndFundUserWithoutTokens()` - Create user with only SOL
- **Constants**
  - `SECONDS_PER_DAY`, `MIN_LOCK_DURATION`, `MAX_LOCK_DURATION`

## Running Tests

### Run all tests
```bash
anchor test
```

### Run specific test file
```bash
anchor test --test-file initialization.test.ts
anchor test --test-file token-claims.test.ts
anchor test --test-file transfers.test.ts
anchor test --test-file staking-basic.test.ts
anchor test --test-file staking-advanced.test.ts
```

### Run tests in watch mode
```bash
npm run test:watch
```

## Test Organization Benefits

1. **Modularity**: Each file focuses on a specific feature area
2. **Maintainability**: Easier to locate and update tests
3. **Readability**: Smaller files are easier to understand
4. **Performance**: Can run specific test suites independently
5. **Reusability**: Shared utilities reduce code duplication
6. **Scalability**: Easy to add new test files as features grow

## Migration from Original

The original `devrewards-platform.ts` file has been refactored into this modular structure. If you need the original file for reference, it has been renamed to `devrewards-platform.ts.backup`.

## Adding New Tests

When adding new tests:
1. Determine which file the test belongs to (or create a new file)
2. Import necessary utilities from `utils/test-helpers.ts`
3. Use shared helper functions to reduce boilerplate
4. Follow existing patterns for consistency
5. Update this README if adding new test files
