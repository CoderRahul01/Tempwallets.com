import { TokenBalance } from '../types/account.types.js';

/**
 * Interface for services that provide token balance fetching capabilities
 */
export interface IBalanceProvider {
    /**
     * Get token balances for a specific address on a chain
     * @param address The wallet address
     * @param chain The internal chain identifier
     * @param forceRefresh Whether to bypass cache
     */
    getBalances(
        address: string,
        chain: string,
        forceRefresh?: boolean,
    ): Promise<TokenBalance[]>;

    /**
     * Get token balances for multiple chains in parallel
     * @param address The wallet address (assumed same for all chains, or mapping provided)
     * @param chains Array of internal chain identifiers
     */
    getBalancesAny?(
        address: string,
        chains: string[],
    ): Promise<TokenBalance[]>;

    /**
     * Check if this provider supports the given chain
     */
    isChainSupported(chain: string): boolean;
}
