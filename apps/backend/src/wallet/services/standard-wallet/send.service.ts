import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { NativeEoaFactory } from '../../factories/native-eoa.factory.js';
import { ChainMapService } from './chain-map.service.js';
import { TokenTransferParams } from '../../types/account.types.js';

@Injectable()
export class SendService {
    private readonly logger = new Logger(SendService.name);

    constructor(
        private readonly nativeEoaFactory: NativeEoaFactory,
        private readonly chainMap: ChainMapService,
    ) { }

    /**
     * Send native or ERC-20 tokens using standard EOA transactions.
     * @param seedPhrase - The mnemonic seed phrase
     * @param chain - Internal chain moniker
     * @param params - Transfer parameters (to, amount, tokenAddress)
     */
    async send(
        seedPhrase: string,
        chain: string,
        params: TokenTransferParams,
        accountIndex = 0
    ): Promise<{ txHash: string; method: string }> {
        this.logger.log(`[Standard Send] Sending ${params.amount} on ${chain} to ${params.to}`);

        // Validate EVM compatibility
        const evmChainId = this.chainMap.getEvmChainId(chain);
        if (!evmChainId) {
            throw new UnprocessableEntityException(`Chain ${chain} is not a supported EVM chain for standard transfers`);
        }

        // Create a standard EOA account using the existing factory
        // We cast the chain as any because NativeEoaFactory has a specific union type for chains
        const account = await this.nativeEoaFactory.createAccount(
            seedPhrase,
            chain as any,
            accountIndex
        );

        try {
            // Use the standard IAccount.transfer method implemented by NativeEoaAccountWrapper
            const result = await account.transfer(params);

            const txHash = typeof result === 'string'
                ? result
                : (result as any)?.hash || (result as any)?.txHash || String(result);

            this.logger.log(`[Standard Send] Transaction successful: ${txHash}`);

            return {
                txHash,
                method: params.tokenAddress ? 'erc20_transfer' : 'native_transfer'
            };
        } catch (error) {
            this.logger.error(`[Standard Send] Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

            // Re-throw with descriptive message
            const errorMessage = error instanceof Error ? error.message : 'Unknown transaction failure';
            throw new UnprocessableEntityException(`Standard EVM transfer failed on ${chain}: ${errorMessage}`);
        }
    }
}
