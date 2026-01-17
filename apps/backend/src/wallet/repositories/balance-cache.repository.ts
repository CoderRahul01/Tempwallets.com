import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class BalanceCacheRepository {
  private readonly logger = new Logger(BalanceCacheRepository.name);

  constructor(private prisma: PrismaService) { }

  /**
   * Get cached balances for a user
   * @param fingerprint - The browser fingerprint (same as userId)
   * @returns Cached balances object or null if not found
   */
  async getCachedBalances(
    fingerprint: string,
  ): Promise<Record<string, { balance: string; lastUpdated: number }> | null> {
    const cache = await this.prisma.walletCache.findUnique({
      where: { fingerprint },
      select: {
        cachedBalances: true,
        lastUpdated: true,
      },
    });

    if (!cache) {
      return null;
    }

    // Parse JSON and ensure it's in the expected format
    const balances = cache.cachedBalances as Record<
      string,
      { balance: string; lastUpdated: number }
    >;

    return balances;
  }

  /**
   * Update cached balances for a user
   * @param fingerprint - The browser fingerprint
   * @param balances - Record of chain -> balance data
   */
  async updateCachedBalances(
    fingerprint: string,
    balances: Record<string, { balance: string; lastUpdated: number }>,
  ): Promise<void> {
    await this.prisma.walletCache.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        cachedBalances: balances,
      },
      update: {
        cachedBalances: balances,
      },
    });
  }

  /**
   * Clear cache for a user
   * @param fingerprint - The browser fingerprint
   */
  async clearCache(fingerprint: string): Promise<void> {
    await this.prisma.walletCache.delete({
      where: { fingerprint },
    });
  }

  /**
   * Check if cache exists for a user
   * @param fingerprint - The browser fingerprint
   * @returns True if cache exists, false otherwise
   */
  async hasCache(fingerprint: string): Promise<boolean> {
    const cache = await this.prisma.walletCache.findUnique({
      where: { fingerprint },
      select: { id: true },
    });
    return !!cache;
  }

  /**
   * Get full token balances (Zerion format) from DB cache
   */
  async getCachedAssetBalances(
    fingerprint: string,
  ): Promise<{ assets: any[]; lastUpdated: Date } | null> {
    const cache = await this.prisma.walletCache.findUnique({
      where: { fingerprint },
    });

    if (!cache || !cache.cachedBalances) {
      return null;
    }

    return {
      assets: cache.cachedBalances as any[],
      lastUpdated: cache.lastUpdated,
    };
  }

  /**
   * Update full token balances (Zerion format) in DB cache
   */
  async updateCachedAssetBalances(
    fingerprint: string,
    assets: any[],
  ): Promise<void> {
    await this.prisma.walletCache.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        cachedBalances: assets as any,
      },
      update: {
        cachedBalances: assets as any,
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Get chain-specific token balances from DB cache
   * @param fingerprint - The browser fingerprint
   * @param chain - The blockchain network
   * @returns Cached balances for the chain or null if not found
   */
  async getChainBalances(
    fingerprint: string,
    chain: string,
  ): Promise<{ assets: any[]; lastUpdated: Date } | null> {
    const cache = await this.prisma.walletBalanceCache.findUnique({
      where: {
        fingerprint_chain: {
          fingerprint,
          chain,
        },
      },
    });

    if (!cache) {
      return null;
    }

    return {
      assets: cache.cachedBalances as any[],
      lastUpdated: cache.lastUpdated,
    };
  }

  /**
   * Update chain-specific token balances in DB cache
   * @param fingerprint - The browser fingerprint
   * @param chain - The blockchain network
   * @param assets - Array of TokenBalance objects
   */
  async updateChainBalances(
    fingerprint: string,
    chain: string,
    assets: any[],
  ): Promise<void> {
    await this.prisma.walletBalanceCache.upsert({
      where: {
        fingerprint_chain: {
          fingerprint,
          chain,
        },
      },
      create: {
        fingerprint,
        chain,
        cachedBalances: assets as any,
      },
      update: {
        cachedBalances: assets as any,
        lastUpdated: new Date(),
      },
    });
  }
}
