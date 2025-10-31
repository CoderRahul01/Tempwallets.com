# Wallet Backend Technical Report

## 1. Overview

The wallet backend is a NestJS application that exposes APIs to:
- Create or import a user’s wallet seed (securely encrypted at rest)
- Derive multi-chain addresses
- Fetch balances across EVM, Tron, Bitcoin, Solana, and ERC-4337 chains
- Fetch ERC-4337 paymaster token balances

Key technologies:
- NestJS for modular architecture (controllers, services, modules)
- Prisma (PostgreSQL) for persistence
- AES-256-GCM for encryption (with per-record IV and auth tag)
- Tetherto WDK for chain-agnostic wallet/account operations (EVM, Tron, BTC, Solana, ERC-4337)

Main entrypoint and app initialization:
- `src/main.ts` bootstraps the Nest app, enables CORS, and sets up a global `ValidationPipe`.
- `src/app.module.ts` wires `ConfigModule`, `PrismaModule`, and `WalletModule`.

Server port: `process.env.PORT` or `5005` by default.

## 2. Folder Structure & File Responsibilities

- `src/main.ts`: Bootstraps Nest app, configures CORS and validation.
- `src/app.module.ts`: Root module wiring configuration, database, and wallet features.

- `src/database/`
  - `prisma.module.ts`: Provides and exports `PrismaService` for DI.
  - `prisma.service.ts`: Extends `PrismaClient`, manages DB lifecycle with retry logic on startup and graceful disconnect on shutdown.

- `src/crypto/`
  - `crypto.module.ts`: Exposes `EncryptionService`.
  - `encryption.service.ts`: Implements AES-256-GCM encryption/decryption using base64 `WALLET_ENC_KEY` (32 bytes) from env.

- `src/wallet/`
  - `wallet.module.ts`: Wires controller, service, and repository; imports DB + Crypto modules.
  - `wallet.controller.ts`: HTTP endpoints for seed creation/import, address retrieval, balance retrieval, and ERC-4337 paymaster balances.
  - `wallet.service.ts`: Business logic for seed handling, WDK setup, account derivation, balances, and ERC-4337 helpers.
  - `seed.repository.ts`: Persistence boundary for encrypted seed using Prisma and `EncryptionService`.
  - `dto/wallet.dto.ts`: DTOs for validating incoming requests (e.g., `CreateOrImportSeedDto`).

## 3. API Endpoints & Flow

Base controller path: `/wallet`

1) `POST /wallet/seed`
- **Purpose**: Create a random seed or import a mnemonic for a given `userId`.
- **Body DTO**: `{ userId: string; mode: 'random' | 'mnemonic'; mnemonic?: string }`.
- **Flow**: Controller → `WalletService.createOrImportSeed` → `SeedRepository.createOrUpdateSeed`.
- **Responses**: `{ ok: true }` on success; validation errors or 4xx on failures.

2) `GET /wallet/addresses?userId=...`
- **Purpose**: Return addresses for Ethereum, Tron, Bitcoin, Solana, and ERC-4337 chains (Ethereum/Base/Arbitrum/Polygon).
- **Flow**: Controller → `WalletService.getAddresses` → WDK `.getAccount(...).getAddress()` per chain.
- **Response**: Object with keys `{ ethereum, tron, bitcoin, solana, ethereumErc4337, baseErc4337, arbitrumErc4337, polygonErc4337 }`.

3) `GET /wallet/balances?userId=...`
- **Purpose**: Return balances per chain as strings.
- **Flow**: Controller → `WalletService.getBalances` → WDK `.getBalance()` per chain.
- **Response**: Array of `{ chain: string; balance: string }`.

4) `GET /wallet/erc4337/paymaster-balances?userId=...`
- **Purpose**: Return ERC-4337 paymaster token balances (if supported by the account manager).
- **Flow**: Controller → `WalletService.getErc4337PaymasterBalances` → (optional) `.getPaymasterTokenBalance()`.
- **Response**: Array of `{ chain: string; balance: string }` for Ethereum, Base, Arbitrum, Polygon.

## 4. Application Logic Flow

General request lifecycle:
- Request enters a controller method under `/wallet`.
- Global `ValidationPipe` enforces DTO/query validation with whitelisting and transforms.
- Controller logs the request and delegates to `WalletService`.
- `WalletService` reads/decrypts the user’s seed via `SeedRepository`:
  - `SeedRepository` uses `PrismaService` to load the `walletSeed` row and `EncryptionService` to decrypt it.
