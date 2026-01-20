import { Injectable, Logger } from '@nestjs/common';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import WalletManagerTron from '@tetherto/wdk-wallet-tron';
import WalletManagerBtc from '@tetherto/wdk-wallet-btc';
import WalletManagerSolana from '@tetherto/wdk-wallet-solana';
import WDK from '@tetherto/wdk';
import { ChainConfigService } from '../config/chain.config.js';
import { IAccountFactory } from '../interfaces/wallet.interfaces.js';
import { IAccount, TokenTransferParams } from '../types/account.types.js';
import { AllChainTypes } from '../types/chain.types.js';

/**
 * Wrapper class to adapt WDK accounts to IAccount interface
 * WDK accounts have transfer() method but not send()
 */
class WdkAccountWrapper implements IAccount {
  constructor(
    private wdkAccount: any,
    private logger: Logger,
  ) { }

  async getAddress(): Promise<string> {
    return this.wdkAccount.getAddress();
  }

  async getBalance(): Promise<string> {
    const balance = await this.wdkAccount.getBalance();
    return balance.toString();
  }

  async send(to: string, amount: string): Promise<string> {
    return this.transfer({ to, amount });
  }

  async transfer(params: TokenTransferParams): Promise<string> {
    const { to, amount, tokenAddress } = params;
    try {
      // WDK accounts handle tokens via internal logic or throw if not supported
      // For standard EVM, transfer() might need tokenAddress support if implemented in future WDK versions
      // For now, we use the existing transfer/send logic.

      // WDK accounts use transfer() method
      if (
        'transfer' in this.wdkAccount &&
        typeof this.wdkAccount.transfer === 'function'
      ) {
        // Prepare transfer options
        const transferParams: any = {
          to,
          amount: BigInt(amount),
        };

        if (tokenAddress) {
          transferParams.tokenAddress = tokenAddress;
        }

        const result = await this.wdkAccount.transfer(transferParams);
        // Extract txHash from result (could be string or object)
        const txHash =
          typeof result === 'string'
            ? result
            : result?.hash || result?.txHash || String(result);
        return txHash;
      }

      // Fallback: some WDK accounts might have send() method
      if (
        'send' in this.wdkAccount &&
        typeof this.wdkAccount.send === 'function'
      ) {
        const result = await this.wdkAccount.send(to, amount);
        const txHash =
          typeof result === 'string'
            ? result
            : result?.hash || result?.txHash || String(result);
        return txHash;
      }

      throw new Error('Account does not support transfer or send methods');
    } catch (error) {
      this.logger.error(
        `Failed to send transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}

/**
 * Account Factory for EOA (Externally Owned Accounts)
 * Uses Tether WDK for standard blockchain accounts (non-ERC-4337)
 */
@Injectable()
export class AccountFactory implements IAccountFactory {
  private readonly logger = new Logger(AccountFactory.name);

  constructor(private chainConfig: ChainConfigService) { }

  getAccountType(): string {
    return 'EOA';
  }

  /**
   * Create an EOA account from seed phrase
   * @param seedPhrase - BIP-39 mnemonic
   * @param chain - Blockchain chain
   * @param accountIndex - HD wallet account index (default: 0)
   * @returns Account wrapper
   */
  async createAccount(
    seedPhrase: string,
    chain: AllChainTypes,
    accountIndex: number = 0,
  ): Promise<IAccount> {
    // Remove erc4337 suffix for chain lookup
    const baseChain = chain.replace(/Erc4337$/i, '').toLowerCase();

    this.logger.debug(`Creating EOA account on ${chain} (base: ${baseChain})`);

    // Create WDK instance with chain-specific configuration
    const wdk = this.createWdkInstance(seedPhrase);

    // Get account from WDK
    const wdkAccount = await wdk.getAccount(
      this.mapChainToWdkChain(baseChain),
      accountIndex,
    );

    // Wrap WDK account to implement IAccount interface
    return new WdkAccountWrapper(wdkAccount, this.logger);
  }

  /**
   * Map internal chain names to WDK chain identifiers
   */
  private mapChainToWdkChain(chain: string): string {
    const chainMap: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'base',
      arbitrum: 'arbitrum',
      polygon: 'polygon',
      avalanche: 'avalanche',
      tron: 'tron',
      bitcoin: 'bitcoin',
      solana: 'solana',
      moonbeamtestnet: 'moonbeamtestnet', // Use ethereum manager for EVM-compatible chains
      astarshibuya: 'astarshibuya',
      paseopassethub: 'paseopassethub',
      hydration: 'hydration',
      unique: 'unique',
      bifrost: 'bifrost',
      bifrosttestnet: 'bifrosttestnet',
    };

    const wdkChain = chainMap[chain];
    if (!wdkChain) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    return wdkChain;
  }

  /**
   * Create WDK instance with all wallet managers registered
   */
  private createWdkInstance(seedPhrase: string): WDK {
    const wdk = new WDK(seedPhrase)
      .registerWallet('ethereum', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('ethereum').rpcUrl,
      })
      .registerWallet('base', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('base').rpcUrl,
      })
      .registerWallet('arbitrum', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('arbitrum').rpcUrl,
      })
      .registerWallet('polygon', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('polygon').rpcUrl,
      })
      .registerWallet('avalanche', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('avalanche').rpcUrl,
      })
      .registerWallet('moonbeamtestnet', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('moonbeamTestnet').rpcUrl,
      })
      .registerWallet('astarshibuya', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('astarShibuya').rpcUrl,
      })
      .registerWallet('paseopassethub', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('paseoPassetHub').rpcUrl,
      })
      .registerWallet('hydration', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('hydration').rpcUrl,
      })
      .registerWallet('unique', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('unique').rpcUrl,
      })
      .registerWallet('bifrost', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('bifrost').rpcUrl,
      })
      .registerWallet('bifrosttestnet', WalletManagerEvm, {
        provider: this.chainConfig.getEvmChainConfig('bifrostTestnet').rpcUrl,
      })
      .registerWallet(
        'tron',
        WalletManagerTron,
        this.chainConfig.getTronConfig(),
      )
      .registerWallet(
        'bitcoin',
        WalletManagerBtc as any,
        this.chainConfig.getBitcoinConfig(),
      )
      .registerWallet(
        'solana',
        WalletManagerSolana,
        this.chainConfig.getSolanaConfig(),
      );

    return wdk;
  }
}
