# Wallet Backend Technical Report

**Project**: Tempwallets.com Backend  
**Framework**: NestJS (TypeScript)  
**Database**: PostgreSQL with Prisma ORM  
**Date**: October 30, 2025  
**Architecture**: Multi-Chain Wallet Backend using Tetherto WDK

---

## 1. Overview

### 1.1 Purpose
This backend service provides a secure, multi-chain cryptocurrency wallet management system. It allows users to:
- Create or import wallet seed phrases (mnemonic)
- Manage wallets across multiple blockchain networks (Ethereum, Bitcoin, Solana, Tron, and ERC-4337 Account Abstraction wallets)
- Query wallet addresses and balances
- Securely store encrypted seed phrases using AES-256-GCM encryption

### 1.2 Technology Stack
- **Runtime**: Node.js with ES Modules
- **Framework**: NestJS v11.0.1 (Enterprise-grade TypeScript framework)
- **Language**: TypeScript 5.7.3
- **Database**: PostgreSQL
- **ORM**: Prisma v6.18.0
- **Blockchain SDKs**: Tetherto WDK (Wallet Development Kit) suite
  - `@tetherto/wdk`: Core wallet SDK
  - `@tetherto/wdk-wallet-evm`: Ethereum Virtual Machine wallets
  - `@tetherto/wdk-wallet-btc`: Bitcoin wallets
  - `@tetherto/wdk-wallet-solana`: Solana wallets
  - `@tetherto/wdk-wallet-tron`: Tron wallets
  - `@tetherto/wdk-wallet-evm-erc-4337`: ERC-4337 Account Abstraction wallets
- **Validation**: class-validator & class-transformer
- **Encryption**: Node.js native `crypto` module (AES-256-GCM)

### 1.3 Core Capabilities
1. **Seed Management**: Generate random or import existing BIP-39 mnemonic phrases
2. **Multi-Chain Support**: Unified interface for 8+ blockchain networks
3. **Secure Storage**: AES-256-GCM authenticated encryption for seed phrases
4. **Account Abstraction**: ERC-4337 support with paymaster integration for gasless transactions
5. **Balance Queries**: Real-time balance fetching across all supported chains

---

## 2. Folder Structure & File Responsibilities

```
apps/backend/
├── src/
│   ├── main.ts                          # Application entry point & bootstrap
│   ├── app.module.ts                     # Root application module
│   │
│   ├── crypto/                           # Encryption services
│   │   ├── crypto.module.ts              # Crypto module definition
│   │   └── encryption.service.ts         # AES-256-GCM encryption/decryption
│   │
│   ├── database/                         # Database layer
│   │   ├── prisma.module.ts              # Prisma module definition
│   │   └── prisma.service.ts             # Prisma client with connection management
│   │
│   └── wallet/                           # Wallet management feature
│       ├── wallet.module.ts              # Wallet module definition
│       ├── wallet.controller.ts          # HTTP REST API endpoints
│       ├── wallet.service.ts             # Business logic & blockchain interactions
│       ├── seed.repository.ts            # Data access layer for seed storage
│       └── dto/
│           └── wallet.dto.ts             # Data Transfer Objects & validation
│
├── prisma/
│   ├── schema.prisma                     # Database schema definition
│   └── migrations/                       # Database migration history
│
├── test/                                 # E2E test suite
├── package.json                          # Dependencies & scripts
├── tsconfig.json                         # TypeScript configuration
└── nest-cli.json                         # NestJS CLI configuration
```

### 2.1 File Responsibilities

#### **`src/main.ts`** - Application Bootstrap
- **Purpose**: Entry point that initializes the NestJS application
- **Key Functions**:
  - Creates NestJS application instance
  - Configures CORS for frontend communication (ports 3000, 5555, 5173)
  - Enables global validation pipes for automatic DTO validation
  - Starts HTTP server on port 5005 (or PORT env variable)
- **Dependencies**: `@nestjs/core`, `@nestjs/common`

#### **`src/app.module.ts`** - Root Module
- **Purpose**: Aggregates all feature modules and global configurations
- **Imports**:
  - `ConfigModule`: Loads environment variables from `.env` file (globally available)
  - `PrismaModule`: Database connection and ORM
  - `WalletModule`: Wallet management features
- **Pattern**: Follows NestJS modular architecture

#### **`src/database/prisma.service.ts`** - Database Client
- **Purpose**: Manages PostgreSQL connection lifecycle
- **Key Features**:
  - Extends `PrismaClient` for database operations
  - Implements lifecycle hooks (`OnModuleInit`, `OnModuleDestroy`)
  - Auto-reconnect logic with retry mechanism (10 attempts, 2s delay)
  - Logging for connection events
- **Methods**:
  - `onModuleInit()`: Establishes database connection with retry
  - `onModuleDestroy()`: Gracefully disconnects from database
  - `connectWithRetry()`: Retry logic for connection failures

