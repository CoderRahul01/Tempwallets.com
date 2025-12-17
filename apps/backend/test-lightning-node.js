/**
 * Lightning Node Testing Script (Node.js)
 * Tests all Lightning Node operations with real Yellow Network
 * 
 * Usage:
 *   node test-lightning-node.js
 * 
 * Environment Variables:
 *   API_BASE - Backend API URL (default: http://localhost:3001)
 *   USER_ID - Test user ID (default: test-user-123)
 *   PARTICIPANT_1 - First participant address
 *   PARTICIPANT_2 - Second participant address
 */

const https = require('https');
const http = require('http');

// Configuration
const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const USER_ID = process.env.USER_ID || 'test-user-123';
const PARTICIPANT_1 = process.env.PARTICIPANT_1 || '0x1234567890123456789012345678901234567890';
const PARTICIPANT_2 = process.env.PARTICIPANT_2 || '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

// Helper function to make API calls
async function apiCall(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}/lightning-node/${endpoint}`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Test functions
async function testCreate() {
  console.log(`${colors.yellow}Test 1: Creating Lightning Node...${colors.reset}`);
  
  const response = await apiCall('POST', 'create', {
    userId: USER_ID,
    participants: [PARTICIPANT_1, PARTICIPANT_2],
    token: 'usdc',
    chain: 'base',
    initialAllocations: [
      {
        participant: PARTICIPANT_1,
        amount: '100.0'
      }
    ]
  });

  console.log(JSON.stringify(response.data, null, 2));

  if (response.status !== 201 || !response.data.lightningNode) {
    throw new Error('Failed to create Lightning Node');
  }

  console.log(`${colors.green}✅ Lightning Node created${colors.reset}`);
  console.log(`   ID: ${response.data.lightningNode.id}`);
  console.log(`   App Session ID: ${response.data.lightningNode.appSessionId}`);
  console.log(`   URI: ${response.data.lightningNode.uri}\n`);

  return response.data.lightningNode;
}

async function testGetDetails(lightningNodeId) {
  console.log(`${colors.yellow}Test 2: Getting Lightning Node details...${colors.reset}`);
  
  const response = await apiCall('GET', `detail/${lightningNodeId}`);
  console.log(JSON.stringify(response.data, null, 2));
  console.log(`${colors.green}✅ Retrieved Lightning Node details${colors.reset}\n`);
}

async function testDeposit(appSessionId) {
  console.log(`${colors.yellow}Test 3: Depositing funds...${colors.reset}`);
  
  const response = await apiCall('POST', 'deposit', {
    userId: USER_ID,
    appSessionId: appSessionId,
    participantAddress: PARTICIPANT_2,
    amount: '50.0',
    asset: 'usdc'
  });

  console.log(JSON.stringify(response.data, null, 2));

  if (response.status !== 200 || !response.data.newBalance) {
    throw new Error('Failed to deposit funds');
  }

  console.log(`${colors.green}✅ Deposit successful${colors.reset}`);
  console.log(`   New balance: ${response.data.newBalance}\n`);
}

async function testTransfer(appSessionId) {
  console.log(`${colors.yellow}Test 4: Transferring funds...${colors.reset}`);
  
  const response = await apiCall('POST', 'transfer', {
    userId: USER_ID,
    appSessionId: appSessionId,
    fromAddress: PARTICIPANT_1,
    toAddress: PARTICIPANT_2,
    amount: '30.0',
    asset: 'usdc'
  });

  console.log(JSON.stringify(response.data, null, 2));

  if (response.status !== 200 || !response.data.senderNewBalance) {
    throw new Error('Failed to transfer funds');
  }

  console.log(`${colors.green}✅ Transfer successful${colors.reset}`);
  console.log(`   Sender balance: ${response.data.senderNewBalance}`);
  console.log(`   Recipient balance: ${response.data.recipientNewBalance}\n`);
}

async function testList() {
  console.log(`${colors.yellow}Test 5: Getting all Lightning Nodes for user...${colors.reset}`);
  
  const response = await apiCall('GET', USER_ID);
  console.log(JSON.stringify(response.data, null, 2));
  console.log(`${colors.green}✅ Retrieved user's Lightning Nodes${colors.reset}\n`);
}

async function testClose(appSessionId) {
  console.log(`${colors.yellow}Test 6: Closing Lightning Node...${colors.reset}`);
  
  const response = await apiCall('POST', 'close', {
    userId: USER_ID,
    appSessionId: appSessionId
  });

  console.log(JSON.stringify(response.data, null, 2));
  console.log(`${colors.green}✅ Lightning Node closed${colors.reset}\n`);
}

// Main test runner
async function runTests() {
  console.log('🚀 Testing Lightning Node with Yellow Network');
  console.log('==============================================');
  console.log(`API Base: ${API_BASE}`);
  console.log(`User ID: ${USER_ID}`);
  console.log(`Participant 1: ${PARTICIPANT_1}`);
  console.log(`Participant 2: ${PARTICIPANT_2}\n`);

  try {
    // Run tests in sequence
    const lightningNode = await testCreate();
    await testGetDetails(lightningNode.id);
    await testDeposit(lightningNode.appSessionId);
    await testTransfer(lightningNode.appSessionId);
    await testList();
    await testClose(lightningNode.appSessionId);

    console.log(`${colors.green}🎉 All tests completed successfully!${colors.reset}`);
  } catch (error) {
    console.error(`${colors.red}❌ Test failed: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Run tests
runTests();

