import {
  Injectable,
  BadRequestException,
  Logger,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeedRepository } from './seed.repository.js';
import { BalanceProviderFactory } from './factories/balance-provider.factory.js';
import { TokenBalance } from './types/account.types.js';
import { SeedManager } from './managers/seed.manager.js';
import { AddressManager } from './managers/address.manager.js';
import { AccountFactory } from './factories/account.factory.js';
import { NativeEoaFactory } from './factories/native-eoa.factory.js';
import { Eip7702AccountFactory } from './factories/eip7702-account.factory.js';
import { SubstrateManager } from './substrate/managers/substrate.manager.js';
import { SubstrateChainKey } from './substrate/config/substrate-chain.config.js';
import { BalanceCacheRepository } from './repositories/balance-cache.repository.js';
import { WalletHistoryRepository } from './repositories/wallet-history.repository.js';
import { Eip7702DelegationRepository } from './repositories/eip7702-delegation.repository.js';
import { IAccount } from './types/account.types.js';
import { ZerionService } from './services/zerion.service.js';
import { CacheService } from './services/cache.service.js';
import { AllChainTypes } from './types/chain.types.js';
import {
  WalletAddresses,
  UiWalletPayload,
  WalletAddressContext,
  WalletAddressMetadataMap,
  SmartAccountSummary,
  UiWalletEntry,
  WalletAddressKey,
  WalletAddressKind,
  WalletConnectNamespacePayload,
} from './interfaces/wallet.interfaces.js';
import {
  convertToSmallestUnits,
  convertSmallestToHuman,
} from './utils/conversion.utils.js';
import { validateAmount } from './utils/validation.utils.js';
import { PimlicoConfigService } from './config/pimlico.config.js';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  // Cache for discovered tokens: userId:chain -> { tokens, timestamp }
  private tokenCache: Map<
    string,
    {
      tokens: Array<{
        address: string | null;
        symbol: string;
        balance: string;
        decimals: number;
      }>;
      timestamp: number;
    }
  > = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private readonly SMART_ACCOUNT_CHAIN_KEYS: Array<
    'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'avalanche'
  > = ['ethereum', 'base', 'arbitrum', 'polygon', 'avalanche'];
  private readonly EOA_CHAIN_KEYS: Array<
    | 'ethereum'
    | 'base'
    | 'arbitrum'
    | 'polygon'
    | 'avalanche'
    | 'moonbeamTestnet'
    | 'astarShibuya'
    | 'paseoPassetHub'
    | 'hydration'
    | 'unique'
    | 'bifrost'
    | 'bifrostTestnet'
  > = [
      'ethereum',
      'base',
      'arbitrum',
      'polygon',
      'avalanche',
      'moonbeamTestnet',
      'astarShibuya',
      'paseoPassetHub',
      'hydration',
      'unique',
      'bifrost',
      'bifrostTestnet',
    ];
  private readonly NON_EVM_CHAIN_KEYS: Array<
    | 'tron'
    | 'bitcoin'
    | 'solana'
    | 'aptos'
    | 'aptosMainnet'
    | 'aptosTestnet'
    | 'aptosDevnet'
  > = [
      'tron',
      'bitcoin',
      'solana',
      'aptos',
      'aptosMainnet',
      'aptosTestnet',
      'aptosDevnet',
    ];
  private readonly UI_SMART_ACCOUNT_LABEL = 'EVM Smart Account';
  private readonly WALLETCONNECT_CHAIN_CONFIG = [
    {
      chainId: 1,
      key: 'ethereum' as WalletAddressKey,
      label: 'Ethereum',
    },
    {
      chainId: 8453,
      key: 'base' as WalletAddressKey,
      label: 'Base',
    },
    {
      chainId: 42161,
      key: 'arbitrum' as WalletAddressKey,
      label: 'Arbitrum',
    },
    {
      chainId: 137,
      key: 'polygon' as WalletAddressKey,
      label: 'Polygon',
    },
    {
      chainId: 43114,
      key: 'avalanche' as WalletAddressKey,
      label: 'Avalanche',
    },
  ];

  constructor(
    private seedRepository: SeedRepository,
    private configService: ConfigService,
    private seedManager: SeedManager,
    private addressManager: AddressManager,
    private accountFactory: AccountFactory,
    private nativeEoaFactory: NativeEoaFactory,
    private eip7702AccountFactory: Eip7702AccountFactory,
    private substrateManager: SubstrateManager,
    private balanceCacheRepository: BalanceCacheRepository,
    private walletHistoryRepository: WalletHistoryRepository,
    private pimlicoConfig: PimlicoConfigService,
    private eip7702DelegationRepository: Eip7702DelegationRepository,
    private zerionService: ZerionService,
    private cacheService: CacheService,
    private balanceProviderFactory: BalanceProviderFactory,
  ) { }

  /**
   * Create or import a wallet seed phrase
   * For authenticated users, saves the current wallet to history before creating new one
   * @param userId - The user ID
   * @param mode - Either 'random' to generate or 'mnemonic' to import
   * @param mnemonic - The mnemonic phrase (required if mode is 'mnemonic')
   * @param saveHistory - Whether to save current wallet to history (default: true for authenticated users)
   */
  async createOrImportSeed(
    userId: string,
    mode: 'random' | 'mnemonic',
    mnemonic?: string,
    saveHistory: boolean = true,
  ): Promise<void> {
    // For authenticated users (non-temp IDs), save current wallet to history
    const isAuthenticatedUser = !userId.startsWith('temp-');

    if (saveHistory && isAuthenticatedUser) {
      try {
        // Check if user has an existing seed to save
        const hasSeed = await this.seedManager.hasSeed(userId);
        if (hasSeed) {
          const currentSeed = await this.seedManager.getSeed(userId);
          await this.walletHistoryRepository.saveToHistory(userId, currentSeed);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to save wallet history: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue even if history save fails
      }
    }

    // Clear any cached addresses since a new seed means new addresses
    await this.addressManager.clearAddressCache(userId);

    // Use the SeedManager for all seed operations
    return this.seedManager.createOrImportSeed(userId, mode, mnemonic);
  }

  /**
   * Get all wallet addresses for all chains
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Object containing addresses for all chains
   */
  async getAddresses(userId: string): Promise<WalletAddresses> {
    // Use the AddressManager for address operations
    return this.addressManager.getAddresses(userId);
  }

  /**
   * Get wallet history for authenticated users
   * @param userId - The user ID
   */
  async getWalletHistory(userId: string) {
    return this.walletHistoryRepository.getWalletHistory(userId);
  }

  /**
   * Switch to a different wallet from history
   * @param userId - The user ID
   * @param walletId - The wallet history entry ID to switch to
   */
  async switchWallet(userId: string, walletId: string): Promise<boolean> {
    // Get the seed from history
    const seedPhrase = await this.walletHistoryRepository.getSeedFromHistory(
      walletId,
      userId,
    );

    if (!seedPhrase) {
      this.logger.error(`Wallet ${walletId} not found for user ${userId}`);
      return false;
    }

    // Save current wallet to history first (don't save again if switching)
    const hasSeed = await this.seedManager.hasSeed(userId);
    if (hasSeed) {
      const currentSeed = await this.seedManager.getSeed(userId);
      // Only save if it's different from the one we're switching to
      if (currentSeed !== seedPhrase) {
        await this.walletHistoryRepository.saveToHistory(userId, currentSeed);
      }
    }

    // Clear address cache
    await this.addressManager.clearAddressCache(userId);

    // Import the selected wallet's seed
    await this.seedManager.createOrImportSeed(userId, 'mnemonic', seedPhrase);

    // Set this wallet as active
    await this.walletHistoryRepository.setActiveWallet(walletId, userId);

    return true;
  }

  /**
   * Delete a wallet from history
   * @param userId - The user ID
   * @param walletId - The wallet history entry ID to delete
   */
  async deleteWalletHistory(
    userId: string,
    walletId: string,
  ): Promise<boolean> {
    return this.walletHistoryRepository.deleteWallet(walletId, userId);
  }

  async getWalletAddressContext(userId: string): Promise<WalletAddressContext> {
    const { addresses, metadata } =
      await this.addressManager.getManagedAddresses(userId);
    const ui = this.buildUiWalletPayload(metadata);
    return {
      internal: addresses,
      metadata,
      ui,
    };
  }

  async getUiWalletAddresses(userId: string): Promise<UiWalletPayload> {
    const context = await this.getWalletAddressContext(userId);
    return context.ui;
  }

  async getWalletConnectAccounts(
    userId: string,
  ): Promise<WalletConnectNamespacePayload[]> {
    const { metadata } = await this.addressManager.getManagedAddresses(userId);
    const namespaces: WalletConnectNamespacePayload[] = [];

    // EIP155 namespace (EVM chains)
    const eip155Namespace: WalletConnectNamespacePayload = {
      namespace: 'eip155',
      chains: [],
      accounts: [],
      addressesByChain: {},
    };

    for (const config of this.WALLETCONNECT_CHAIN_CONFIG) {
      const address = metadata[config.key]?.address;

      if (!address) {
        continue;
      }

      const chainTag = `eip155:${config.chainId}`;
      eip155Namespace.chains.push(chainTag);
      eip155Namespace.accounts.push(`${chainTag}:${address}`);
      eip155Namespace.addressesByChain[chainTag] = address;
    }

    if (eip155Namespace.accounts.length > 0) {
      namespaces.push(eip155Namespace);
    }

    // Polkadot namespace (Substrate chains) - with error isolation
    try {
      const substrateAddresses = await this.substrateManager.getAddresses(
        userId,
        false,
      );
      const enabledChains = this.substrateManager.getEnabledChains();

      const polkadotNamespace: WalletConnectNamespacePayload = {
        namespace: 'polkadot',
        chains: [],
        accounts: [],
        addressesByChain: {},
      };

      for (const chain of enabledChains) {
        const address = substrateAddresses[chain];
        if (!address) {
          continue;
        }

        const chainConfig = this.substrateManager.getChainConfig(chain, false);
        const genesisHash = chainConfig.genesisHash;
        const chainTag = `polkadot:${genesisHash}`;
        const accountId = `polkadot:${genesisHash}:${address}`;

        polkadotNamespace.chains.push(chainTag);
        polkadotNamespace.accounts.push(accountId);
        polkadotNamespace.addressesByChain[chainTag] = address;
      }

      if (polkadotNamespace.accounts.length > 0) {
        namespaces.push(polkadotNamespace);
      }
    } catch (error) {
      this.logger.error(
        `Failed to register Polkadot namespace for WalletConnect: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Continue with other namespaces - error isolation (Issue #6)
    }

    if (namespaces.length === 0) {
      throw new BadRequestException(
        'No WalletConnect-compatible addresses found. Please initialize your wallet first.',
      );
    }

    // Return first namespace for backward compatibility, but log that multiple namespaces are available
    if (namespaces.length > 1) {
      this.logger.debug(
        `Multiple WalletConnect namespaces available: ${namespaces.map((n) => n.namespace).join(', ')}`,
      );
    }

    return namespaces;
  }

  private buildUiWalletPayload(
    metadata: WalletAddressMetadataMap,
  ): UiWalletPayload {
    const chainsRecord = {
      ethereum: metadata.ethereum?.address ?? null,
      base: metadata.base?.address ?? null,
      arbitrum: metadata.arbitrum?.address ?? null,
      polygon: metadata.polygon?.address ?? null,
      avalanche: metadata.avalanche?.address ?? null,
    };

    const canonicalChainKey = this.SMART_ACCOUNT_CHAIN_KEYS.find(
      (key) => metadata[key]?.address,
    );

    const canonicalAddress = canonicalChainKey
      ? (metadata[canonicalChainKey]?.address ?? null)
      : null;
    const canonicalChain = canonicalChainKey
      ? canonicalChainKey
      : null;

    const smartAccount: SmartAccountSummary | null = canonicalAddress
      ? {
        key: 'evmSmartAccount',
        label: this.UI_SMART_ACCOUNT_LABEL,
        canonicalChain,
        address: canonicalAddress,
        chains: chainsRecord,
      }
      : null;

    const auxiliary = this.buildAuxiliaryWalletEntries(metadata);

    return {
      smartAccount,
      auxiliary,
    };
  }

  private buildAuxiliaryWalletEntries(
    metadata: WalletAddressMetadataMap,
  ): UiWalletEntry[] {
    const entries: UiWalletEntry[] = [];

    // EVM EOA chains (standard EVM wallets)
    const eoaChains: WalletAddressKey[] = [
      'ethereum',
      'base',
      'arbitrum',
      'polygon',
      'avalanche',
    ];
    eoaChains.forEach((chain) => {
      const entry = metadata[chain];
      if (entry?.visible && entry.address) {
        entries.push({
          key: chain,
          label: entry.label,
          chain,
          address: entry.address,
          category: 'evm',
        });
      }
    });

    // Polkadot EVM chains
    const polkadotEvmChains: WalletAddressKey[] = [
      'moonbeamTestnet',
      'astarShibuya',
      'paseoPassetHub',
    ];
    polkadotEvmChains.forEach((chain) => {
      const entry = metadata[chain];
      if (entry?.visible && entry.address) {
        entries.push({
          key: chain,
          label: entry.label,
          chain,
          address: entry.address,
          category: 'polkadot-evm',
        });
      }
    });

    // Substrate chains
    const substrateChains: WalletAddressKey[] = [
      'polkadot',
      'hydrationSubstrate',
      'bifrostSubstrate',
      'uniqueSubstrate',
      'paseo',
      'paseoAssethub',
    ];
    substrateChains.forEach((chain) => {
      const entry = metadata[chain];
      if (entry?.visible && entry.address) {
        entries.push({
          key: chain,
          label: entry.label,
          chain,
          address: entry.address,
          category: 'substrate',
        });
      }
    });

    // Non-EVM chains (including Aptos)
    this.NON_EVM_CHAIN_KEYS.forEach((chain) => {
      const entry = metadata[chain];
      if (entry?.visible && entry.address) {
        // Determine category based on chain
        let category: string | undefined;
        if (chain.startsWith('aptos')) {
          category = 'aptos';
        } else if (
          chain === 'tron' ||
          chain === 'bitcoin' ||
          chain === 'solana'
        ) {
          category = 'non-evm';
        }

        entries.push({
          key: chain,
          label: entry.label,
          chain,
          address: entry.address,
          category,
        });
      }
    });

    return entries;
  }

  private buildMetadataSnapshot(
    partial: Partial<Record<WalletAddressKey, string | null>> | WalletAddresses,
  ): WalletAddressMetadataMap {
    const metadata = {} as WalletAddressMetadataMap;

    const assign = (
      chain: WalletAddressKey,
      kind: WalletAddressKind,
      visible: boolean,
    ) => {
      metadata[chain] = {
        chain,
        address: partial[chain] ?? null,
        kind,
        visible,
        label: this.getLabelForChain(chain, kind),
      };
    };

    // Standard EOA chains (not visible by default)
    const standardEoaChains = this.EOA_CHAIN_KEYS.filter(
      (chain) =>
        ![
          'moonbeamTestnet',
          'astarShibuya',
          'paseoPassetHub',
          'hydration',
          'unique',
          'bifrost',
          'bifrostTestnet',
        ].includes(chain),
    );
    standardEoaChains.forEach((chain) => assign(chain, 'eoa', true));

    // Polkadot EVM chains (visible)
    const polkadotEvmChains: WalletAddressKey[] = [
      'moonbeamTestnet',
      'astarShibuya',
      'paseoPassetHub',
      'hydration',
      'unique',
      'bifrost',
      'bifrostTestnet',
    ];
    polkadotEvmChains.forEach((chain) => assign(chain, 'eoa', true));
    this.SMART_ACCOUNT_CHAIN_KEYS.forEach((chain) =>
      assign(chain, 'eoa', true),
    );
    this.NON_EVM_CHAIN_KEYS.forEach((chain) => assign(chain, 'nonEvm', true));

    // Substrate chains (visible)
    const substrateChains: WalletAddressKey[] = [
      'polkadot',
      'hydrationSubstrate',
      'bifrostSubstrate',
      'uniqueSubstrate',
      'paseo',
      'paseoAssethub',
    ];
    substrateChains.forEach((chain) => assign(chain, 'substrate', true));

    return metadata;
  }

  private getLabelForChain(
    chain: WalletAddressKey,
    kind: WalletAddressKind,
  ): string {
    const baseLabels: Partial<Record<WalletAddressKey, string>> = {
      ethereum: 'Ethereum',
      base: 'Base',
      arbitrum: 'Arbitrum',
      polygon: 'Polygon',
      avalanche: 'Avalanche',
      tron: 'Tron',
      bitcoin: 'Bitcoin',
      solana: 'Solana',
      moonbeamTestnet: 'Moonbeam Testnet',
      astarShibuya: 'Astar Shibuya',
      paseoPassetHub: 'Paseo PassetHub',
      hydration: 'Hydration',
      unique: 'Unique',
      bifrost: 'Bifrost Mainnet',
      bifrostTestnet: 'Bifrost Testnet',
    };

    const label = baseLabels[chain];
    if (label) {
      if (kind === 'eoa') {
        return `${label} (EOA)`;
      }
      return label;
    }
    return chain;
  }

  private isVisibleChain(chain: WalletAddressKey): boolean {
    const SUBSTRATE_CHAIN_KEYS: Array<
      | 'polkadot'
      | 'hydrationSubstrate'
      | 'bifrostSubstrate'
      | 'uniqueSubstrate'
      | 'paseo'
      | 'paseoAssethub'
    > = [
        'polkadot',
        'hydrationSubstrate',
        'bifrostSubstrate',
        'uniqueSubstrate',
        'paseo',
        'paseoAssethub',
      ];

    const POLKADOT_EVM_CHAIN_KEYS: Array<
      'moonbeamTestnet' | 'astarShibuya' | 'paseoPassetHub'
    > = ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub'];

    return (
      this.SMART_ACCOUNT_CHAIN_KEYS.includes(
        chain as (typeof this.SMART_ACCOUNT_CHAIN_KEYS)[number],
      ) ||
      this.NON_EVM_CHAIN_KEYS.includes(
        chain as (typeof this.NON_EVM_CHAIN_KEYS)[number],
      ) ||
      SUBSTRATE_CHAIN_KEYS.includes(
        chain as (typeof SUBSTRATE_CHAIN_KEYS)[number],
      ) ||
      POLKADOT_EVM_CHAIN_KEYS.includes(
        chain as (typeof POLKADOT_EVM_CHAIN_KEYS)[number],
      ) ||
      this.EOA_CHAIN_KEYS.includes(
        chain as (typeof this.EOA_CHAIN_KEYS)[number],
      )
    );
  }

  private isEvmChain(chain: string): boolean {
    const POLKADOT_EVM_CHAIN_KEYS: Array<
      'moonbeamTestnet' | 'astarShibuya' | 'paseoPassetHub'
    > = ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub'];

    return (
      this.SMART_ACCOUNT_CHAIN_KEYS.includes(
        chain as (typeof this.SMART_ACCOUNT_CHAIN_KEYS)[number],
      ) ||
      POLKADOT_EVM_CHAIN_KEYS.includes(
        chain as (typeof POLKADOT_EVM_CHAIN_KEYS)[number],
      ) ||
      this.EOA_CHAIN_KEYS.includes(
        chain as (typeof this.EOA_CHAIN_KEYS)[number],
      )
    );
  }

  /**
   * Get all token positions across any supported chains for the user's primary addresses
   * Uses Zerion any-chain endpoints per address (no chain filter) and merges results.
   * Primary addresses considered: EVM EOA (ethereum), first ERC-4337 smart account, and Solana.
   * @param userId - The user ID
   * @param forceRefresh - Force refresh from API (bypass Zerion's internal cache)
   */
  async getTokenBalancesAny(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<
    Array<{
      chain: string;
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
      balanceHuman?: string;
    }>
  > {
    this.logger.log(
      `Getting any-chain token balances for user ${userId}${forceRefresh ? ' (force refresh)' : ''}`,
    );

    // List of all chains we want to query (EVM + Polkadot EVM)
    const allChains = [
      ...this.EOA_CHAIN_KEYS,
      'moonbeamTestnet',
      'astarShibuya',
      'paseoPassetHub',
    ] as string[];

    // Fetch balances for each chain in parallel using the chain-specific getTokenBalances
    // which handles per-chain caching
    const results = await Promise.allSettled(
      allChains.map(async (chain) => {
        try {
          const balances = await this.getTokenBalances(userId, chain, forceRefresh);
          // Add chain property to each balance
          return balances.map(b => ({ ...b, chain }));
        } catch (err) {
          this.logger.error(`Error fetching balances for ${chain}: ${err}`);
          return [];
        }
      }),
    );

    const allBalances: any[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allBalances.push(...result.value);
      }
    }

    return allBalances;
  }

  /**
   * Get transactions across any supported chains for the user's primary addresses
   * Merges and dedupes by chain_id + tx hash.
   */
  async getTransactionsAny(
    userId: string,
    limit: number = 100,
  ): Promise<
    Array<{
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
    }>
  > {
    const hasSeed = await this.seedRepository.hasSeed(userId);
    if (!hasSeed) {
      await this.createOrImportSeed(userId, 'random');
    }

    const addresses = await this.getAddresses(userId);
    const chains = Object.keys(addresses).filter(
      (c) =>
        this.isEvmChain(c) || ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub', 'hydration', 'unique', 'bifrost', 'bifrostTestnet'].includes(c),
    );

    // Fetch all in parallel but with a limit per chain to keep it manageable
    const perChainLimit = Math.min(limit, 20);
    const results = await Promise.allSettled(
      chains.map((chain) => this.getTransactions(userId, chain, perChainLimit)),
    );

    const allTransactions: any[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTransactions.push(...result.value);
      }
    }

    // Sort by timestamp descending
    allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return allTransactions.slice(0, limit);
  }

  /**
   * Stream addresses progressively (for SSE)
   * Yields addresses as they become available
   */
  async * streamAddresses(
    userId: string,
  ): AsyncGenerator<UiWalletPayload, void, unknown> {
    const collected: Partial<Record<WalletAddressKey, string | null>> = {};

    for await (const { chain, address } of this.addressManager.streamAddresses(
      userId,
    )) {
      const key = chain as WalletAddressKey;
      collected[key] = address;

      if (!this.isVisibleChain(key)) {
        continue;
      }

      const metadata = this.buildMetadataSnapshot(collected);
      const uiPayload = this.buildUiWalletPayload(metadata);
      yield uiPayload;
    }
  }

  /**
   * Stream balances progressively (for SSE)
   * Yields balances as they're fetched from Zerion
   */
  async * streamBalances(userId: string): AsyncGenerator<
    {
      chain: string;
      address: string | null;
      nativeBalance: string;
      nativeBalanceUsd: number;
      tokens: Array<{
        address: string | null;
        symbol: string;
        balance: string;
        decimals: number;
        usdValue?: number;
      }>;
      totalBalanceUsd: number;
    },
    void,
    unknown
  > {
    // Get addresses first
    const addresses = await this.getAddresses(userId);

    // Process each chain independently
    for (const [chain, address] of Object.entries(addresses)) {
      if (!address) {
        yield {
          chain,
          address: null,
          nativeBalance: '0',
          nativeBalanceUsd: 0,
          tokens: [],
          totalBalanceUsd: 0
        };
        continue;
      }

      try {
        // Get token balances (includes native + tokens)
        const tokens = await this.getTokenBalances(userId, chain);
        const nativeToken = tokens.find((t) => t.address === null);
        const otherTokens = tokens.filter((t) => t.address !== null);

        const totalUsd = tokens.reduce((sum, t: any) => sum + (t.usdValue || 0), 0);

        yield {
          chain,
          address,
          nativeBalance: nativeToken?.balance || '0',
          nativeBalanceUsd: nativeToken?.usdValue || 0,
          tokens: otherTokens,
          totalBalanceUsd: totalUsd,
        };
      } catch (error) {
        this.logger.error(
          `Error streaming balance for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        yield {
          chain,
          address: address || null,
          nativeBalance: '0',
          nativeBalanceUsd: 0,
          tokens: [],
          totalBalanceUsd: 0
        };
      }
    }
  }

  /**
   * Stream transactions for a user across all chains
   */
  async * streamTransactions(userId: string): AsyncGenerator<
    Array<{
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
    }>,
    void,
    unknown
  > {
    const addresses = await this.getAddresses(userId);
    const chains = Object.entries(addresses).filter(
      ([chain, address]) => address && (this.isEvmChain(chain) || ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub', 'hydration', 'unique', 'bifrost', 'bifrostTestnet'].includes(chain))
    );

    // Fetch all in parallel but yield as they resolve
    const results: Array<any[]> = [];
    let resolveNext: ((value: void) => void) | null = null;
    let finishedCount = 0;

    const pushResult = (txs: any[]) => {
      if (txs && txs.length > 0) {
        results.push(txs);
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    };

    // Start all requests in parallel
    chains.forEach(async ([chain, address]) => {
      try {
        const txs = await this.getTransactions(userId, chain);
        pushResult(txs);
      } catch (error) {
        this.logger.error(`Error streaming transactions for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } finally {
        finishedCount++;
        if (finishedCount === chains.length && resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    });

    // Yield results as they arrive
    while (finishedCount < chains.length || results.length > 0) {
      if (results.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }

      while (results.length > 0) {
        yield results.shift()!;
      }
    }
  }

  /**
   * Get balances for all chains using RPC
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Array of balance objects
   */
  async getBalances(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<Array<{ chain: string; balance: string }>> {
    const substrateChains = [
      'polkadot',
      'hydrationSubstrate',
      'bifrostSubstrate',
      'uniqueSubstrate',
      'paseo',
      'paseoAssethub',
    ];

    this.logger.debug(
      `Getting balances for user ${userId}${forceRefresh ? ' (force refresh)' : ''}`,
    );

    try {
      // Use consolidated getTokenBalancesAny which handles per-chain caching and isolation
      const allAssets = await this.getTokenBalancesAny(userId, forceRefresh);

      // Filter for native assets (address: null) and map to legacy format
      return allAssets
        .filter(
          (asset) =>
            asset.address === null &&
            !substrateChains.includes(asset.chain) &&
            !asset.chain.startsWith('substrate_'),
        )
        .map((asset) => ({
          chain: asset.chain,
          balance: asset.balance,
        }));
    } catch (error: any) {
      this.logger.error(`Error in getBalances for ${userId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Refresh balances from external APIs and update cache
   * @param userId - The user ID
   * @returns Fresh balances from APIs
   */
  async refreshBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    this.logger.debug(`Refreshing balances for user ${userId}`);
    return this.getBalances(userId, true); // Force refresh
  }

  /**
   * Get ERC-4337 paymaster token balances
   * @param userId - The user ID
   * @returns Array of paymaster token balances
   */
  async getErc4337PaymasterBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    this.logger.warn(
      'EIP-7702 migration: paymaster balances for legacy ERC-4337 are disabled.',
    );
    return [];
  }

  /**
   * Convert human-readable amount to smallest units (BigInt)
   * @param humanAmount - Human-readable amount string (e.g., "1.5")
   * @param decimals - Number of decimal places
   * @returns BigInt representing the amount in smallest units
   */
  private convertToSmallestUnits(
    humanAmount: string,
    decimals: number,
  ): bigint {
    const [wholeRaw = '0', fracRaw = ''] = humanAmount.trim().split('.');
    const whole = wholeRaw.replace(/^0+/, '') || '0';
    const fracPadded = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
    const combined = (whole + fracPadded).replace(/^0+/, '') || '0';
    return BigInt(combined);
  }

  /**
   * Convert smallest units to human-readable amount
   * @param smallestUnits - Amount in smallest units (string)
   * @param decimals - Number of decimal places
   * @returns Human-readable amount string
   */
  private convertSmallestToHuman(
    smallestUnits: string,
    decimals: number,
  ): string {
    const smallestBigInt = BigInt(smallestUnits);
    const divisor = BigInt(10 ** decimals);
    const whole = smallestBigInt / divisor;
    const remainder = smallestBigInt % divisor;

    if (remainder === 0n) {
      return whole.toString();
    }

    const remainderStr = remainder.toString().padStart(decimals, '0');
    const trimmedRemainder = remainderStr.replace(/0+$/, '');
    return `${whole}.${trimmedRemainder}`;
  }

  /**
   * Chain ID aliases for Zerion API - Zerion may return chain IDs in different formats
   */
  private readonly CHAIN_ID_ALIASES: Record<string, string[]> = {
    ethereum: ['ethereum', 'eth', 'eip155:1', 'ethereum-mainnet', '1'],
    base: ['base', 'eip155:8453', 'base-mainnet', '8453'],
    arbitrum: ['arbitrum', 'arbitrum-one', 'eip155:42161', '42161'],
    polygon: ['polygon', 'matic', 'eip155:137', 'polygon-mainnet', '137'],
    avalanche: ['avalanche', 'avax', 'eip155:43114', '43114', 'avalanche-c'],
    moonbeamTestnet: [
      'moonbeamTestnet',
      'moonbase',
      'eip155:420420422',
      '420420422',
    ],
    astarShibuya: ['astarShibuya', 'shibuya', 'eip155:81', '81'],
    paseoPassetHub: [
      'paseoPassetHub',
      'paseo',
      'passethub',
      'eip155:420420422',
      '420420422',
    ],
  };

  /**
   * Check if chain is ERC-4337 smart account chain
   * @param chain - Internal chain name
   * @returns true if chain is ERC-4337
   */
  private isErc4337Chain(chain: string): boolean {
    return chain.includes('Erc4337') || chain.includes('erc4337');
  }

  /**
   * Check if a smart account is deployed on-chain
   * @param account - WDK account instance
   * @returns true if account is deployed, false otherwise
   */
  private async checkIfDeployed(account: any): Promise<boolean> {
    try {
      const address = await account.getAddress();

      // Get provider from account
      let provider: any = null;
      if ('provider' in account) {
        provider = account.provider;
      } else if (
        'getProvider' in account &&
        typeof account.getProvider === 'function'
      ) {
        provider = await account.getProvider();
      }

      if (!provider || typeof provider.request !== 'function') {
        this.logger.warn(
          `Cannot check deployment status: provider not available for address ${address}`,
        );
        return false;
      }

      // Check if contract code exists at address
      const code = await provider.request({
        method: 'eth_getCode',
        params: [address, 'latest'],
      });

      const isDeployed = code && code !== '0x' && code !== '0x0';

      this.logger.log(
        `[Deployment Check] Address: ${address}, deployed: ${isDeployed}, code length: ${code?.length || 0}`,
      );

      return isDeployed;
    } catch (e) {
      this.logger.error(
        `Failed to check deployment status: ${e instanceof Error ? e.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Deploy an ERC-4337 smart account using UserOperation
   * @param account - WDK ERC-4337 account instance
   * @param address - Account address
   * @param chain - Internal chain name
   * @returns Promise that resolves when deployment is complete
   */
  private async deployErc4337Account(
    account: any,
    address: string,
    chain: string,
  ): Promise<void> {
    this.logger.log(
      `[Deploy] Starting deployment for ERC-4337 account ${address} on ${chain}`,
    );

    try {
      // Method 1: Try deployAccount() if available
      if (
        'deployAccount' in account &&
        typeof account.deployAccount === 'function'
      ) {
        await account.deployAccount();
        return;
      }

      // Method 2: Try deploy() if available
      if ('deploy' in account && typeof account.deploy === 'function') {
        await account.deploy();
        return;
      }

      // Method 3: Send a zero-value transaction to self to trigger deployment
      // ERC-4337 accounts typically auto-deploy on first UserOperation
      if ('send' in account && typeof account.send === 'function') {
        await account.send(address, '0');

        // Wait a bit for deployment to be confirmed
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify deployment
        const isNowDeployed = await this.checkIfDeployed(account);
        if (!isNowDeployed) {
          throw new Error(
            'Deployment transaction sent but account not deployed yet. Please try again in a moment.',
          );
        }
        return;
      }

      // Method 4: Try transfer with structured params
      if ('transfer' in account && typeof account.transfer === 'function') {
        this.logger.debug(
          `[Deploy] Using account.transfer() to trigger deployment`,
        );
        const result = await account.transfer({
          to: address,
          amount: 0,
        });
        this.logger.log(
          `[Deploy] Deployment triggered via transfer: ${JSON.stringify(result)}`,
        );

        // Wait for deployment confirmation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify deployment
        const isNowDeployed = await this.checkIfDeployed(account);
        if (!isNowDeployed) {
          throw new Error(
            'Deployment transaction sent but account not deployed yet. Please try again in a moment.',
          );
        }
        return;
      }

      // If no deployment method found, throw error
      throw new Error(
        `No deployment method available for ERC-4337 account. ` +
        `Account type may not support auto-deployment. ` +
        `Available methods: ${Object.keys(account)
          .filter((k) => typeof account[k] === 'function')
          .join(', ')}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Deploy] Deployment failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Fetch token decimals from RPC using ERC-20 decimals() call
   * @param tokenAddress - Token contract address
   * @param account - WDK account instance
   * @returns Token decimals or null if failed
   */
  private async fetchDecimalsFromRPC(
    tokenAddress: string,
    account: any,
  ): Promise<number | null> {
    try {
      let provider: any = null;
      if ('provider' in account) {
        provider = account.provider;
      } else if (
        'getProvider' in account &&
        typeof account.getProvider === 'function'
      ) {
        provider = await account.getProvider();
      }

      if (!provider || typeof provider.request !== 'function') {
        return null;
      }

      // ERC-20 decimals() function signature: 0x313ce567
      const result = await provider.request({
        method: 'eth_call',
        params: [{ to: tokenAddress, data: '0x313ce567' }, 'latest'],
      });

      if (typeof result === 'string' && result !== '0x' && result !== '0x0') {
        const parsed = parseInt(result, 16);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 36) {
          this.logger.log(
            `[RPC Decimals] Fetched decimals for ${tokenAddress}: ${parsed}`,
          );
          return parsed;
        }
      }

      return null;
    } catch (e) {
      this.logger.debug(
        `RPC decimals() call failed for ${tokenAddress}: ${e instanceof Error ? e.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Validate balance on-chain (source of truth)
   * @param tokenAddress - Token contract address (null for native)
   * @param amountSmallest - Amount in smallest units (BigInt)
   * @param account - WDK account instance
   * @returns Validation result with balance
   */
  private async validateBalanceOnChain(
    tokenAddress: string | null,
    amountSmallest: bigint,
    account: any,
  ): Promise<{ sufficient: boolean; balance: string }> {
    try {
      let balanceBigInt: bigint;

      if (tokenAddress) {
        // ERC-20 token balance
        if (
          'getTokenBalance' in account &&
          typeof account.getTokenBalance === 'function'
        ) {
          const bal = await account.getTokenBalance(tokenAddress);
          balanceBigInt = BigInt(bal?.toString?.() ?? String(bal));
        } else if (
          'balanceOf' in account &&
          typeof account.balanceOf === 'function'
        ) {
          const bal = await account.balanceOf(tokenAddress);
          balanceBigInt = BigInt(bal?.toString?.() ?? String(bal));
        } else {
          // Fallback to direct RPC call
          let provider: any = null;
          if ('provider' in account) {
            provider = account.provider;
          } else if (
            'getProvider' in account &&
            typeof account.getProvider === 'function'
          ) {
            provider = await account.getProvider();
          }

          if (provider && typeof provider.request === 'function') {
            const owner = await account.getAddress();
            const data =
              '0x70a08231' + owner.replace(/^0x/, '').padStart(64, '0');
            const result = await provider.request({
              method: 'eth_call',
              params: [{ to: tokenAddress, data }, 'latest'],
            });

            if (typeof result === 'string' && result.startsWith('0x')) {
              balanceBigInt = BigInt(result);
            } else {
              throw new Error('Invalid RPC response for token balance');
            }
          } else {
            throw new Error('No provider available for balance check');
          }
        }
      } else {
        // Native token balance
        const bal = await account.getBalance();
        balanceBigInt = BigInt(bal?.toString?.() ?? String(bal));
      }

      const sufficient = balanceBigInt >= amountSmallest;

      this.logger.log(
        `[On-Chain Balance] Token: ${tokenAddress || 'native'}, ` +
        `balance: ${balanceBigInt.toString()}, requested: ${amountSmallest.toString()}, ` +
        `sufficient: ${sufficient}`,
      );

      return {
        sufficient,
        balance: balanceBigInt.toString(),
      };
    } catch (e) {
      this.logger.error(
        `On-chain balance validation failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      );
      throw e;
    }
  }

  /**
   * Validate balance from Zerion
   * @param tokenAddress - Token contract address (null for native)
   * @param amountSmallest - Amount in smallest units (BigInt)
   * @param chain - Internal chain name
   * @param walletAddress - Wallet address to check
   * @returns Validation result with balance info
   */
  private async validateBalanceFromZerion(
    tokenAddress: string | null,
    amountSmallest: bigint,
    chain: string,
    walletAddress: string,
  ): Promise<{
    sufficient: boolean;
    zerionBalance: string;
    onChainBalance?: string;
    error?: string;
  }> {
    // Zerion fallback removed
    this.logger.warn(
      `[Zerion Balance] ZerionService is deprecated. Skipping Zerion balance validation.`,
    );
    // Always return insufficient from Zerion if it's deprecated, forcing on-chain check
    return {
      sufficient: false,
      zerionBalance: '0',
      error: 'ZerionService is deprecated, cannot validate balance from Zerion.',
    };
  }

  /**
   * Create an account instance using appropriate factory based on chain type
   * @param seedPhrase - The mnemonic seed phrase
   * @param chain - The blockchain network
   * @returns Account instance implementing IAccount interface
   */
  private async createAccountForChain(
    seedPhrase: string,
    chain: AllChainTypes,
    userId?: string,
  ): Promise<IAccount> {
    const eip7702Chains: AllChainTypes[] = [
      'ethereum',
      'sepolia',
      'base',
      'arbitrum',
      'optimism',
    ];

    const isEip7702 =
      this.pimlicoConfig.isEip7702Enabled(chain) &&
      eip7702Chains.includes(chain);

    if (isEip7702) {
      return this.eip7702AccountFactory.createAccount(
        seedPhrase,
        chain as 'ethereum' | 'sepolia' | 'base' | 'arbitrum' | 'optimism',
        0,
        userId,
      );
    }

    const evmChains: AllChainTypes[] = [
      'ethereum',
      'base',
      'arbitrum',
      'optimism',
      'polygon',
      'avalanche',
      'sepolia',
      'bnb',
    ];

    if (evmChains.includes(chain)) {
      // Zerion fallback removed
      return this.nativeEoaFactory.createAccount(
        seedPhrase,
        chain as
        | 'ethereum'
        | 'base'
        | 'arbitrum'
        | 'polygon'
        | 'avalanche'
        | 'sepolia',
        0,
      );
    }

    return this.accountFactory.createAccount(seedPhrase, chain, 0);
  }

  /**
   * Send crypto to a recipient address
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @param recipientAddress - The recipient's address
   * @param amount - The amount to send (as string to preserve precision)
   * @param tokenAddress - Optional token contract address for ERC-20 tokens
   * @param tokenDecimals - Optional token decimals from Zerion/UI (if provided, will be used directly)
   * @param options - Optional parameters for sendCrypto
   * @returns Transaction hash
   */
  async sendCrypto(
    userId: string,
    chain: AllChainTypes,
    recipientAddress: string,
    amount: string,
    tokenAddress?: string,
    tokenDecimals?: number,
    options?: { forceEip7702?: boolean },
  ): Promise<{ txHash: string }> {
    this.logger.log(
      `Sending crypto for user ${userId} on chain ${chain}: ${amount} to ${recipientAddress}`,
    );

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      await this.createOrImportSeed(userId, 'random');
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    const forceEip7702 = options?.forceEip7702 === true;
    const isEip7702Chain = this.pimlicoConfig.isEip7702Enabled(chain);
    const accountType = isEip7702Chain ? 'EIP-7702' : 'EOA';

    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);

      // Auto-route native sends on EIP-7702 enabled chains to the gasless flow to avoid zeroed gas fields
      if (isEip7702Chain && !tokenAddress && !forceEip7702) {
        const chainId = this.pimlicoConfig.getEip7702Config(
          chain as 'ethereum' | 'sepolia' | 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'bnb' | 'avalanche',
        ).chainId;

        this.logger.warn(
          `[Auto-Route] Chain ${chain} has EIP-7702 enabled but sendCrypto() was called. ` +
          `Routing to sendEip7702Gasless() for proper user operation flow.`,
        );

        const result = await this.sendEip7702Gasless(
          userId,
          chainId,
          recipientAddress,
          amount,
          tokenAddress,
          tokenDecimals,
        );

        return { txHash: result.transactionHash || result.userOpHash };
      }

      // Create account using appropriate factory
      const account = await this.createAccountForChain(
        seedPhrase,
        chain,
        userId,
      );
      const walletAddress = await account.getAddress();

      this.logger.log(
        `[Send Debug] User is sending ${amount} ${tokenAddress || 'native'} from ${chain} ` +
        `(accountType: ${accountType}, address: ${walletAddress})`,
      );

      // Get decimals: Use provided tokenDecimals, or fetch from Zerion, or use native decimals
      let finalDecimals: number;
      let decimalsSource: string;

      if (tokenAddress) {
        // ERC-20 token
        if (
          tokenDecimals !== undefined &&
          tokenDecimals !== null &&
          tokenDecimals >= 0 &&
          tokenDecimals <= 36
        ) {
          // OPTIMIZED: Use provided decimals from UI/Zerion directly - no re-fetch
          finalDecimals = tokenDecimals;
          decimalsSource = 'frontend-zerion';
          this.logger.log(
            `[Decimals Optimization] Using frontend-provided token decimals: ${finalDecimals} ` +
            `(source: ${decimalsSource}). Skipping redundant Zerion API call.`,
          );
        } else {
          // Frontend didn't provide decimals or they're invalid - fetch from Zerion
          this.logger.warn(
            `[Decimals Fallback] Frontend did not provide valid tokenDecimals for ${tokenAddress}. ` +
            `Provided value: ${tokenDecimals}. Falling back to Zerion API lookup.`,
          );

          // Zerion fallback removed
          this.logger.warn(
            `[Decimals Fallback] ZerionService is deprecated. Trying RPC decimals() call as fallback.`,
          );

          const rpcDecimals = await this.fetchDecimalsFromRPC(
            tokenAddress,
            account,
          );
          if (rpcDecimals !== null && rpcDecimals >= 0 && rpcDecimals <= 36) {
            finalDecimals = rpcDecimals;
            decimalsSource = 'rpc-decimals()';
            this.logger.log(
              `[Decimals Fallback] Fetched token decimals from RPC: ${finalDecimals} ` +
              `(source: ${decimalsSource})`,
            );
          } else {
            // All methods failed
            throw new BadRequestException(
              `Cannot determine token decimals for ${tokenAddress} on ${chain}. ` +
              `Attempted: Frontend (${tokenDecimals}), RPC decimals() (failed). ` +
              `This token may not exist on ${chain}, or data is incomplete. ` +
              `Please refresh your wallet data and try again.`,
            );
          }
        }
      } else {
        // Native token
        finalDecimals = this.getNativeTokenDecimals(chain);
        decimalsSource = 'native';
        this.logger.log(
          `Using native token decimals: ${finalDecimals} (source: ${decimalsSource})`,
        );
      }

      // Convert human-readable amount to smallest units using Zerion's decimals
      const amountSmallest = this.convertToSmallestUnits(amount, finalDecimals);
      this.logger.log(
        `Send pre-check: chain=${chain}, accountType=${accountType}, token=${tokenAddress || 'native'}, ` +
        `humanAmount=${amount}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
        `amountSmallest=${amountSmallest.toString()}`,
      );

      // Validate address format (basic check)
      // Fallback removed (ZerionService deprecated)
      // Validate balance using Zerion as primary source
      const balanceValidation = await this.validateBalanceFromZerion(
        tokenAddress || null,
        amountSmallest,
        chain,
        walletAddress,
      );

      this.logger.log(
        `Balance validation: zerionBalance=${balanceValidation.zerionBalance}, ` +
        `requested=${amountSmallest.toString()}, sufficient=${balanceValidation.sufficient}`,
      );

      // Use on-chain balance as source of truth - verify if Zerion says insufficient
      if (!balanceValidation.sufficient) {
        // Zerion says insufficient - verify with on-chain balance (source of truth)
        this.logger.warn(
          `Zerion reported insufficient balance (${balanceValidation.zerionBalance}), ` +
          `verifying with on-chain balance (source of truth)`,
        );

        try {
          const onChainValidation = await this.validateBalanceOnChain(
            tokenAddress || null,
            amountSmallest,
            account,
          );

          if (onChainValidation.sufficient) {
            // On-chain says sufficient - allow transaction (Zerion may be stale)
            this.logger.warn(
              `Balance discrepancy detected: Zerion shows ${balanceValidation.zerionBalance}, ` +
              `on-chain shows ${onChainValidation.balance}, requested ${amountSmallest.toString()}. ` +
              `Using on-chain balance (source of truth) - proceeding with transaction.`,
            );
            // Don't throw error - proceed with send
          } else {
            // Both Zerion AND on-chain say insufficient
            const errorMessage =
              balanceValidation.error ||
              `Insufficient balance confirmed by both Zerion and on-chain. ` +
              `Zerion: ${balanceValidation.zerionBalance} smallest units, ` +
              `On-chain: ${onChainValidation.balance} smallest units, ` +
              `Requested: ${amountSmallest.toString()} smallest units`;

            this.logger.error(
              `Insufficient balance: ${errorMessage}, token=${tokenAddress || 'native'}, ` +
              `decimals=${finalDecimals}, chain=${chain}`,
            );

            throw new UnprocessableEntityException(errorMessage);
          }
        } catch (e) {
          if (e instanceof UnprocessableEntityException) {
            throw e;
          }

          // Couldn't get on-chain balance - trust Zerion
          this.logger.error(
            `Could not verify with on-chain balance: ${e instanceof Error ? e.message : 'Unknown error'}. ` +
            `Trusting Zerion result.`,
          );

          const errorMessage =
            balanceValidation.error ||
            `Insufficient balance. Zerion shows: ${balanceValidation.zerionBalance} smallest units, ` +
            `Requested: ${amountSmallest.toString()} smallest units. ` +
            `Could not verify with on-chain balance.`;

          throw new UnprocessableEntityException(errorMessage);
        }
      } else {
        // Zerion says sufficient - log for debugging but proceed
        this.logger.log(
          `Balance validation passed: Zerion shows ${balanceValidation.zerionBalance}, ` +
          `requested ${amountSmallest.toString()}`,
        );
      }

      // Send transaction using WDK - single mapped method per account type
      let txHash: string = '';
      let sendMethod: string = 'unknown';

      try {
        if (tokenAddress) {
          // ERC-20 token transfer
          // Use account.transfer with structured parameters (preferred for both EOA and ERC-4337)
          if (
            'transfer' in account &&
            typeof (account as any).transfer === 'function'
          ) {
            try {
              // Try with 'recipient' key first
              const result = await (account as any).transfer({
                token: tokenAddress,
                recipient: recipientAddress,
                amount: amountSmallest,
              });
              txHash =
                typeof result === 'string'
                  ? result
                  : result?.hash || result?.txHash || String(result);
              sendMethod = 'transfer({token, recipient, amount})';
            } catch (e1) {
              // Try with 'to' key if 'recipient' was not accepted
              try {
                const result = await (account as any).transfer({
                  token: tokenAddress,
                  to: recipientAddress,
                  amount: amountSmallest,
                });
                txHash =
                  typeof result === 'string'
                    ? result
                    : result?.hash || result?.txHash || String(result);
                sendMethod = 'transfer({token, to, amount})';
              } catch (e2) {
                this.logger.error(
                  `Token transfer via account.transfer failed: ${e2 instanceof Error ? e2.message : 'unknown'}`,
                );
                throw new ServiceUnavailableException(
                  `Token transfer method not supported. Account type: ${accountType}, ` +
                  `Error: ${e2 instanceof Error ? e2.message : 'unknown'}`,
                );
              }
            }
          } else {
            throw new ServiceUnavailableException(
              `Token transfer not supported for account type ${accountType} on chain ${chain}. ` +
              `The account does not support the transfer method.`,
            );
          }
        } else {
          // Native token transfer
          if ('send' in account && typeof account.send === 'function') {
            const result = await account.send(
              recipientAddress,
              amountSmallest.toString(),
            );
            txHash =
              typeof result === 'string'
                ? result
                : (result as any).hash ||
                (result as any).txHash ||
                String(result);
            sendMethod = 'send(recipient, amount)';
          } else if (
            'transfer' in account &&
            typeof (account as any).transfer === 'function'
          ) {
            const result = await (account as any).transfer({
              to: recipientAddress,
              amount: amountSmallest,
            });
            txHash =
              typeof result === 'string'
                ? result
                : result.hash || result.txHash || String(result);
            sendMethod = 'transfer({to, amount})';
          } else {
            throw new BadRequestException(
              `Native token send not supported for chain ${chain}. ` +
              `Account type: ${accountType}. Please check if this chain/account combination is supported.`,
            );
          }
        }

        if (!txHash || typeof txHash !== 'string') {
          throw new ServiceUnavailableException(
            'Transaction submitted but no transaction hash returned',
          );
        }

        // Structured logging for successful transaction
        this.logger.log(
          `Transaction successful: chain=${chain}, accountType=${accountType}, ` +
          `token=${tokenAddress || 'native'}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
          `humanAmount=${amount}, amountSmallest=${amountSmallest.toString()}, ` +
          `method=${sendMethod}, txHash=${txHash}, recipient=${recipientAddress}`,
        );

        // Invalidate caches after successful send
        try {
          // Zerion fallback removed
          this.logger.log(
            `Invalidated Zerion cache for ${walletAddress} on ${chain} after send`,
          );
        } catch (cacheError) {
          this.logger.warn(
            `Failed to invalidate cache: ${cacheError instanceof Error ? cacheError.message : 'Unknown error'}`,
          );
        }

        return { txHash };
      } catch (error) {
        // Structured error logging
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Transaction failed: chain=${chain}, accountType=${accountType}, ` +
          `token=${tokenAddress || 'native'}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
          `humanAmount=${amount}, amountSmallest=${amountSmallest.toString()}, ` +
          `method=${sendMethod}, error=${errorMessage}`,
        );

        // Re-throw known exceptions
        if (
          error instanceof BadRequestException ||
          error instanceof UnprocessableEntityException ||
          error instanceof ServiceUnavailableException
        ) {
          throw error;
        }

        // Enhanced error handling with specific messages
        const lowerError = errorMessage.toLowerCase();

        if (
          lowerError.includes('insufficient') ||
          lowerError.includes('balance')
        ) {
          throw new UnprocessableEntityException(
            `Insufficient balance for this transaction. ` +
            `Please check your balance and try again. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('network') ||
          lowerError.includes('timeout') ||
          lowerError.includes('rpc')
        ) {
          throw new ServiceUnavailableException(
            `Blockchain network is unavailable. Please try again later. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('invalid address') ||
          lowerError.includes('address')
        ) {
          throw new BadRequestException(
            `Invalid recipient address. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('nonce') ||
          lowerError.includes('replacement')
        ) {
          throw new ServiceUnavailableException(
            `Transaction nonce error. Please wait a moment and try again. Error: ${errorMessage}`,
          );
        }

        // Generic fallback
        throw new ServiceUnavailableException(
          `Transaction failed: ${errorMessage}`,
        );
      }
    } catch (error) {
      // Re-throw known exceptions (they already have proper error messages)
      if (
        error instanceof BadRequestException ||
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      // Log unexpected errors with full context
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Unexpected error in sendCrypto: userId=${userId}, chain=${chain}, ` +
        `token=${tokenAddress || 'native'}, amount=${amount}, error=${errorMessage}`,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`,
      );
      throw new ServiceUnavailableException(
        `Failed to send crypto: ${errorMessage}`,
      );
    }
  }

  async sendEip7702Gasless(
    userId: string,
    chainId: number,
    recipientAddress: string,
    amount: string,
    tokenAddress?: string,
    tokenDecimals?: number,
  ): Promise<{
    success: boolean;
    userOpHash: string;
    transactionHash?: string;
    isFirstTransaction: boolean;
    explorerUrl?: string;
  }> {
    const chainIdMap: Record<number, AllChainTypes> = {
      1: 'ethereum',
      8453: 'base',
      42161: 'arbitrum',
      10: 'optimism',
      137: 'polygon',
      43114: 'avalanche',
      11155111: 'sepolia',
      56: 'bnb',
    };

    const chain = chainIdMap[chainId];
    if (!chain) {
      throw new BadRequestException(`Unsupported EIP-7702 chainId: ${chainId}`);
    }

    if (!this.pimlicoConfig.isEip7702Enabled(chain)) {
      throw new BadRequestException(
        `EIP-7702 is not enabled for chain ${chain}. Enable via config before sending gasless transactions.`,
      );
    }

    // Determine if this is the first delegation/transaction before sending
    const isFirstTransaction =
      !(await this.eip7702DelegationRepository.hasDelegation(userId, chainId));

    const { txHash } = await this.sendCrypto(
      userId,
      chain,
      recipientAddress,
      amount,
      tokenAddress,
      tokenDecimals,
      { forceEip7702: true },
    );

    return {
      success: true,
      userOpHash: txHash,
      transactionHash: txHash,
      isFirstTransaction,
    };
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
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      await this.createOrImportSeed(userId, 'random');
    }

    const chainIdMatch = chainId.match(/^eip155:(\d+)$/);
    if (!chainIdMatch || !chainIdMatch[1]) {
      throw new BadRequestException(
        `Invalid WalletConnect chain ID format: ${chainId}. Expected format: eip155:chainId`,
      );
    }

    const chainMap: Record<string, AllChainTypes> = {
      '1': 'ethereum',
      '8453': 'base',
      '42161': 'arbitrum',
      '137': 'polygon',
      '43114': 'avalanche',
    };

    const internalChain = chainMap[chainIdMatch[1]];
    if (!internalChain) {
      throw new BadRequestException(
        `Unsupported chain ID: ${chainIdMatch[1]}. Supported chains: ${Object.keys(chainMap).join(', ')}`,
      );
    }

    const seedPhrase = await this.seedRepository.getSeedPhrase(userId);
    const account = await this.createAccountForChain(
      seedPhrase,
      internalChain,
      userId,
    );

    const to = transaction.to || transaction.from;
    const value = transaction.value || '0';
    const txHash = await account.send(to, value);
    return { txHash };
  }

  /**
   * Get token balances for a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @param forceRefresh - Force refresh from API (bypass Zerion's internal cache)
   * @returns Array of token balances
   */
  async getTokenBalances(
    userId: string,
    chain: string,
    forceRefresh: boolean = false,
  ): Promise<TokenBalance[]> {
    this.logger.debug(
      `Getting token balances for user ${userId} on chain ${chain} using RPC${forceRefresh ? ' (force refresh)' : ''}`,
    );

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      this.logger.debug(`No wallet found for user ${userId}. Auto-creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.debug(`Successfully auto-created wallet for user ${userId}`);
    }

    // Fast path: Check database cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await this.balanceCacheRepository.getChainBalances(userId, chain);
      if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL) {
        this.logger.debug(`Returning cached token balances from DB for user ${userId} on ${chain}`);
        return cached.assets;
      }
    }

    try {
      // Get address for this chain
      const addresses = await this.getAddresses(userId);
      const address = addresses[chain as keyof WalletAddresses];

      if (!address) {
        this.logger.warn(`No address found for chain ${chain}`);
        return [];
      }

      // Use factory to get the right provider
      const provider = this.balanceProviderFactory.getProvider(chain);
      const balances = await provider.getBalances(address, chain, forceRefresh);

      const result = balances.map((b) => ({
        chain,
        address: b.address,
        symbol: b.symbol,
        balance: b.balance,
        decimals: b.decimals,
      }));

      // Save to chain-specific cache
      await this.balanceCacheRepository.updateChainBalances(userId, chain, result);

      return result;
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Error getting token balances from Zerion: ${errorMessage}`,
      );

      // Return empty array if Zerion fails (Zerion is primary source)
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
      avalanche: 'AVAX',
      tron: 'TRX',
      bitcoin: 'BTC',
      solana: 'SOL',
      ethereumErc4337: 'ETH',
      baseErc4337: 'ETH',
      arbitrumErc4337: 'ETH',
      polygonErc4337: 'MATIC',
      avalancheErc4337: 'AVAX',
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
      avalanche: 18,
      tron: 6,
      bitcoin: 8,
      solana: 9,
      ethereumErc4337: 18,
      baseErc4337: 18,
      arbitrumErc4337: 18,
      polygonErc4337: 18,
      avalancheErc4337: 18,
    };
    return decimals[chain] || 18;
  }

  /**
   * Get default decimals for a token address with known overrides
   * Used as fallback when Zerion doesn't provide decimals
   * @param chain - The blockchain network
   * @param address - The token contract address (lowercase)
   * @returns Token decimals (defaults to 18 for unknown tokens)
   */
  private getDefaultDecimals(chain: string, address: string | null): number {
    // Native tokens - return 0 to indicate native (caller should use chain-specific decimals)
    if (!address) {
      return 0;
    }

    const addr = address.toLowerCase();

    // Known token decimals overrides (cross-chain)
    const overrides: Record<string, number> = {
      // === Native USDC (6 decimals) ===
      // Base
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,
      // Ethereum
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
      // Arbitrum
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,
      // Polygon
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 6,

      // === USDT (6 decimals) ===
      // Ethereum
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
      // Arbitrum
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6,
      // Polygon
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,

      // === Bridged USDbC (Base - 18 decimals) ===
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 18,

      // === WBTC (8 decimals) ===
      // Ethereum
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,
      // Arbitrum
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8,
      // Polygon
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 8,
    };

    return overrides[addr] ?? 18;
  }


  /**
   * Discover tokens by scanning Transfer events from the account
   * This scans recent Transfer events to find all tokens the account has interacted with
   */
  private async discoverTokensFromEvents(
    account: any,
    chain: string,
  ): Promise<
    Array<{
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
    }>
  > {
    // EIP-7702 refactor: event-based discovery temporarily disabled.
    // Zerion balance fetch plus cached tokens cover discovery today.
    return [];
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
   * Note: This method now primarily relies on Zerion API for real-time balances
   * Fallback to cached values is acceptable since cache is refreshed periodically
   */
  private async refreshTokenBalances(
    userId: string,
    chain: string,
    cachedTokens: Array<{
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
    }>,
  ): Promise<
    Array<{
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
    }>
  > {
    try {
      // For now, return cached tokens as-is
      // The primary balance source is Zerion API which is called in getTokenBalances()
      // This method is mainly used to serve from cache while a background refresh happens
      this.logger.debug(
        `Serving cached token balances for ${chain} (${cachedTokens.length} tokens)`,
      );
      return cachedTokens;
    } catch (error) {
      this.logger.warn(
        `Failed to refresh token balances: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return cachedTokens; // Return cached on error
    }
  }

  /**
   * Get token addresses for a chain (fallback list for common tokens)
   * Used when dynamic discovery fails
   */
  private getTokenAddressesForChain(
    chain: string,
  ): Array<{ address: string; symbol: string; decimals: number }> {
    // Token addresses per network (fallback for common tokens)
    const tokens: Record<
      string,
      Array<{ address: string; symbol: string; decimals: number }>
    > = {
      ethereum: [
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          symbol: 'USDT',
          decimals: 6,
        },
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          symbol: 'USDC',
          decimals: 6,
        },
      ],
      ethereumErc4337: [
        {
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          symbol: 'USDT',
          decimals: 6,
        },
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          symbol: 'USDC',
          decimals: 6,
        },
      ],
      baseErc4337: [
        {
          address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          symbol: 'USDC',
          decimals: 6,
        },
      ],
      arbitrumErc4337: [
        {
          address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
          symbol: 'USDT',
          decimals: 6,
        },
        {
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          symbol: 'USDC',
          decimals: 6,
        },
      ],
      polygonErc4337: [
        {
          address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
          symbol: 'USDT',
          decimals: 6,
        },
        {
          address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
          symbol: 'USDC',
          decimals: 6,
        },
      ],
    };
    return tokens[chain] || [];
  }

  /**
   * Get transaction history for a user on a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The chain identifier
   * @param limit - Maximum number of transactions to return (default: 10)
   * @returns Array of transaction objects
   */
  async getTransactions(
    userId: string,
    chain: string,
    limit: number = 10,
    cursor?: string,
  ): Promise<
    Array<{
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
    }>
  > {
    this.logger.log(`Getting transaction history for user ${userId} on chain ${chain}`);

    const addresses = await this.getAddresses(userId);
    const address = addresses[chain as keyof WalletAddresses];

    if (!address) {
      return [];
    }

    if (this.isEvmChain(chain) || ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub', 'hydration', 'unique', 'bifrost', 'bifrostTestnet'].includes(chain)) {
      const cacheKey = `txs:${address}:${chain}`;
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      const txs = await this.zerionService.getTransactions(address, chain);
      await this.cacheService.set(cacheKey, txs, 30);
      return txs;
    }

    return [];
  }

  /**
   * Get Substrate balances for all chains for a user
   *
   * @param userId - User ID
   * @param useTestnet - Whether to use testnet
   * @returns Map of chain -> balance information
   */
  async getSubstrateBalances(
    userId: string,
    useTestnet: boolean = false,
    forceRefresh: boolean = false,
  ): Promise<
    Record<
      SubstrateChainKey,
      {
        balance: string;
        address: string | null;
        token: string;
        decimals: number;
      }
    >
  > {
    const substrateChains: SubstrateChainKey[] = [
      'polkadot',
      'hydration',
      'bifrost',
      'unique',
      'paseo',
      'paseoAssethub',
    ];
    const cacheType = useTestnet ? 'testnet' : 'mainnet';
    const result: Record<string, any> = {};

    // 1. Try to load from partitioned cache
    if (!forceRefresh) {
      const cachedResults = await Promise.all(
        substrateChains.map(async (chain) => {
          const partitionedChainId = `substrate_${cacheType}_${chain}`;
          const cached = await this.balanceCacheRepository.getChainBalances(
            userId,
            partitionedChainId,
          );
          return { chain, cached };
        }),
      );

      const hasSomeCache = cachedResults.some((r) => r.cached !== null);

      if (hasSomeCache) {
        this.logger.debug(
          `Returning cached Substrate balances from partitioned DB for user ${userId}`,
        );

        const addresses = await this.addressManager.getAddresses(userId);

        for (const { chain, cached } of cachedResults) {
          if (cached && cached.assets.length > 0) {
            const asset = cached.assets[0];
            const chainConfig = this.substrateManager.getChainConfig(
              chain as SubstrateChainKey,
              useTestnet,
            );

            // Map chain to address key
            const addressMap: Record<SubstrateChainKey, keyof WalletAddresses> =
            {
              polkadot: 'polkadot',
              hydration: 'hydrationSubstrate',
              bifrost: 'bifrostSubstrate',
              unique: 'uniqueSubstrate',
              paseo: 'paseo',
              paseoAssethub: 'paseoAssethub',
            };

            result[chain] = {
              balance: asset.balance,
              address: addresses[addressMap[chain as SubstrateChainKey]] ?? null,
              token: chainConfig.token.symbol,
              decimals: chainConfig.token.decimals,
            };
          }
        }

        if (Object.keys(result).length > 0) {
          return result as any;
        }
      }
    }

    // 2. Fetch fresh if no cache or force refresh
    this.logger.log(
      `[WalletService] Getting Substrate balances for user ${userId} (testnet: ${useTestnet})`,
    );
    const balances = await this.substrateManager.getBalances(
      userId,
      useTestnet,
    );

    for (const [chain, data] of Object.entries(balances)) {
      const chainConfig = this.substrateManager.getChainConfig(
        chain as SubstrateChainKey,
        useTestnet,
      );

      result[chain] = {
        balance: data.balance,
        address: data.address,
        token: chainConfig.token.symbol,
        decimals: chainConfig.token.decimals,
      };

      // Store in partitioned cache
      const partitionedChainId = `substrate_${cacheType}_${chain}`;
      await this.balanceCacheRepository.updateChainBalances(
        userId,
        partitionedChainId,
        [
          {
            address: null,
            symbol: chainConfig.token.symbol,
            balance: data.balance,
            decimals: chainConfig.token.decimals,
          },
        ],
      );
    }

    return result as any;
  }

  /**
   * Get Substrate transaction history for a user
   *
   * @param userId - User ID
   * @param chain - Chain key
   * @param useTestnet - Whether to use testnet
   * @param limit - Number of transactions to fetch
   * @param cursor - Pagination cursor
   * @returns Transaction history
   */
  async getSubstrateTransactions(
    userId: string,
    chain: SubstrateChainKey,
    useTestnet: boolean = false,
    limit: number = 10,
    cursor?: string,
  ) {
    return this.substrateManager.getUserTransactionHistory(
      userId,
      chain,
      useTestnet,
      limit,
      cursor,
    );
  }

  /**
   * Get Substrate addresses for a user
   *
   * @param userId - User ID
   * @param useTestnet - Whether to use testnet
   * @returns Substrate addresses
   */
  async getSubstrateAddresses(userId: string, useTestnet: boolean = false) {
    return this.substrateManager.getAddresses(userId, useTestnet);
  }

  /**
   * Send Substrate transfer
   *
   * @param userId - User ID
   * @param chain - Chain key
   * @param to - Recipient address
   * @param amount - Amount in smallest units
   * @param useTestnet - Whether to use testnet
   * @param transferMethod - Transfer method ('transferAllowDeath' or 'transferKeepAlive')
   * @param accountIndex - Account index (default: 0)
   * @returns Transaction result
   */
  async sendSubstrateTransfer(
    userId: string,
    chain: SubstrateChainKey,
    to: string,
    amount: string,
    useTestnet: boolean = false,
    transferMethod?: 'transferAllowDeath' | 'transferKeepAlive',
    accountIndex: number = 0,
  ) {
    return this.substrateManager.sendTransfer(
      userId,
      {
        from: '', // Will be resolved from userId in SubstrateTransactionService
        to,
        amount,
        chain,
        useTestnet,
        transferMethod,
      },
      accountIndex,
    );
  }
}