#### **`src/database/prisma.module.ts`** - Database Module
- **Purpose**: Exports `PrismaService` for dependency injection across the app
- **Pattern**: Standard NestJS module pattern

#### **`src/crypto/encryption.service.ts`** - Encryption Service
- **Purpose**: Provides AES-256-GCM authenticated encryption for sensitive data
- **Algorithm**: `aes-256-gcm` (Galois/Counter Mode - provides authenticity + confidentiality)
- **Key Management**: 
  - Reads 32-byte encryption key from `WALLET_ENC_KEY` env variable (base64 encoded)
  - Key validation on service initialization
- **Methods**:
  - `encrypt(plaintext: string)`: Returns `{ ciphertext, iv, authTag }`
    - Generates random 16-byte IV per encryption (prevents pattern attacks)
    - Returns hex-encoded ciphertext with authentication tag
  - `decrypt(encryptedData)`: Verifies auth tag and decrypts ciphertext
    - Throws error if data has been tampered with (auth tag mismatch)
- **Security Features**:
  - Authenticated encryption (prevents tampering)
  - Unique IV per encryption (prevents replay attacks)
  - Secure random IV generation

#### **`src/crypto/crypto.module.ts`** - Crypto Module
- **Purpose**: Exports `EncryptionService` for dependency injection
- **Imports**: `ConfigModule` to access environment variables

#### **`src/wallet/dto/wallet.dto.ts`** - Data Transfer Objects
- **Purpose**: Defines API request validation schemas
- **DTOs**:
  ```typescript
  CreateOrImportSeedDto:
    - userId: string (required)
    - mode: 'random' | 'mnemonic' (required)
    - mnemonic?: string (required if mode='mnemonic')
  ```
- **Validation**:
  - Uses `class-validator` decorators
  - `@ValidateIf`: Conditional validation (mnemonic required only if mode='mnemonic')
  - Automatic validation via global ValidationPipe in `main.ts`

#### **`src/wallet/seed.repository.ts`** - Data Access Layer
- **Purpose**: Abstracts database operations for wallet seed management
- **Dependencies**: `PrismaService`, `EncryptionService`
- **Methods**:
  - `createOrUpdateSeed(userId, seedPhrase)`:
    - Encrypts seed phrase using `EncryptionService`
    - Upserts to `WalletSeed` table (creates or updates)
    - Stores ciphertext, iv, authTag separately
  - `getSeedPhrase(userId)`:
    - Retrieves encrypted seed from database
    - Decrypts using `EncryptionService`
    - Throws `NotFoundException` if no seed exists
  - `hasSeed(userId)`: Checks if user has stored seed
  - `deleteSeed(userId)`: Removes user's seed from database
- **Pattern**: Repository pattern for clean separation of concerns

#### **`src/wallet/wallet.service.ts`** - Business Logic Layer
- **Purpose**: Core wallet management logic and blockchain interactions
- **Dependencies**: `SeedRepository`, `ConfigService`
- **Key Methods**:

  1. **`createOrImportSeed(userId, mode, mnemonic?)`**
     - Generates random seed using `WDK.getRandomSeedPhrase()` OR
     - Validates and imports user-provided mnemonic (12 or 24 words)
     - Delegates storage to `SeedRepository`

  2. **`getAddresses(userId)`**
     - Retrieves decrypted seed phrase
     - Creates WDK instance with registered wallet managers
     - Fetches addresses for all chains:
       - `ethereum`: Standard Ethereum address
       - `tron`: Tron address
       - `bitcoin`: Bitcoin address
       - `solana`: Solana address
       - `ethereumErc4337`: Ethereum ERC-4337 smart account
       - `baseErc4337`: Base ERC-4337 smart account
       - `arbitrumErc4337`: Arbitrum ERC-4337 smart account
       - `polygonErc4337`: Polygon ERC-4337 smart account
     - Error handling: Returns null for chains that fail

  3. **`getBalances(userId)`**
     - Similar to `getAddresses` but fetches balance for each chain
     - Returns array of `{ chain, balance }` objects
     - Balance returned as string to preserve precision
     - Graceful error handling: Returns '0' for failed chains

  4. **`getErc4337PaymasterBalances(userId)`**
     - Fetches paymaster token balances for ERC-4337 wallets
     - Checks if `getPaymasterTokenBalance()` method exists
     - Returns balances for Ethereum, Base, Arbitrum, Polygon

  5. **`createWdkInstance(seedPhrase)` (private)**
     - **Core blockchain integration method**
     - Creates WDK instance and registers all wallet managers
     - Configuration per chain:
       - **Ethereum**: RPC URL, EntryPoint, Bundler, Paymaster
       - **Tron**: Trongrid API
       - **Bitcoin**: Blockstream API
       - **Solana**: Mainnet RPC
       - **ERC-4337 chains**: Extensive config (chainId, bundler, paymaster, Safe modules)
     - Reads configuration from environment variables with fallback defaults

