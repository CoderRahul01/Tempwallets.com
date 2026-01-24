import { Injectable, Logger } from '@nestjs/common';
import { Address } from 'viem';

@Injectable()
export class ReceiveService {
    private readonly logger = new Logger(ReceiveService.name);

    /**
     * Get the deposit address for a specific chain and user.
     * @param address - The wallet address
     * @param chain - Internal chain moniker
     * @returns Object containing address and display metadata
     */
    async getReceiveInfo(address: string, chain: string) {
        this.logger.debug(`Generating receive info for ${address} on ${chain}`);

        return {
            address,
            chain,
            qrMetadata: `ethereum:${address}@${this.getChainIdForQr(chain)}`,
            instructions: `Send native tokens or any ERC-20 token on the ${chain} network to this address.`,
        };
    }

    /**
     * Helper to get numeric chain ID for QR code metadata (EIP-681 / EIP-831 style)
     */
    private getChainIdForQr(chain: string): number {
        const ids: Record<string, number> = {
            ethereum: 1,
            polygon: 137,
            base: 8453,
            arbitrum: 42161,
            optimism: 10,
            avalanche: 43114,
        };
        return ids[chain] || 1;
    }
}
