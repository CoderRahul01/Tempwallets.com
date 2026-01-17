"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, ArrowUpRight, ArrowDownLeft, ExternalLink, Clock } from "lucide-react";
import { walletApi, Transaction } from "@/lib/api";
import { useBrowserFingerprint } from "@/hooks/useBrowserFingerprint";
import { useWalletData } from "@/hooks/useWalletData";
import { useWalletV2 } from "@/hooks/useWalletV2";

interface RecentTransactionsProps {
  showAll?: boolean;
  transactions?: Transaction[]; // Optional transactions from provider
  hideHeader?: boolean; // Hide header when used in toggle component
  selectedChainId?: string; // Optional chain filter
}

const CHAIN_NAMES: Record<string, string> = {
  // Zerion canonical chain ids
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  polygon: "Polygon",
  solana: "Solana",
  // Legacy/other
  tron: "Tron",
  bitcoin: "Bitcoin",
  ethereumErc4337: "Ethereum (ERC-4337)",
  baseErc4337: "Base (ERC-4337)",
  arbitrumErc4337: "Arbitrum (ERC-4337)",
  polygonErc4337: "Polygon (ERC-4337)",
  // Substrate/Polkadot chains
  polkadot: "Polkadot",
  hydrationSubstrate: "Hydration (Substrate)",
  bifrostSubstrate: "Bifrost (Substrate)",
  uniqueSubstrate: "Unique (Substrate)",
  paseo: "Paseo",
  paseoAssethub: "Paseo AssetHub",
};

/**
 * Format transaction hash for block explorer
 * Substrate chains need hash without 0x prefix for Subscan
 */
const formatTxHash = (hash: string, isSubstrate: boolean = false): string => {
  if (!hash) return '';
  // Remove 0x prefix for Substrate chains (Subscan expects it without prefix)
  if (isSubstrate && hash.startsWith('0x')) {
    return hash.slice(2);
  }
  return hash;
};

/**
 * Get block explorer URL for a transaction
 * Supports both testnet and mainnet explorers
 */
const getExplorerUrl = (txHash: string, chain: string, isTestnet: boolean = false): string => {
  if (!txHash) return '#';

  // EVM chains (testnet support)
  const evmExplorers: Record<string, { mainnet: string; testnet?: string }> = {
    ethereum: { mainnet: 'https://etherscan.io', testnet: 'https://sepolia.etherscan.io' },
    base: { mainnet: 'https://basescan.org', testnet: 'https://sepolia.basescan.org' },
    arbitrum: { mainnet: 'https://arbiscan.io', testnet: 'https://sepolia.arbiscan.io' },
    polygon: { mainnet: 'https://polygonscan.com', testnet: 'https://mumbai.polygonscan.com' },
    avalanche: { mainnet: 'https://snowtrace.io', testnet: 'https://testnet.snowtrace.io' },
    moonbeamTestnet: { mainnet: 'https://moonscan.io', testnet: 'https://moonbase.moonscan.io' },
    astarShibuya: { mainnet: 'https://astar.subscan.io', testnet: 'https://shibuya.subscan.io' },
    paseoPassetHub: { mainnet: 'https://assethub-polkadot.subscan.io', testnet: 'https://assethub-paseo.subscan.io' },
  };

  // Check if it's an EVM chain
  const evmChain = chain.replace('Erc4337', '');
  if (evmExplorers[evmChain]) {
    const explorer = isTestnet && evmExplorers[evmChain].testnet
      ? evmExplorers[evmChain].testnet
      : evmExplorers[evmChain].mainnet;
    return `${explorer}/tx/${txHash}`;
  }

  // Non-EVM chains
  const nonEvmExplorers: Record<string, string> = {
    tron: `https://tronscan.org/#/transaction/${txHash}`,
    bitcoin: `https://blockstream.info/tx/${txHash}`,
    solana: `https://solscan.io/tx/${txHash}`,
  };

  if (nonEvmExplorers[chain]) {
    return nonEvmExplorers[chain];
  }

  // Substrate/Polkadot chains - use Subscan (more reliable than Polkascan)
  const substrateExplorers: Record<string, { mainnet: string; testnet: string }> = {
    polkadot: {
      mainnet: 'https://polkadot.subscan.io',
      testnet: 'https://paseo.subscan.io' // Paseo is Polkadot testnet
    },
    hydrationSubstrate: {
      mainnet: 'https://hydradx.subscan.io',
      testnet: 'https://hydradx-testnet.subscan.io'
    },
    bifrostSubstrate: {
      mainnet: 'https://bifrost.subscan.io',
      testnet: 'https://bifrost-testnet.subscan.io'
    },
    uniqueSubstrate: {
      mainnet: 'https://unique.subscan.io',
      testnet: 'https://unique-testnet.subscan.io'
    },
    paseo: {
      mainnet: 'https://paseo.subscan.io',
      testnet: 'https://paseo.subscan.io' // Paseo is always testnet
    },
    paseoAssethub: {
      mainnet: 'https://assethub-polkadot.subscan.io',
      testnet: 'https://assethub-paseo.subscan.io'
    },
  };

  if (substrateExplorers[chain]) {
    const explorer = isTestnet ? substrateExplorers[chain].testnet : substrateExplorers[chain].mainnet;
    const formattedHash = formatTxHash(txHash, true);
    return `${explorer}/extrinsic/${formattedHash}`;
  }

  return '#';
};