- **WDK Registration Pattern**:
  ```typescript
  new WDK(seedPhrase)
    .registerWallet('ethereum', WalletManagerEvm, { provider: 'https://...' })
    .registerWallet('tron', WalletManagerTron, { provider: 'https://...' })
    // ... more chains
  ```

#### **`src/wallet/wallet.controller.ts`** - HTTP API Layer
- **Purpose**: Exposes REST API endpoints for wallet operations
- **Base Route**: `/wallet`
- **Dependencies**: `WalletService`
- **Endpoints**:

  1. **`POST /wallet/seed`**
     - **Purpose**: Create or import wallet seed phrase
     - **Body**: `CreateOrImportSeedDto`
     - **Flow**: Validates DTO → `WalletService.createOrImportSeed()` → Response
     - **Response**: `{ ok: true }`
     - **Logging**: Logs creation/import events and errors

  2. **`GET /wallet/addresses?userId=xxx`**
     - **Purpose**: Retrieve all wallet addresses
     - **Query Param**: `userId` (string)
     - **Flow**: Validates userId → `WalletService.getAddresses()` → Returns addresses object
     - **Response**: `WalletAddresses` object with all chain addresses

  3. **`GET /wallet/balances?userId=xxx`**
     - **Purpose**: Retrieve all wallet balances
     - **Query Param**: `userId` (string)
     - **Flow**: Validates userId → `WalletService.getBalances()` → Returns balance array
     - **Response**: `Array<{ chain: string, balance: string }>`

  4. **`GET /wallet/erc4337/paymaster-balances?userId=xxx`**
     - **Purpose**: Retrieve ERC-4337 paymaster token balances
     - **Query Param**: `userId` (string)
     - **Flow**: Validates userId → `WalletService.getErc4337PaymasterBalances()`
     - **Response**: `Array<{ chain: string, balance: string }>`

- **Error Handling**: Catches and logs errors, re-throws for NestJS exception filters

#### **`src/wallet/wallet.module.ts`** - Wallet Feature Module
- **Purpose**: Encapsulates all wallet-related functionality
- **Imports**: `PrismaModule`, `CryptoModule`
- **Providers**: `WalletService`, `SeedRepository`
- **Controllers**: `WalletController`
- **Exports**: `WalletService`, `SeedRepository` (available for other modules)

---

## 3. API Endpoints Overview

### Base URL
```
http://localhost:5005/wallet
```

### 3.1 Create or Import Seed
**Endpoint**: `POST /wallet/seed`

**Purpose**: Generate a random seed phrase or import an existing mnemonic

**Request Body**:
```json
{
  "userId": "user123",
  "mode": "random"  // or "mnemonic"
}
```

**For Import Mode**:
```json
{
  "userId": "user123",
  "mode": "mnemonic",
  "mnemonic": "your twelve or twenty four word seed phrase here..."
}
```

**Validation**:
- `userId`: Required, non-empty string
- `mode`: Must be either 'random' or 'mnemonic'
- `mnemonic`: Required and non-empty when mode='mnemonic', must be 12 or 24 words

**Response**:
```json
{
  "ok": true
}
```

**Flow**:
1. Request received → `WalletController.createOrImportSeed()`
2. DTO validated by ValidationPipe
3. → `WalletService.createOrImportSeed()`
4. → If 'random': `WDK.getRandomSeedPhrase()` generates BIP-39 mnemonic
5. → If 'mnemonic': Validates word count (12 or 24)
6. → `SeedRepository.createOrUpdateSeed()`
7. → `EncryptionService.encrypt()` encrypts seed phrase
8. → `PrismaService` stores encrypted data in `WalletSeed` table
9. → Response sent

**Error Cases**:
- Invalid mode: `BadRequestException`
- Mnemonic missing when required: `BadRequestException`
- Invalid word count: `BadRequestException`
- Database error: Propagated to client

---

### 3.2 Get Wallet Addresses
**Endpoint**: `GET /wallet/addresses?userId=user123`

**Purpose**: Retrieve wallet addresses for all supported chains

**Query Parameters**:
- `userId` (required): User identifier

**Response**:
```json
{
  "ethereum": "0x1234...",
  "tron": "T1234...",
  "bitcoin": "bc1q...",
  "solana": "Abc123...",
  "ethereumErc4337": "0x5678...",
  "baseErc4337": "0x9abc...",
  "arbitrumErc4337": "0xdef0...",
  "polygonErc4337": "0x1111..."
}
```

**Flow**:
1. Request received → `WalletController.getAddresses()`
2. Query param extracted and validated
3. → `WalletService.getAddresses(userId)`
4. → `SeedRepository.getSeedPhrase(userId)`
5. → `EncryptionService.decrypt()` decrypts seed
6. → `createWdkInstance(seedPhrase)` creates WDK with all wallet managers
7. → For each chain: `wdk.getAccount(chain, 0).getAddress()`
8. → Parallel address fetching with error handling
9. → Response sent with all addresses

**Error Cases**:
- User has no seed: `NotFoundException` (404)
- Decryption failure: Propagated error
- Chain-specific errors: Logged, returns `null` for that chain

