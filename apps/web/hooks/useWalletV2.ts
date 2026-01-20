import { useCallback, useMemo } from 'react';
import { useStreamingWallets } from './useStreamingWallets';
import { ChainType } from '@/lib/chains';
import { getWalletConfig } from '@/lib/wallet-config';

/**
 * Wallet data interface (compatible with existing useWallet)
 */
export interface WalletData {
  name: string;
  address: string;
  chain: string;
  category?: string;
  chainType?: ChainType;
}

/**
 * Unified wallet hook return type (compatible with existing useWallet)
 */
export interface UseWalletReturn {
  wallets: WalletData[];
  loading: boolean;
  error: string | null;
  loadWallets: (userId: string, forceRefresh?: boolean) => Promise<void>;
  changeWallets: (userId: string) => Promise<void>;
  getWalletByChainType: (type: ChainType) => WalletData | null;
  getWalletByChainId: (configId: string) => WalletData | null;

  // New streaming-specific properties
  isStreaming?: boolean;
  loadedCount?: number;
  totalCount?: number;
}

/**
 * Unified wallet hook
 * 
 * Provides a single interface for wallet management with streaming support.
 * Compatible with the existing useWallet hook interface.
 * 
 * Features:
 * - Progressive loading via SSE streaming
 * - Automatic fallback to batch loading
 * - Per-wallet loading states
 * - Backward compatible interface
 * 
 * @example
 * ```tsx
 * const { wallets, loading, loadWallets, getWalletByChainType } = useWalletV2();
 * 
 * useEffect(() => {
 *   if (userId) {
 *     loadWallets(userId);
 *   }
 * }, [userId, loadWallets]);
 * 
 * const ethereumWallet = getWalletByChainType('evm');
 * ```
 */
export function useWalletV2(): UseWalletReturn {
  const streaming = useStreamingWallets();

  // Convert streaming wallet states to legacy WalletData format
  const wallets = useMemo((): WalletData[] => {
    return Object.values(streaming.wallets)
      .filter((w) => w.address) // Only include wallets with addresses
      .map((wallet) => {
        const config = getWalletConfig(wallet.configId);

        return {
          name: wallet.label || config?.name || wallet.configId,
          address: wallet.address!,
          chain: wallet.configId,
          category: config?.type || 'evm',
          chainType: config?.type as ChainType,
        };
      });
  }, [streaming.wallets]);

  const loadWallets = useCallback(
    async (userId: string, forceRefresh: boolean = false) => {
      await streaming.loadWallets(userId, forceRefresh);
    },
    [streaming]
  );

  const changeWallets = useCallback(
    async (userId: string) => {
      // Force refresh to get new wallets
      await streaming.loadWallets(userId, true);
    },
    [streaming]
  );

  const getWalletByChainType = useCallback(
    (type: ChainType): WalletData | null => {
      const streamWallet = streaming.getWalletByType(type);

      if (!streamWallet || !streamWallet.address) {
        return null;
      }

      const config = getWalletConfig(streamWallet.configId);

      return {
        name: streamWallet.label || config?.name || streamWallet.configId,
        address: streamWallet.address,
        chain: streamWallet.configId,
        category: config?.type || 'evm',
        chainType: config?.type as ChainType,
      };
    },
    [streaming]
  );

  const getWalletByChainId = useCallback(
    (configId: string): WalletData | null => {
      const streamWallet = streaming.getWallet(configId);

      if (!streamWallet || !streamWallet.address) {
        return null;
      }

      const config = getWalletConfig(streamWallet.configId);

      return {
        name: streamWallet.label || config?.name || streamWallet.configId,
        address: streamWallet.address,
        chain: streamWallet.configId,
        category: config?.type || 'evm',
        chainType: config?.type as ChainType,
      };
    },
    [streaming]
  );

  return useMemo(() => ({
    wallets,
    loading: streaming.loading,
    error: streaming.error,
    loadWallets,
    changeWallets,
    getWalletByChainType,
    getWalletByChainId,
    isStreaming: streaming.isStreaming,
    loadedCount: streaming.loadedCount,
    totalCount: streaming.totalCount,
  }), [wallets, streaming.loading, streaming.error, loadWallets, changeWallets, getWalletByChainType, getWalletByChainId, streaming.isStreaming, streaming.loadedCount, streaming.totalCount]);
}