- `WalletService` constructs a WDK instance (`createWdkInstance`) for that seed, registering wallet managers for multiple chains.
- Service invokes per-chain operations:
  - Derivation: `.getAccount(chainId, index)` and `.getAddress()`
  - Balances: `.getBalance()`
  - ERC-4337: `.getPaymasterTokenBalance()` when available
- Each chain call is isolated with try/catch; failures are logged and replaced by fallback values (`null` address or `'0'` balance).
- Response data is returned to the controller and then to the client.

Asynchronous/event handling:
- Chain interactions are asynchronous and awaited in sequence within loops.
- There are no background jobs/queues in this code; transaction confirmations are not managed here (endpoints are read-only except seed setup).

## 5. Data Storage & Retrieval

Prisma models (PostgreSQL): `prisma/schema.prisma`

- `WalletSeed` (actively used): stores the encrypted seed for each `userId` with fields `ciphertext`, `iv`, `authTag`, and timestamps.
- `User`, `Wallet`, `WalletAddress` (present but unused in current flows): designed for future features such as multi-wallet and address indexing.

Repository responsibilities:
- `seed.repository.ts` provides:
  - `createOrUpdateSeed(userId, seedPhrase)` → encrypts with AES-256-GCM and upserts the row.
  - `getSeedPhrase(userId)` → loads row and decrypts it.
  - `hasSeed(userId)` and `deleteSeed(userId)` helpers.

Encryption details (`crypto/encryption.service.ts`):
- Algorithm: AES-256-GCM.
- Key: `WALLET_ENC_KEY` base64 string, 32 bytes after decoding (required at startup).
- Per-record random IV; returns/consumes hex-encoded `ciphertext`, `iv`, and `authTag`.

## 6. Imports & Dependencies

Framework and validation:
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` for the Nest app.
- `@nestjs/config` for environment configuration.
- `class-validator`, `class-transformer` with global `ValidationPipe`.

Database:
- `@prisma/client` runtime and `prisma` CLI.
- `PrismaService` manages lifecycle and retries.
- Env: `DATABASE_URL` (PostgreSQL connection).

Crypto & wallet abstraction:
- Node `crypto` for AES-256-GCM; env `WALLET_ENC_KEY` required.
- `@tetherto/wdk` and wallet managers:
  - `@tetherto/wdk-wallet-evm`
  - `@tetherto/wdk-wallet-tron`
  - `@tetherto/wdk-wallet-btc`
  - `@tetherto/wdk-wallet-solana`
  - `@tetherto/wdk-wallet-evm-erc-4337`

Environment-driven chain configuration (used in `wallet.service.ts`):
- EVM: `ETH_RPC_URL`
- Tron: `TRON_RPC_URL`
- Bitcoin: `BTC_RPC_URL`
- Solana: `SOL_RPC_URL`
- ERC-4337 (per chain):
  - Ethereum: `ETH_ERC4337_RPC_URL`, `ETH_BUNDLER_URL`, `ETH_PAYMASTER_URL`, `ETH_PAYMASTER_ADDRESS`, `ETH_PAYMASTER_TOKEN`
  - Base: `BASE_RPC_URL`, `BASE_BUNDLER_URL`, `BASE_PAYMASTER_URL`, `BASE_PAYMASTER_ADDRESS`, `BASE_PAYMASTER_TOKEN`
  - Arbitrum: `ARB_RPC_URL`, `ARB_BUNDLER_URL`, `ARB_PAYMASTER_URL`, `ARB_PAYMASTER_ADDRESS`, `ARB_PAYMASTER_TOKEN`
  - Polygon: `POLYGON_RPC_URL`, `POLYGON_BUNDLER_URL`, `POLYGON_PAYMASTER_URL`, `POLYGON_PAYMASTER_ADDRESS`, `POLYGON_PAYMASTER_TOKEN`
- Shared ERC-4337 settings: `ENTRY_POINT_ADDRESS`, `SAFE_MODULES_VERSION`, `TRANSFER_MAX_FEE`
- Server: `PORT` (optional)

## 7. Summary

- Modular NestJS backend with clear separation of concerns:
  - `WalletModule` for API and business logic
  - `CryptoModule` for encryption/decryption
  - `PrismaModule` for database access
- Encrypted seed storage with AES-256-GCM and per-record IV/auth tag.
- WDK-based multi-chain address derivation and balance queries across EVM, Tron, BTC, Solana, and ERC-4337.
- API surface:
  - `POST /wallet/seed`
  - `GET /wallet/addresses?userId=...`
  - `GET /wallet/balances?userId=...`
  - `GET /wallet/erc4337/paymaster-balances?userId=...`
- Environment-driven configuration for RPCs, bundlers, paymasters, and encryption.

If you want, we can add example cURL commands and sample responses, or extend endpoints for sending transactions.