// Legacy function for backward compatibility (kept for potential future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHAIN_EXPLORER_URLS: Record<string, (txHash: string) => string> = {
  // Zerion canonical chain ids
  ethereum: (hash) => getExplorerUrl(hash, 'ethereum', false),
  base: (hash) => getExplorerUrl(hash, 'base', false),
  arbitrum: (hash) => getExplorerUrl(hash, 'arbitrum', false),
  polygon: (hash) => getExplorerUrl(hash, 'polygon', false),
  solana: (hash) => getExplorerUrl(hash, 'solana', false),
  // Legacy/other
  tron: (hash) => getExplorerUrl(hash, 'tron', false),
  bitcoin: (hash) => getExplorerUrl(hash, 'bitcoin', false),
  ethereumErc4337: (hash) => getExplorerUrl(hash, 'ethereum', false),
  baseErc4337: (hash) => getExplorerUrl(hash, 'base', false),
  arbitrumErc4337: (hash) => getExplorerUrl(hash, 'arbitrum', false),
  polygonErc4337: (hash) => getExplorerUrl(hash, 'polygon', false),
  // Substrate/Polkadot chains
  polkadot: (hash) => getExplorerUrl(hash, 'polkadot', false),
  hydrationSubstrate: (hash) => getExplorerUrl(hash, 'hydrationSubstrate', false),
  bifrostSubstrate: (hash) => getExplorerUrl(hash, 'bifrostSubstrate', false),
  uniqueSubstrate: (hash) => getExplorerUrl(hash, 'uniqueSubstrate', false),
  paseo: (hash) => getExplorerUrl(hash, 'paseo', true), // Paseo is testnet
  paseoAssethub: (hash) => getExplorerUrl(hash, 'paseoAssethub', true), // Paseo AssetHub is testnet
};

const formatValue = (value: string, decimals: number = 18, tokenSymbol?: string): string => {
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return "0";
  const formatted = (num / Math.pow(10, decimals)).toFixed(6).replace(/\.?0+$/, "");
  return `${formatted} ${tokenSymbol || ""}`.trim();
};

const formatDate = (timestamp: number | null): string => {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp * 1000); // Assuming timestamp is in seconds
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const truncateAddress = (address: string | null): string => {
  if (!address) return "N/A";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Cache key for localStorage
const getCacheKey = (fingerprint: string) => `transactions_cache_${fingerprint}`;
const CACHE_TTL = 30 * 1000; // 30 seconds

// Helper to get cached transactions
const getCachedTransactions = (fingerprint: string): Transaction[] | null => {
  try {
    const cached = localStorage.getItem(getCacheKey(fingerprint));
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_TTL) {
      localStorage.removeItem(getCacheKey(fingerprint));
      return null;
    }

    return data;
  } catch {
    return null;
  }
};

// Helper to set cached transactions
const setCachedTransactions = (fingerprint: string, transactions: Transaction[]): void => {
  try {
    localStorage.setItem(getCacheKey(fingerprint), JSON.stringify({
      data: transactions,
      timestamp: Date.now(),
    }));
  } catch {
    // Ignore localStorage errors (quota exceeded, etc.)
  }
};

