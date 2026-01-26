import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { subscribeToSSE, UiWalletPayload, ApiError, walletApi } from '@/lib/api';
import { WalletData } from '@/types/wallet.types';
import { getWalletConfig } from '@/lib/wallet-config';
import { mapWalletCategoryToChainType, ChainType } from '@/lib/chains';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5005';

/**
 * Individual wallet stream state
 */
interface WalletStreamState {
  configId: string;
  loading: boolean;
  address: string | null;
  label?: string;
  error?: string | null;
  lastUpdated?: Date;
}

/**
 * Streaming wallets hook return type
 */
export interface UseStreamingWalletsReturn {
  /** Wallet states indexed by config ID */
  wallets: Record<string, WalletStreamState>;

  /** Overall loading state (true if any wallet is loading) */
  loading: boolean;

  /** Global error (only if complete failure) */
  error: string | null;

  /** Load wallets for user (uses streaming if available) */
  loadWallets: (userId: string, forceRefresh?: boolean) => Promise<void>;

  /** Get wallet by config ID */
  getWallet: (configId: string) => WalletStreamState | undefined;

  /** Get wallet by chain type */
  getWalletByType: (type: ChainType) => WalletStreamState | undefined;

  /** Check if streaming is in progress */
  isStreaming: boolean;

  /** Number of wallets loaded */
  loadedCount: number;

  /** Total wallets expected */
  totalCount: number;
}

/**
 * Map backend wallet keys to wallet config IDs
 */
function mapBackendKeyToConfigId(key: string, isSmartAccount: boolean = false): string {
  // Direct mappings for known backend keys
  const keyMap: Record<string, string> = {
    // EVM Standard (EOA) - backend uses short names, frontend uses 'Eoa' suffix
    'ethereum': isSmartAccount ? 'ethereumErc4337' : 'ethereumEoa',
    'base': isSmartAccount ? 'baseErc4337' : 'baseEoa',
    'arbitrum': isSmartAccount ? 'arbitrumErc4337' : 'arbitrumEoa',
    'polygon': isSmartAccount ? 'polygonErc4337' : 'polygonEoa',
    'avalanche': isSmartAccount ? 'avalancheErc4337' : 'avalancheEoa',

    // EVM Smart Accounts (ERC-4337) - map specific backend keys if they exist
    'ethereumErc4337': 'ethereumErc4337',
    'baseErc4337': 'baseErc4337',
    'arbitrumErc4337': 'arbitrumErc4337',
    'polygonErc4337': 'polygonErc4337',
    'avalancheErc4337': 'avalancheErc4337',
    'evmSmartAccount': 'ethereumErc4337', // Default smart account entry

    // Non-EVM
    'bitcoin': 'bitcoin',
    'solana': 'solana',
    'tron': 'tron',
    'yellow': 'yellow',
    'lightning': 'yellow',
    'clearnet': 'yellow',

    // Substrate/Polkadot
    'polkadot': 'polkadot',
    'hydration': 'hydrationSubstrate',
    'hydrationSubstrate': 'hydrationSubstrate',
    'bifrost': 'bifrostSubstrate',
    'bifrostSubstrate': 'bifrostSubstrate',
    'unique': 'uniqueSubstrate',
    'uniqueSubstrate': 'uniqueSubstrate',

    // Testnets
    'moonbeamTestnet': 'moonbeamTestnet',
    'astarShibuya': 'astarShibuya',
    'paseoPassetHub': 'paseoPassetHub',
    'paseo': 'paseo',
    'paseoAssethub': 'paseoAssethub',
  };

  return keyMap[key] || key;
}

/**
 * Process backend wallet payload into stream states
 */
