import { Injectable } from '@nestjs/common';

@Injectable()
export class ChainMapService {
    /**
     * Universal mapping between internal chain identifiers and Zerion chain IDs.
     */
    private readonly zerionMapping: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum',
        polygon: 'polygon',
        avalanche: 'avalanche',
        optimism: 'optimism',
        sepolia: 'sepolia',
        moonbeamTestnet: 'moonbeam-alpha',
        astarShibuya: 'astar-shibuya',
        paseoPassetHub: 'paseo-assethub',
    };

    /**
     * Mapping between internal chain identifiers and numeric EVM chain IDs.
     */
    private readonly evmChainIdMapping: Record<string, number> = {
        ethereum: 1,
        base: 8453,
        arbitrum: 42161,
        polygon: 137,
        avalanche: 43114,
        optimism: 10,
        sepolia: 11155111,
        polygonAmoy: 80002,
        baseSepolia: 84532,
    };

    /**
     * Get Zerion chain ID for internal chain moniker.
     */
    mapToZerionChain(chain: string): string {
        // Handle gasless variants by stripping the suffix
        const baseChain = chain.replace('Erc4337', '').replace('Gasless', '');
        return this.zerionMapping[baseChain] || baseChain.toLowerCase();
    }

    /**
     * Get internal chain moniker from Zerion chain ID.
     */
    mapFromZerionChain(zerionChain: string): string {
        const reverseMapping: Record<string, string> = Object.entries(this.zerionMapping).reduce(
            (acc, [key, value]) => ({ ...acc, [value]: key }),
            {},
        );
        return reverseMapping[zerionChain] || zerionChain;
    }

    /**
     * Get numeric EVM chain ID for internal chain moniker.
     */
    getEvmChainId(chain: string): number | undefined {
        const baseChain = chain.replace('Erc4337', '').replace('Gasless', '');
        return this.evmChainIdMapping[baseChain];
    }

    /**
     * Get internal chain moniker from numeric EVM chain ID.
     */
    getChainFromId(chainId: number): string | undefined {
        const reverseMapping: Record<number, string> = Object.entries(this.evmChainIdMapping).reduce(
            (acc, [key, value]) => ({ ...acc, [value]: key }),
            {},
        );
        return reverseMapping[chainId];
    }

    /**
     * Check if a chain is a testnet.
     */
    isTestnet(chain: string): boolean {
        const testnets = ['sepolia', 'polygonAmoy', 'baseSepolia', 'moonbeamTestnet', 'astarShibuya', 'paseoPassetHub'];
        const baseChain = chain.replace('Erc4337', '').replace('Gasless', '');
        return testnets.some(t => baseChain.toLowerCase().includes(t.toLowerCase()));
    }
}
