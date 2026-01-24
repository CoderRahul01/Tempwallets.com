import { Injectable, Logger } from '@nestjs/common';
import { ZerionService } from '../zerion.service.js';
import { ChainMapService } from './chain-map.service.js';
import { TokenBalance } from '../../types/account.types.js';

@Injectable()
export class BalanceService {
    private readonly logger = new Logger(BalanceService.name);

    constructor(
        private readonly zerionService: ZerionService,
        private readonly chainMap: ChainMapService,
    ) { }

    /**
     * Fetch balances for a specific address and chain using Zerion.
     * @param address - EVM address to check
     * @param chain - Internal chain moniker
     * @returns Array of token balances
     */
    async getBalances(address: string, chain?: string): Promise<TokenBalance[]> {
        this.logger.debug(`Fetching balances for ${address} ${chain ? `on ${chain}` : '(all chains)'}`);

        // Use ZerionService which handles the heavy lifting
        const balances = await this.zerionService.getBalances(address, chain);

        // The ZerionService already returns internal chain monikers if it can map them,
        // but we ensure consistency here.
        return balances.map(b => ({
            ...b,
            chain: this.chainMap.mapFromZerionChain(b.chain)
        }));
    }

    /**
     * Validate if an address has sufficient balance for a specific amount.
     */
    async hasSufficientBalance(
        address: string,
        chain: string,
        amountSmallest: bigint,
        tokenAddress?: string
    ): Promise<{ sufficient: boolean; currentBalance: string; error?: string }> {
        const balances = await this.getBalances(address, chain);

        const token = tokenAddress
            ? balances.find(b => b.address?.toLowerCase() === tokenAddress.toLowerCase())
            : balances.find(b => !b.address); // Native token usually has no address in Zerion response

        if (!token) {
            return {
                sufficient: false,
                currentBalance: '0',
                error: `Token ${tokenAddress || 'Native'} not found on chain ${chain}`
            };
        }

        const currentBalance = BigInt(token.balance);
        const sufficient = currentBalance >= amountSmallest;

        return {
            sufficient,
            currentBalance: token.balance,
            error: sufficient ? undefined : `Insufficient balance. Required: ${amountSmallest}, Available: ${currentBalance}`
        };
    }
}
