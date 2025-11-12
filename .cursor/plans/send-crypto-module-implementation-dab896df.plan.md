<!-- dab896df-6bf9-49da-a285-308670032580 0652149d-664f-4f63-b9fb-572299d6e18f -->
# Zerion API Integration with Progressive Loading

## Overview

Migrate from WDK's native balance/token/transaction methods to Zerion API for faster, more reliable data fetching. Implement caching to minimize API calls and add progressive loading so wallets appear in the UI as they're ready, not after all chains complete.

## Implementation Steps

### 1. Create Zerion API Service (Backend)

- **File**: `apps/backend/src/wallet/zerion.service.ts`
- Create service to interact with Zerion API
- Handle API key from environment variable (`ZERION_API_KEY`)
- Map chain names to Zerion's chain identifiers:
- ethereum → eth
- baseErc4337 → base
- arbitrumErc4337 → arbitrum
- polygonErc4337 → polygon
- tron → tron (if supported)
- bitcoin → btc (if supported)
- solana → sol (if supported)
- Methods needed:
- `getPortfolio(address: string, chain: string)` - get all balances/tokens
- `getTransactions(address: string, chain: string, limit: number)` - get transaction history
- `getTokenMetadata(tokenAddress: string, chain: string)` - get token details for send modal
- Implement rate limiting and error handling
- Add request retry logic for failed calls

### 2. Add Caching Layer for Zerion Calls

- **File**: `apps/backend/src/wallet/zerion-cache.service.ts` or add to `zerion.service.ts`
- Use in-memory cache (Map) with TTL (Time To Live)
- Cache structure: `address:chain -> { data, timestamp }`
- TTL: 30 seconds for balances, 60 seconds for transactions
- Check cache before making Zerion API calls
- Clear cache on send transactions (invalidate affected address:chain)

### 3. Update Balance Methods to Use Zerion

- **File**: `apps/backend/src/wallet/wallet.service.ts`
- Modify `getBalances()`:
- Keep address derivation using WDK (addresses stay on backend)
- Replace `account.getBalance()` calls with Zerion API
- For each chain, call Zerion portfolio API with address
- Parse Zerion response to extract native token + ERC-20 tokens
- Return same format as before: `{ chain: string; balance: string }[]`
- Modify `getTokenBalances()`:
- Replace WDK token discovery with Zerion portfolio API
- Zerion returns all tokens in one call (native + ERC-20)
- Map Zerion response to existing `TokenBalance` interface
- Return array with `{ address, symbol, balance, decimals }`

### 4. Update Transaction History to Use Zerion

- **File**: `apps/backend/src/wallet/wallet.service.ts`
- Modify `getTransactionHistory()`:
- Replace WDK `getTransactions()` attempt with Zerion transactions API
- Call Zerion with address and chain
- Parse Zerion transaction response
- Map to existing `Transaction` interface format
- Handle pagination if needed

### 5. Update Send Functionality to Use Zerion for Token Metadata

- **File**: `apps/backend/src/wallet/wallet.service.ts`
- Add method `getTokenDetails(address: string, chain: string, tokenAddress: string)`:
- Use Zerion to get token metadata (symbol, decimals, name)
- Used by send modal to display token info
- Keep actual send transaction using WDK (signing still happens with WDK)
- Optionally validate token exists via Zerion before sending

### 6. Implement Progressive Loading (Server-Sent Events)

- **File**: `apps/backend/src/wallet/wallet.controller.ts`
- Add new endpoint: `GET /wallet/addresses-stream?userId=...`
- Return Server-Sent Events (SSE) stream
- For each chain:
- Derive address (using WDK)
- Immediately send `{ chain, address }` to client
- Continue with next chain (don't wait for all)
- Client receives addresses as they're ready
- Fallback: If SSE not supported, keep existing batch endpoint

### 7. Implement Progressive Balance Loading

- **File**: `apps/backend/src/wallet/wallet.controller.ts`
- Option A (Recommended): Add endpoint `GET /wallet/balances-stream?userId=...`
- SSE stream that sends each chain's balance as it's fetched from Zerion
- Format: `{ chain, balance, tokens: [] }`
- Client updates UI progressively
- Option B: Separate endpoint per chain `GET /wallet/balance?userId=...&chain=...`
- Frontend fetches each chain separately in parallel
- Updates UI as each resolves
- Include caching - skip Zerion call if cached data is fresh

### 8. Update Frontend for Progressive Loading

- **File**: `apps/web/hooks/useWallet.ts`
- Modify `loadWallets()`:
- Use SSE endpoint `/wallet/addresses-stream` instead of batch endpoint
- Update wallets state as each address arrives
- Handle SSE connection errors with fallback to batch endpoint
- **File**: `apps/web/app/transactions/page.tsx`
- Modify `loadBalances()`:
- Use SSE endpoint `/wallet/balances-stream` or Option B per-chain endpoints
- Update `chainBalances` state progressively as data arrives
- Show loading only for chains not yet loaded
- **File**: `apps/web/components/dashboard/recent-transactions.tsx`
- No changes needed - transaction endpoint already per-chain

### 9. Environment Configuration

- **File**: `apps/backend/.env.example` (or existing env file)
- Add: `ZERION_API_KEY=your_api_key_here`
- Document in README how to obtain Zerion API key

### 10. Error Handling & Fallbacks

- If Zerion API fails:
- Log error with chain and address
- Return empty balance (0) for that chain instead of crashing
- Consider fallback to WDK for critical operations
- If Zerion rate limited:
- Use cached data if available
- Queue requests with exponential backoff
- Handle Zerion API key missing gracefully

## Technical Notes

### Zerion API Integration Points:

1. **Portfolio/Balances**: `GET https://api.zerion.io/v1/wallets/{address}/portfolio` or similar
2. **Transactions**: `GET https://api.zerion.io/v1/wallets/{address}/transactions`
3. **Token Metadata**: Part of portfolio response or separate token endpoint

### Chain Mapping:

- Need to map internal chain names to Zerion's identifiers
- ERC-4337 chains likely use same addresses as their base chains (ethereum, base, etc.)
- May need special handling for non-EVM chains (Bitcoin, Solana, Tron)

### Caching Strategy:

- Cache key: `${address.toLowerCase()}:${chain}`
- Balance cache: 30s TTL
- Transaction cache: 60s TTL
- Invalidate on send transactions

### Progressive Loading Benefits:

- Users see Ethereum wallet immediately (fast)
- Don't wait for slow chains (Tron, Bitcoin) to block UI
- Better perceived performance

## Files to Modify/Create

**Backend:**

- `apps/backend/src/wallet/zerion.service.ts` (NEW)
- `apps/backend/src/wallet/wallet.service.ts` (MODIFY)
- `apps/backend/src/wallet/wallet.controller.ts` (MODIFY - add SSE endpoints)
- `apps/backend/src/wallet/wallet.module.ts` (MODIFY - add ZerionService)
- `apps/backend/package.json` (MODIFY - no new deps needed, use native fetch/axios)

**Frontend:**

- `apps/web/hooks/useWallet.ts` (MODIFY - SSE support)
- `apps/web/app/transactions/page.tsx` (MODIFY - progressive balance loading)
- `apps/web/lib/api.ts` (MODIFY - add SSE helper functions)

**Configuration:**

- Environment variable documentation