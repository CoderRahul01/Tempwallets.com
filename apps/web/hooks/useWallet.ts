import { useState, useEffect, useCallback, useRef } from 'react';
import { walletApi, WalletAddresses, WalletBalance, ApiError, subscribeToSSE } from '@/lib/api';
import { walletStorage } from '@/lib/walletStorage';

export interface WalletData {
  name: string;
  address: string;
  chain: string;
}

export interface UseWalletReturn {
  wallets: WalletData[];
  loading: boolean;
  error: string | null;
  loadWallets: (userId: string) => Promise<void>;
  changeWallets: (userId: string) => Promise<void>;
}

const CHAIN_NAMES: Record<string, string> = {
  ethereum: 'Ethereum',
  tron: 'Tron',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  erc4337: 'ERC-4337',
};

// ERC-4337 chains that share the same address
const ERC4337_CHAINS = ['ethereumErc4337', 'baseErc4337', 'arbitrumErc4337', 'polygonErc4337'];

export function useWallet(): UseWalletReturn {
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef<Record<string, boolean>>({});

  const processWallets = useCallback((addresses: WalletAddresses) => {
    const walletData: WalletData[] = [];
    const erc4337Addresses: string[] = [];
    
    // Process ERC-4337 addresses first to check for duplicates
    ERC4337_CHAINS.forEach(chain => {
      const address = addresses[chain as keyof WalletAddresses];
      if (address && !erc4337Addresses.includes(address)) {
        erc4337Addresses.push(address);
      }
    });
    
    // Add ERC-4337 wallet if we have any addresses
    if (erc4337Addresses.length > 0) {
      const firstAddress = erc4337Addresses[0];
      if (firstAddress) {
        walletData.push({
          name: CHAIN_NAMES.erc4337 || 'ERC-4337',
          address: firstAddress,
          chain: 'erc4337',
        });
      }
    }
    
    // Process other chains
    Object.entries(addresses).forEach(([chain, address]) => {
      if (address && !ERC4337_CHAINS.includes(chain)) {
        walletData.push({
          name: CHAIN_NAMES[chain] || chain,
          address: address,
          chain,
        });
      }
    });

    setWallets(walletData);
  }, []);

  const loadWallets = useCallback(async (userId: string, forceRefresh: boolean = false) => {
    if (!userId) {
      console.warn('⚠️ loadWallets called without userId');
      return;
    }

    setError(null);
    console.log('🔍 Loading wallet for user:', userId);
    
    // STEP 1: Always load from localStorage first (instant display)
    const cachedAddresses = walletStorage.getAddresses(userId);
    const hasLoadedBefore = hasLoadedOnceRef.current[userId] || false;
    const hasWalletsInCache = !!cachedAddresses && Object.values(cachedAddresses).some(address => address && address.length > 0);
    
    // If we have cached data and not forcing refresh, use cache and skip API
    if (hasWalletsInCache && !forceRefresh && hasLoadedBefore) {
      console.log('⚡ Using cached wallets (no API call)');
      processWallets(cachedAddresses);
      return; // Skip API call - addresses don't change unless user changes wallet
    }

    // STEP 2: Load from cache immediately for display
    if (hasWalletsInCache) {
      console.log('⚡ Loading wallets from cache (instant)');
      processWallets(cachedAddresses!);
    }

    // STEP 3: Only call API if first time or forceRefresh
    if (!forceRefresh && hasLoadedBefore) {
      console.log('⏭️ Skipping API call - using cached data');
      return;
    }

    // STEP 4: Fetch from backend using SSE for progressive loading
    // Only show blocking loader if we don't have cached wallets to show
    setLoading(!hasWalletsInCache);
    
    // Try SSE first for progressive loading
    const useSSE = typeof EventSource !== 'undefined';
    
    if (useSSE) {
      const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005'}/wallet/addresses-stream?userId=${encodeURIComponent(userId)}`;
      const collectedAddresses: Partial<WalletAddresses> = {};
      let completed = false;
      let unsubscribeFn: (() => void) | null = null;
      
      try {
        unsubscribeFn = subscribeToSSE<{ chain: string; address: string | null }>(
          url,
          (data) => {
            // Update addresses progressively as they arrive
            if (data.chain && data.chain !== 'type') {
              collectedAddresses[data.chain as keyof WalletAddresses] = data.address;
              // Immediately update UI with new address
              const partialAddresses = { ...cachedAddresses, ...collectedAddresses } as WalletAddresses;
              processWallets(partialAddresses);
              walletStorage.setAddresses(userId, partialAddresses);
            }
          },
          (error) => {
            console.warn('⚠️ SSE error, falling back to batch API:', error);
            // Fallback to batch API
            if (unsubscribeFn) unsubscribeFn();
            loadWalletsBatch(userId, cachedAddresses);
          },
          () => {
            completed = true;
            // Final update with all addresses
            const finalAddresses = { ...cachedAddresses, ...collectedAddresses } as WalletAddresses;
            walletStorage.setAddresses(userId, finalAddresses);
            hasLoadedOnceRef.current[userId] = true;
            setLoading(false);
          }
        );

        // Cleanup function (timeout after 30 seconds)
        const timeout = setTimeout(() => {
          if (!completed && unsubscribeFn) {
            unsubscribeFn();
            loadWalletsBatch(userId, cachedAddresses);
          }
        }, 30000);

        // Wait a bit for SSE to complete, but don't block forever
        // The completion callback will handle the final state
        return;
      } catch (err) {
        console.warn('⚠️ SSE not available, using batch API:', err);
        if (unsubscribeFn) unsubscribeFn();
        await loadWalletsBatch(userId, cachedAddresses);
        return;
      }
    }
    
    // Fallback to batch API if SSE not supported
    await loadWalletsBatch(userId, cachedAddresses);

    // Helper function for batch loading (fallback)
    async function loadWalletsBatch(userId: string, cachedAddresses: WalletAddresses | null) {
      try {
        // Try to get addresses from API
        let addresses;
        try {
          addresses = await walletApi.getAddresses(userId);
        } catch (err) {
          // If 404, wallet doesn't exist - we'll create it
          if (err instanceof ApiError && err.status === 404) {
            console.log('🆕 No wallet found (404). Creating new wallet...');
            
            // Auto-create wallet
            await walletApi.createOrImportSeed({
              userId,
              mode: 'random',
            });
            
            // Wait a moment for backend to process
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Fetch addresses again after creation
            addresses = await walletApi.getAddresses(userId);
            console.log('✅ New wallet created successfully');
          } else {
            // If it's a different error, check if we have cache to fall back to
            if (!cachedAddresses) {
              throw err;
            }
            // If we have cache, log error but don't throw - use cached data
            console.warn('⚠️ API error but using cached data:', err instanceof ApiError ? err.message : 'Unknown error');
            hasLoadedOnceRef.current[userId] = true;
            setLoading(false);
            return;
          }
        }
        
        // Check if user has any wallets (in case addresses are all null)
        const hasWallets = Object.values(addresses).some(address => address && address.length > 0);
        
        if (!hasWallets) {
          console.log('🆕 Wallet exists but no addresses. Creating new wallet...');
          
          // Auto-create wallet if addresses are null
          await walletApi.createOrImportSeed({
            userId,
            mode: 'random',
          });
          
          // Wait a moment for backend to process
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Fetch addresses again after creation
          const newAddresses = await walletApi.getAddresses(userId);
          console.log('✅ New wallet created successfully');
          
          // Cache the new addresses
          walletStorage.setAddresses(userId, newAddresses);
          processWallets(newAddresses);
        } else {
          console.log('✅ Existing wallet loaded from backend');
          
          // Cache the addresses
          walletStorage.setAddresses(userId, addresses);
          // Update wallets (they may be different from cache)
          processWallets(addresses);
        }

        // Mark as loaded
        hasLoadedOnceRef.current[userId] = true;
      } catch (err) {
        const errorMessage = err instanceof ApiError 
          ? err.message
          : 'Failed to load wallet';
        
        console.error('❌ Error loading wallet:', err);
        
        // If we have cached data and API fails, keep showing cached data silently
        // Only show error if we don't have cached data to fall back to
        if (!cachedAddresses) {
          setError(errorMessage);
        } else {
          console.log('✅ Using cached data due to API error');
        }
        hasLoadedOnceRef.current[userId] = true; // Mark as attempted even on error
      } finally {
        setLoading(false);
      }
    }
  }, [processWallets]);

  const changeWallets = useCallback(async (userId: string) => {
    // Clear the loaded flag and force refresh from API
    hasLoadedOnceRef.current[userId] = false;
    await loadWallets(userId, true); // Force refresh
  }, [loadWallets]);

  return {
    wallets,
    loading,
    error,
    loadWallets,
    changeWallets,
  };
}