function processWalletPayload(
  payload: UiWalletPayload,
  existingStates: Record<string, WalletStreamState> = {}
): Record<string, WalletStreamState> {
  const newStates: Record<string, WalletStreamState> = { ...existingStates };

  // Process smart account
  if (payload.smartAccount?.address) {
    const smartAccountKey = payload.smartAccount.key;
    const smartAccountConfigId = mapBackendKeyToConfigId(smartAccountKey, true);
    const smartAccountChains = payload.smartAccount.chains;

    // Map each ERC-4337 chain
    Object.entries(smartAccountChains).forEach(([key, address]) => {
      const configId = mapBackendKeyToConfigId(key, true);
      const config = getWalletConfig(configId);

      if (config) {
        newStates[configId] = {
          configId,
          loading: false,
          address: address,
          label: config.name,
          lastUpdated: new Date(),
        };
      }
    });
  }

  // Process auxiliary wallets
  if (payload.auxiliary && payload.auxiliary.length > 0) {
    payload.auxiliary.forEach((entry) => {
      const configId = mapBackendKeyToConfigId(entry.key || entry.chain);
      const config = getWalletConfig(configId);

      if (config) {
        newStates[configId] = {
          configId,
          loading: false,
          address: entry.address,
          label: entry.label || config.name,
          lastUpdated: new Date(),
        };
      }
    });
  }

  return newStates;
}

/**
 * Hook for streaming wallet data
 * 
 * Progressively loads wallet addresses using SSE streaming.
 * Falls back to batch loading if streaming fails or is not available.
 * 
 * @example
 * ```tsx
 * const { wallets, loading, loadWallets, getWallet } = useStreamingWallets();
 * 
 * useEffect(() => {
 *   if (userId) {
 *     loadWallets(userId);
 *   }
 * }, [userId, loadWallets]);
 * 
 * const ethereum = getWallet('ethereumErc4337');
 * ```
 */
