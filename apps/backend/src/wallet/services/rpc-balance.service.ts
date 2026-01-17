import { Injectable, Logger } from '@nestjs/common';
import { ChainConfigService } from '../config/chain.config.js';
import { TokenListService } from './token-list.service.js';
import { IBalanceProvider } from '../interfaces/balance-provider.interface.js';

interface CachedData<T> {
    data: T;
    timestamp: number;
}

interface RpcResponse<T> {
    jsonrpc: string;
    id: number;
    result?: T;
    error?: {
        code: number;
        message: string;
    };
}

export interface TokenBalance {
    chain: string;
    address: string | null;
    symbol: string;
    balance: string;
    decimals: number;
    balanceHuman?: string;
    name?: string;
}

/**
 * Service to fetch token balances using direct RPC calls for EVM chains.
 * Initially explores public RPCs and can be extended to use Alchemy Enhanced APIs.
 */
@Injectable()
export class RpcBalanceService implements IBalanceProvider {
    private readonly logger = new Logger(RpcBalanceService.name);

    // In-memory cache
    private balanceCache = new Map<string, CachedData<TokenBalance[]>>();
    private readonly CACHE_TTL = 30 * 1000; // 30 seconds

    // Request deduplication
    private pendingRequests = new Map<string, Promise<TokenBalance[]>>();

    constructor(
        private chainConfig: ChainConfigService,
        private tokenListService: TokenListService,
    ) { }

    /**
     * Map chain variants (gasless, erc4337) to base EVM chain IDs
     */
    private mapToSourceChain(chain: string): string {
        const mapping: Record<string, string> = {
            ethereumErc4337: 'ethereum',
            baseErc4337: 'base',
            arbitrumErc4337: 'arbitrum',
            polygonErc4337: 'polygon',
            avalancheErc4337: 'avalanche',
            ethereumGasless: 'ethereum',
            baseGasless: 'base',
            arbitrumGasless: 'arbitrum',
            optimismGasless: 'optimism',
            polygonGasless: 'polygon',
            sepoliaGasless: 'sepolia',
            baseSepoliaGasless: 'baseSepolia',
        };
        return mapping[chain] || chain;
    }

    /**
     * Get all assets (native + tokens from list) for an address on an EVM chain
     */
    async getBalances(
        address: string,
        chain: string,
        forceRefresh: boolean = false,
    ): Promise<TokenBalance[]> {
        const sourceChain = this.mapToSourceChain(chain);
        if (!this.chainConfig.isEvmChain(sourceChain)) {
            return [];
        }

        const cacheKey = `${sourceChain}:${address.toLowerCase()}`;

        if (!forceRefresh) {
            const cached = this.balanceCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.data;
            }
        }

        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey)!;
        }

        const requestPromise = this.fetchBalances(address, chain);
        this.pendingRequests.set(cacheKey, requestPromise);

        try {
            const balances = await requestPromise;
            this.balanceCache.set(cacheKey, {
                data: balances,
                timestamp: Date.now(),
            });
            return balances;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    /**
     * Check if a chain is supported by RPC provider
     */
    isChainSupported(chain: string): boolean {
        const sourceChain = this.mapToSourceChain(chain);
        return this.chainConfig.isEvmChain(sourceChain as any);
    }

    private async fetchBalances(
        address: string,
        chain: string,
    ): Promise<TokenBalance[]> {
        const sourceChain = this.mapToSourceChain(chain);
        const balances: TokenBalance[] = [];
        const config = this.chainConfig.getEvmChainConfig(sourceChain as any);

        try {
            // 1. Fetch Native Balance
            const nativeBalanceHex = await this.makeRpcCall<string>(
                config.rpcUrl,
                'eth_getBalance',
                [address, 'latest'],
            );

            const nativeBalance = BigInt(nativeBalanceHex).toString();
            balances.push({
                chain,
                address: null,
                symbol: config.nativeCurrency.symbol,
                balance: nativeBalance,
                decimals: config.nativeCurrency.decimals,
                balanceHuman: this.convertWeiToHuman(nativeBalance, config.nativeCurrency.decimals),
                name: config.nativeCurrency.name,
            });

            // 2. Fetch Token Balances from List
            const tokens = this.tokenListService.getTokensForChain(sourceChain);
            if (tokens.length > 0) {
                // We could batch these if the RPC supports multicall, 
                // but for now we'll do individual calls with slight delays to avoid rate limits
                for (const token of tokens) {
                    try {
                        const balanceHex = await this.callTokenMethod<string>(
                            config.rpcUrl,
                            token.address,
                            'balanceOf',
                            [address],
                        );

                        if (balanceHex && balanceHex !== '0x' && balanceHex !== '0x0') {
                            const balance = BigInt(balanceHex).toString();
                            if (balance !== '0') {
                                const decimals = token.decimals || 18;
                                balances.push({
                                    chain,
                                    address: token.address,
                                    symbol: token.symbol,
                                    balance,
                                    decimals: decimals,
                                    balanceHuman: this.convertWeiToHuman(balance, decimals),
                                    name: token.name,
                                });
                            }
                        }
                    } catch (error: any) {
                        this.logger.debug(`Failed to fetch balance for token ${token.symbol} on ${chain}: ${error.message}`);
                    }
                    // Small delay to avoid aggressive rate limiting on public RPCs
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        } catch (error: any) {
            this.logger.error(`Failed to fetch balances for ${chain}: ${error.message}`);
        }

        return balances;
    }

    private async makeRpcCall<T>(
        rpcUrl: string,
        method: string,
        params: any[],
        retries = 3,
    ): Promise<T> {
        const requestId = Math.floor(Math.random() * 1000000);

        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method,
                        params,
                        id: requestId,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`RPC request failed with status ${response.status}`);
                }

                const data = (await response.json()) as RpcResponse<T>;
                if (data.error) {
                    throw new Error(`RPC error: ${data.error.message}`);
                }

                if (data.result === undefined) {
                    throw new Error('RPC response missing result');
                }

                return data.result;
            } catch (error) {
                if (attempt === retries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            }
        }
        throw new Error('RPC call failed');
    }

    private async callTokenMethod<T>(
        rpcUrl: string,
        tokenAddress: string,
        method: 'balanceOf' | 'decimals',
        params: any[],
    ): Promise<T> {
        let dataData: string;
        if (method === 'balanceOf') {
            const addr = params[0].startsWith('0x') ? params[0].slice(2) : params[0];
            dataData = `0x70a08231${addr.padStart(64, '0')}`;
        } else {
            dataData = '0x313ce567'; // decimals()
        }

        return this.makeRpcCall<T>(rpcUrl, 'eth_call', [
            { to: tokenAddress, data: dataData },
            'latest',
        ]);
    }

    private convertWeiToHuman(wei: string, decimals: number): string {
        const weiBigInt = BigInt(wei);
        const divisor = BigInt(10 ** decimals);
        const whole = weiBigInt / divisor;
        const remainder = weiBigInt % divisor;

        if (remainder === 0n) return whole.toString();

        const remainderStr = remainder.toString().padStart(decimals, '0');
        const trimmedRemainder = remainderStr.replace(/0+$/, '');
        return `${whole}.${trimmedRemainder}`;
    }
}
