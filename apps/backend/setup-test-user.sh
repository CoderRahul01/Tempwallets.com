#!/bin/bash

# Setup Test User for Lightning Node Testing
# This script helps you verify and prepare a test user

set -e

# Configuration
API_BASE="${API_BASE:-http://localhost:3001}"
USER_ID="${USER_ID:-}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔧 Lightning Node Test User Setup${NC}"
echo "======================================"
echo ""

if [ -z "$USER_ID" ]; then
    echo -e "${YELLOW}⚠️  USER_ID not set${NC}"
    echo "Usage: USER_ID=your-user-id ./setup-test-user.sh"
    echo ""
    echo "This script helps verify that a user is ready for Lightning Node testing."
    echo "The user must already exist and have a wallet created."
    exit 1
fi

echo -e "${BLUE}Checking user: $USER_ID${NC}"
echo ""

# Check if user has wallet (this would require database access)
# For now, we'll just provide instructions

echo -e "${YELLOW}📋 Prerequisites Checklist:${NC}"
echo ""
echo "1. User exists in database (User table)"
echo "2. User has a Wallet record"
echo "3. User has a WalletSeed record (encrypted seed phrase)"
echo "4. User has WalletAddress records for the chain you want to test"
echo "   - For Base: chain = 'base'"
echo "   - For Ethereum: chain = 'ethereum'"
echo "   - etc."
echo ""

echo -e "${YELLOW}💡 To verify in database:${NC}"
echo ""
echo "SELECT * FROM \"User\" WHERE id = '$USER_ID';"
echo "SELECT * FROM \"Wallet\" WHERE \"userId\" = '$USER_ID';"
echo "SELECT * FROM \"WalletSeed\" WHERE \"userId\" = '$USER_ID';"
echo "SELECT * FROM \"WalletAddress\" WHERE \"walletId\" IN (SELECT id FROM \"Wallet\" WHERE \"userId\" = '$USER_ID');"
echo ""

echo -e "${YELLOW}💡 To get user's wallet address for a chain:${NC}"
echo ""
echo "SELECT wa.address, wa.chain"
echo "FROM \"WalletAddress\" wa"
echo "JOIN \"Wallet\" w ON w.id = wa.\"walletId\""
echo "WHERE w.\"userId\" = '$USER_ID' AND wa.chain = 'base';"
echo ""

echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Verify the user has all prerequisites"
echo "2. Get the user's wallet address for your test chain"
echo "3. Use that address in your Lightning Node API calls"
echo "4. Run: ./test-lightning-node.sh"

