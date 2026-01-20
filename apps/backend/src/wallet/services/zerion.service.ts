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

  async getBalances(address: string, chain: string): Promise<TokenBalance[]> {
    if (!this.apiKey) {
      this.logger.error('Cannot fetch balances: ZERION_API_KEY is missing');
      return [];
    }

    const zerionChain = this.mapToZerionChain(chain);
    const url = `https://api.zerion.io/v1/wallets/${address}/positions/?filter[chain_ids]=${zerionChain}&currency=usd`;

    try {
      this.logger.debug(`Fetching balances from Zerion for ${address} on ${zerionChain}`);
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

        return {
          chain: chain,
          address: info?.implementations?.find((i: any) => i.chain_id === zerionChain)?.address || null,
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

  async getTransactions(address: string, chain: string): Promise<any[]> {
    if (!this.apiKey) {
      this.logger.error('Cannot fetch transactions: ZERION_API_KEY is missing');
      return [];
    }

    const zerionChain = this.mapToZerionChain(chain);
    const url = `https://api.zerion.io/v1/wallets/${address}/transactions/?filter[chain_ids]=${zerionChain}`;

    try {
      this.logger.debug(`Fetching transactions from Zerion for ${address} on ${zerionChain}`);
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
        // Basic mapping, WalletService will refine this
        return {
          txHash: attr.hash,
          from: attr.mintern_address || '', // Typical field in Zerion V1 for sender
          to: attr.address || '',
          value: attr.value?.toString() || '0',
          timestamp: attr.minit_at ? Math.floor(new Date(attr.minit_at).getTime() / 1000) : null,
          blockNumber: attr.block_number || null,
          status: 'success', // Zerion mostly returns confirmed transactions
          chain: chain,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch transactions from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }
}