---

### 3.3 Get Wallet Balances
**Endpoint**: `GET /wallet/balances?userId=user123`

**Purpose**: Retrieve native token balances for all chains

**Query Parameters**:
- `userId` (required): User identifier

**Response**:
```json
[
  { "chain": "ethereum", "balance": "1500000000000000000" },
  { "chain": "tron", "balance": "5000000" },
  { "chain": "bitcoin", "balance": "100000000" },
  { "chain": "solana", "balance": "2000000000" },
  { "chain": "ethereumErc4337", "balance": "750000000000000000" },
  { "chain": "baseErc4337", "balance": "0" },
  { "chain": "arbitrumErc4337", "balance": "0" },
  { "chain": "polygonErc4337", "balance": "0" }
]
```

**Flow**:
1. Request received → `WalletController.getBalances()`
2. → `WalletService.getBalances(userId)`
3. → `SeedRepository.getSeedPhrase(userId)` retrieves decrypted seed
4. → `createWdkInstance(seedPhrase)` creates WDK instance
5. → For each chain: `wdk.getAccount(chain, 0).getBalance()`
6. → RPC calls to blockchain nodes to fetch balances
7. → Balance returned as string to preserve precision
8. → Error handling: Returns '0' for failed chains
9. → Response sent as array

**Error Cases**:
- No seed found: `NotFoundException`
- RPC errors: Logged, returns '0' for that chain

---

### 3.4 Get ERC-4337 Paymaster Balances
**Endpoint**: `GET /wallet/erc4337/paymaster-balances?userId=user123`

**Purpose**: Retrieve paymaster token balances for gasless transactions

**Query Parameters**:
- `userId` (required): User identifier

**Response**:
```json
[
  { "chain": "Ethereum", "balance": "100000000" },
  { "chain": "Base", "balance": "50000000" },
  { "chain": "Arbitrum", "balance": "0" },
  { "chain": "Polygon", "balance": "25000000" }
]
```

**Flow**:
1. Request received → `WalletController.getErc4337PaymasterBalances()`
2. → `WalletService.getErc4337PaymasterBalances(userId)`
3. → Retrieves seed and creates WDK instance
4. → For ERC-4337 accounts only (Ethereum, Base, Arbitrum, Polygon)
5. → Checks if `getPaymasterTokenBalance()` method exists
6. → Calls method to get USDC/USDT balance deposited with paymaster
7. → Returns balances array

**Use Case**: 
- Paymaster tokens (typically USDC/USDT) are used to sponsor gas fees
- Users pay transaction fees in stablecoins instead of native tokens
- Backend tracks deposited balances for UI display

---

## 4. Application Flow

### 4.1 Initialization Flow
```
1. main.ts bootstrap() executed
   ↓
2. NestFactory.create(AppModule) initializes app
   ↓
3. AppModule loads:
   - ConfigModule (environment variables)
   - PrismaModule (database connection)
   - WalletModule (wallet features)
   ↓
4. PrismaService.onModuleInit() connects to PostgreSQL
   ↓
5. CORS configured for frontend origins
   ↓
6. Global ValidationPipe enabled
   ↓
7. Server listens on port 5005
```

### 4.2 Seed Creation Flow (Detailed)
```
Client Request: POST /wallet/seed
   ↓
[HTTP Layer - wallet.controller.ts]
   ↓
ValidationPipe validates CreateOrImportSeedDto
   ↓
WalletController.createOrImportSeed(dto)
   ↓
[Business Logic Layer - wallet.service.ts]
   ↓
IF mode === 'random':
   WDK.getRandomSeedPhrase() → generates BIP-39 mnemonic
ELSE IF mode === 'mnemonic':
   Validate word count (12 or 24 words)
   Use provided mnemonic
   ↓
[Data Access Layer - seed.repository.ts]
   ↓
SeedRepository.createOrUpdateSeed(userId, seedPhrase)
   ↓
[Encryption Layer - encryption.service.ts]
   ↓
EncryptionService.encrypt(seedPhrase)
   → Generates random 16-byte IV
   → Encrypts with AES-256-GCM
   → Returns { ciphertext, iv, authTag }
   ↓
[Database Layer - prisma.service.ts]
   ↓
PrismaService.walletSeed.upsert()
   → Stores/updates in WalletSeed table
   → Columns: userId, ciphertext, iv, authTag
   ↓
Success response: { ok: true }
```

