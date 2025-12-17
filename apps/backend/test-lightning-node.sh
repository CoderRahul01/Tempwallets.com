#!/bin/bash

# Lightning Node Testing Script
# Tests all Lightning Node operations with real Yellow Network
# 
# IMPORTANT: User must have:
# - Wallet created
# - Seed phrase stored
# - Wallet addresses for the chain
#
# Usage:
#   USER_ID=your-user-id USER_WALLET=0x... PARTICIPANT_2=0x... ./test-lightning-node.sh

set -e

# Configuration
API_BASE="${API_BASE:-http://localhost:3001}"
USER_ID="${USER_ID:-}"

# User's wallet address (required - get from database)
USER_WALLET="${USER_WALLET:-}"

# Second participant address (optional - can be another user's wallet)
PARTICIPANT_2="${PARTICIPANT_2:-}"

# Chain to test (default: base)
CHAIN="${CHAIN:-base}"

echo "🚀 Testing Lightning Node with Yellow Network"
echo "=============================================="
echo "API Base: $API_BASE"
echo "User ID: $USER_ID"
echo "User Wallet: $USER_WALLET"
echo "Chain: $CHAIN"
echo ""

# Validate required variables
if [ -z "$USER_ID" ]; then
    echo "❌ ERROR: USER_ID is required"
    echo "Usage: USER_ID=your-user-id USER_WALLET=0x... ./test-lightning-node.sh"
    exit 1
fi

if [ -z "$USER_WALLET" ]; then
    echo "❌ ERROR: USER_WALLET is required"
    echo "Get the user's wallet address from the database:"
    echo "  SELECT address FROM \"WalletAddress\" WHERE \"walletId\" IN (SELECT id FROM \"Wallet\" WHERE \"userId\" = '$USER_ID') AND chain = '$CHAIN';"
    echo ""
    echo "Usage: USER_ID=$USER_ID USER_WALLET=0x... ./test-lightning-node.sh"
    exit 1
fi

# Use user's wallet as participant 1, and provided address or generate a second one
PARTICIPANT_1="$USER_WALLET"
if [ -z "$PARTICIPANT_2" ]; then
    echo "⚠️  WARNING: PARTICIPANT_2 not set. Using a placeholder address."
    echo "   For real testing, provide a second participant address."
    PARTICIPANT_2="0x0000000000000000000000000000000000000001"
fi

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        curl -s -X $method "$API_BASE/lightning-node/$endpoint" \
            -H "Content-Type: application/json"
    else
        curl -s -X $method "$API_BASE/lightning-node/$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Test 1: Create Lightning Node
echo -e "${YELLOW}Test 1: Creating Lightning Node...${NC}"
echo "   Using user wallet: $USER_WALLET"
echo "   Second participant: $PARTICIPANT_2"
CREATE_RESPONSE=$(api_call POST create "{
    \"userId\": \"$USER_ID\",
    \"participants\": [\"$PARTICIPANT_1\", \"$PARTICIPANT_2\"],
    \"token\": \"usdc\",
    \"chain\": \"$CHAIN\",
    \"initialAllocations\": [
        {
            \"participant\": \"$PARTICIPANT_1\",
            \"amount\": \"100.0\"
        }
    ]
}")

echo "$CREATE_RESPONSE" | jq '.'

LIGHTNING_NODE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.lightningNode.id // empty')
APP_SESSION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.lightningNode.appSessionId // empty')
URI=$(echo "$CREATE_RESPONSE" | jq -r '.lightningNode.uri // empty')

if [ -z "$LIGHTNING_NODE_ID" ] || [ "$LIGHTNING_NODE_ID" == "null" ]; then
    echo -e "${RED}❌ Failed to create Lightning Node${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Lightning Node created${NC}"
echo "   ID: $LIGHTNING_NODE_ID"
echo "   App Session ID: $APP_SESSION_ID"
echo "   URI: $URI"
echo ""

# Test 2: Get Lightning Node details
echo -e "${YELLOW}Test 2: Getting Lightning Node details...${NC}"
GET_RESPONSE=$(api_call GET "detail/$LIGHTNING_NODE_ID")
echo "$GET_RESPONSE" | jq '.'
echo -e "${GREEN}✅ Retrieved Lightning Node details${NC}"
echo ""

# Test 3: Deposit funds (to user's own wallet in the Lightning Node)
echo -e "${YELLOW}Test 3: Depositing funds...${NC}"
echo "   Depositing to user's wallet: $USER_WALLET"
DEPOSIT_RESPONSE=$(api_call POST deposit "{
    \"userId\": \"$USER_ID\",
    \"appSessionId\": \"$APP_SESSION_ID\",
    \"participantAddress\": \"$USER_WALLET\",
    \"amount\": \"50.0\",
    \"asset\": \"usdc\"
}")

echo "$DEPOSIT_RESPONSE" | jq '.'
NEW_BALANCE=$(echo "$DEPOSIT_RESPONSE" | jq -r '.newBalance // empty')

if [ -z "$NEW_BALANCE" ] || [ "$NEW_BALANCE" == "null" ]; then
    echo -e "${RED}❌ Failed to deposit funds${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Deposit successful${NC}"
echo "   New balance: $NEW_BALANCE"
echo ""

# Test 4: Transfer funds (from user's wallet to second participant)
echo -e "${YELLOW}Test 4: Transferring funds...${NC}"
echo "   From: $USER_WALLET"
echo "   To: $PARTICIPANT_2"
TRANSFER_RESPONSE=$(api_call POST transfer "{
    \"userId\": \"$USER_ID\",
    \"appSessionId\": \"$APP_SESSION_ID\",
    \"fromAddress\": \"$USER_WALLET\",
    \"toAddress\": \"$PARTICIPANT_2\",
    \"amount\": \"30.0\",
    \"asset\": \"usdc\"
}")

echo "$TRANSFER_RESPONSE" | jq '.'

SENDER_BALANCE=$(echo "$TRANSFER_RESPONSE" | jq -r '.senderNewBalance // empty')
RECIPIENT_BALANCE=$(echo "$TRANSFER_RESPONSE" | jq -r '.recipientNewBalance // empty')

if [ -z "$SENDER_BALANCE" ] || [ "$SENDER_BALANCE" == "null" ]; then
    echo -e "${RED}❌ Failed to transfer funds${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Transfer successful${NC}"
echo "   Sender balance: $SENDER_BALANCE"
echo "   Recipient balance: $RECIPIENT_BALANCE"
echo ""

# Test 5: Get all Lightning Nodes for user
echo -e "${YELLOW}Test 5: Getting all Lightning Nodes for user...${NC}"
LIST_RESPONSE=$(api_call GET "$USER_ID")
echo "$LIST_RESPONSE" | jq '.'
echo -e "${GREEN}✅ Retrieved user's Lightning Nodes${NC}"
echo ""

# Test 6: Close Lightning Node
echo -e "${YELLOW}Test 6: Closing Lightning Node...${NC}"
CLOSE_RESPONSE=$(api_call POST close "{
    \"userId\": \"$USER_ID\",
    \"appSessionId\": \"$APP_SESSION_ID\"
}")

echo "$CLOSE_RESPONSE" | jq '.'
echo -e "${GREEN}✅ Lightning Node closed${NC}"
echo ""

echo -e "${GREEN}🎉 All tests completed successfully!${NC}"

