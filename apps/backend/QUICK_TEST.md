# Quick Testing Guide

## Step 1: Get Your Test User's Wallet Address

```bash
# Option A: Use the helper script
USER_ID=your-user-id CHAIN=base ./get-user-wallet.sh

# Option B: Query database directly
# Run the SQL query shown by the script to get the address
```

## Step 2: Set Environment Variables

```bash
export USER_ID="test-check"
export USER_WALLET="0x..."  # From Step 1
export PARTICIPANT_2="0x..."  # Optional: another participant
export CHAIN="base"  # Optional: defaults to base
export API_BASE="http://localhost:3001"  # Optional
```

## Step 3: Run Tests

```bash
./test-lightning-node.sh
```

## What Gets Tested

1. ✅ **Create Lightning Node** - Creates app session on Yellow Network
2. ✅ **Get Details** - Retrieves Lightning Node info
3. ✅ **Deposit** - Deposits funds via DEPOSIT intent
4. ✅ **Transfer** - Transfers funds via OPERATE intent
5. ✅ **List** - Gets all Lightning Nodes for user
6. ✅ **Close** - Closes the Lightning Node

## Prerequisites Checklist

Before running tests, ensure:

- [ ] User exists in database
- [ ] User has a Wallet record
- [ ] User has a WalletSeed record (encrypted seed phrase)
- [ ] User has WalletAddress for the chain (e.g., "base")
- [ ] `YELLOW_NETWORK_WS_URL` is set in `.env`
- [ ] Backend server is running
- [ ] You know the user's wallet address for the chain

## Common Errors

### "Wallet not found for user"
→ User needs a wallet created first

### "Wallet address not found for user on chain"
→ User needs addresses generated for that chain

### "No wallet seed found for user"
→ User needs a seed phrase stored

### "Participant address does not match user's wallet"
→ Use the correct wallet address (from database)

## Example Full Test Flow

```bash
# 1. Get user's wallet address
USER_ID="test-user-123"
./get-user-wallet.sh

# 2. Set variables (use address from step 1)
export USER_ID="test-user-123"
export USER_WALLET="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"  # Example
export PARTICIPANT_2="0x8ba1f109551bD432803012645Hac136c22C9"  # Another user

# 3. Run tests
./test-lightning-node.sh
```

## Manual API Testing

See `TESTING_GUIDE.md` for detailed curl examples.