### 4.3 Address Retrieval Flow (Detailed)
```
Client Request: GET /wallet/addresses?userId=user123
   ↓
[HTTP Layer]
WalletController.getAddresses(userId)
   ↓
[Business Logic Layer]
WalletService.getAddresses(userId)
   ↓
[Data Access Layer]
SeedRepository.getSeedPhrase(userId)
   → Fetches encrypted seed from database
   ↓
[Encryption Layer]
EncryptionService.decrypt({ ciphertext, iv, authTag })
   → Verifies authTag (prevents tampering)
   → Decrypts to plaintext seed phrase
   ↓
[Blockchain SDK Layer]
WalletService.createWdkInstance(seedPhrase)
   ↓
Register wallet managers for all chains:
   .registerWallet('ethereum', WalletManagerEvm, { provider: ETH_RPC_URL })
   .registerWallet('tron', WalletManagerTron, { provider: TRON_RPC_URL })
   .registerWallet('bitcoin', WalletManagerBtc, { provider: BTC_RPC_URL })
   .registerWallet('solana', WalletManagerSolana, { rpcUrl: SOL_RPC_URL })
   .registerWallet('ethereum-erc4337', WalletManagerEvmErc4337, {
     chainId, provider, bundlerUrl, paymasterUrl, ...
   })
   ... (repeat for Base, Arbitrum, Polygon ERC-4337)
   ↓
For each chain:
   wdk.getAccount(chain, 0) → Derives account from seed (BIP-44 path)
   account.getAddress() → Calculates blockchain address
   ↓
Error Handling:
   - Try/catch per chain
   - Log errors
   - Return null for failed chains
   ↓
Response: WalletAddresses object with all addresses
```

### 4.4 Balance Fetching Flow
```
Client Request: GET /wallet/balances?userId=user123
   ↓
[Similar to Address Retrieval up to WDK instance creation]
   ↓
For each chain:
   wdk.getAccount(chain, 0)
   account.getBalance()
      ↓
   [External RPC Call to Blockchain Node]
      - Ethereum: eth_getBalance via ETH_RPC_URL
      - Bitcoin: Query UTXO balance via BTC_RPC_URL
      - Solana: getBalance via SOL_RPC_URL
      - Tron: Query account via TRON_RPC_URL
      ↓
   Parse response → BigInt/BigNumber
   Convert to string (preserve precision)
   ↓
Aggregate results → Array<{ chain, balance }>
   ↓
Response sent to client
```

### 4.5 Asynchronous & Error Handling Patterns

**Async Operations**:
- All database operations are async (Prisma)
- All blockchain RPC calls are async (WDK)
- Controllers use async/await pattern
- Services use async/await with try/catch blocks

**Error Propagation**:
```
Layer 4 (Controller) → Catches errors, logs, re-throws
   ↓
Layer 3 (Service) → Business logic errors (BadRequestException)
   ↓
Layer 2 (Repository) → Data errors (NotFoundException)
   ↓
Layer 1 (Prisma/Crypto) → System errors (connection, encryption)
   ↓
NestJS Exception Filters → HTTP error responses
```

**Graceful Degradation**:
- Balance queries: Individual chain failures don't block entire request
- Address queries: Returns partial results if some chains fail
- Logging: Extensive logging at each layer for debugging

---

## 5. Data Storage

### 5.1 Database Type
**PostgreSQL** via **Prisma ORM**

### 5.2 Database Schema

