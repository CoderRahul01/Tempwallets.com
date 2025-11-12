# Zerion API Setup Guide

## What You Need to Do

The Zerion API integration has been implemented, but you need to verify and adjust the API endpoints based on Zerion's actual documentation.

## Step 1: Get Your Zerion API Key

1. Go to https://zerion.io/api or https://developers.zerion.io
2. Sign up for an account
3. Get your API key (usually in dashboard/settings)

## Step 2: Add API Key to Environment Variables

Add to your backend `.env` file:

```bash
ZERION_API_KEY=your_api_key_here
```

## Step 3: Authentication Method ✅ VERIFIED

Based on Zerion API documentation: https://developers.zerion.io

**Location:** `apps/backend/src/wallet/zerion.service.ts` (lines 185-198)

**Zerion uses Basic Authentication with base64 encoding:**
```typescript
const auth = Buffer.from(`${this.apiKey}:`).toString('base64');
headers['Authorization'] = `Basic ${auth}`;
```

✅ **This is correct** - Zerion docs show "Credentials: Basic base64"

## Step 4: Verify API Endpoints

### Portfolio Endpoint ✅ VERIFIED

**Documentation:** https://developers.zerion.io/reference/getwalletportfolio

**Endpoint:** `GET https://api.zerion.io/v1/wallets/{address}/portfolio`

**Location:** `apps/backend/src/wallet/zerion.service.ts` (lines 262-283)

**Current Implementation:**
- Base URL: `https://api.zerion.io/v1/wallets/{address}/portfolio`
- Optional query parameter: `?chain_ids={chain}` (may or may not be supported)
- The endpoint returns full portfolio if chain filtering isn't supported

**Note:** The exact query parameter format for chain filtering isn't documented. The code tries `chain_ids` parameter, but if Zerion doesn't support it, the API will return all chains and we filter client-side.

### Transactions Endpoint ✅ VERIFIED

**Documentation:** https://developers.zerion.io/reference/listwallettransactions

**Endpoint:** `GET https://api.zerion.io/v1/wallets/{address}/transactions/`

**Location:** `apps/backend/src/wallet/zerion.service.ts` (lines 308-357)

**Current Implementation:**
- Base URL: `https://api.zerion.io/v1/wallets/{address}/transactions/` (note trailing slash)
- Query parameters:
  - `chain_ids={chain}` - Chain filter (if supported)
  - `page[size]={limit}` - Pagination (JSON:API style)

**Important Notes from Zerion Docs:**
- Endpoint supports "a lot of filters, sorting, and pagination parameters"
- Keep URL length under 2000 characters
- Exact parameter names for filtering aren't specified in base docs
- Supports testnets via `X-Env` header (not currently implemented)

## Step 5: Verify Response Format

The code expects Zerion responses in this format:

**Portfolio Response:**
```typescript
{
  data?: Array<{
    type: 'token' | 'native';
    attributes: {
      quantity?: { int?: string; decimals?: number };
      fungible_info?: {
        symbol?: string;
        decimals?: number;
        implementations?: Array<{ address?: string }>;
      };
    };
  }>;
}
```

**Transactions Response:**
```typescript
{
  data?: Array<{
    id: string;
    attributes: {
      hash?: string;
      mined_at?: number;
      status?: string;
      block_number?: number;
      transfers?: Array<{
        fungible_info?: { symbol?: string };
        quantity?: { int?: string; decimals?: number };
        to?: { address?: string };
      }>;
    };
  }>;
}
```

**If Zerion uses a different format, adjust the interfaces in:**
- `apps/backend/src/wallet/zerion.service.ts` (lines 15-70)

## Step 6: Test the Integration

1. Start your backend
2. Make a test API call (check backend logs)
3. Review error messages if any
4. Adjust endpoints/format based on errors

## Step 7: Chain ID Mapping

**Current mapping in:** `apps/backend/src/wallet/zerion.service.ts` (lines 78-91)

Verify that Zerion uses these chain identifiers:
- `ethereum` → `eth`
- `baseErc4337` → `base`
- `arbitrumErc4337` → `arbitrum`
- `polygonErc4337` → `polygon`
- etc.

If different, update the `chainMap` object.

## Testing Checklist

- [ ] API key added to `.env`
- [ ] Authentication method verified
- [ ] Portfolio endpoint tested and working
- [ ] Transactions endpoint tested and working
- [ ] Response format matches expected structure
- [ ] Chain IDs correctly mapped
- [ ] Error handling works (try invalid API key)

## Resources

- Zerion API Docs: https://developers.zerion.io
- Zerion API Portal: https://zerion.io/api
- Get API Key: Usually in dashboard after signing up

## Fallback Behavior

If Zerion API calls fail, the system automatically falls back to:
- WDK (Wallet Development Kit) for balances
- Empty arrays for transactions (graceful degradation)

This ensures your app continues working even if Zerion is unavailable.

