
export const MOCK_BALANCES = [
    {
        chain: 'ethereum',
        symbol: 'ETH',
        balance: '1500000000000000000',
        decimals: 18,
        balanceHuman: '1.5',
        isNative: true,
        address: null,
    },
    {
        chain: 'ethereum',
        symbol: 'USDC',
        balance: '500250000',
        decimals: 6,
        balanceHuman: '500.25',
        isNative: false,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    },
    {
        chain: 'ethereum',
        symbol: 'USDT',
        balance: '1898000',
        decimals: 6,
        balanceHuman: '1.898',
        isNative: false,
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    },
    {
        chain: 'solana',
        symbol: 'SOL',
        balance: '10500000000',
        decimals: 9,
        balanceHuman: '10.5',
        isNative: true,
        address: null,
    },
    {
        chain: 'bitcoin',
        symbol: 'BTC',
        balance: '1500000',
        decimals: 8,
        balanceHuman: '0.015',
        isNative: true,
        address: null,
    },
    {
        chain: 'polygon',
        symbol: 'MATIC',
        balance: '150000000000000000000',
        decimals: 18,
        balanceHuman: '150',
        isNative: true,
        address: null,
    }
];

export const MOCK_TRANSACTIONS = [
    {
        id: '1',
        type: 'send',
        chain: 'ethereum',
        symbol: 'ETH',
        amount: '0.1',
        status: 'completed',
        timestamp: Date.now() - 3600000,
        hash: '0x123...456',
    }
];
