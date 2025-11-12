import { Injectable, BadRequestException, Logger, UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import WalletManagerTron from '@tetherto/wdk-wallet-tron';
import WalletManagerBtc from '@tetherto/wdk-wallet-btc';
import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import WalletManagerEvmErc4337 from '@tetherto/wdk-wallet-evm-erc-4337';
import { SeedRepository } from './seed.repository.js';
import { ZerionService } from './zerion.service.js';

export interface WalletAddresses {
  ethereum: string;
  base: string;
  arbitrum: string;
  polygon: string;
  tron: string;
  bitcoin: string;
  solana: string;
  ethereumErc4337: string;
  baseErc4337: string;
  arbitrumErc4337: string;
  polygonErc4337: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  // Cache for discovered tokens: userId:chain -> { tokens, timestamp }
  private tokenCache: Map<string, { tokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }>; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  // Cache for addresses per user to avoid repeated fetching
  private addressCache: Map<string, { addresses: WalletAddresses; timestamp: number }> = new Map();
  private readonly ADDRESS_CACHE_TTL = 60 * 1000; // 1 minute cache (addresses don't change often)

  constructor(
    private seedRepository: SeedRepository,
    private configService: ConfigService,
    private zerionService: ZerionService,
  ) {}

  /**
   * Create or import a wallet seed phrase
   * @param userId - The user ID
   * @param mode - Either 'random' to generate or 'mnemonic' to import
   * @param mnemonic - The mnemonic phrase (required if mode is 'mnemonic')
   */
  async createOrImportSeed(
    userId: string,
    mode: 'random' | 'mnemonic',
    mnemonic?: string,
  ): Promise<void> {
    let seedPhrase: string;

    if (mode === 'random') {
      seedPhrase = WDK.getRandomSeedPhrase();
      this.logger.log(`Generated random seed phrase for user ${userId}`);
    } else if (mode === 'mnemonic') {
      if (!mnemonic) {
        throw new BadRequestException('Mnemonic is required when mode is "mnemonic"');
      }
      // Basic validation - should be 12 or 24 words
      const words = mnemonic.trim().split(/\s+/);
      if (words.length !== 12 && words.length !== 24) {
        throw new BadRequestException('Mnemonic must be 12 or 24 words');
      }
      seedPhrase = mnemonic;
      this.logger.log(`Imported mnemonic for user ${userId}`);
    } else {
      throw new BadRequestException('Mode must be either "random" or "mnemonic"');
    }

    await this.seedRepository.createOrUpdateSeed(userId, seedPhrase);
  }

  /**
   * Get all wallet addresses for all chains
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Object containing addresses for all chains
   */
  async getAddresses(userId: string): Promise<WalletAddresses> {
    // Check cache first to avoid repeated fetching
    const cached = this.addressCache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.ADDRESS_CACHE_TTL) {
      this.logger.debug(`Using cached addresses for user ${userId}`);
      return cached.addresses;
    }

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    const seedPhrase = await this.seedRepository.getSeedPhrase(userId);

    const wdk = this.createWdkInstance(seedPhrase);

    const accounts = {
      ethereum: await wdk.getAccount('ethereum', 0),
      base: await wdk.getAccount('base', 0),
      arbitrum: await wdk.getAccount('arbitrum', 0),
      polygon: await wdk.getAccount('polygon', 0),
      tron: await wdk.getAccount('tron', 0),
      bitcoin: await wdk.getAccount('bitcoin', 0),
      solana: await wdk.getAccount('solana', 0),
      ethereumErc4337: await wdk.getAccount('ethereum-erc4337', 0),
      baseErc4337: await wdk.getAccount('base-erc4337', 0),
      arbitrumErc4337: await wdk.getAccount('arbitrum-erc4337', 0),
      polygonErc4337: await wdk.getAccount('polygon-erc4337', 0),
    };

    const addresses: Partial<WalletAddresses> = {};

    for (const [chain, account] of Object.entries(accounts)) {
      try {
        const address = await account.getAddress();
        addresses[chain as keyof WalletAddresses] = address;
        this.logger.debug(`Successfully got address for ${chain}: ${address}`);
      } catch (error) {
        this.logger.error(`Error getting address for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        addresses[chain as keyof WalletAddresses] = null as any;
      }
    }

    const result = addresses as WalletAddresses;
    // Cache the addresses
    this.addressCache.set(userId, { addresses: result, timestamp: Date.now() });
    
    return result;
  }

  /**
   * Get all token positions across any supported chains for the user's primary addresses
   * Uses Zerion any-chain endpoints per address (no chain filter) and merges results.
   * Primary addresses considered: EVM EOA (ethereum), first ERC-4337 smart account, and Solana.
   */
  async getTokenBalancesAny(userId: string): Promise<Array<{ chain: string; address: string | null; symbol: string; balance: string; decimals: number }>> {
    // Ensure wallet exists
    const hasSeed = await this.seedRepository.hasSeed(userId);
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    const addresses = await this.getAddresses(userId);
    const erc4337Address = [
      addresses.ethereumErc4337,
      addresses.baseErc4337,
      addresses.arbitrumErc4337,
      addresses.polygonErc4337,
    ].find((a) => !!a) || null;

    const targetAddresses = [addresses.ethereum, erc4337Address, addresses.solana].filter(Boolean) as string[];
    if (targetAddresses.length === 0) return [];

    // Fetch positions for each address in parallel
    const results = await Promise.all(
      targetAddresses.map((addr) => this.zerionService.getPositionsAnyChain(addr))
    );

    // Merge and dedupe across addresses using chain_id + token address/native
    const byKey = new Map<string, { chain: string; address: string | null; symbol: string; balance: string; decimals: number }>();

    for (const res of results) {
      if (!res || !Array.isArray(res.data)) continue;
      for (const tokenData of res.data) {
        try {
          const chainId = tokenData.relationships?.chain?.data?.id || 'unknown';
          const quantity = tokenData.attributes?.quantity;
          if (!quantity) continue;

          const intPart = quantity.int || '0';
          const decimals = quantity.decimals || 0;
          const balance = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
          if (parseFloat(balance) === 0) continue;

          const fungible = tokenData.attributes?.fungible_info;
          const implAddr = fungible?.implementations?.[0]?.address || null;
          const isNative = tokenData.type === 'native' || !fungible;
          const nativeSymbolByChain: Record<string, string> = {
            ethereum: 'ETH',
            base: 'ETH',
            arbitrum: 'ETH',
            polygon: 'MATIC',
            solana: 'SOL',
          };
          const nativeDecimalsByChain: Record<string, number> = {
            ethereum: 18,
            base: 18,
            arbitrum: 18,
            polygon: 18,
            solana: 9,
          };
          const symbol = isNative ? (nativeSymbolByChain[chainId] || 'NATIVE') : (fungible?.symbol || 'UNKNOWN');
          const tokenDecimals = isNative ? (nativeDecimalsByChain[chainId] ?? 18) : (fungible?.decimals || 18);

          const key = `${chainId}:${implAddr ? implAddr.toLowerCase() : 'native'}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              chain: chainId,
              address: implAddr ? implAddr : null,
              symbol,
              balance,
              decimals: tokenDecimals,
            });
          }
        } catch (e) {
          this.logger.debug(`Error processing any-chain token: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
    }

    return Array.from(byKey.values());
  }

  /**
   * Get transactions across any supported chains for the user's primary addresses
   * Merges and dedupes by chain_id + tx hash.
   */
  async getTransactionsAny(userId: string, limit: number = 100): Promise<Array<{
    txHash: string;
    from: string;
    to: string | null;
    value: string;
    timestamp: number | null;
    blockNumber: number | null;
    status: 'success' | 'failed' | 'pending';
    chain: string;
    tokenSymbol?: string;
    tokenAddress?: string;
  }>> {
    const hasSeed = await this.seedRepository.hasSeed(userId);
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    const addresses = await this.getAddresses(userId);
    const erc4337Address = [
      addresses.ethereumErc4337,
      addresses.baseErc4337,
      addresses.arbitrumErc4337,
      addresses.polygonErc4337,
    ].find((a) => !!a) || null;

    const targetAddresses = [addresses.ethereum, erc4337Address, addresses.solana].filter(Boolean) as string[];
    if (targetAddresses.length === 0) return [];

    const perAddr = await Promise.all(
      targetAddresses.map((addr) => this.zerionService.getTransactionsAnyChain(addr, limit))
    );

    const byKey = new Map<string, {
      txHash: string;
      from: string;
      to: string | null;
      value: string;
      timestamp: number | null;
      blockNumber: number | null;
      status: 'success' | 'failed' | 'pending';
      chain: string;
      tokenSymbol?: string;
      tokenAddress?: string;
    }>();

    for (const list of perAddr) {
      for (const tx of list) {
        try {
          const attrs = tx.attributes || {};
          const chainId = tx.relationships?.chain?.data?.id?.toLowerCase() || 'unknown';
          const hash = (attrs.hash || tx.id || '').toLowerCase();
          if (!hash) continue;

          // Determine status
          let status: 'success' | 'failed' | 'pending' = 'pending';
          if (attrs.status) {
            const s = attrs.status.toLowerCase();
            if (s === 'confirmed' || s === 'success') status = 'success';
            else if (s === 'failed' || s === 'error') status = 'failed';
          } else if (attrs.block_confirmations !== undefined && attrs.block_confirmations > 0) {
            status = 'success';
          }

          const transfers = attrs.transfers || [];
          let tokenSymbol: string | undefined;
          let tokenAddress: string | undefined;
          let value = '0';
          let toAddress: string | null = null;

          if (transfers.length > 0) {
            const tr = transfers[0];
            if (tr) {
              tokenSymbol = tr.fungible_info?.symbol;
              const q = tr.quantity;
              if (q) {
                const intPart = q.int || '0';
                const decimals = q.decimals || 0;
                value = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
              }
              toAddress = tr.to?.address || null;
            }
          }

          const key = `${chainId}:${hash}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              txHash: hash,
              from: '',
              to: toAddress,
              value,
              timestamp: attrs.mined_at || attrs.sent_at || null,
              blockNumber: attrs.block_number || null,
              status,
              chain: chainId,
              tokenSymbol,
              tokenAddress,
            });
          }
        } catch (e) {
          this.logger.debug(`Error processing any-chain tx: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
    }

    return Array.from(byKey.values());
  }

  /**
   * Stream addresses progressively (for SSE)
   * Yields addresses as they become available
   */
  async *streamAddresses(userId: string): AsyncGenerator<{ chain: string; address: string | null }, void, unknown> {
    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
    const wdk = this.createWdkInstance(seedPhrase);

    const chains = [
      'ethereum',
      'tron',
      'bitcoin',
      'solana',
      'ethereumErc4337',
      'baseErc4337',
      'arbitrumErc4337',
      'polygonErc4337',
    ];

    const wdkChainMap: Record<string, string> = {
      ethereum: 'ethereum',
      tron: 'tron',
      bitcoin: 'bitcoin',
      solana: 'solana',
      ethereumErc4337: 'ethereum-erc4337',
      baseErc4337: 'base-erc4337',
      arbitrumErc4337: 'arbitrum-erc4337',
      polygonErc4337: 'polygon-erc4337',
    };

    // Process each chain independently and yield immediately
    for (const chain of chains) {
      try {
        const wdkChain = wdkChainMap[chain];
        if (!wdkChain) {
          yield { chain, address: null };
          continue;
        }

        const account = await wdk.getAccount(wdkChain, 0);
        const address = await account.getAddress();
        yield { chain, address };
        this.logger.log(`Streamed address for ${chain}: ${address}`);
      } catch (error) {
        this.logger.error(`Error getting address for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        yield { chain, address: null };
      }
    }
  }

  /**
   * Stream balances progressively (for SSE)
   * Yields balances as they're fetched from Zerion
   */
  async *streamBalances(userId: string): AsyncGenerator<{
    chain: string;
    nativeBalance: string;
    tokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }>;
  }, void, unknown> {
    // Get addresses first
    const addresses = await this.getAddresses(userId);

    // Process each chain independently
    for (const [chain, address] of Object.entries(addresses)) {
      if (!address) {
        yield { chain, nativeBalance: '0', tokens: [] };
        continue;
      }

      try {
        // Get token balances from Zerion (includes native + tokens)
        const tokens = await this.getTokenBalances(userId, chain);
        const nativeToken = tokens.find(t => t.address === null);
        const otherTokens = tokens.filter(t => t.address !== null);

        yield {
          chain,
          nativeBalance: nativeToken?.balance || '0',
          tokens: otherTokens,
        };
      } catch (error) {
        this.logger.error(`Error streaming balance for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        yield { chain, nativeBalance: '0', tokens: [] };
      }
    }
  }

  /**
   * Get balances for all chains using Zerion API
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Array of balance objects
   */
  async getBalances(userId: string): Promise<Array<{ chain: string; balance: string }>> {
    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    // Get addresses first (using WDK - addresses stay on backend)
    const addresses = await this.getAddresses(userId);

    const balances: Array<{ chain: string; balance: string }> = [];

    // For each chain, get balance from Zerion
    for (const [chain, address] of Object.entries(addresses)) {
      if (!address) {
        balances.push({ chain, balance: '0' });
        continue;
      }

      try {
        // Get portfolio from Zerion
        const portfolio = await this.zerionService.getPortfolio(address, chain);
        
        if (!portfolio?.data || !Array.isArray(portfolio.data)) {
          // Zerion doesn't support this chain or returned no data
          balances.push({ chain, balance: '0' });
          continue;
        }

        // Find native token in portfolio
        const nativeToken = portfolio.data.find(
          (token) => token.type === 'native' || !token.attributes?.fungible_info
        );

        let balance = '0';
        if (nativeToken?.attributes?.quantity) {
          const quantity = nativeToken.attributes.quantity;
          // Combine int and decimals parts
          const intPart = quantity.int || '0';
          const decimals = quantity.decimals || 0;
          balance = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
        }

        balances.push({
          chain,
          balance,
        });
        
        this.logger.log(`Successfully got balance for ${chain} from Zerion: ${balance}`);
      } catch (error) {
        this.logger.error(`Error fetching balance for ${chain} from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Fallback: try WDK if Zerion fails
        try {
          const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
          const wdk = this.createWdkInstance(seedPhrase);
          const wdkChainMap: Record<string, string> = {
            ethereum: 'ethereum',
            base: 'base',
            arbitrum: 'arbitrum',
            polygon: 'polygon',
            tron: 'tron',
            bitcoin: 'bitcoin',
            solana: 'solana',
            ethereumErc4337: 'ethereum-erc4337',
            baseErc4337: 'base-erc4337',
            arbitrumErc4337: 'arbitrum-erc4337',
            polygonErc4337: 'polygon-erc4337',
          };
          const wdkChain = wdkChainMap[chain];
          if (wdkChain) {
            const account = await wdk.getAccount(wdkChain, 0);
            const wdkBalance = await account.getBalance();
            balances.push({
              chain,
              balance: wdkBalance.toString(),
            });
            this.logger.log(`Fallback to WDK for ${chain}: ${wdkBalance.toString()}`);
          } else {
            balances.push({ chain, balance: '0' });
          }
        } catch (fallbackError) {
          this.logger.error(`Fallback to WDK also failed for ${chain}`);
          balances.push({ chain, balance: '0' });
        }
      }
    }

    return balances;
  }

  /**
   * Get ERC-4337 paymaster token balances
   * @param userId - The user ID
   * @returns Array of paymaster token balances
   */
  async getErc4337PaymasterBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
    const wdk = this.createWdkInstance(seedPhrase);

    const erc4337Accounts = {
      Ethereum: await wdk.getAccount('ethereum-erc4337', 0),
      Base: await wdk.getAccount('base-erc4337', 0),
      Arbitrum: await wdk.getAccount('arbitrum-erc4337', 0),
      Polygon: await wdk.getAccount('polygon-erc4337', 0),
    };

    const balances: Array<{ chain: string; balance: string }> = [];

    for (const [chainName, account] of Object.entries(erc4337Accounts)) {
      try {
        // Try to get paymaster token balance if the method exists
        const balance = 'getPaymasterTokenBalance' in account
          ? await (account as any).getPaymasterTokenBalance()
          : null;
        
        balances.push({
          chain: chainName,
          balance: balance ? balance.toString() : '0',
        });
      } catch (error) {
        this.logger.error(`Error fetching paymaster balance for ${chainName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        balances.push({
          chain: chainName,
          balance: '0',
        });
      }
    }

    return balances;
  }

  /**
   * Send crypto to a recipient address
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @param recipientAddress - The recipient's address
   * @param amount - The amount to send (as string to preserve precision)
   * @param tokenAddress - Optional token contract address for ERC-20 tokens
   * @returns Transaction hash
   */
  async sendCrypto(
    userId: string,
    chain: string,
    recipientAddress: string,
    amount: string,
    tokenAddress?: string,
  ): Promise<{ txHash: string }> {
    this.logger.log(`Sending crypto for user ${userId} on chain ${chain}: ${amount} to ${recipientAddress}`);

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
      const wdk = this.createWdkInstance(seedPhrase);

      // Map chain name to WDK chain identifier
      const wdkChainMap: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum',
        polygon: 'polygon',
        tron: 'tron',
        bitcoin: 'bitcoin',
        solana: 'solana',
        ethereumErc4337: 'ethereum-erc4337',
        baseErc4337: 'base-erc4337',
        arbitrumErc4337: 'arbitrum-erc4337',
        polygonErc4337: 'polygon-erc4337',
      };

      const wdkChain = wdkChainMap[chain];
      if (!wdkChain) {
        throw new BadRequestException(`Unsupported chain: ${chain}`);
      }

      const account = await wdk.getAccount(wdkChain, 0);

      // Convert human amount -> smallest units using authoritative decimals
      const toSmallest = (val: string, decimals: number): string => {
        const [wholeRaw, fracRaw] = (val?.trim?.() ?? '').split('.');
        const whole = wholeRaw ?? '0';
        const frac = fracRaw ?? '';
        const cleanWhole = whole.replace(/^0+/, '') || '0';
        const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
        const combined = (cleanWhole + fracPadded).replace(/^0+/, '') || '0';
        return combined;
      };

      // Get decimals
      let tokenDecimals = 18; // Start with common fallback
      let decimalsSource = 'fallback-18';
      if (tokenAddress) {
        // Try ERC-20 decimals via provider
        try {
          let provider: any = null;
          if ('provider' in account) provider = (account as any).provider;
          else if ('getProvider' in account && typeof (account as any).getProvider === 'function') provider = await (account as any).getProvider();
          if (provider && typeof provider.request === 'function') {
            const result = await provider.request({
              method: 'eth_call',
              params: [{ to: tokenAddress, data: '0x313ce567' }, 'latest'],
            });
            if (typeof result === 'string' && result !== '0x' && result !== '0x0') {
              const parsed = parseInt(result, 16);
              if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 36) {
                tokenDecimals = parsed;
                decimalsSource = 'rpc-decimals()';
              }
            }
          }
        } catch (e) {
          this.logger.debug(`ERC-20 decimals() call failed, will try Zerion metadata: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
        // Zerion fallback for decimals - always try if we don't have valid decimals yet
        if (decimalsSource === 'fallback-18') {
          try {
            const addr = await account.getAddress();
            const zerionChainMap: Record<string, string> = {
              ethereum: 'ethereum',
              base: 'base',
              arbitrum: 'arbitrum',
              polygon: 'polygon',
              ethereumErc4337: 'ethereum',
              baseErc4337: 'base',
              arbitrumErc4337: 'arbitrum',
              polygonErc4337: 'polygon',
            };
            const zChain = zerionChainMap[chain] || chain;
            this.logger.debug(`Looking up token decimals from Zerion: token=${tokenAddress}, chain=${zChain}, address=${addr}`);
            const positionsAny = await this.zerionService.getPositionsAnyChain(addr);
            
            // Log all positions to debug
            if (positionsAny?.data) {
              this.logger.debug(`Found ${positionsAny.data.length} positions in Zerion for ${addr}`);
            }
            
            const match = positionsAny?.data?.find((p: any) => {
              const impl = p.attributes?.fungible_info?.implementations?.[0]?.address?.toLowerCase();
              const cid = p?.relationships?.chain?.data?.id;
              const matches = impl === tokenAddress.toLowerCase() && cid === zChain;
              if (impl === tokenAddress.toLowerCase()) {
                this.logger.debug(`Found matching token address, chain=${cid}, expected=${zChain}, match=${matches}`);
              }
              return matches;
            });
            
            if (match) {
              const d = match?.attributes?.fungible_info?.decimals;
              this.logger.debug(`Zerion position found: decimals=${d}, symbol=${match?.attributes?.fungible_info?.symbol}`);
              if (typeof d === 'number' && d >= 0 && d <= 36) {
                tokenDecimals = d;
                decimalsSource = 'zerion-positions-any';
              }
            } else {
              this.logger.debug(`No matching Zerion position found for token=${tokenAddress} on chain=${zChain}`);
            }
          } catch (e) {
            this.logger.debug(`Zerion decimals fallback failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }
      } else {
        // Native token
        tokenDecimals = this.getNativeTokenDecimals(chain);
        decimalsSource = 'native';
      }

      const requestedSmallest = toSmallest(amount, tokenAddress ? tokenDecimals : this.getNativeTokenDecimals(chain));
      this.logger.log(`Send pre-check: token=${tokenAddress || 'native'}, humanAmount=${amount}, decimals=${tokenDecimals} (source: ${decimalsSource}), requestedSmallest=${requestedSmallest}`);

      // Validate address format (basic check)
      if (!recipientAddress || recipientAddress.trim().length === 0) {
        throw new BadRequestException('Recipient address is required');
      }

      // Check available balance (prefer on-chain via WDK; fall back to RPC/Zerion if needed)
      try {
        let availableSmallest = '0';
        let balanceSource = 'unknown';

        if (tokenAddress) {
          // Try WDK token balance first
          try {
            if ('getTokenBalance' in account && typeof (account as any).getTokenBalance === 'function') {
              const bal = await (account as any).getTokenBalance(tokenAddress);
              availableSmallest = bal?.toString?.() ?? String(bal);
              if (/^[0-9]+$/.test(availableSmallest) && availableSmallest !== '0') balanceSource = 'wdk-getTokenBalance';
            } else if ('balanceOf' in account && typeof (account as any).balanceOf === 'function') {
              const bal = await (account as any).balanceOf(tokenAddress);
              availableSmallest = bal?.toString?.() ?? String(bal);
              if (/^[0-9]+$/.test(availableSmallest) && availableSmallest !== '0') balanceSource = 'wdk-balanceOf';
            }
          } catch (e) {
            this.logger.debug(`WDK token balance check failed, will try RPC fallback: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }

          // If not numeric or zero, try direct RPC balanceOf(owner)
          if (!/^[0-9]+$/.test(availableSmallest) || availableSmallest === '0') {
            try {
              // Get provider from account if available (EVM chains)
              let provider: any = null;
              if ('provider' in account) {
                provider = (account as any).provider;
              } else if ('getProvider' in account && typeof (account as any).getProvider === 'function') {
                provider = await (account as any).getProvider();
              }
              if (provider && typeof provider.request === 'function') {
                const owner = await account.getAddress();
                const data = '0x70a08231' + owner.replace(/^0x/, '').padStart(64, '0');
                const result = await provider.request({
                  method: 'eth_call',
                  params: [
                    { to: tokenAddress, data },
                    'latest',
                  ],
                });
                if (typeof result === 'string' && result.startsWith('0x')) {
                  const v = BigInt(result);
                  availableSmallest = v.toString();
                  if (availableSmallest !== '0') balanceSource = 'rpc-balanceOf';
                }
              }
            } catch (e) {
              this.logger.debug(`Direct RPC balanceOf fallback failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
          }

          // Zerion fallback if still not numeric or still zero
          if (!/^[0-9]+$/.test(availableSmallest) || availableSmallest === '0') {
            try {
              const addr = await account.getAddress();
              // Map internal chain to Zerion canonical chain id
              const zerionChainMap: Record<string, string> = {
                ethereum: 'ethereum',
                base: 'base',
                arbitrum: 'arbitrum',
                polygon: 'polygon',
                ethereumErc4337: 'ethereum',
                baseErc4337: 'base',
                arbitrumErc4337: 'arbitrum',
                polygonErc4337: 'polygon',
              };
              const zChain = zerionChainMap[chain] || chain;

              const positionsAny = await this.zerionService.getPositionsAnyChain(addr);
              const match = positionsAny?.data?.find((p: any) => {
                const impl = p.attributes?.fungible_info?.implementations?.[0]?.address?.toLowerCase();
                const cid = p?.relationships?.chain?.data?.id;
                return impl === tokenAddress.toLowerCase() && cid === zChain;
              });
              const q = match?.attributes?.quantity;
              const smallest = q?.int || '0';
              if (/^[0-9]+$/.test(smallest) && smallest !== '0') {
                availableSmallest = smallest;
                balanceSource = 'zerion-positions-any';
              }
            } catch (e) {
              this.logger.debug(`Zerion token balance fallback failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
          }
        } else {
          // Native balance via WDK
          try {
            const bal = await account.getBalance();
            availableSmallest = bal?.toString?.() ?? String(bal);
            if (/^[0-9]+$/.test(availableSmallest)) balanceSource = 'wdk-native';
          } catch (e) {
            this.logger.debug(`WDK native balance check failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }

        this.logger.log(`Balance pre-check result: availableSmallest=${availableSmallest} (source: ${balanceSource}), requestedSmallest=${requestedSmallest}`);

        if (/^[0-9]+$/.test(availableSmallest)) {
          if (BigInt(availableSmallest) < BigInt(requestedSmallest)) {
            this.logger.error(`Insufficient balance: available=${availableSmallest} (${balanceSource}), requested=${requestedSmallest}, token=${tokenAddress || 'native'}, decimals=${tokenDecimals}`);
            throw new UnprocessableEntityException(`Insufficient balance. Available: ${availableSmallest} (${balanceSource}), Requested: ${requestedSmallest}`);
          }
        } else {
          // If we couldn't determine balance, allow send to proceed (node will error if truly insufficient)
          this.logger.warn(`Balance pre-check unavailable; proceeding. available='${availableSmallest}'`);
        }
      } catch (error) {
        if (error instanceof UnprocessableEntityException) {
          throw error;
        }
        this.logger.warn(`Could not check balance, proceeding anyway: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Send transaction
  let txHash: string = '';

      try {
        if (tokenAddress) {
          // ERC-20 token transfer
          // Prefer a structured transfer call with token + recipient + amount (BigInt)
          const amountBigInt = (() => {
            try { return BigInt(requestedSmallest); } catch { return BigInt(String(requestedSmallest)); }
          })();

          let sent = false;
          // 1) account.transfer({ token, recipient|to, amount }) if available
          if ('transfer' in account && typeof (account as any).transfer === 'function') {
            try {
              const result = await (account as any).transfer({ token: tokenAddress, recipient: recipientAddress, amount: amountBigInt });
              txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
              sent = true;
            } catch (e1) {
              // Try with 'to' key if recipient was not accepted
              try {
                const result = await (account as any).transfer({ token: tokenAddress, to: recipientAddress, amount: amountBigInt });
                txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
                sent = true;
              } catch (e2) {
                this.logger.debug(`account.transfer failed, will try other token send methods: ${e2 instanceof Error ? e2.message : 'unknown'}`);
              }
            }
          }

          // 2) account.sendToken(token, recipient, amount)
          if (!sent && 'sendToken' in account && typeof (account as any).sendToken === 'function') {
            try {
              const result = await (account as any).sendToken(tokenAddress, recipientAddress, amountBigInt);
              txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
              sent = true;
            } catch (e) {
              this.logger.debug(`account.sendToken failed: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }

          // 3) account.transferToken(token, recipient, amount)
          if (!sent && 'transferToken' in account && typeof (account as any).transferToken === 'function') {
            try {
              const result = await (account as any).transferToken(tokenAddress, recipientAddress, amountBigInt);
              txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
              sent = true;
            } catch (e) {
              this.logger.debug(`account.transferToken failed: ${e instanceof Error ? e.message : 'unknown'}`);
            }
          }

          // 4) Fallback: generic send(recipient, amount, { tokenAddress })
          if (!sent && 'send' in account && typeof (account as any).send === 'function') {
            const result = await (account as any).send(recipientAddress, amountBigInt, { tokenAddress });
            txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
            sent = true;
          }

          if (!sent || !txHash) {
            throw new ServiceUnavailableException('Token transfer method not supported by this account');
          }
        } else {
          // Native token transfer
          if ('send' in account && typeof account.send === 'function') {
            const result = await account.send(recipientAddress, requestedSmallest);
            txHash = typeof result === 'string' ? result : (result as any).hash || (result as any).txHash || String(result);
          } else if ('transfer' in account && typeof account.transfer === 'function') {
            const result = await (account as any).transfer({ to: recipientAddress, amount: BigInt(requestedSmallest) });
            txHash = typeof result === 'string' ? result : (result as any).hash || (result as any).txHash || String(result);
          } else {
            throw new BadRequestException(`Chain ${chain} does not support send operation`);
          }
        }

        if (!txHash || typeof txHash !== 'string') {
          throw new ServiceUnavailableException('Transaction submitted but no transaction hash returned');
        }

        // Invalidate Zerion cache for this address/chain after successful send
        try {
          const address = await account.getAddress();
          this.zerionService.invalidateCache(address, chain);
          this.logger.log(`Invalidated Zerion cache for ${address} on ${chain} after send`);
        } catch (cacheError) {
          this.logger.warn(`Failed to invalidate cache: ${cacheError instanceof Error ? cacheError.message : 'Unknown error'}`);
        }

        this.logger.log(`Successfully sent crypto. Transaction hash: ${txHash}`);
        return { txHash };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof UnprocessableEntityException) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Transaction failed: ${errorMessage}`);
        
        // Check for common error patterns
        if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
          throw new UnprocessableEntityException('Insufficient balance for this transaction');
        }
        if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('RPC')) {
          throw new ServiceUnavailableException('Blockchain network is unavailable. Please try again later.');
        }
        if (errorMessage.includes('invalid address') || errorMessage.includes('address')) {
          throw new BadRequestException(`Invalid recipient address: ${errorMessage}`);
        }
        
        throw new ServiceUnavailableException(`Transaction failed: ${errorMessage}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException || 
          error instanceof UnprocessableEntityException || 
          error instanceof ServiceUnavailableException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending crypto: ${errorMessage}`);
      this.logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`);
        throw new ServiceUnavailableException(`Failed to send crypto: ${errorMessage}`);
    }
  }

  /**
   * Sign a WalletConnect transaction request
   * @param userId - The user ID
   * @param chainId - WalletConnect chain ID (e.g., "eip155:1", "eip155:8453")
   * @param transaction - Transaction parameters from WalletConnect
   * @returns Transaction hash
   */
  async signWalletConnectTransaction(
    userId: string,
    chainId: string,
    transaction: {
      from: string;
      to?: string;
      value?: string;
      data?: string;
      gas?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      nonce?: string;
    },
  ): Promise<{ txHash: string }> {
    this.logger.log(`Signing WalletConnect transaction for user ${userId} on chain ${chainId}`);

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    // Map WalletConnect chain ID to internal chain name
    // Format: eip155:chainId (e.g., eip155:1 for Ethereum, eip155:8453 for Base)
    const chainIdMatch = chainId.match(/^eip155:(\d+)$/);
    if (!chainIdMatch || !chainIdMatch[1]) {
      throw new BadRequestException(`Invalid WalletConnect chain ID format: ${chainId}. Expected format: eip155:chainId`);
    }

    const numericChainId = parseInt(chainIdMatch[1], 10);
    
    // Map chain ID to internal chain name
    // Prefer ERC-4337 chains for better UX (gasless transactions)
    const chainIdMap: Record<number, string> = {
      1: 'ethereumErc4337',      // Ethereum Mainnet
      8453: 'baseErc4337',       // Base
      42161: 'arbitrumErc4337',  // Arbitrum
      137: 'polygonErc4337',     // Polygon
      // Fallback to EOA chains if ERC-4337 not available
      // 1: 'ethereum',
      // 8453: 'base',
      // 42161: 'arbitrum',
      // 137: 'polygon',
    };

    const internalChain = chainIdMap[numericChainId];
    if (!internalChain) {
      throw new BadRequestException(`Unsupported chain ID: ${numericChainId}. Supported chains: Ethereum (1), Base (8453), Arbitrum (42161), Polygon (137)`);
    }

    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
      const wdk = this.createWdkInstance(seedPhrase);

      // Map internal chain name to WDK chain identifier
      const wdkChainMap: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum',
        polygon: 'polygon',
        ethereumErc4337: 'ethereum-erc4337',
        baseErc4337: 'base-erc4337',
        arbitrumErc4337: 'arbitrum-erc4337',
        polygonErc4337: 'polygon-erc4337',
      };

      const wdkChain = wdkChainMap[internalChain];
      if (!wdkChain) {
        throw new BadRequestException(`Unsupported chain: ${internalChain}`);
      }

      const account = await wdk.getAccount(wdkChain, 0);
      const accountAddress = await account.getAddress();

      // Verify that the 'from' address matches the account address
      if (transaction.from.toLowerCase() !== accountAddress.toLowerCase()) {
        throw new BadRequestException(`Transaction 'from' address (${transaction.from}) does not match wallet address (${accountAddress})`);
      }

      // Prepare transaction object
      const txParams: any = {};
      
      if (transaction.to) {
        txParams.to = transaction.to;
      }
      
      if (transaction.value) {
        // Convert hex value to BigInt if needed
        const value = transaction.value.startsWith('0x') 
          ? BigInt(transaction.value).toString() 
          : transaction.value;
        txParams.value = value;
      }
      
      if (transaction.data) {
        txParams.data = transaction.data;
      }
      
      if (transaction.gas) {
        txParams.gas = transaction.gas.startsWith('0x') 
          ? parseInt(transaction.gas, 16).toString() 
          : transaction.gas;
      }
      
      if (transaction.gasPrice) {
        txParams.gasPrice = transaction.gasPrice.startsWith('0x') 
          ? BigInt(transaction.gasPrice).toString() 
          : transaction.gasPrice;
      }
      
      if (transaction.maxFeePerGas) {
        txParams.maxFeePerGas = transaction.maxFeePerGas.startsWith('0x') 
          ? BigInt(transaction.maxFeePerGas).toString() 
          : transaction.maxFeePerGas;
      }
      
      if (transaction.maxPriorityFeePerGas) {
        txParams.maxPriorityFeePerGas = transaction.maxPriorityFeePerGas.startsWith('0x') 
          ? BigInt(transaction.maxPriorityFeePerGas).toString() 
          : transaction.maxPriorityFeePerGas;
      }
      
      if (transaction.nonce) {
        txParams.nonce = transaction.nonce.startsWith('0x') 
          ? parseInt(transaction.nonce, 16) 
          : parseInt(transaction.nonce, 10);
      }

      // Send transaction using account's sendTransaction method
      let txHash: string = '';
      
      if ('sendTransaction' in account && typeof (account as any).sendTransaction === 'function') {
        const result = await (account as any).sendTransaction(txParams);
        txHash = typeof result === 'string' ? result : (result?.hash || result?.txHash || String(result));
      } else if ('send' in account && typeof account.send === 'function') {
        // Fallback to send method if sendTransaction not available
        const recipient = transaction.to || accountAddress;
        const amount = transaction.value ? (transaction.value.startsWith('0x') ? BigInt(transaction.value).toString() : transaction.value) : '0';
        const result = await account.send(recipient, amount);
        txHash = typeof result === 'string' ? result : (result as any).hash || (result as any).txHash || String(result);
      } else {
        throw new ServiceUnavailableException(`Account does not support sendTransaction or send methods`);
      }

      if (!txHash || typeof txHash !== 'string') {
        throw new ServiceUnavailableException('Transaction submitted but no transaction hash returned');
      }

      // Invalidate Zerion cache for this address/chain after successful send
      try {
        this.zerionService.invalidateCache(accountAddress, internalChain);
        this.logger.log(`Invalidated Zerion cache for ${accountAddress} on ${internalChain} after WalletConnect transaction`);
      } catch (cacheError) {
        this.logger.warn(`Failed to invalidate cache: ${cacheError instanceof Error ? cacheError.message : 'Unknown error'}`);
      }

      this.logger.log(`Successfully signed WalletConnect transaction. Transaction hash: ${txHash}`);
      return { txHash };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnprocessableEntityException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error signing WalletConnect transaction: ${errorMessage}`);
      this.logger.error(`Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`);
      throw new ServiceUnavailableException(`Failed to sign WalletConnect transaction: ${errorMessage}`);
    }
  }

  /**
   * Get token balances for a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @returns Array of token balances
   */
  async getTokenBalances(
    userId: string,
    chain: string,
  ): Promise<Array<{ address: string | null; symbol: string; balance: string; decimals: number }>> {
    this.logger.log(`Getting token balances for user ${userId} on chain ${chain} using Zerion`);

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);
    
    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    try {
      // Get address for this chain
      const addresses = await this.getAddresses(userId);
      const address = addresses[chain as keyof WalletAddresses];
      
      if (!address) {
        this.logger.warn(`No address found for chain ${chain}`);
        return [];
      }

      // Get portfolio from Zerion (includes native + all ERC-20 tokens)
      const portfolio = await this.zerionService.getPortfolio(address, chain);
      
      // Check if portfolio has valid data array
      if (!portfolio?.data || !Array.isArray(portfolio.data) || portfolio.data.length === 0) {
        // Zerion doesn't support this chain or returned no data
        this.logger.warn(`No portfolio data from Zerion for ${address} on ${chain}`);
        return [];
      }

      const tokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }> = [];

      // Process each token in portfolio
      for (const tokenData of portfolio.data) {
        try {
          const quantity = tokenData.attributes?.quantity;
          if (!quantity) continue;

          const intPart = quantity.int || '0';
          const decimals = quantity.decimals || 0;
          
          // Convert to standard format (18 decimals)
          const balance = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
          
          // Skip zero balances
          if (parseFloat(balance) === 0) continue;

          // Determine if native token or ERC-20
          const isNative = tokenData.type === 'native' || !tokenData.attributes?.fungible_info;
          const fungibleInfo = tokenData.attributes?.fungible_info;
          
          if (isNative) {
            // Native token
            const nativeSymbol = this.getNativeTokenSymbol(chain);
            const nativeDecimals = this.getNativeTokenDecimals(chain);
            
            tokens.push({
              address: null,
              symbol: nativeSymbol,
              balance,
              decimals: nativeDecimals,
            });
          } else if (fungibleInfo) {
            // ERC-20 token
            const tokenAddress = fungibleInfo.implementations?.[0]?.address || null;
            const symbol = fungibleInfo.symbol || 'UNKNOWN';
            const tokenDecimals = fungibleInfo.decimals || 18;

            tokens.push({
              address: tokenAddress,
              symbol,
              balance,
              decimals: tokenDecimals,
            });
          }
        } catch (error) {
          this.logger.debug(`Error processing token from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      this.logger.log(`Retrieved ${tokens.length} tokens from Zerion for ${chain}`);
      return tokens;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error getting token balances from Zerion: ${errorMessage}`);
      
      // Fallback: try WDK if Zerion fails
      this.logger.warn(`Falling back to WDK for token balances on ${chain}`);
      try {
        const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
        const wdk = this.createWdkInstance(seedPhrase);
        const wdkChainMap: Record<string, string> = {
          ethereum: 'ethereum',
          base: 'base',
          arbitrum: 'arbitrum',
          polygon: 'polygon',
          tron: 'tron',
          bitcoin: 'bitcoin',
          solana: 'solana',
          ethereumErc4337: 'ethereum-erc4337',
          baseErc4337: 'base-erc4337',
          arbitrumErc4337: 'arbitrum-erc4337',
          polygonErc4337: 'polygon-erc4337',
        };
        const wdkChain = wdkChainMap[chain];
        if (wdkChain) {
          const account = await wdk.getAccount(wdkChain, 0);
          const nativeBalance = await account.getBalance();
          const nativeSymbol = this.getNativeTokenSymbol(chain);
          const nativeDecimals = this.getNativeTokenDecimals(chain);
          
          return [{
            address: null,
            symbol: nativeSymbol,
            balance: nativeBalance.toString(),
            decimals: nativeDecimals,
          }];
        }
      } catch (fallbackError) {
        this.logger.error(`Fallback to WDK also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
      }
      
      return [];
    }
  }

  /**
   * Get native token symbol for a chain
   */
  private getNativeTokenSymbol(chain: string): string {
    const symbols: Record<string, string> = {
      ethereum: 'ETH',
      base: 'ETH',
      arbitrum: 'ETH',
      polygon: 'MATIC',
      tron: 'TRX',
      bitcoin: 'BTC',
      solana: 'SOL',
      ethereumErc4337: 'ETH',
      baseErc4337: 'ETH',
      arbitrumErc4337: 'ETH',
      polygonErc4337: 'MATIC',
    };
    return symbols[chain] || chain.toUpperCase();
  }

  /**
   * Get native token decimals for a chain
   */
  private getNativeTokenDecimals(chain: string): number {
    const decimals: Record<string, number> = {
      ethereum: 18,
      base: 18,
      arbitrum: 18,
      polygon: 18,
      tron: 6,
      bitcoin: 8,
      solana: 9,
      ethereumErc4337: 18,
      baseErc4337: 18,
      arbitrumErc4337: 18,
      polygonErc4337: 18,
    };
    return decimals[chain] || 18;
  }

  /**
   * Check if chain is EVM-compatible
   */
  private isEvmChain(chain: string): boolean {
    const evmChains = ['ethereum', 'base', 'arbitrum', 'polygon', 'ethereumErc4337', 'baseErc4337', 'arbitrumErc4337', 'polygonErc4337'];
    return evmChains.includes(chain);
  }

  /**
   * Discover tokens by scanning Transfer events from the account
   * This scans recent Transfer events to find all tokens the account has interacted with
   */
  private async discoverTokensFromEvents(
    account: any,
    chain: string,
  ): Promise<Array<{ address: string | null; symbol: string; balance: string; decimals: number }>> {
    const tokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }> = [];
    const discoveredTokenAddresses = new Set<string>();

    try {
      // Get account address
      const address = await account.getAddress();
      
      // ERC-20 Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      
      // Try to get RPC provider from account to query events
      let provider: any = null;
      if ('provider' in account) {
        provider = account.provider;
      } else if ('getProvider' in account && typeof account.getProvider === 'function') {
        provider = await account.getProvider();
      }

      if (provider && typeof provider.request === 'function') {
        // Query recent Transfer events where this address is the recipient or sender
        // This finds all tokens the address has interacted with
        const currentBlock = await provider.request({ method: 'eth_blockNumber' });
        const blockNumber = parseInt(currentBlock, 16);
        // Reduced to 1000 blocks (~4 hours on Ethereum mainnet) for better performance
        const fromBlock = Math.max(0, blockNumber - 1000);
        
        // Pad address to 32 bytes (64 hex chars) for topic encoding
        const addressLower = address.toLowerCase();
        const paddedAddress = '0x' + addressLower.slice(2).padStart(64, '0');
        
        try {
          const events = await provider.request({
            method: 'eth_getLogs',
            params: [{
              fromBlock: '0x' + fromBlock.toString(16),
              toBlock: 'latest',
              topics: [
                transferEventSignature,
                null, // from address (any)
                paddedAddress, // to address (this account)
              ],
            }],
          });

          // Also check for outgoing transfers
          const outgoingEvents = await provider.request({
            method: 'eth_getLogs',
            params: [{
              fromBlock: '0x' + fromBlock.toString(16),
              toBlock: 'latest',
              topics: [
                transferEventSignature,
                paddedAddress, // from address (this account)
                null, // to address (any)
              ],
            }],
          });

          // Combine both sets of events
          const allEvents = [...(events || []), ...(outgoingEvents || [])];
          
          // Extract unique token contract addresses
          allEvents.forEach((event: any) => {
            if (event.address && !discoveredTokenAddresses.has(event.address.toLowerCase())) {
              discoveredTokenAddresses.add(event.address.toLowerCase());
            }
          });
        } catch (error) {
          this.logger.debug(`Failed to query Transfer events: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // For each discovered token, get balance, symbol, and decimals
      // Limit to first 50 tokens to prevent excessive RPC calls
      const tokenAddressesArray = Array.from(discoveredTokenAddresses).slice(0, 50);
      
      // Process in parallel batches of 10 to speed up
      const batchSize = 10;
      for (let i = 0; i < tokenAddressesArray.length; i += batchSize) {
        const batch = tokenAddressesArray.slice(i, i + batchSize);
        const batchPromises = batch.map(async (tokenAddress) => {
        try {
          // Get token balance
          let tokenBalance: any = '0';
          if ('getTokenBalance' in account && typeof (account as any).getTokenBalance === 'function') {
            tokenBalance = await (account as any).getTokenBalance(tokenAddress);
          } else if (provider) {
            // Fallback: Call balanceOf directly via RPC
            const balanceResult = await provider.request({
              method: 'eth_call',
              params: [{
                to: tokenAddress,
                data: '0x70a08231' + address.slice(2).padStart(64, '0'), // balanceOf(address)
              }, 'latest'],
            });
            tokenBalance = BigInt(balanceResult).toString();
          }

          if (tokenBalance && parseFloat(tokenBalance.toString()) > 0) {
            // Get token symbol and decimals
            let symbol = 'UNKNOWN';
            let decimals = 18;

            try {
              if (provider) {
                // Call symbol() - 0x95d89b41
                const symbolResult = await provider.request({
                  method: 'eth_call',
                  params: [{
                    to: tokenAddress,
                    data: '0x95d89b41',
                  }, 'latest'],
                });
                if (symbolResult && symbolResult !== '0x') {
                  symbol = this.decodeStringFromHex(symbolResult);
                }

                // Call decimals() - 0x313ce567
                const decimalsResult = await provider.request({
                  method: 'eth_call',
                  params: [{
                    to: tokenAddress,
                    data: '0x313ce567',
                  }, 'latest'],
                });
                if (decimalsResult && decimalsResult !== '0x') {
                  decimals = parseInt(decimalsResult, 16);
                }
              }
            } catch (error) {
              this.logger.debug(`Failed to fetch token metadata for ${tokenAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            tokens.push({
              address: tokenAddress,
              symbol,
              balance: tokenBalance.toString(),
              decimals,
            });
          }
          return null;
        } catch (error) {
          this.logger.debug(`Failed to process token ${tokenAddress}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return null;
        }
        });
        
        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach((token) => {
          if (token) {
            tokens.push(token);
          }
        });
      }
    } catch (error) {
      this.logger.warn(`Token discovery from events failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return tokens;
  }

  /**
   * Decode string from hex-encoded ABI return value
   */
  private decodeStringFromHex(hex: string): string {
    try {
      // Remove 0x prefix
      const hexWithoutPrefix = hex.startsWith('0x') ? hex.slice(2) : hex;
      
      // Skip offset and length (first 64 chars = 32 bytes each)
      // Then decode the string
      const offset = parseInt(hexWithoutPrefix.slice(0, 64), 16);
      const length = parseInt(hexWithoutPrefix.slice(64, 128), 16);
      const stringHex = hexWithoutPrefix.slice(128, 128 + length * 2);
      
      // Convert hex to string
      let result = '';
      for (let i = 0; i < stringHex.length; i += 2) {
        const charCode = parseInt(stringHex.substr(i, 2), 16);
        if (charCode > 0) {
          result += String.fromCharCode(charCode);
        }
      }
      
      return result || 'UNKNOWN';
    } catch (error) {
      return 'UNKNOWN';
    }
  }

  /**
   * Refresh balances for known tokens (used when serving from cache)
   */
  private async refreshTokenBalances(
    userId: string,
    chain: string,
    cachedTokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }>,
  ): Promise<Array<{ address: string | null; symbol: string; balance: string; decimals: number }>> {
    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
      const wdk = this.createWdkInstance(seedPhrase);

      const wdkChainMap: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum',
        polygon: 'polygon',
        tron: 'tron',
        bitcoin: 'bitcoin',
        solana: 'solana',
        ethereumErc4337: 'ethereum-erc4337',
        baseErc4337: 'base-erc4337',
        arbitrumErc4337: 'arbitrum-erc4337',
        polygonErc4337: 'polygon-erc4337',
      };

      const wdkChain = wdkChainMap[chain];
      if (!wdkChain) {
        return cachedTokens;
      }

      const account = await wdk.getAccount(wdkChain, 0);
      const refreshedTokens: Array<{ address: string | null; symbol: string; balance: string; decimals: number }> = [];

      // Refresh all token balances in parallel
      const refreshPromises = cachedTokens.map(async (cachedToken) => {
        try {
          if (cachedToken.address === null) {
            // Native token
            const balance = await account.getBalance();
            return {
              ...cachedToken,
              balance: balance.toString(),
            };
          } else {
            // ERC-20 token
            let balance: any = '0';
            if ('getTokenBalance' in account && typeof (account as any).getTokenBalance === 'function') {
              balance = await (account as any).getTokenBalance(cachedToken.address);
            } else if ('balanceOf' in account && typeof (account as any).balanceOf === 'function') {
              balance = await (account as any).balanceOf(cachedToken.address);
            }

            if (balance && parseFloat(balance.toString()) > 0) {
              return {
                ...cachedToken,
                balance: balance.toString(),
              };
            }
            return null; // Token balance is now 0, exclude it
          }
        } catch (error) {
          this.logger.debug(`Failed to refresh balance for token ${cachedToken.symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return cachedToken; // Return cached value on error
        }
      });

      const refreshed = await Promise.all(refreshPromises);
      refreshed.forEach((token) => {
        if (token) {
          refreshedTokens.push(token);
        }
      });

      return refreshedTokens;
    } catch (error) {
      this.logger.warn(`Failed to refresh token balances: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return cachedTokens; // Return cached on error
    }
  }

  /**
   * Get token addresses for a chain (fallback list for common tokens)
   * Used when dynamic discovery fails
   */
  private getTokenAddressesForChain(chain: string): Array<{ address: string; symbol: string; decimals: number }> {
    // Token addresses per network (fallback for common tokens)
    const tokens: Record<string, Array<{ address: string; symbol: string; decimals: number }>> = {
      ethereum: [
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
      ],
      ethereumErc4337: [
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
      ],
      baseErc4337: [
        { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
      ],
      arbitrumErc4337: [
        { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
        { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
      ],
      polygonErc4337: [
        { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
        { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', decimals: 6 },
      ],
    };
    return tokens[chain] || [];
  }

  /**
   * Create a WDK instance with all wallet managers registered
   * @param seedPhrase - The seed phrase
   * @returns Configured WDK instance
   */
  private createWdkInstance(seedPhrase: string) {
    return new WDK(seedPhrase)
      .registerWallet('ethereum', WalletManagerEvm, {
        provider: this.configService.get<string>('ETH_RPC_URL') || 'https://eth.llamarpc.com',
      })
      .registerWallet('base', WalletManagerEvm, {
        provider: this.configService.get<string>('BASE_RPC_URL') || 'https://mainnet.base.org',
      })
      .registerWallet('arbitrum', WalletManagerEvm, {
        provider: this.configService.get<string>('ARB_RPC_URL') || 'https://arb1.arbitrum.io/rpc',
      })
      .registerWallet('polygon', WalletManagerEvm, {
        provider: this.configService.get<string>('POLYGON_RPC_URL') || 'https://polygon-rpc.com',
      })
      .registerWallet('tron', WalletManagerTron, {
        provider: this.configService.get<string>('TRON_RPC_URL') || 'https://api.trongrid.io',
      })
      .registerWallet('bitcoin', WalletManagerBtc as any, {
        provider: this.configService.get<string>('BTC_RPC_URL') || 'https://blockstream.info/api',
      })
      .registerWallet('solana', WalletManagerSolana, {
        rpcUrl: this.configService.get<string>('SOL_RPC_URL') || 'https://api.mainnet-beta.solana.com',
      })
      .registerWallet('ethereum-erc4337', WalletManagerEvmErc4337, {
        chainId: 1,
        provider: this.configService.get<string>('ETH_ERC4337_RPC_URL') || 'https://eth.llamarpc.com',
        bundlerUrl: this.configService.get<string>('ETH_BUNDLER_URL') || 'https://api.candide.dev/public/v3/ethereum',
        paymasterUrl: this.configService.get<string>('ETH_PAYMASTER_URL') || 'https://api.candide.dev/public/v3/ethereum',
        paymasterAddress: this.configService.get<string>('ETH_PAYMASTER_ADDRESS') || '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
        entryPointAddress: this.configService.get<string>('ENTRY_POINT_ADDRESS') || '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        safeModulesVersion: this.configService.get<string>('SAFE_MODULES_VERSION') || '0.3.0',
        paymasterToken: {
          address: this.configService.get<string>('ETH_PAYMASTER_TOKEN') || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        },
        transferMaxFee: parseInt(this.configService.get<string>('TRANSFER_MAX_FEE') || '100000000000000'),
      })
      .registerWallet('base-erc4337', WalletManagerEvmErc4337, {
        chainId: 8453,
        provider: this.configService.get<string>('BASE_RPC_URL') || 'https://mainnet.base.org',
        bundlerUrl: this.configService.get<string>('BASE_BUNDLER_URL') || 'https://api.candide.dev/public/v3/base',
        paymasterUrl: this.configService.get<string>('BASE_PAYMASTER_URL') || 'https://api.candide.dev/public/v3/base',
        paymasterAddress: this.configService.get<string>('BASE_PAYMASTER_ADDRESS') || '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
        entryPointAddress: this.configService.get<string>('ENTRY_POINT_ADDRESS') || '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        safeModulesVersion: this.configService.get<string>('SAFE_MODULES_VERSION') || '0.3.0',
        paymasterToken: {
          address: this.configService.get<string>('BASE_PAYMASTER_TOKEN') || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        },
        transferMaxFee: parseInt(this.configService.get<string>('TRANSFER_MAX_FEE') || '100000000000000'),
      })
      .registerWallet('arbitrum-erc4337', WalletManagerEvmErc4337, {
        chainId: 42161,
        provider: this.configService.get<string>('ARB_RPC_URL') || 'https://arb1.arbitrum.io/rpc',
        bundlerUrl: this.configService.get<string>('ARB_BUNDLER_URL') || 'https://api.candide.dev/public/v3/arbitrum',
        paymasterUrl: this.configService.get<string>('ARB_PAYMASTER_URL') || 'https://api.candide.dev/public/v3/arbitrum',
        paymasterAddress: this.configService.get<string>('ARB_PAYMASTER_ADDRESS') || '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
        entryPointAddress: this.configService.get<string>('ENTRY_POINT_ADDRESS') || '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        safeModulesVersion: this.configService.get<string>('SAFE_MODULES_VERSION') || '0.3.0',
        paymasterToken: {
          address: this.configService.get<string>('ARB_PAYMASTER_TOKEN') || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        },
        transferMaxFee: parseInt(this.configService.get<string>('TRANSFER_MAX_FEE') || '100000000000000'),
      })
      .registerWallet('polygon-erc4337', WalletManagerEvmErc4337, {
        chainId: 137,
        provider: this.configService.get<string>('POLYGON_RPC_URL') || 'https://polygon-rpc.com',
        bundlerUrl: this.configService.get<string>('POLYGON_BUNDLER_URL') || 'https://api.candide.dev/public/v3/polygon',
        paymasterUrl: this.configService.get<string>('POLYGON_PAYMASTER_URL') || 'https://api.candide.dev/public/v3/polygon',
        paymasterAddress: this.configService.get<string>('POLYGON_PAYMASTER_ADDRESS') || '0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba',
        entryPointAddress: this.configService.get<string>('ENTRY_POINT_ADDRESS') || '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        safeModulesVersion: this.configService.get<string>('SAFE_MODULES_VERSION') || '0.3.0',
        paymasterToken: {
          address: this.configService.get<string>('POLYGON_PAYMASTER_TOKEN') || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        },
        transferMaxFee: parseInt(this.configService.get<string>('TRANSFER_MAX_FEE') || '100000000000000'),
      });
  }

  /**
   * Get transaction history for a user on a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The chain identifier
   * @param limit - Maximum number of transactions to return (default: 50)
   * @returns Array of transaction objects
   */
  async getTransactionHistory(
    userId: string,
    chain: string,
    limit: number = 50,
  ): Promise<Array<{
    txHash: string;
    from: string;
    to: string | null;
    value: string;
    timestamp: number | null;
    blockNumber: number | null;
    status: 'success' | 'failed' | 'pending';
    chain: string;
    tokenSymbol?: string;
    tokenAddress?: string;
  }>> {
    this.logger.log(`Getting transaction history for user ${userId} on chain ${chain} using Zerion`);

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      this.logger.log(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.log(`Successfully auto-created wallet for user ${userId}`);
    }

    try {
      // Get address for this chain
      const addresses = await this.getAddresses(userId);
      const address = addresses[chain as keyof WalletAddresses];
      
      if (!address) {
        this.logger.warn(`No address found for chain ${chain}`);
        return [];
      }

      // Get transactions from Zerion
      const zerionTransactions = await this.zerionService.getTransactions(address, chain, limit);
      
      if (!zerionTransactions || zerionTransactions.length === 0) {
        this.logger.debug(`No transactions from Zerion for ${address} on ${chain}`);
        return [];
      }

      const transactions: Array<{
        txHash: string;
        from: string;
        to: string | null;
        value: string;
        timestamp: number | null;
        blockNumber: number | null;
        status: 'success' | 'failed' | 'pending';
        chain: string;
        tokenSymbol?: string;
        tokenAddress?: string;
      }> = [];

      // Map Zerion transactions to our format
      for (const zerionTx of zerionTransactions) {
        try {
          const attributes = zerionTx.attributes || {};
          const txHash = attributes.hash || zerionTx.id || '';
          const timestamp = attributes.mined_at || attributes.sent_at || null;
          const blockNumber = attributes.block_number || null;
          
          // Determine status
          let status: 'success' | 'failed' | 'pending' = 'pending';
          if (attributes.status) {
            const statusLower = attributes.status.toLowerCase();
            if (statusLower === 'confirmed' || statusLower === 'success') {
              status = 'success';
            } else if (statusLower === 'failed' || statusLower === 'error') {
              status = 'failed';
            }
          } else if (attributes.block_confirmations !== undefined && attributes.block_confirmations > 0) {
            status = 'success';
          }

          // Get transfer information
          const transfers = attributes.transfers || [];
          let tokenSymbol: string | undefined;
          let tokenAddress: string | undefined;
          let value = '0';
          let toAddress: string | null = null;

          if (transfers.length > 0) {
            // Use first transfer for token info
            const transfer = transfers[0];
            if (transfer) {
              tokenSymbol = transfer.fungible_info?.symbol;
              const quantity = transfer.quantity;
              if (quantity) {
                const intPart = quantity.int || '0';
                const decimals = quantity.decimals || 0;
                value = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
              }
              toAddress = transfer.to?.address || null;
            }
          } else {
            // Native token transfer - get from fee or use default
            if (attributes.fee?.value) {
              value = attributes.fee.value.toString();
            }
          }

          transactions.push({
            txHash,
            from: address,
            to: toAddress,
            value,
            timestamp,
            blockNumber,
            status,
            chain,
            tokenSymbol,
            tokenAddress,
          });
        } catch (error) {
          this.logger.debug(`Error processing transaction from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      this.logger.log(`Retrieved ${transactions.length} transactions from Zerion for ${chain}`);
      return transactions;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error getting transaction history from Zerion: ${errorMessage}`);
      return [];
    }
  }
}

