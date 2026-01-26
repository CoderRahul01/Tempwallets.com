
import {
  Injectable,
  BadRequestException,
  Logger,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { SeedRepository } from './seed.repository.js';
import { BalanceProviderFactory } from './factories/balance-provider.factory.js';
import { SeedManager } from './managers/seed.manager.js';
import { AddressManager } from './managers/address.manager.js';
import { AccountFactory } from './factories/account.factory.js';
import { NativeEoaFactory } from './factories/native-eoa.factory.js';
import { IAccount, TokenBalance, ZerionTransaction } from './types/account.types.js';
import { SubstrateManager } from './substrate/managers/substrate.manager.js';
import { SubstrateChainKey } from './substrate/config/substrate-chain.config.js';
import { BalanceCacheRepository } from './repositories/balance-cache.repository.js';
import { WalletHistoryRepository } from './repositories/wallet-history.repository.js';
import { ZerionService } from './services/zerion.service.js';
import { ViemErrorFormatter } from './diagnostics/viem-error.formatter.js';
import { SendService } from './services/standard-wallet/send.service.js';
import { ReceiveService } from './services/standard-wallet/receive.service.js';
import { BalanceService } from './services/standard-wallet/balance.service.js';
import { ChainMapService } from './services/standard-wallet/chain-map.service.js';
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
    private substrateManager: SubstrateManager,
    private balanceCacheRepository: BalanceCacheRepository,
    private walletHistoryRepository: WalletHistoryRepository,
    private pimlicoConfig: PimlicoConfigService,
    private zerionService: ZerionService,
    private cacheService: CacheService,
    private balanceProviderFactory: BalanceProviderFactory,
    private sendService: SendService,
    private receiveService: ReceiveService,
    private balanceService: BalanceService,
    private chainMapService: ChainMapService,
    private prisma: PrismaService,
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
          `Failed to save wallet history: ${error instanceof Error ? error.message : 'Unknown error'} `,
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
   * Get the seed phrase for a user
   * @param userId - The user ID
   * @returns The seed phrase
   */
  async getSeedPhrase(userId: string): Promise<string> {
    return this.seedRepository.getSeedPhrase(userId);
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

      const chainTag = `eip155:${config.chainId} `;
      eip155Namespace.chains.push(chainTag);
      eip155Namespace.accounts.push(`${chainTag}:${address} `);
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
        const chainTag = `polkadot:${genesisHash} `;
        const accountId = `polkadot:${genesisHash}:${address} `;

        polkadotNamespace.chains.push(chainTag);
        polkadotNamespace.accounts.push(accountId);
        polkadotNamespace.addressesByChain[chainTag] = address;
      }

      if (polkadotNamespace.accounts.length > 0) {
        namespaces.push(polkadotNamespace);
      }
    } catch (error) {
      this.logger.error(
        `Failed to register Polkadot namespace for WalletConnect: ${error instanceof Error ? error.message : 'Unknown error'} `,
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
        `Multiple WalletConnect namespaces available: ${namespaces.map((n) => n.namespace).join(', ')} `,
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
  ): Promise<TokenBalance[]> {
    this.logger.log(
      `Getting any - chain token balances for user ${userId}${forceRefresh ? ' (force refresh)' : ''} `,
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
          this.logger.error(`Error fetching balances for ${chain}: ${err} `);
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
      tokenDecimals?: number;
      type?: string;
      usdValue?: number;
      direction?: 'in' | 'out';
    }>
  > {
    const hasSeed = await this.seedRepository.hasSeed(userId);
    if (!hasSeed) {
      await this.createOrImportSeed(userId, 'random');
    }

    // Aggregated sync: Fetch latest from Zerion for all addresses to fill in received/external txs
    const addresses = await this.getAddresses(userId);

    // Explicitly list chains Zerion supports for the /transactions/ endpoint
    const zerionSupportedChains = [
      'ethereum', 'base', 'arbitrum', 'polygon', 'avalanche', 'optimism', 'solana',
      'moonbeamTestnet', 'astarShibuya', 'sepolia'
    ];
    const syncChains = Object.entries(addresses).filter(([chain, addr]) =>
      !!addr && zerionSupportedChains.includes(chain)
    );

    // Run sync in parallel for each address
    await Promise.allSettled(syncChains.map(async ([chain, address]) => {
      try {
        this.logger.debug(`[History] Syncing Zerion transactions for ${address} on ${chain}`);
        const latest = await this.zerionService.getTransactions(address!, chain, 50);
        this.logger.debug(`[History] Received ${latest.length} transactions from Zerion for ${chain}`);
        if (latest.length > 0) {
          await Promise.all(latest.map(tx => {
            // Requirement: Only process confirmed transactions
            if (tx.status !== 'success') {
              this.logger.debug(`[History] Skipping non-confirmed transaction ${tx.txHash} (Status: ${tx.status})`);
              return Promise.resolve();
            }
            // SKIP native transactions with zero value, BUT keep token transfers
            if (tx.value === '0' && !tx.tokenAddress) {
              return Promise.resolve();
            }

            const data = {
              userId,
              txHash: tx.txHash,
              chain: tx.chain,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              tokenSymbol: tx.tokenSymbol,
              tokenAddress: tx.tokenAddress,
              tokenDecimals: tx.tokenDecimals,
              timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
              blockNumber: tx.blockNumber,
              status: tx.status,
              type: tx.type,
              usdValue: tx.usdValue,
              direction: tx.direction
            };

            return this.prisma.blockchainTransaction.upsert({
              where: {
                txHash_chain: {
                  txHash: tx.txHash,
                  chain: tx.chain
                }
              },
              update: data,
              create: data
            });
          }));
        }
      } catch (err) {
        this.logger.warn(`[History] Sync failed for ${chain}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }));

    // Cleanup: Remove any previously stored zero-value transactions that aren't actually token transfers
    await this.prisma.blockchainTransaction.deleteMany({
      where: {
        userId,
        value: '0',
        tokenSymbol: null,
        usdValue: 0
      }
    });

    // Unified view: Fetch authenticated local transactions (now synced with Zerion)
    const dbTransactions = await this.prisma.blockchainTransaction.findMany({
      where: {
        userId,
        status: 'success' // Requirement: Only show confirmed transactions
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return dbTransactions.map((tx) => ({
      txHash: tx.txHash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      tokenSymbol: tx.tokenSymbol || undefined,
      tokenAddress: tx.tokenAddress || undefined,
      tokenDecimals: tx.tokenDecimals,
      timestamp: Math.floor(tx.timestamp.getTime() / 1000), // Return timestamp in seconds
      blockNumber: tx.blockNumber,
      status: tx.status as 'success' | 'failed' | 'pending',
      chain: tx.chain,
      type: tx.type,
      usdValue: tx.usdValue || 0,
      direction: (tx.direction as 'in' | 'out') || undefined,
    }));
  }

  /**
   * Fetch transactions directly from the database without syncing with Zerion
   */
  async getTransactionsDb(userId: string, limit: number = 100) {
    const dbTransactions = await this.prisma.blockchainTransaction.findMany({
      where: {
        userId,
        status: 'success' // Requirement: Only show confirmed transactions
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return dbTransactions.map((tx) => ({
      txHash: tx.txHash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      tokenSymbol: tx.tokenSymbol || undefined,
      tokenAddress: tx.tokenAddress || undefined,
      tokenDecimals: tx.tokenDecimals,
      timestamp: Math.floor(tx.timestamp.getTime() / 1000),
      blockNumber: tx.blockNumber,
      status: tx.status as 'success' | 'failed' | 'pending',
      chain: tx.chain,
      type: tx.type,
      usdValue: tx.usdValue || 0,
      direction: (tx.direction as 'in' | 'out') || undefined,
    }));
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
          `Error streaming balance for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'} `,
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
   * @param userId - The user ID
   * @param options - Streaming options (poll: true to keep streaming new transactions)
   */
  async * streamTransactions(
    userId: string,
    options: { poll?: boolean; intervalMs?: number } = { poll: false }
  ): AsyncGenerator<
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
      direction?: 'in' | 'out';
    }>,
    void,
    unknown
  > {
    const addresses = await this.getAddresses(userId);
    const chains = Object.entries(addresses).filter(
      ([chain, address]) =>
        address &&
        (this.isEvmChain(chain) ||
          [
            'moonbeamTestnet',
            'astarShibuya',
            'paseoPassetHub',
            'hydration',
            'unique',
            'bifrost',
            'bifrostTestnet',
            'solana',
            'tron',
            'bitcoin',
            'aptos',
          ].includes(chain)),
    );

    const seenTxHashes = new Set<string>();

    // Initial fetch loop
    const fetchAndYield = async function* (this: WalletService) {
      const results: Array<any[]> = [];
      let resolveNext: ((value: void) => void) | null = null;
      let finishedCount = 0;

      const pushResult = (txs: any[]) => {
        // Filter out already seen transactions and ONLY keep confirmed ones
        const newTxs = txs.filter((tx) =>
          !seenTxHashes.has(`${tx.chain}:${tx.txHash}`) &&
          tx.status === 'success'
        );
        newTxs.forEach((tx) => seenTxHashes.add(`${tx.chain}:${tx.txHash}`));

        if (newTxs.length > 0) {
          // Persistence: Save to DB as they are discovered
          Promise.all(newTxs.map(tx => {
            const data = {
              userId,
              txHash: tx.txHash,
              chain: tx.chain,
              from: tx.from,
              to: tx.to,
              value: tx.value,
              tokenSymbol: tx.tokenSymbol || null,
              tokenAddress: tx.tokenAddress || null,
              tokenDecimals: tx.tokenDecimals || 18,
              timestamp: tx.timestamp ? new Date(tx.timestamp * 1000) : new Date(),
              blockNumber: tx.blockNumber || null,
              status: tx.status || 'success',
              type: tx.type || 'transaction',
              usdValue: tx.usdValue || 0,
              direction: tx.direction || (tx.from?.toLowerCase() === addresses[this.mapChainToAddressKey(tx.chain) as keyof WalletAddresses]?.toLowerCase() ? 'out' : 'in')
            };

            return this.prisma.blockchainTransaction.upsert({
              where: { txHash_chain: { txHash: tx.txHash, chain: tx.chain } },
              update: data,
              create: data
            }).catch(err => this.logger.error(`[SSE Persistence] Failed to save tx ${tx.txHash}: ${err.message}`));
          }));

          results.push(newTxs);
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
          this.logger.error(
            `Error streaming transactions for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'} `,
          );
        } finally {
          finishedCount++;
          if (finishedCount === chains.length && resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        }
      });

      while (finishedCount < chains.length || results.length > 0) {
        if (results.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }

        const batch = results.shift();
        if (batch) {
          yield batch;
        }
      }
    }.bind(this);

    yield* fetchAndYield.call(this);

    // If polling is enabled, check for new transactions periodically
    if (options.poll) {
      const intervalMs = options.intervalMs || 30000; // Poll every 30s by default
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        for (const [chain, address] of chains) {
          try {
            const txs = await this.getTransactions(userId, chain, 10);
            const newTxs = txs.filter((tx) => !seenTxHashes.has(`${tx.chain}:${tx.txHash}`));

            if (newTxs.length > 0) {
              newTxs.forEach((tx) => seenTxHashes.add(`${tx.chain}:${tx.txHash}`));
              yield newTxs;
            }
          } catch (error) {
            this.logger.error(
              `Error polling transactions for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'} `,
            );
          }
        }
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
      `Getting balances for user ${userId}${forceRefresh ? ' (force refresh)' : ''} `,
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
      this.logger.error(`Error in getBalances for ${userId}: ${error.message} `);
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
    return `${whole}.${trimmedRemainder} `;
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
            `[RPC Decimals] Fetched decimals for ${tokenAddress}: ${parsed} `,
          );
          return parsed;
        }
      }

      return null;
    } catch (e) {
      this.logger.debug(
        `RPC decimals() call failed for ${tokenAddress}: ${e instanceof Error ? e.message : 'Unknown error'} `,
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
        `[On - Chain Balance]Chain: ${account.chainId || 'unknown'}, ` +
        `Address: ${await account.getAddress()}, ` +
        `Token: ${tokenAddress || 'native'}, ` +
        `balance: ${balanceBigInt.toString()}, requested: ${amountSmallest.toString()}, ` +
        `sufficient: ${sufficient} `,
      );

      return {
        sufficient,
        balance: balanceBigInt.toString(),
      };
    } catch (e) {
      this.logger.error(
        `On - chain balance validation failed: ${e instanceof Error ? e.message : 'Unknown error'} `,
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
    try {
      this.logger.log(
        `[Zerion Balance] Fetching balances for ${walletAddress} on ${chain} `,
      );
      const balances = await this.zerionService.getBalances(
        walletAddress,
        chain,
      );

      let foundBalance: string = '0';
      if (tokenAddress) {
        // Find matching ERC-20 token
        const token = balances.find(
          (b) =>
            b.address?.toLowerCase() === tokenAddress.toLowerCase() ||
            (b.symbol?.toLowerCase() === 'usdt' &&
              tokenAddress.toLowerCase().includes('c2132d05')), // Extra safety for Polygon USDT
        );
        foundBalance = token?.balance || '0';
      } else {
        // Find native token balance (address is usually null)
        const native = balances.find((b) => b.address === null);
        foundBalance = native?.balance || '0';
      }

      const sufficient = BigInt(foundBalance) >= amountSmallest;

      return {
        sufficient,
        zerionBalance: foundBalance,
      };
    } catch (error) {
      this.logger.error(
        `[Zerion Balance] Error fetching from Zerion: ${error instanceof Error ? error.message : 'Unknown error'} `,
      );
      return {
        sufficient: false,
        zerionBalance: '0',
        error: `Zerion error: ${error instanceof Error ? error.message : 'Unknown error'} `,
      };
    }
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
      `Sending crypto for user ${userId} on chain ${chain}: ${amount} to ${recipientAddress} `,
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

    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);

      // Use the modular SendService for standard EVM chains
      const isEvmChain = this.EOA_CHAIN_KEYS.includes(chain as any);
      if (isEvmChain) {
        this.logger.log(`[Send] Using modular SendService for ${chain}`);
        const result = await this.sendService.send(seedPhrase, chain as any, {
          to: recipientAddress,
          amount: amount,
          tokenAddress: tokenAddress,
        });

        // Asynchronously record the transaction for history
        this.recordTransaction(userId, result.txHash, chain, recipientAddress, amount, tokenAddress).catch(err => {
          this.logger.error(`Failed to record transaction ${result.txHash}: ${err.message} `);
        });

        return { txHash: result.txHash };
      }

      // Fallback/Legacy logic for other chains (Solana, Bitcoin, etc.)
      const account = await this.createAccountForChain(
        seedPhrase,
        chain,
        userId,
      );
      const walletAddress = await account.getAddress();

      this.logger.log(
        `[Send Debug] User is sending ${amount} ${tokenAddress || 'native'} from ${chain} ` +
        `(address: ${walletAddress})`,
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
            `[Decimals Optimization] Using frontend - provided token decimals: ${finalDecimals} ` +
            `(source: ${decimalsSource}).Skipping redundant Zerion API call.`,
          );
        } else {
          // Frontend didn't provide decimals or they're invalid - fetch from Zerion
          this.logger.warn(
            `[Decimals Fallback] Frontend did not provide valid tokenDecimals for ${tokenAddress}. ` +
            `Provided value: ${tokenDecimals}. Falling back to Zerion API lookup.`,
          );

          // Fetch from Zerion
          const zerionBalances = await this.zerionService.getBalances(
            walletAddress,
            chain,
          );
          const token = zerionBalances.find(
            (b) => b.address?.toLowerCase() === tokenAddress.toLowerCase(),
          );

          if (token && token.decimals !== undefined) {
            finalDecimals = token.decimals;
            decimalsSource = 'zerion-api';
            this.logger.log(
              `[Decimals Fallback] Fetched token decimals from Zerion: ${finalDecimals} ` +
              `(source: ${decimalsSource})`,
            );
          } else {
            // If Zerion fails, try RPC decimals() as last resort
            this.logger.warn(
              `[Decimals Fallback] Zerion did not have decimals for ${tokenAddress}.Trying RPC decimals() call.`,
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
                `Cannot determine token decimals for ${tokenAddress} on ${chain}.` +
                `Attempted: Frontend(${tokenDecimals}), Zerion API, RPC decimals()(failed). ` +
                `This token may not exist on ${chain}, or data is incomplete. ` +
                `Please refresh your wallet data and try again.`,
              );
            }
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
        `Send pre - check: chain = ${chain}, token = ${tokenAddress || 'native'}, ` +
        `amount = ${amount}, decimals = ${finalDecimals} (via ${decimalsSource}), smallest = ${amountSmallest.toString()} `,
      );

      // Validate balance using Zerion as primary source
      const balanceValidation = await this.validateBalanceFromZerion(
        tokenAddress || null,
        amountSmallest,
        chain,
        walletAddress,
      );

      this.logger.log(
        `Balance validation: zerionBalance = ${balanceValidation.zerionBalance}, ` +
        `requested = ${amountSmallest.toString()}, sufficient = ${balanceValidation.sufficient} `,
      );

      // Use on-chain balance as source of truth - verify if Zerion says insufficient
      if (!balanceValidation.sufficient) {
        // Zerion says insufficient - verify with on-chain balance (source of truth)
        this.logger.warn(
          `Zerion reported insufficient balance(${balanceValidation.zerionBalance}), ` +
          `verifying with on - chain balance(source of truth)`,
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
              `on - chain shows ${onChainValidation.balance}, requested ${amountSmallest.toString()}.` +
              `Using on - chain balance(source of truth) - proceeding with transaction.`,
            );
            // Don't throw error - proceed with send
          } else {
            // Both Zerion AND on-chain say insufficient
            const errorMessage =
              balanceValidation.error ||
              `Insufficient balance confirmed by both Zerion and on - chain. ` +
              `Zerion: ${balanceValidation.zerionBalance} smallest units, ` +
              `On - chain: ${onChainValidation.balance} smallest units, ` +
              `Requested: ${amountSmallest.toString()} smallest units`;

            this.logger.error(
              `Insufficient balance: ${errorMessage}, token = ${tokenAddress || 'native'}, ` +
              `decimals = ${finalDecimals}, chain = ${chain} `,
            );

            throw new UnprocessableEntityException(errorMessage);
          }
        } catch (e) {
          if (e instanceof UnprocessableEntityException) {
            throw e;
          }

          // Couldn't get on-chain balance - trust Zerion
          this.logger.error(
            `Could not verify with on - chain balance: ${e instanceof Error ? e.message : 'Unknown error'}.` +
            `Trusting Zerion result.`,
          );

          const errorMessage =
            balanceValidation.error ||
            `Insufficient balance.Zerion shows: ${balanceValidation.zerionBalance} smallest units, ` +
            `Requested: ${amountSmallest.toString()} smallest units. ` +
            `Could not verify with on - chain balance.`;

          throw new UnprocessableEntityException(errorMessage);
        }
      } else {
        // Zerion says sufficient - log for debugging but proceed
        this.logger.log(
          `Balance validation passed: Zerion shows ${balanceValidation.zerionBalance}, ` +
          `requested ${amountSmallest.toString()} `,
        );
      }

      // Send transaction using WDK - single mapped method per account type
      let txHash: string = '';
      let sendMethod: string = 'unknown';

      try {
        if (tokenAddress) {
          // ERC-20 token transfer
          // Use account.transfer with standard TokenTransferParams (preferred for both EOA and EIP-7702)
          if (
            'transfer' in account &&
            typeof (account as any).transfer === 'function'
          ) {
            try {
              this.logger.log(`[Send] Calling account.transfer with: to = ${recipientAddress}, amount = ${amountSmallest}, tokenAddress = ${tokenAddress} `);
              const result = await (account as any).transfer({
                to: recipientAddress,
                amount: amountSmallest.toString(),
                tokenAddress: tokenAddress,
              });
              txHash =
                typeof result === 'string'
                  ? result
                  : result?.hash || result?.txHash || String(result);
              sendMethod = 'transfer({to, amount, tokenAddress})';
            } catch (e1) {
              // Try with legacy keys if standard fails (for backward compatibility if any factory still uses them)
              this.logger.warn(`Standard transfer failed, trying legacy keys: ${e1 instanceof Error ? e1.message : 'unknown'} `);
              try {
                const result = await (account as any).transfer({
                  token: tokenAddress,
                  recipient: recipientAddress,
                  amount: amountSmallest.toString(),
                });
                txHash =
                  typeof result === 'string'
                    ? result
                    : result?.hash || result?.txHash || String(result);
                sendMethod = 'transfer({token, recipient, amount})';
              } catch (e2) {
                this.logger.error(
                  `Token transfer via account.transfer failed: ${e2 instanceof Error ? e2.message : 'unknown'} `,
                );
                // Don't wrap in "method not supported" if it's a real transaction error
                const errorDetail = e2 instanceof Error ? e2.message : 'unknown error';
                throw new ServiceUnavailableException(
                  `Token transfer failed for account type EOA on chain ${chain}: ${errorDetail} `,
                );
              }
            }
          } else {
            throw new ServiceUnavailableException(
              `Token transfer not supported for account type EOA on chain ${chain}.` +
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
              `Account type: EOA.Please check if this chain / account combination is supported.`,
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
          `Transaction successful: chain = ${chain}, ` +
          `token = ${tokenAddress || 'native'}, decimals = ${finalDecimals} (source: ${decimalsSource}), ` +
          `humanAmount = ${amount}, amountSmallest = ${amountSmallest.toString()}, ` +
          `method = ${sendMethod}, txHash = ${txHash}, recipient = ${recipientAddress} `,
        );

        // Invalidate caches after successful send
        try {
          // Zerion fallback removed
          this.logger.log(
            `Invalidated Zerion cache for ${walletAddress} on ${chain} after send`,
          );
        } catch (cacheError) {
          this.logger.warn(
            `Failed to invalidate cache: ${cacheError instanceof Error ? cacheError.message : 'Unknown error'} `,
          );
        }

        return { txHash };
      } catch (error) {
        // Structured error logging
        const errorMessage = ViemErrorFormatter.format(error);
        this.logger.error(
          `Transaction failed: chain = ${chain}, ` +
          `token = ${tokenAddress || 'native'}, decimals = ${finalDecimals} (source: ${decimalsSource}), ` +
          `humanAmount = ${amount}, amountSmallest = ${amountSmallest.toString()}, ` +
          `method = ${sendMethod}, error = ${errorMessage} `,
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
            `Please check your balance and try again.Error: ${errorMessage} `,
          );
        }

        if (
          lowerError.includes('network') ||
          lowerError.includes('timeout') ||
          lowerError.includes('rpc')
        ) {
          throw new ServiceUnavailableException(
            `Blockchain network is unavailable.Please try again later.Error: ${errorMessage} `,
          );
        }

        if (
          lowerError.includes('invalid address') ||
          lowerError.includes('address')
        ) {
          throw new BadRequestException(
            `Invalid recipient address.Error: ${errorMessage} `,
          );
        }

        if (
          lowerError.includes('nonce') ||
          lowerError.includes('replacement')
        ) {
          throw new ServiceUnavailableException(
            `Transaction nonce error.Please wait a moment and try again.Error: ${errorMessage} `,
          );
        }

        // Generic fallback
        throw new ServiceUnavailableException(
          `Transaction failed: ${errorMessage} `,
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
      const errorMessage = ViemErrorFormatter.format(error);
      this.logger.error(
        `Unexpected error in sendCrypto: userId = ${userId}, chain = ${chain}, ` +
        `token = ${tokenAddress || 'native'}, amount = ${amount}, error = ${errorMessage} `,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'} `,
      );
      throw new ServiceUnavailableException(
        `Failed to send crypto: ${errorMessage} `,
      );
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
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      await this.createOrImportSeed(userId, 'random');
    }

    const chainIdMatch = chainId.match(/^eip155:(\d+)$/);
    if (!chainIdMatch || !chainIdMatch[1]) {
      throw new BadRequestException(
        `Invalid WalletConnect chain ID format: ${chainId}. Expected format: eip155: chainId`,
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
        `Unsupported chain ID: ${chainIdMatch[1]}. Supported chains: ${Object.keys(chainMap).join(', ')} `,
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
      this.logger.debug(`No wallet found for user ${userId}.Auto - creating...`);
      await this.createOrImportSeed(userId, 'random');
      this.logger.debug(`Successfully auto - created wallet for user ${userId}`);
    }

    // Fast path: Check database cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = await this.balanceCacheRepository.getChainBalances(userId, chain);
      if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL) {
        this.logger.debug(`Returning cached token balances from DB for user ${userId} on ${chain} `);
        return cached.assets;
      }
    }

    try {
      // Get address for this chain
      const addresses = await this.getAddresses(userId);
      // Map variant chains (e.g. ethereumGasless) to canonical keys (e.g. ethereum) for address lookup
      const addressKey = this.mapChainToAddressKey(chain);
      const address = addresses[addressKey as keyof WalletAddresses];

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
        balanceHuman: b.balanceHuman,
        usdValue: b.usdValue,
        price: b.price,
        name: b.name,
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
        `Error getting token balances from Zerion: ${errorMessage} `,
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
   * Map chain ID to address key
   * Handles gasless/ERC-4337 variants by mapping them to their underlying chain
   */
  private mapChainToAddressKey(chain: string): string {
    // Handle Gasless chains
    if (chain.endsWith('Gasless')) {
      // e.g. ethereumGasless -> ethereum
      // e.g. baseGasless -> base
      // e.g. baseSepoliaGasless -> baseSepolia (which isn't a key? baseSepolia might map to something else?)
      // Check for Sepolia edge cases
      if (chain === 'baseSepoliaGasless') return 'base'; // Assuming base Sepolia uses Base address key? Or maybe it's not supported in getAddresses?
      if (chain === 'sepoliaGasless') return 'sepolia'; // Assuming sepolia is a key

      return chain.replace('Gasless', '');
    }

    // Handle ERC-4337 chains
    if (chain.endsWith('Erc4337')) {
      return chain.replace('Erc4337', '');
    }

    return chain;
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
        `Serving cached token balances for ${chain}(${cachedTokens.length} tokens)`,
      );
      return cachedTokens;
    } catch (error) {
      this.logger.warn(
        `Failed to refresh token balances: ${error instanceof Error ? error.message : 'Unknown error'} `,
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
      type?: string;
      usdValue?: number;
    }>
  > {
    this.logger.log(`Getting transaction history for user ${userId} on chain ${chain} `);

    const addresses = await this.getAddresses(userId);
    // Map variant chains (e.g. ethereumGasless) to canonical keys (e.g. ethereum) for address lookup
    const addressKey = this.mapChainToAddressKey(chain);
    const address = addresses[addressKey as keyof WalletAddresses];

    if (!address) {
      return [];
    }

    if (this.isEvmChain(chain) || ['moonbeamTestnet', 'astarShibuya', 'paseoPassetHub', 'hydration', 'unique', 'bifrost', 'bifrostTestnet'].includes(chain)) {
      const cacheKey = `txs:${address}:${chain} `;
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) return cached;

      const txs = await this.zerionService.getTransactions(address, chain, limit);
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
          const partitionedChainId = `substrate_${cacheType}_${chain} `;
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
      `[WalletService] Getting Substrate balances for user ${userId}(testnet: ${useTestnet})`,
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
      const partitionedChainId = `substrate_${cacheType}_${chain} `;
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
    );
  }

  private async recordTransaction(
    userId: string,
    txHash: string,
    chain: string,
    to: string,
    value: string,
    tokenAddress?: string,
    tokenDecimals: number = 18,
    tokenSymbol: string = 'ETH',
  ) {
    let authenticTx: ZerionTransaction | undefined = undefined;
    let senderAddress = '';

    try {
      const addresses = await this.getAddresses(userId);
      senderAddress = (addresses[chain as any] as string) || '';
    } catch (e) {
      this.logger.warn(
        `Could not fetch addresses for user ${userId} in recordTransaction`,
      );
    }

    // Retry loop: 3 attempts x 5s
    for (let i = 0; i < 3; i++) {
      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 5000));

      try {
        if (senderAddress) {
          const recentTxs = await this.zerionService.getTransactions(senderAddress, chain, 20);
          authenticTx = recentTxs.find(tx => tx.txHash.toLowerCase() === txHash.toLowerCase());

          if (authenticTx) {
            this.logger.log(`[History] Found authentic tx ${txHash} on attempt ${i + 1}`);
            break;
          }
        }
      } catch (err) {
        this.logger.warn(`[History] Zerion fetch failed attempt ${i + 1}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // Fallback if not found: Save pending record driven by initial inputs
    // NOTE: 'value' from UI is usually a human-readable string (e.g. "0.5")
    // If we have to fall back, we should convert it to raw units for consistency with authentic records.
    let fallbackValue = value;
    if (!authenticTx) {
      try {
        const valNum = parseFloat(value);
        if (!isNaN(valNum)) {
          // Convert to raw units using tokenDecimals
          fallbackValue = (valNum * Math.pow(10, tokenDecimals)).toString().split('.')[0] || '0';
        }
      } catch (e) {
        this.logger.warn(`Could not normalize fallback value ${value}`);
      }
    }

    const defaultSymbol = chain === 'polygon' ? 'POL' : (chain === 'base' || chain === 'arbitrum' || chain === 'ethereum' ? 'ETH' : 'TOKEN');

    const data = {
      userId,
      txHash,
      chain,
      from: (authenticTx?.from || senderAddress || '') as string,
      to: (authenticTx?.to || to || null) as string | null,
      value: (authenticTx?.value || fallbackValue || '0') as string,
      tokenSymbol: (authenticTx?.tokenSymbol || tokenSymbol || defaultSymbol) as string,
      tokenAddress: (authenticTx?.tokenAddress || tokenAddress || null) as string | null,
      tokenDecimals: authenticTx?.tokenDecimals || tokenDecimals || 18,
      timestamp: authenticTx?.timestamp ? new Date(authenticTx.timestamp * 1000) : new Date(),
      blockNumber: authenticTx?.blockNumber || null,
      status: (authenticTx?.status || 'success') as string, // Default to success for sent transactions
      type: 'send',
      usdValue: authenticTx?.usdValue ?? null,
      direction: (authenticTx?.direction || (authenticTx?.from?.toLowerCase() === senderAddress.toLowerCase() ? 'out' : 'in')) as string
    };

    try {
      await this.prisma.blockchainTransaction.upsert({
        where: {
          txHash_chain: {
            txHash: data.txHash,
            chain: data.chain
          }
        },
        update: data,
        create: data
      });
      this.logger.log(`[History] Persisted transaction ${txHash} (Status: ${data.status})`);
    } catch (error) {
      this.logger.error(`[History] Failed to persist transaction ${txHash}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
