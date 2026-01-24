import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WalletService } from './wallet.service.js';
import { SeedRepository } from './seed.repository.js';
import { ZerionService } from './services/zerion.service.js';
import { BalanceProviderFactory } from './factories/balance-provider.factory.js';
import { SeedManager } from './managers/seed.manager.js';
import { AddressManager } from './managers/address.manager.js';
import { AccountFactory } from './factories/account.factory.js';
import { SubstrateManager } from './substrate/managers/substrate.manager.js';
import { BalanceCacheRepository } from './repositories/balance-cache.repository.js';
import { WalletAddresses } from './interfaces/wallet.interfaces.js';
import { Eip7702DelegationRepository } from './repositories/eip7702-delegation.repository.js';
import { NativeEoaFactory } from './factories/native-eoa.factory.js';
import { Eip7702AccountFactory } from './factories/eip7702-account.factory.js';
import { WalletHistoryRepository } from './repositories/wallet-history.repository.js';
import { PimlicoConfigService } from './config/pimlico.config.js';
import { CacheService } from './services/cache.service.js';
import { SendService } from './services/standard-wallet/send.service.js';
import { ReceiveService } from './services/standard-wallet/receive.service.js';
import { BalanceService } from './services/standard-wallet/balance.service.js';
import { ChainMapService } from './services/standard-wallet/chain-map.service.js';

// Mock TokenListService to avoid import.meta.url issues
jest.mock('./services/token-list.service.js', () => {
  return {
    TokenListService: jest.fn().mockImplementation(() => ({
      getTokensForChain: jest.fn().mockReturnValue([]),
      getAllTokens: jest.fn().mockReturnValue([]),
    })),
  };
});