#### **Table: `User`**
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  wallets   Wallet[]  // One-to-many relationship
}
```
- **Purpose**: Stores user accounts
- **Key**: `id` (CUID - Collision-resistant Universal Identifier)
- **Unique**: `email` (enforces unique email addresses)

#### **Table: `Wallet`**
```prisma
model Wallet {
  id               String         @id @default(cuid())
  userId           String
  salt             String
  encryptedSeed    String         // hex-encoded Buffer (DEPRECATED)
  encryptedEntropy String         // hex-encoded Buffer (DEPRECATED)
  createdAt        DateTime       @default(now())
  addresses        WalletAddress[]

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
}
```
- **Purpose**: Stores wallet metadata (legacy, not actively used)
- **Cascade Delete**: Deleting user deletes all wallets
- **Index**: Fast lookups by `userId`

#### **Table: `WalletAddress`**
```prisma
model WalletAddress {
  id        String   @id @default(cuid())
  walletId  String
  chain     String   // 'base', 'ethereum', 'polygon'
  address   String
  createdAt DateTime @default(now())

  wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)
  
  @@unique([walletId, chain])
  @@index([walletId])
  @@index([address])
}
```
- **Purpose**: Stores generated addresses per chain (legacy, not actively used)
- **Unique Constraint**: One address per wallet per chain
- **Indexes**: Fast lookups by walletId and address

#### **Table: `WalletSeed`** (Primary Storage)
```prisma
model WalletSeed {
  id         String   @id @default(cuid())
  userId     String   @unique
  ciphertext String   // Encrypted seed phrase
  iv         String   // Initialization Vector (hex)
  authTag    String   // Authentication Tag (hex)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId])
}
```
- **Purpose**: **Primary storage for encrypted wallet seeds**
- **Unique**: One seed per user (`userId` is unique)
- **Security**: Stores AES-256-GCM encrypted seed phrase components
- **Active Use**: This is the table actively used by `SeedRepository`

### 5.3 Data Storage Pattern

**Encryption at Rest**:
```typescript
// Storage format in WalletSeed table:
{
  userId: "user123",
  ciphertext: "a3f2...b9e1",  // Hex-encoded encrypted seed
  iv: "1f2a3b4c...",           // 16-byte random IV (hex)
  authTag: "9e8d7c6b..."       // 16-byte auth tag (hex)
}
```

**Encryption Process**:
1. Plaintext seed: `"word1 word2 word3 ... word12"`
2. Generate random 16-byte IV
3. Encrypt with AES-256-GCM using `WALLET_ENC_KEY`
4. Extract auth tag from cipher
5. Store ciphertext, IV, authTag as separate hex strings

**Decryption Process**:
1. Read `ciphertext`, `iv`, `authTag` from database
2. Convert hex strings to Buffers
3. Create decipher with key and IV
4. Set auth tag (verifies data integrity)
5. Decrypt to plaintext seed
6. If auth tag doesn't match → throws error (data tampered)

### 5.4 Data Retrieval Patterns

**User Seed Lookup**:
```typescript
// File: seed.repository.ts
async getSeedPhrase(userId: string): Promise<string> {
  const seed = await prisma.walletSeed.findUnique({ where: { userId } });
  if (!seed) throw new NotFoundException(...);
  return encryptionService.decrypt(seed);
}
```

**Seed Creation/Update**:
```typescript
// Upsert pattern (create if not exists, update if exists)
await prisma.walletSeed.upsert({
  where: { userId },
  create: { userId, ciphertext, iv, authTag },
  update: { ciphertext, iv, authTag }
});
```

**Transaction Safety**:
- Prisma handles connection pooling
- Automatic retries on connection failures (10 attempts)
- Transactional operations via Prisma's implicit transactions

---

## 6. Imports & Dependencies

### 6.1 Core Dependencies

#### **NestJS Ecosystem**
```json
"@nestjs/common": "^11.0.1"        // Core decorators, pipes, guards
"@nestjs/core": "^11.0.1"          // NestJS framework core
"@nestjs/config": "^4.0.2"         // Environment variable management
"@nestjs/platform-express": "^11.0.1"  // Express HTTP adapter
```
- **Usage**: Framework foundation, dependency injection, HTTP handling
- **Files**: All `*.module.ts`, `*.controller.ts`, `*.service.ts`

#### **Database**
```json
"@prisma/client": "^6.18.0"        // Prisma ORM client
"prisma": "^6.18.0"                // Prisma CLI (devDependency)
```
- **Usage**: Type-safe database queries, migrations
- **Files**: `prisma.service.ts`, `seed.repository.ts`
- **Generated Code**: `node_modules/.prisma/client` (auto-generated types)

#### **Blockchain SDKs (Tetherto WDK)**
```json
"@tetherto/wdk": "1.0.0-beta.3"                    // Core wallet SDK
"@tetherto/wdk-wallet-evm": "1.0.0-beta.3"         // Ethereum, Base, etc.
"@tetherto/wdk-wallet-btc": "1.0.0-beta.3"         // Bitcoin
"@tetherto/wdk-wallet-solana": "1.0.0-beta.2"      // Solana
"@tetherto/wdk-wallet-tron": "1.0.0-beta.2"        // Tron
"@tetherto/wdk-wallet-evm-erc-4337": "1.0.0-beta.2"  // Account Abstraction
```
- **Usage**: Multi-chain wallet generation, signing, balance queries
- **Files**: `wallet.service.ts`
- **Key Classes**: `WDK`, `WalletManagerEvm`, `WalletManagerBtc`, etc.

#### **Validation**
```json
"class-validator": "^0.14.2"       // Decorator-based validation
"class-transformer": "^0.5.1"      // DTO transformation
```
- **Usage**: Automatic request validation via decorators
- **Files**: `wallet.dto.ts`, enabled globally in `main.ts`

#### **Utilities**
```json
"reflect-metadata": "^0.2.2"       // Required for decorators
"rxjs": "^7.8.1"                   // Reactive programming (NestJS uses it)
```

### 6.2 Development Dependencies
```json
"typescript": "^5.7.3"              // TypeScript compiler
"@types/node": "^22.10.7"           // Node.js type definitions
"@nestjs/cli": "^11.0.0"            // NestJS CLI
"jest": "^30.0.0"                   // Testing framework
"eslint": "^9.18.0"                 // Linting
"prettier": "^3.4.2"                // Code formatting
```

### 6.3 Environment Variables

**Required Variables** (from `.env`):
```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/db?schema=public"

# Encryption (CRITICAL)
WALLET_ENC_KEY="base64-encoded-32-byte-key"  # Generate: openssl rand -base64 32

# Server
PORT=5005

# Blockchain RPC URLs
ETH_RPC_URL="https://mainnet.infura.io/v3/YOUR_KEY"
TRON_RPC_URL="https://api.trongrid.io"
BTC_RPC_URL="https://blockstream.info/api"
SOL_RPC_URL="https://api.mainnet-beta.solana.com"

