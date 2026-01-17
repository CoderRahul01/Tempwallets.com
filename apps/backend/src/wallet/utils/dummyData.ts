import { TokenBalance } from '../zerion.service.js';

export const MOCK_TOKEN_BALANCES: TokenBalance[] = [
    {
        chain: 'ethereum',
        symbol: 'ETH',
        address: null,
        decimals: 18,
        balanceSmallest: '1250000000000000000',
        balanceHuman: 1.25,
        name: 'Ether',
    },
    {
        chain: 'ethereum',
        symbol: 'USDC',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        balanceSmallest: '500000000',
        balanceHuman: 500.0,
        name: 'USD Coin',
    },
    {
        chain: 'ethereum',
        symbol: 'USDT',
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        decimals: 6,
        balanceSmallest: '1898000',
        balanceHuman: 1.898,
        name: 'Tether USD',
    },
    {
        chain: 'bitcoin',
        symbol: 'BTC',
        address: null,
        decimals: 8,
        balanceSmallest: '1500000',
        balanceHuman: 0.015,
        name: 'Bitcoin',
    },
    {
        chain: 'base',
        symbol: 'ETH',
        address: null,
        decimals: 18,
        balanceSmallest: '450000000000000000',
        balanceHuman: 0.45,
        name: 'Ether',
    },
    {
        chain: 'polygon',
        symbol: 'MATIC',
        address: null,
        decimals: 18,
        balanceSmallest: '150000000000000000000',
        balanceHuman: 150.0,
        name: 'MATIC',
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
