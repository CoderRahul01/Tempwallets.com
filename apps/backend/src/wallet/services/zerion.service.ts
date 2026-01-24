import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenBalance, ZerionTransaction } from '../types/account.types.js';

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

  async getTransactions(address: string, chain?: string, limit: number = 50): Promise<ZerionTransaction[]> {
    if (!this.apiKey) {
      this.logger.error('Cannot fetch transactions: ZERION_API_KEY is missing');
      return [];
    }

    const zerionChainId = chain ? this.mapToZerionChain(chain) : '';

    try {
      const queryParams = new URLSearchParams({
        'filter[trash]': 'only_non_trash',
        'page[size]': limit.toString(),
      });
      if (zerionChainId) {
        queryParams.append('filter[chain_id]', zerionChainId);
      }

      const url = `https://api.zerion.io/v1/wallets/${address}/transactions/?${queryParams.toString()}`;
      this.logger.debug(`Fetching transactions from Zerion: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(this.apiKey + ':').toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Zerion API error (${response.status}): ${errorText}`);
        return [];
      }

      const json = (await response.json()) as any;
      const transactions = json.data || [];
      this.logger.debug(`Zerion returned ${transactions.length} transactions for ${address} on ${chain || 'all chains'}`);

      if (transactions.length > 0) {
        this.logger.debug(`First TX attributes: ${JSON.stringify(transactions[0].attributes).slice(0, 200)}...`);
      }

      return transactions.map((tx: any) => {
        const attr = tx?.attributes;
        const txZerionChain = tx?.relationships?.chain?.data?.id;
        const internalChain = txZerionChain ? this.mapFromZerionChain(txZerionChain) : (chain || 'unknown');

        // Parse transfers to find the "main" movement
        const transfers = attr?.transfers || [];

        // Logical priority for primary transfer:
        // 1. Non-fee native transfer
        // 2. Any fungible transfer with non-zero value
        // 3. First transfer in the list
        let primaryTransfer = transfers.find((t: any) => {
          const isNative = t.fungible_info?.implementations?.[0]?.address === null;
          // If native, ensure it's not JUST a fee (Zerion usually marks fees separately or we can check the footprint)
          // But simpler: just pick the one with the largest absolute value if multiple exist
          return t.fungible_info?.symbol !== undefined;
        });

        // If multiple transfers, pick the one that "looks" like the main payload (not a tiny fee)
        if (transfers.length > 1) {
          const sortedByValue = [...transfers].sort((a: any, b: any) =>
            Math.abs(b.value || 0) - Math.abs(a.value || 0)
          );
          primaryTransfer = sortedByValue[0];
        } else if (transfers.length === 1) {
          primaryTransfer = transfers[0];
        }

        const tokenAddress = primaryTransfer?.fungible_info?.implementations?.[0]?.address || null;

        // Native symbol mapping based on chain
        const getNativeSymbol = (c: string) => {
          if (c === 'polygon') return 'POL';
          if (['ethereum', 'base', 'arbitrum', 'optimism', 'sepolia'].includes(c)) return 'ETH';
          if (c === 'avalanche') return 'AVAX';
          if (c === 'solana') return 'SOL';
          return 'ETH';
        };

        const tokenSymbol = primaryTransfer?.fungible_info?.symbol || getNativeSymbol(internalChain);
        const decimals = primaryTransfer?.fungible_info?.implementations?.[0]?.decimals || 18;

        // Value: Use the quantity from the primary transfer if available, otherwise fallback to top-level value
        const rawValue = primaryTransfer?.quantity?.int || attr?.value?.toString() || '0';

        // Direction detection (more robust)
        const sentFrom = attr?.sent_from?.toLowerCase();
        const receivedBy = attr?.sent_to?.toLowerCase();
        const direction = sentFrom === address.toLowerCase() ? 'out' : 'in';

        // Zerion uses mined_at for confirmed transactions
        const timestampStr = attr?.mined_at || attr?.minit_at;
        const timestamp = timestampStr ? Math.floor(new Date(timestampStr).getTime() / 1000) : null;

        return {
          txHash: attr?.hash || '',
          from: sentFrom || attr?.mintern_address || '',
          to: receivedBy || attr?.address || '',
          value: rawValue,
          tokenSymbol,
          tokenAddress,
          tokenDecimals: decimals,
          timestamp,
          blockNumber: attr?.mined_at_block || attr?.block_number || null,
          status: attr?.status === 'confirmed' ? 'success' : (attr?.status === 'failed' ? 'failed' : 'pending'),
          chain: internalChain,
          type: attr?.operation_type || 'transaction',
          usdValue: primaryTransfer?.value || attr?.value || 0,
          direction
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch transactions from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }
}