# ERC-4337 Configuration (per chain: Ethereum, Base, Arbitrum, Polygon)
ETH_BUNDLER_URL="https://api.candide.dev/public/v3/ethereum"
ETH_PAYMASTER_URL="https://api.candide.dev/public/v3/ethereum"
ETH_PAYMASTER_ADDRESS="0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba"
ETH_PAYMASTER_TOKEN="0xdAC17F958D2ee523a2206206994597C13D831ec7"  # USDT

# ... (similar for BASE_, ARB_, POLYGON_ prefixes)

# Shared ERC-4337 Config
ENTRY_POINT_ADDRESS="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
SAFE_MODULES_VERSION="0.3.0"
TRANSFER_MAX_FEE="100000000000000"
```

**Configuration Loading**:
- Loaded via `ConfigModule.forRoot()` in `app.module.ts`
- Accessed via `ConfigService` dependency injection
- Global availability (no need to import ConfigModule in feature modules)

### 6.4 Module Import Graph
```
AppModule
├─ ConfigModule (global)
├─ PrismaModule
│  └─ Exports: PrismaService
├─ WalletModule
   ├─ Imports: PrismaModule, CryptoModule
   ├─ Controllers: WalletController
   ├─ Providers: WalletService, SeedRepository
   └─ Exports: WalletService, SeedRepository

CryptoModule
├─ Imports: ConfigModule
├─ Providers: EncryptionService
└─ Exports: EncryptionService
```

### 6.5 Key Import Examples

**Controller Import**:
```typescript
// wallet.controller.ts
import { Controller, Post, Get, Query, Body, Logger } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { CreateOrImportSeedDto } from './dto/wallet.dto.js';
```

**Service Import**:
```typescript
// wallet.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
// ... more wallet managers
import { SeedRepository } from './seed.repository.js';
```

**Repository Import**:
```typescript
// seed.repository.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
```

**Note**: All imports use `.js` extensions due to ES Modules (`"type": "module"` in package.json)

---

## 7. Security Considerations

### 7.1 Encryption Security
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Size**: 256 bits (32 bytes) - industry standard
- **IV Generation**: Cryptographically secure random per encryption
- **Authentication**: Auth tag prevents tampering detection
- **Key Storage**: Environment variable (should use secrets manager in production)

### 7.2 API Security
- **CORS**: Restricted to specific origins (localhost ports)
- **Validation**: All inputs validated via DTOs
- **Error Handling**: Errors logged but sensitive details not exposed to clients
- **No Authentication**: ⚠️ **Currently no JWT/API key validation** (TODO for production)

### 7.3 Database Security
- **Connection String**: Stored in environment variables
- **Cascade Deletes**: Automatic cleanup of related records
- **Retry Logic**: Prevents connection failures from crashing app

### 7.4 Production Recommendations
1. **Add Authentication**: JWT tokens or API keys
2. **Rate Limiting**: Prevent abuse of endpoints
3. **HTTPS Only**: Enforce TLS for all connections
4. **Key Management**: Use AWS Secrets Manager, HashiCorp Vault, etc.
5. **Audit Logging**: Log all seed access and wallet operations
6. **IP Whitelisting**: Restrict API access to known IPs

---

## 8. Development Workflow

### 8.1 Scripts (from package.json)
```bash
pnpm run dev          # Start in watch mode (development)
pnpm run build        # Compile TypeScript to dist/
pnpm run start:prod   # Run compiled production build
pnpm run lint         # Run ESLint
pnpm run format       # Format code with Prettier
pnpm run test         # Run unit tests (Jest)
pnpm run test:e2e     # Run end-to-end tests
```

### 8.2 Database Workflow
```bash
pnpm prisma generate      # Generate Prisma client types
pnpm prisma migrate dev   # Create and apply new migration
pnpm prisma studio        # Open database GUI (port 5555)
pnpm prisma db push       # Push schema changes without migration
```

### 8.3 Startup Sequence
```bash
1. pnpm install              # Install dependencies
2. pnpm prisma generate      # Generate Prisma client
3. pnpm prisma migrate dev   # Run migrations
4. pnpm run dev              # Start server
   → Server listening on http://localhost:5005
