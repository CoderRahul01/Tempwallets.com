import { TokenBalance } from '../types/account.types.js';

// Simplified dummy data for UI testing
export const MOCK_TOKEN_BALANCES: TokenBalance[] = [
    {
        chain: 'ethereum',
        symbol: 'ETH',
        address: null,
        decimals: 18,
        balance: '1250000000000000000',
        balanceHuman: '1.25',
        name: 'Ether',
    },
];

export const MOCK_TRANSACTIONS = [
    {
        type: 'transaction',
        id: 'mock-tx-1',
        attributes: {
            hash: '0x123...456',
            operation_type: 'send',
            mined_at: Math.floor(Date.now() / 1000) - 3600,
            status: 'confirmed',
            fee: { value_usd: 1.5 },
            transfers: [
                {
                    direction: 'out',
                    quantity: { float: 0.1 },
                    fungible_info: { symbol: 'ETH' },
                },
            ],
        },
        relationships: {
            chain: { data: { id: 'eth' } },
        },
    },
];