describe('WalletService', () => {
  let walletService: WalletService;
  let seedRepository: jest.Mocked<SeedRepository>;
  let configService: jest.Mocked<ConfigService>;
  let zerionService: jest.Mocked<ZerionService>;
  let seedManager: jest.Mocked<SeedManager>;
  let addressManager: jest.Mocked<AddressManager>;
  let accountFactory: jest.Mocked<AccountFactory>;
  let eip7702AccountFactory: jest.Mocked<Eip7702AccountFactory>;
  let nativeEoaFactory: jest.Mocked<NativeEoaFactory>;
  let walletHistoryRepository: jest.Mocked<WalletHistoryRepository>;
  let pimlicoConfig: jest.Mocked<PimlicoConfigService>;
  let substrateManager: jest.Mocked<SubstrateManager>;
  let balanceCacheRepository: jest.Mocked<BalanceCacheRepository>;
  let eip7702DelegationRepository: jest.Mocked<Eip7702DelegationRepository>;
  let balanceProviderFactory: jest.Mocked<BalanceProviderFactory>;
  let cacheService: jest.Mocked<CacheService>;
  let sendService: jest.Mocked<SendService>;
  let receiveService: jest.Mocked<ReceiveService>;
  let balanceService: jest.Mocked<BalanceService>;
  let chainMapService: jest.Mocked<ChainMapService>;

  const mockUserId = 'test-fingerprint-123';
  const mockAddresses: WalletAddresses = {
    ethereum: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    base: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  } as WalletAddresses;

  beforeEach(async () => {
    const mockSeedRepository = {
      createOrUpdateSeed: jest.fn(),
      getSeedPhrase: jest.fn(),
      hasSeed: jest.fn(),
      deleteSeed: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockZerionService = {
      getBalances: jest.fn(),
      getTransactions: jest.fn(),
    };

    const mockSeedManager = {
      hasSeed: jest.fn(),
      createOrImportSeed: jest.fn(),
      getSeed: jest.fn(),
      storeSeed: jest.fn(),
    };

    const mockAddressManager = {
      getAddresses: jest.fn(),
      streamAddresses: jest.fn(),
      getManagedAddresses: jest.fn(),
    };

    const mockAccountFactory = {
      createAccount: jest.fn(),
    };

    const mockEip7702AccountFactory = {
      createAccount: jest.fn(),
    };

    const mockNativeEoaFactory = {
      createAccount: jest.fn(),
    };

    const mockWalletHistoryRepository = {
      saveToHistory: jest.fn(),
      getWalletHistory: jest.fn(),
      getSeedFromHistory: jest.fn(),
      setActiveWallet: jest.fn(),
      deleteWallet: jest.fn(),
    };

    const mockPimlicoConfig = {
      isEip7702Enabled: jest.fn(),
      getEip7702Config: jest.fn(),
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const mockSendService = {};
    const mockReceiveService = {};
    const mockBalanceService = {
      getBalances: jest.fn(),
    };
    const mockChainMapService = {};


    const mockSubstrateManager = {
      getBalances: jest.fn(),
    };

    const mockEip7702DelegationRepository = {
      getDelegationsForUser: jest.fn().mockResolvedValue([]),
    };

    const mockBalanceCacheRepository = {
      getCachedBalances: jest.fn(),
      updateCachedBalances: jest.fn(),
      clearCache: jest.fn(),
      hasCache: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: SeedRepository,
          useValue: mockSeedRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ZerionService,
          useValue: mockZerionService,
        },
        {
          provide: SeedManager,
          useValue: mockSeedManager,
        },
        {
          provide: AddressManager,
          useValue: mockAddressManager,
        },
        {
          provide: AccountFactory,
          useValue: mockAccountFactory,
        },
        {
          provide: Eip7702AccountFactory,
          useValue: mockEip7702AccountFactory,
        },
        {
          provide: NativeEoaFactory,
          useValue: mockNativeEoaFactory,
        },
        {
          provide: WalletHistoryRepository,
          useValue: mockWalletHistoryRepository,
        },
        {
          provide: PimlicoConfigService,
          useValue: mockPimlicoConfig,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: SendService,
          useValue: mockSendService,
        },
        {
          provide: ReceiveService,
          useValue: mockReceiveService,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
        {
          provide: ChainMapService,
          useValue: mockChainMapService,
        },
        {
          provide: SubstrateManager,
          useValue: mockSubstrateManager,
        },
        {
          provide: BalanceCacheRepository,
          useValue: mockBalanceCacheRepository,
        },
        {
          provide: Eip7702DelegationRepository,
          useValue: mockEip7702DelegationRepository,
        },
        {
          provide: BalanceProviderFactory,
          useValue: {
            getProvider: jest.fn().mockReturnValue({
              getBalances: jest.fn().mockResolvedValue([]),
              isChainSupported: jest.fn().mockReturnValue(true),
            }),
          },
        },
      ],
    }).compile();

    walletService = module.get<WalletService>(WalletService);
    seedRepository = module.get(SeedRepository);
    configService = module.get(ConfigService);
    zerionService = module.get(ZerionService);
    seedManager = module.get(SeedManager);
    addressManager = module.get(AddressManager);
    accountFactory = module.get(AccountFactory);
    eip7702AccountFactory = module.get(Eip7702AccountFactory);
    nativeEoaFactory = module.get(NativeEoaFactory);
    walletHistoryRepository = module.get(WalletHistoryRepository);
    pimlicoConfig = module.get(PimlicoConfigService);
    cacheService = module.get(CacheService);
    sendService = module.get(SendService);
    receiveService = module.get(ReceiveService);
    balanceService = module.get(BalanceService);
    chainMapService = module.get(ChainMapService);
    substrateManager = module.get(SubstrateManager);
    balanceCacheRepository = module.get(BalanceCacheRepository);
    eip7702DelegationRepository = module.get(Eip7702DelegationRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalances()', () => {
    it('should return data from balanceService', async () => {
      const mockBalances = [
        { chain: 'ethereum', balance: '1000000000000000000', address: null, symbol: 'ETH', decimals: 18 },
        { chain: 'base', balance: '500000000000000000', address: null, symbol: 'ETH', decimals: 18 },
      ];

      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      balanceService.getBalances.mockResolvedValue(mockBalances as any);

      const result = await walletService.getBalances(mockUserId, false);

      expect(addressManager.getAddresses).toHaveBeenCalledWith(mockUserId);
      expect(balanceService.getBalances).toHaveBeenCalledWith(mockAddresses.ethereum, undefined);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ chain: 'ethereum', balance: '1000000000000000000' });
    });

    it('should create wallet if it does not exist', async () => {
      balanceCacheRepository.getCachedBalances.mockResolvedValue(null);
      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      seedManager.hasSeed.mockResolvedValue(false);
      seedManager.createOrImportSeed.mockResolvedValue(undefined);

      zerionService.getBalances.mockResolvedValue([]);

      await walletService.getBalances(mockUserId, false);

      // Should check if wallet exists
      expect(addressManager.getAddresses).toHaveBeenCalledWith(mockUserId);
    });

    it('should fetch from balanceService', async () => {
      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      balanceService.getBalances.mockResolvedValue([]);

      await walletService.getBalances(mockUserId, false);

      expect(balanceService.getBalances).toHaveBeenCalled();
    });

    it('should pass forceRefresh to getBalances', async () => {
      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      balanceService.getBalances.mockResolvedValue([]);

      await walletService.getBalances(mockUserId, true);

      expect(balanceService.getBalances).toHaveBeenCalled();
    });
  });

  describe('refreshBalances()', () => {
    it('should fetch from balanceService', async () => {
      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      balanceService.getBalances.mockResolvedValue([]);

      const result = await walletService.refreshBalances(mockUserId);

      expect(addressManager.getAddresses).toHaveBeenCalledWith(mockUserId);
      expect(balanceService.getBalances).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('Cache operations', () => {
    it('should retrieve balances via balanceService', async () => {
      addressManager.getAddresses.mockResolvedValue(mockAddresses);
      balanceService.getBalances.mockResolvedValue([]);

      const result = await walletService.getBalances(mockUserId, false);

      expect(balanceService.getBalances).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