```

---

## 9. Architecture Patterns

### 9.1 Layered Architecture
```
┌─────────────────────────────────────────┐
│   HTTP Layer (Controllers)              │  ← REST API endpoints
├─────────────────────────────────────────┤
│   Business Logic Layer (Services)       │  ← Core wallet logic
├─────────────────────────────────────────┤
│   Data Access Layer (Repositories)      │  ← Database operations
├─────────────────────────────────────────┤
│   Infrastructure Layer                  │  ← Prisma, Encryption, WDK
└─────────────────────────────────────────┘
```

### 9.2 Dependency Injection
- **Pattern**: Constructor injection via NestJS DI container
- **Example**:
  ```typescript
  constructor(
    private seedRepository: SeedRepository,
    private configService: ConfigService
  ) {}
  ```
- **Benefits**: Loose coupling, testability, modularity

### 9.3 Repository Pattern
- **Purpose**: Abstract database operations
- **Implementation**: `SeedRepository` encapsulates all `WalletSeed` operations
- **Benefits**: Easy to swap database, centralized data access logic

### 9.4 DTO Pattern
- **Purpose**: Define data shapes for API requests/responses
- **Validation**: Integrated with `class-validator`
- **Transformation**: Automatic type conversion via `class-transformer`

---

## 10. Testing Strategy

### 10.1 Unit Tests
- **Framework**: Jest
- **Location**: `*.spec.ts` files next to source files
- **Scope**: Individual service/controller methods

### 10.2 E2E Tests
- **Framework**: Jest + Supertest
- **Location**: `test/` directory
- **Scope**: Full API request/response cycles

### 10.3 Example Test Flow
```typescript
// wallet.service.spec.ts (example)
describe('WalletService', () => {
  it('should create random seed', async () => {
    const service = new WalletService(mockRepo, mockConfig);
    await service.createOrImportSeed('user1', 'random');
    expect(mockRepo.createOrUpdateSeed).toHaveBeenCalled();
  });
});
```

---

## 11. Deployment Considerations

### 11.1 Railway Deployment
- **Database**: PostgreSQL plugin (auto-provisions `DATABASE_URL`)
- **Environment**: Set all env vars in Railway dashboard
- **Port**: Railway auto-assigns port via `PORT` env variable
- **Build**: `pnpm run build` → runs `prisma generate` automatically

### 11.2 Environment Checklist
- [ ] `DATABASE_URL` configured
- [ ] `WALLET_ENC_KEY` set (generate with `openssl rand -base64 32`)
- [ ] All RPC URLs configured (Infura, Alchemy, or public nodes)
- [ ] Bundler/Paymaster URLs for ERC-4337 chains
- [ ] `PORT` configured (Railway auto-assigns)

### 11.3 Health Monitoring
- **Database**: Prisma connection retry logic logs failures
- **Logging**: NestJS Logger used throughout (timestamps, context)
- **Error Tracking**: Consider adding Sentry or similar in production

---

## 12. Summary

### 12.1 Key Strengths
✅ **Modular Architecture**: Clean separation of concerns  
✅ **Type Safety**: Full TypeScript with Prisma types  
✅ **Multi-Chain Support**: 8+ blockchains via unified WDK interface  
✅ **Security**: AES-256-GCM authenticated encryption  
✅ **Account Abstraction**: ERC-4337 support for gasless transactions  
✅ **Error Handling**: Comprehensive try/catch with logging  
✅ **Scalability**: NestJS modular design allows easy feature additions  

### 12.2 Technical Highlights
- **Framework**: Enterprise-grade NestJS with dependency injection
- **Database**: Type-safe Prisma ORM with PostgreSQL
- **Encryption**: Military-grade AES-256-GCM with unique IVs
- **Blockchain SDKs**: Tetherto WDK suite for unified multi-chain access
- **Validation**: Automatic DTO validation with class-validator

### 12.3 Data Flow Summary
```
Client Request
   ↓
Controller (HTTP)
   ↓
Service (Business Logic) ← ConfigService
   ↓
Repository (Data Access) ← EncryptionService
   ↓
PrismaService (ORM)
   ↓
PostgreSQL Database
```

### 12.4 Future Enhancements
1. **Authentication**: Add JWT middleware for secure API access
2. **Rate Limiting**: Prevent abuse with throttling
3. **Transaction Signing**: Add endpoints for signing and broadcasting transactions
4. **NFT Support**: Integrate NFT balance queries
5. **Webhooks**: Event-driven notifications for balance changes
6. **Multi-User Support**: Extend to handle proper user management
7. **Backup/Recovery**: Seed backup mechanisms
8. **Analytics**: Track wallet usage metrics

---

## 13. Quick Reference

### 13.1 Port Assignments
- **Backend API**: 5005
- **Frontend Web**: 3000
- **Prisma Studio**: 5555
- **Vite Dev**: 5173

### 13.2 Important Files
| File | Purpose |
|------|---------|
| `main.ts` | App entry point, CORS, validation |
| `wallet.service.ts` | Core wallet logic, WDK integration |
| `seed.repository.ts` | Encrypted seed storage |
| `encryption.service.ts` | AES-256-GCM encryption |
| `schema.prisma` | Database schema definition |
| `.env` | Configuration secrets |

### 13.3 Critical Environment Variables
| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | `postgresql://...` |
| `WALLET_ENC_KEY` | 32-byte encryption key | `base64-encoded-string` |
| `ETH_RPC_URL` | Ethereum node | `https://mainnet.infura.io/...` |
| `ENTRY_POINT_ADDRESS` | ERC-4337 EntryPoint | `0x00000000...` |

---

**Document Version**: 1.0  
**Last Updated**: October 30, 2025  
**Author**: Technical Documentation (Auto-Generated)

