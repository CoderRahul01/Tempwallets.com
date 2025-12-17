#!/bin/bash

# Get User's Wallet Address for Lightning Node Testing
# Helps you find the user's wallet address for a specific chain

set -e

# Configuration
USER_ID="${USER_ID:-}"
CHAIN="${CHAIN:-base}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$USER_ID" ]; then
    echo "Usage: USER_ID=your-user-id [CHAIN=base] ./get-user-wallet.sh"
    echo ""
    echo "This script provides SQL queries to get the user's wallet address."
    exit 1
fi

echo -e "${BLUE}🔍 Getting Wallet Address for User${NC}"
echo "======================================"
echo "User ID: $USER_ID"
echo "Chain: $CHAIN"
echo ""

echo -e "${YELLOW}SQL Query to get wallet address:${NC}"
echo ""
echo "SELECT wa.address, wa.chain, w.id as wallet_id"
echo "FROM \"WalletAddress\" wa"
echo "JOIN \"Wallet\" w ON w.id = wa.\"walletId\""
echo "WHERE w.\"userId\" = '$USER_ID'"
echo "  AND wa.chain = '$CHAIN';"
echo ""

echo -e "${YELLOW}Alternative: Get all addresses for user${NC}"
echo ""
echo "SELECT wa.address, wa.chain"
echo "FROM \"WalletAddress\" wa"
echo "JOIN \"Wallet\" w ON w.id = wa.\"walletId\""
echo "WHERE w.\"userId\" = '$USER_ID'"
echo "ORDER BY wa.chain;"
echo ""

echo -e "${GREEN}💡 Tips:${NC}"
echo "- Use the address from the query result"
echo "- Prefer EOA wallets (base, ethereum) over ERC-4337 wallets"
echo "- The service automatically finds and uses the correct address"
echo ""

echo -e "${GREEN}Example usage:${NC}"
echo "export USER_WALLET=\$(psql -d your_db -t -c \"SELECT wa.address FROM \\\"WalletAddress\\\" wa JOIN \\\"Wallet\\\" w ON w.id = wa.\\\"walletId\\\" WHERE w.\\\"userId\\\" = '$USER_ID' AND wa.chain = '$CHAIN' LIMIT 1;\")"
echo "echo \"Wallet address: \$USER_WALLET\""