export function useStreamingWallets(): UseStreamingWalletsReturn {
  const [wallets, setWallets] = useState<Record<string, WalletStreamState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const hasLoadedRef = useRef<Record<string, boolean>>({});
  const isLoadingRef = useRef<Record<string, boolean>>({});
  const activeConnectionRef = useRef<EventSource | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      if (activeConnectionRef.current) {
        activeConnectionRef.current.close();
      }
    };
  }, []);

  // Move loadWalletsBatch outside to fix scope and make it a useCallback
  const loadWalletsBatch = useCallback(async (userId: string) => {
    if (!userId) {
      console.warn('loadWalletsBatch called without userId');
      return;
    }

    try {
      const url = `${API_BASE_URL}/wallet/addresses?userId=${encodeURIComponent(userId)}`;
      console.debug('Fetching wallets batch:', url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new ApiError(response.status, 'Failed to load wallets');
      }

      const data: UiWalletPayload = await response.json();
      const processedStates = processWalletPayload(data);

      const count = Object.keys(processedStates).length;

      // AUTO-SEEDING: If no wallets found, trigger seed creation
      if (count === 0 && userId) {
        console.log('No wallets found, auto-creating seed...');
        try {
          await walletApi.createOrImportSeed({ userId, mode: 'random' });
          // Wait a moment and try fetching again once
          await new Promise(r => setTimeout(r, 1000));
          const retryResponse = await fetch(`${API_BASE_URL}/wallet/addresses?userId=${encodeURIComponent(userId)}`);
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            const retryProcessed = processWalletPayload(retryData);
            setWallets(retryProcessed);
            setTotalCount(Object.keys(retryProcessed).length);
          }
        } catch (seedErr) {
          console.error('Auto-seeding failed:', seedErr);
        }
      } else {
        setWallets(processedStates);
        setTotalCount(count);
      }

      setLoading(false);
      hasLoadedRef.current[userId] = true;
      isLoadingRef.current[userId] = false;
    } catch (err) {
      const errorMessage = err instanceof ApiError
        ? err.message
        : 'Failed to load wallets';

      console.error('Error loading wallets:', err);
      setError(errorMessage);
      setLoading(false);
      isLoadingRef.current[userId] = false;
    }
  }, []);

  const loadWallets = useCallback(async (userId: string, forceRefresh: boolean = false) => {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      console.warn('loadWallets called with invalid userId:', userId);
      return;
    }

    // Prevent duplicate calls for the same userId
    if (isLoadingRef.current[userId] && !forceRefresh) {
      return;
    }

    // Don't reload if already loaded and not forcing refresh
    if (hasLoadedRef.current[userId] && !forceRefresh) {
      return;
    }

    // Cleanup existing connection synchronously BEFORE creating new one
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Close active EventSource connection if exists
    if (activeConnectionRef.current) {
      activeConnectionRef.current.close();
      activeConnectionRef.current = null;
    }

    setError(null);
    setLoading(true);

    // Clear wallets state if forcing refresh or if userId has changed
    // This prevents stale addresses from previous users/sessions from being displayed
    setWallets({});
    setTotalCount(0);

    isLoadingRef.current[userId] = true;

    // Try SSE streaming first
    const useSSE = typeof EventSource !== 'undefined';

    if (useSSE) {
      try {
        const url = `${API_BASE_URL}/wallet/addresses-stream?userId=${encodeURIComponent(userId)}`;
        console.debug('Starting SSE stream for wallets:', url);
        setIsStreaming(true);

        let streamCompleted = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = subscribeToSSE<UiWalletPayload>(
          url,
          // On message - update wallets progressively
          (data) => {
            setWallets((prev) => {
              const updated = processWalletPayload(data, prev);
              setTotalCount(Object.keys(updated).length);
              return updated;
            });
          },
          // On error - fall back to batch
          (error) => {
            console.warn('SSE streaming failed, falling back to batch loading:', error);
            if (timeoutId) clearTimeout(timeoutId);
            setIsStreaming(false);
            isLoadingRef.current[userId] = false;
            loadWalletsBatch(userId);
          },
          // On complete
          () => {
            streamCompleted = true;
            if (timeoutId) clearTimeout(timeoutId);

            // AUTO-SEEDING: If stream completes but still no wallets found, trigger seed creation
            setWallets((latestWallets) => {
              const count = Object.keys(latestWallets).length;
              if (count === 0 && userId) {
                console.log('No wallets found after streaming, auto-creating seed...');
                walletApi.createOrImportSeed({ userId, mode: 'random' }).then(() => {
                  loadWalletsBatch(userId);
                });
              }
              return latestWallets;
            });

            setIsStreaming(false);
            setLoading(false);
            hasLoadedRef.current[userId] = true;
            isLoadingRef.current[userId] = false;
          }
        );

        unsubscribeRef.current = cleanup;

        // Timeout after 30 seconds
        timeoutId = setTimeout(() => {
          if (!streamCompleted && cleanup) {
            if (process.env.NODE_ENV === 'development') {
              console.debug('SSE streaming timeout, falling back to batch loading');
            }
            cleanup();
            setIsStreaming(false);
            isLoadingRef.current[userId] = false;
            loadWalletsBatch(userId);
          }
        }, 30000);

        return;
      } catch (err) {
        console.warn('Failed to start SSE streaming, falling back to batch:', err);
        setIsStreaming(false);
        isLoadingRef.current[userId] = false;
        await loadWalletsBatch(userId);
        return;
      }
    }

    // Fallback to batch loading
    await loadWalletsBatch(userId);
  }, [loadWalletsBatch]);

  const getWallet = useCallback((configId: string): WalletStreamState | undefined => {
    return wallets[configId];
  }, [wallets]);

  const getWalletByType = useCallback((type: ChainType): WalletStreamState | undefined => {
    // Find first wallet matching the chain type
    return Object.values(wallets).find((wallet) => {
      const config = getWalletConfig(wallet.configId);
      return config?.type === type;
    });
  }, [wallets]);

  const loadedCount = Object.keys(wallets).length;
  const isLoading = loading || Object.values(wallets).some((w) => w.loading);

  const result = useMemo(() => ({
    wallets,
    loading: isLoading,
    error,
    loadWallets,
    getWallet,
    getWalletByType,
    isStreaming,
    loadedCount,
    totalCount,
  }), [wallets, isLoading, error, loadWallets, getWallet, getWalletByType, isStreaming, loadedCount, totalCount]);

  return result;
}