const RecentTransactions = ({ showAll = false, transactions: propTransactions, hideHeader = false, selectedChainId }: RecentTransactionsProps) => {
  const { fingerprint } = useBrowserFingerprint();
  const { wallets } = useWalletV2();

  // Create a set of all user wallet addresses for direction detection
  const userAddresses = useMemo(() => {
    return new Set(wallets.map(w => w.address.toLowerCase()));
  }, [wallets]);

  // Use provider data (provider is always available since we wrap app with Providers)
  const { transactions: providerTransactions, loading: providerLoading, errors: providerErrors, refresh: providerRefresh } = useWalletData();

  // Use prop transactions if provided, otherwise use provider transactions, otherwise use local state
  const useProviderData = propTransactions === undefined;
  const [localTransactions, setLocalTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine which data source to use
  const allTransactions = propTransactions ?? (useProviderData ? providerTransactions : localTransactions);

  // Apply chain filter if selectedChainId is provided
  const finalTransactions = useMemo(() => {
    if (!selectedChainId) return allTransactions;
    return allTransactions.filter(tx => tx.chain === selectedChainId);
  }, [allTransactions, selectedChainId]);

  const finalLoading = useProviderData ? providerLoading.transactions : loading;
  const finalError = useProviderData ? providerErrors.transactions : error;
  const refreshFn = useProviderData ? providerRefresh : undefined;

  const loadTransactions = useCallback(async () => {
    if (!fingerprint) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch aggregated any-chain transactions in one call
      const allTransactions = await walletApi.getTransactionsAny(fingerprint, showAll ? 100 : 20);

      // Load Substrate transactions for all Substrate chains
      const SUBSTRATE_CHAINS = ["polkadot", "hydrationSubstrate", "bifrostSubstrate", "uniqueSubstrate", "paseo", "paseoAssethub"];
      const substrateTransactions: Transaction[] = [];

      // Fetch Substrate transactions in parallel with proper error handling
      const substratePromises = SUBSTRATE_CHAINS.map(async (chain) => {
        try {
          const history = await walletApi.getSubstrateTransactions(fingerprint, chain, false, 10);
          // Transform Substrate transactions to Transaction format
          return history.transactions.map(tx => ({
            txHash: tx.txHash,
            from: tx.from,
            to: tx.to || null,
            value: tx.amount || '0',
            timestamp: tx.timestamp ? Math.floor(tx.timestamp / 1000) : null, // Convert ms to seconds if needed
            blockNumber: tx.blockNumber || null,
            status: tx.status === 'finalized' || tx.status === 'inBlock' ? 'success' :
              tx.status === 'failed' || tx.status === 'error' ? 'failed' : 'pending',
            chain: chain,
            tokenSymbol: undefined, // Substrate native token symbol would need to be fetched separately
          } as Transaction));
        } catch (chainErr) {
          console.warn(`Failed to load transactions for ${chain}:`, chainErr);
          return []; // Return empty array on error
        }
      });

      try {
        // Wait for all Substrate chain queries to complete (or fail)
        const substrateResults = await Promise.allSettled(substratePromises);
        substrateResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            substrateTransactions.push(...result.value);
          }
        });
      } catch (substrateErr) {
        console.warn('Failed to load Substrate transactions:', substrateErr);
        // Don't fail the whole load if Substrate fails
      }

      // Combine EVM and Substrate transactions
      const combinedTransactions = [...allTransactions, ...substrateTransactions];

      // Filter out transactions with invalid/missing data
      const validTransactions = combinedTransactions.filter(tx =>
        tx.txHash &&
        tx.txHash.length > 0 &&
        (tx.value !== undefined || tx.tokenSymbol !== undefined)
      );

      // Sort by timestamp (most recent first)
      validTransactions.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        return timeB - timeA;
      });

      // Limit to 20 for recent, all for full view
      const limited = showAll ? validTransactions : validTransactions.slice(0, 10);
      setLocalTransactions(limited);

      // Cache transactions for instant loading on tab switch
      if (fingerprint) {
        setCachedTransactions(fingerprint, limited);
      }
    } catch (err) {
      // Only show error if it's a critical error from the main EVM transaction fetch
      // Substrate transaction errors are handled gracefully above
      console.error('Failed to load transactions:', err);
      // Suppress error UI to show empty state instead
    } finally {
      setLoading(false);
    }
  }, [fingerprint, showAll]);

  useEffect(() => {
    // Only use local fetching if not using provider data
    if (!useProviderData && fingerprint) {
      // Try to load from cache first for instant display
      const cached = getCachedTransactions(fingerprint);
      if (cached && cached.length > 0) {
        setLocalTransactions(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }

      // Always refresh in background
      loadTransactions();

      // Auto-refresh every 30 seconds
      const interval = setInterval(() => {
        loadTransactions();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [fingerprint, loadTransactions, useProviderData]);

  const getTransactionExplorerUrl = (tx: Transaction): string => {
    // Determine if this is a testnet chain
    const isTestnet = tx.chain === 'paseo' || tx.chain === 'paseoAssethub' ||
      tx.chain === 'moonbeamTestnet' || tx.chain === 'astarShibuya' ||
      tx.chain === 'paseoPassetHub';

    return getExplorerUrl(tx.txHash, tx.chain, isTestnet);
  };

  // Helper function to determine if transaction is outgoing (kept for potential future use)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isOutgoing = (tx: Transaction, userAddress: string): boolean => {
    return tx.from.toLowerCase() === userAddress.toLowerCase();
  };

  // If hideHeader is true, render without container/wrapper (for toggle component)
  if (hideHeader) {
    return (
      <div className="w-full">
        {finalError && finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-500 mb-4 font-rubik-normal">{finalError}</p>
            <button
              onClick={refreshFn || loadTransactions}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 md:py-20">
            {/* Empty Mailbox GIF */}
            <div className="-mt-32">
              <Image
                src="/empty-mailbox-illustration-with-spiderweb-and-flie-2025-10-20-04-28-09-utc.gif"
                alt="Empty mailbox illustration"
                width={320}
                height={320}
                className="object-contain mix-blend-multiply"
              />
            </div>
            <p className="text-gray-600 text-lg md:text-xl font-rubik-medium z-10 -mt-16">
              No transactions yet
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {(showAll ? finalTransactions : finalTransactions.slice(0, 10)).map((tx) => {
              const direction = userAddresses.has(tx.to?.toLowerCase() || '') ? 'in' : 'out';
              const isSuccess = tx.status === 'success';
              const isFailed = tx.status === 'failed';
              const isPending = tx.status === 'pending';

              return (
                <a
                  key={`${tx.chain}-${tx.txHash}`}
                  href={getTransactionExplorerUrl(tx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-3 md:p-4 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-all shadow-sm group"
                >
                  <div className="flex items-center w-full overflow-hidden">
                    {/* Direction Icon (Fixed Width) */}
                    <div className={`flex-shrink-0 flex items-center justify-center rounded-full p-2 mr-3 sm:mr-4 ${direction === 'in' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                      {direction === 'in' ? (
                        <ArrowDownLeft className="w-6 h-6 md:w-8 md:h-8" />
                      ) : (
                        <ArrowUpRight className="w-6 h-6 md:w-8 md:h-8" />
                      )}
                    </div>

                    {/* Symbol/Direction Label (Fixed Width) */}
                    <div className="flex-shrink-0 w-16 sm:w-20">
                      <div className="text-base md:text-lg font-bold text-gray-900 font-rubik-medium truncate uppercase">
                        {direction === 'in' ? 'RCVD' : 'SENT'}
                      </div>
                      <div className="text-[10px] text-gray-400 font-rubik-normal">
                        {tx.tokenSymbol || 'ETH'}
                      </div>
                    </div>

                    {/* Chain Tag (Fixed Width) */}
                    <div className="flex-shrink-0 w-20 sm:w-24 ml-2 sm:ml-4">
                      <div className="text-[9px] md:text-[10px] text-blue-500 font-rubik-medium bg-blue-500/10 px-2 py-0.5 rounded-full leading-tight whitespace-nowrap inline-block">
                        {CHAIN_NAMES[tx.chain] || tx.chain}
                      </div>
                      <div className="text-[10px] text-gray-400 font-rubik-normal mt-1 flex items-center gap-1">
                        {isPending ? <Clock className="h-2 w-2" /> : null}
                        {isPending ? 'Pending' : formatDate(tx.timestamp)}
                      </div>
                    </div>

                    {/* Amount (Aligned Left) */}
                    <div className="flex-shrink-0 ml-4 sm:ml-8 flex-1 flex flex-col items-end">
                      <div className={`text-lg md:text-xl font-bold font-rubik-bold truncate ${direction === 'in' ? 'text-green-600' : 'text-gray-900'}`}>
                        {direction === 'in' ? '+' : '-'}{tx.tokenSymbol
                          ? formatValue(tx.value, 18)
                          : formatValue(tx.value, 18)
                        }
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono truncate max-w-[100px]">
                        {truncateAddress(tx.txHash)}
                      </div>
                    </div>

                    {/* External Link */}
                    <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors ml-4" />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`w-full bg-white rounded-3xl pt-4 pb-20 border-t border-gray-200 shadow-sm ${showAll
      ? "md:max-w-4xl md:rounded-3xl md:mx-auto min-h-[calc(100vh-450px)]"
      : "md:max-w-2xl md:mx-auto mt-4 overflow-y-auto max-h-[calc(100vh-450px)]"
      }`}>
      {/* Top Divider */}
      <div className="flex justify-center mb-2 px-4 md:px-6">
        <div className="w-10 h-1 bg-gray-200 rounded-full"></div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-4 md:px-6">
        <h2 className="text-gray-900 text-lg md:text-2xl font-rubik-bold">
          {showAll ? "All Transactions" : "Recent Transactions"}
        </h2>
        <div className="flex items-center gap-4">
          {!showAll && (
            <Link href="/transactions" className="text-gray-500 text-sm md:text-base hover:opacity-70 transition-opacity">
              See all
            </Link>
          )}
          <button
            onClick={refreshFn || loadTransactions}
            disabled={finalLoading}
            className="text-gray-500 text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
          >
            {finalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </button>
        </div>
      </div>

      {/* Transactions List */}
      <div className="px-4 md:px-6">
        {finalError && finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-500 mb-4 font-rubik-normal">{finalError}</p>
            <button
              onClick={refreshFn || loadTransactions}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 md:py-20">
            {/* Empty Mailbox GIF */}
            <div className="-mt-32">
              <Image
                src="/empty-mailbox-illustration-with-spiderweb-and-flie-2025-10-20-04-28-09-utc.gif"
                alt="Empty mailbox illustration"
                width={320}
                height={320}
                className="object-contain mix-blend-multiply"
              />
            </div>
            <p className="text-gray-600 text-lg md:text-xl font-rubik-medium z-10 -mt-16">
              No transactions yet
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {(showAll ? finalTransactions : finalTransactions.slice(0, 10)).map((tx) => {
              const direction = userAddresses.has(tx.to?.toLowerCase() || '') ? 'in' : 'out';
              const isSuccess = tx.status === 'success';
              const isFailed = tx.status === 'failed';
              const isPending = tx.status === 'pending';

              return (
                <a
                  key={`${tx.chain}-${tx.txHash}`}
                  href={getTransactionExplorerUrl(tx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-3 md:p-4 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-all shadow-sm group"
                >
                  <div className="flex items-center w-full overflow-hidden">
                    {/* Direction Icon (Fixed Width) */}
                    <div className={`flex-shrink-0 flex items-center justify-center rounded-full p-2 mr-3 sm:mr-4 ${direction === 'in' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                      {direction === 'in' ? (
                        <ArrowDownLeft className="w-6 h-6 md:w-8 md:h-8" />
                      ) : (
                        <ArrowUpRight className="w-6 h-6 md:w-8 md:h-8" />
                      )}
                    </div>

                    {/* Symbol/Direction Label (Fixed Width) */}
                    <div className="flex-shrink-0 w-16 sm:w-20">
                      <div className="text-base md:text-lg font-bold text-gray-900 font-rubik-medium truncate uppercase">
                        {direction === 'in' ? 'RCVD' : 'SENT'}
                      </div>
                      <div className="text-[10px] text-gray-400 font-rubik-normal">
                        {tx.tokenSymbol || 'ETH'}
                      </div>
                    </div>

                    {/* Chain Tag (Fixed Width) */}
                    <div className="flex-shrink-0 w-20 sm:w-24 ml-2 sm:ml-4">
                      <div className="text-[9px] md:text-[10px] text-blue-500 font-rubik-medium bg-blue-500/10 px-2 py-0.5 rounded-full leading-tight whitespace-nowrap inline-block">
                        {CHAIN_NAMES[tx.chain] || tx.chain}
                      </div>
                      <div className="text-[10px] text-gray-400 font-rubik-normal mt-1 flex items-center gap-1">
                        {isPending ? <Clock className="h-2 w-2" /> : null}
                        {isPending ? 'Pending' : formatDate(tx.timestamp)}
                      </div>
                    </div>

                    {/* Amount (Aligned Left) */}
                    <div className="flex-shrink-0 ml-4 sm:ml-8 flex-1 flex flex-col items-end">
                      <div className={`text-lg md:text-xl font-bold font-rubik-bold truncate ${direction === 'in' ? 'text-green-600' : 'text-gray-900'}`}>
                        {direction === 'in' ? '+' : '-'}{tx.tokenSymbol
                          ? formatValue(tx.value, 18)
                          : formatValue(tx.value, 18)
                        }
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono truncate max-w-[100px]">
                        {truncateAddress(tx.txHash)}
                      </div>
                    </div>

                    {/* External Link */}
                    <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors ml-4" />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentTransactions;
