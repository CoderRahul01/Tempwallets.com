# Send Modal Configuration for Aptos - Complete ✅

## Summary

The send modal has been fully configured and fixed for Aptos wallets. All necessary mappings, validations, and API integrations are in place.

## Changes Made

### 1. Transactions Page - Chain Mapping ✅
- **File**: `apps/web/app/transactions/page.tsx`
- **Fix**: Added Aptos chains to `mapChainForSend()` function
- **Result**: When user clicks "Send" on Aptos balance card, it correctly maps to `aptos` or `aptosTestnet`

```typescript
// Aptos chains - pass through as-is
aptos: 'aptos',
aptosTestnet: 'aptosTestnet',
```

### 2. Send Modal - Already Configured ✅
The send modal already had all Aptos support implemented:

#### Chain Names
- `aptos: "Aptos"`
- `aptosTestnet: "Aptos Testnet"`

#### Address Validation
- Validates Aptos addresses: `0x` prefix + 64 hex characters (66 total)
- Error message: "Invalid Aptos address format (must start with 0x and be 66 characters)"

#### Token Loading
- Fetches Aptos balance using `getAptosBalance()`
- Converts APT to octas (8 decimals) for internal calculations
- Creates native APT token entry

#### Transaction Sending
- Uses `sendAptosTransaction()` API
- Sends amount in human-readable APT (backend converts to octas)
- Handles both testnet and mainnet based on chain ID

#### Explorer Links
- Testnet: `https://explorer.aptoslabs.com/?network=testnet&transaction={hash}`
- Mainnet: `https://explorer.aptoslabs.com/?network=mainnet&transaction={hash}`

## Complete Flow

### 1. User Clicks "Send" on Aptos Balance Card
- Transactions page calls `handleSendClick(chain)`
- `mapChainForSend()` maps `aptos` or `aptosTestnet` correctly
- Opens send modal with correct chain ID

### 2. Send Modal Opens
- Displays "Send Aptos" or "Send Aptos Testnet" title
- Loads Aptos balance via `getAptosBalance()`
- Shows available APT balance
- Displays native APT token (only token available)

### 3. User Enters Amount and Address
- Address validation checks for `0x` + 64 hex chars
- Amount validation checks for positive number
- Balance validation checks sufficient funds

### 4. User Clicks "Send"
- Calls `sendAptosTransaction()` with:
  - `userId`: User fingerprint
  - `recipientAddress`: Validated address
  - `amount`: Human-readable APT amount
  - `network`: `testnet` or `mainnet` based on chain

### 5. Transaction Submitted
- Backend processes transaction
- Returns `transactionHash`
- Modal displays success message
- Shows explorer link
- Calls `onSuccess()` callback to refresh balances

## API Integration

### Endpoints Used
1. **GET** `/wallet/aptos/balance` - Get APT balance
2. **POST** `/wallet/aptos/send` - Send APT transaction

### Request Format
```typescript
{
  userId: string,
  recipientAddress: string,  // 0x + 64 hex chars
  amount: number,             // Human-readable APT
  network: 'testnet' | 'mainnet'
}
```

### Response Format
```typescript
{
  success: boolean,
  transactionHash: string,
  sequenceNumber: number
}
```

## Validation Rules

### Address Validation
- Must start with `0x`
- Must be exactly 66 characters total
- Must contain only hex characters (0-9, a-f, A-F)
- Regex: `/^0x[a-fA-F0-9]{64}$/`

### Amount Validation
- Must be a positive number
- Must not exceed available balance
- Displayed in APT (human-readable)
- Backend converts to octas (8 decimals)

## Error Handling

### Address Errors
- "Recipient address is required"
- "Invalid Aptos address format (must start with 0x and be 66 characters)"

### Amount Errors
- "Amount is required"
- "Amount must be a positive number"
- "Insufficient balance. Available: X.XXXXXX APT"

### Transaction Errors
- Network errors (503, 408)
- Insufficient balance (422)
- Invalid address (400)
- All errors displayed in modal

## Testing Checklist

- [x] Chain mapping works in transactions page
- [x] Send modal opens with correct chain
- [x] Balance loads correctly
- [x] Address validation works
- [x] Amount validation works
- [x] Transaction sending works
- [x] Explorer link works
- [x] Success callback refreshes balances
- [x] Error handling works
- [x] Testnet and mainnet both supported

## Status: ✅ Complete

The send modal is fully configured and working for Aptos wallets. All functionality has been implemented and tested.

