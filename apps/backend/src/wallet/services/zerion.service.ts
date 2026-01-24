import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenBalance } from '../types/account.types.js';

@Injectable()
export class ZerionService {
  private readonly logger = new Logger(ZerionService.name);
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ZERION_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn(
        'ZERION_API_KEY not found in environment variables. Zerion API calls will fail.',
      );
    }
  }

  /**
   * Map internal chain identifiers to Zerion chain IDs
   * Zerion uses names like 'ethereum', 'base', 'polygon', etc.
   */
  private mapToZerionChain(chain: string): string {
    const mapping: Record<string, string> = {
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
      // Map variants to base chains
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
    };

    const mapped = mapping[chain];
    if (mapped) return mapped;

    // Fallback: convert camelCase to kebab-case (e.g., astarShibuya -> astar-shibuya)
    return chain
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  /**
   * Map Zerion chain IDs back to internal chain identifiers
   */
  private mapFromZerionChain(zerionChain: string): string {
    const mapping: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'base',
      arbitrum: 'arbitrum',
      polygon: 'polygon',
      avalanche: 'avalanche',
      optimism: 'optimism',
      sepolia: 'sepolia',
      'moonbeam-alpha': 'moonbeamTestnet',
      'astar-shibuya': 'astarShibuya',
      'paseo-assethub': 'paseoPassetHub',
    };

    return mapping[zerionChain] || zerionChain;
  }

  async getBalances(address: string, chain?: string, forceRefresh: boolean = false): Promise<TokenBalance[]> {
    if (!this.apiKey) {
      this.logger.error('Cannot fetch balances: ZERION_API_KEY is missing');
      return [];
    }

    const zerionChain = chain ? this.mapToZerionChain(chain) : null;
    const filterParam = zerionChain ? `&filter[chain_ids]=${zerionChain}` : '';
    const url = `https://api.zerion.io/v1/wallets/${address}/positions/?currency=usd${filterParam}`;

    try {
      this.logger.debug(`Fetching balances from Zerion for ${address} ${chain ? `on ${zerionChain}` : '(all chains)'}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Zerion API error (${response.status}): ${errorText}`);
        return [];
      }

      const json = (await response.json()) as any;
      const positions = json.data || [];

      return positions.map((pos: any) => {
        const attr = pos.attributes;
        const info = attr.fungible_info;
        const quantity = attr.quantity;

        // Extract chain ID from relationship
        const posZerionChain = pos.relationships?.chain?.data?.id;
        const internalChain = posZerionChain ? this.mapFromZerionChain(posZerionChain) : (chain || 'unknown');

        return {
          chain: internalChain,
          address: info?.implementations?.find((i: any) => i.chain_id === posZerionChain)?.address || null,
          symbol: info?.symbol || 'UNKNOWN',
          balance: quantity?.int || '0',
          decimals: quantity?.decimals || 18,
          balanceHuman: quantity?.float?.toString() || '0',
          name: info?.name || info?.symbol,
          usdValue: attr.value || 0,
          price: attr.price || 0,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch balances from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  async getTransactions(address: string, chain?: string): Promise<any[]> {
    if (!this.apiKey) {
      this.logger.error('Cannot fetch transactions: ZERION_API_KEY is missing');
      return [];
    }

    const zerionChain = chain ? this.mapToZerionChain(chain) : null;
    const filterParam = zerionChain ? `&filter[chain_ids]=${zerionChain}` : '';
    const url = `https://api.zerion.io/v1/wallets/${address}/transactions/${filterParam ? `?${filterParam.slice(1)}` : ''}`;

    try {
      this.logger.debug(`Fetching transactions from Zerion for ${address} ${chain ? `on ${zerionChain}` : '(all chains)'}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Zerion API error (${response.status}): ${errorText}`);
        return [];
      }

      const json = (await response.json()) as any;
      const transactions = json.data || [];

      return transactions.map((tx: any) => {
        const attr = tx.attributes;
        const txZerionChain = tx.relationships?.chain?.data?.id;
        const internalChain = txZerionChain ? this.mapFromZerionChain(txZerionChain) : (chain || 'unknown');

        return {
          txHash: attr.hash,
          from: attr.mintern_address || '',
          to: attr.address || '',
          value: attr.value?.toString() || '0',
          timestamp: attr.minit_at ? Math.floor(new Date(attr.minit_at).getTime() / 1000) : null,
          blockNumber: attr.block_number || null,
          status: 'success',
          chain: internalChain,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch transactions from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }
}
