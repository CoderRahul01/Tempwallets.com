'use client';

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, ArrowUpRight, ArrowDownLeft, ExternalLink, Clock, Repeat, ArrowRight } from "lucide-react";
import { walletApi, Transaction } from "@/lib/api";
import { useBrowserFingerprint } from "@/hooks/useBrowserFingerprint";

import { useWalletV2 } from "@/hooks/useWalletV2";
import { useAuth } from '@/hooks/useAuth';
import { useTokenIcon } from '@/lib/token-icons';
import { useWalletConfig } from '@/hooks/useWalletConfig';

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
  avalanche: "Avalanche",
  // Legacy/other
  tron: "Tron",
  bitcoin: "Bitcoin",
  ethereumErc4337: "Ethereum",
  baseErc4337: "Base",
  arbitrumErc4337: "Arbitrum",
  polygonErc4337: "Polygon",
  avalancheErc4337: "Avalanche",
  // Substrate/Polkadot chains
  polkadot: "Polkadot",
  hydrationSubstrate: "Hydration",
  bifrostSubstrate: "Bifrost",
  uniqueSubstrate: "Unique",
  paseo: "Paseo",
  paseoAssethub: "Paseo AssetHub",
  // Testnets
  moonbeamTestnet: "Moonbeam Testnet",
  astarShibuya: "Astar Shibuya",
  paseoPassetHub: "Paseo PassetHub",
};

/**
 * Format transaction hash for block explorer
 */
const formatTxHash = (hash: string): string => {
  if (!hash) return '';
  return hash;
};

/**
 * Get block explorer URL for a transaction
 */
const getExplorerUrl = (txHash: string, chain: string, isTestnet: boolean = false): string => {
  if (!txHash) return '#';

  const evmExplorers: Record<string, { mainnet: string; testnet?: string }> = {
    ethereum: { mainnet: 'https://etherscan.io', testnet: 'https://sepolia.etherscan.io' },
    base: { mainnet: 'https://basescan.org', testnet: 'https://sepolia.basescan.org' },
    arbitrum: { mainnet: 'https://arbiscan.io', testnet: 'https://sepolia.arbiscan.io' },
    polygon: { mainnet: 'https://polygonscan.com', testnet: 'https://mumbai.polygonscan.com' },
    avalanche: { mainnet: 'https://snowtrace.io', testnet: 'https://testnet.snowtrace.io' },
  };

  const evmChain = chain.replace('Erc4337', '');
  if (evmExplorers[evmChain]) {
    const explorer = isTestnet && evmExplorers[evmChain].testnet
      ? evmExplorers[evmChain].testnet
      : evmExplorers[evmChain].mainnet;
    return `${explorer}/tx/${txHash}`;
  }

  const nonEvmExplorers: Record<string, string> = {
    tron: `https://tronscan.org/#/transaction/${txHash}`,
    bitcoin: `https://blockstream.info/tx/${txHash}`,
    solana: `https://solscan.io/tx/${txHash}`,
  };

  if (nonEvmExplorers[chain]) {
    return nonEvmExplorers[chain];
  }

  return '#';
};

// Explorer URLs are handled by getExplorerUrl function below
// Helper to truncate transaction hash
const truncateTxHash = (hash: string | null): string => {
  if (!hash) return "N/A";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

const formatValue = (value: string, decimals: number = 18, tokenSymbol?: string): string => {
  if (!value || value === "0") return "0";
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return "0";

  const humanValue = num / Math.pow(10, decimals);

  // If it's very small but non-zero, show more decimals
  let formatted;
  if (humanValue > 0 && humanValue < 0.000001) {
    formatted = humanValue.toFixed(10).replace(/\.?0+$/, "");
  } else if (humanValue > 0 && humanValue < 0.01) {
    formatted = humanValue.toFixed(6).replace(/\.?0+$/, "");
  } else {
    formatted = humanValue.toFixed(4).replace(/\.?0+$/, "");
  }

  return `${formatted} ${tokenSymbol || ""}`.trim();
};

const formatTime = (timestamp: number | null): string => {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

const groupTransactionsByDate = (transactions: Transaction[]) => {
  const groups: Record<string, Transaction[]> = {};
  transactions.forEach(tx => {
    if (!tx.timestamp) return;
    const date = new Date(tx.timestamp * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(tx);
  });
  return Object.entries(groups).sort((a, b) => {
    return new Date(b[0]).getTime() - new Date(a[0]).getTime();
  });
};

const TransactionItem = ({
  tx,
  direction,
  isPending,
  getTransactionExplorerUrl,
  formatValue,
}: {
  tx: Transaction,
  direction: 'in' | 'out',
  isPending: boolean,
  getTransactionExplorerUrl: (tx: Transaction) => string,
  formatValue: (val: string, dec?: number, sym?: string) => string,
}) => {
  const isSwap = tx.type === 'trade';
  const Icon = useTokenIcon(tx.chain, tx.tokenSymbol || 'ETH');
  const walletConfig = useWalletConfig();

  const chainId = tx.chain?.replace('Erc4337', '') || 'ethereum';
  const config = walletConfig.getById(tx.chain?.endsWith('Erc4337') ? tx.chain : chainId);
  const chainColor = config?.color || '#627EEA';

  // Activity Info
  return (
    <a
      href={getTransactionExplorerUrl(tx)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center p-3 md:px-6 md:py-4 hover:bg-gray-50/50 transition-colors group relative border-b border-gray-50 last:border-0"
    >
      <div className="flex items-center w-full relative z-10">
        {/* Left: Icon Container with Chain Badge */}
        <div className="relative flex-shrink-0 mr-4">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center bg-gray-50 border border-gray-100 shadow-sm overflow-hidden p-1.5 transition-transform group-hover:scale-105">
            <Icon
              className="w-full h-full"
              style={{ fill: isSwap ? '#A855F7' : (direction === 'in' ? '#22C55E' : '#3B82F6') }}
            />
          </div>
          {/* Status Overlay Icon */}
          <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center shadow-sm ${isSwap ? 'bg-purple-500' : direction === 'in' ? 'bg-green-500' : 'bg-blue-500'
            }`}>
            {isSwap ? <Repeat className="w-2.5 h-2.5 text-white" /> :
              direction === 'in' ? <ArrowDownLeft className="w-2.5 h-2.5 text-white" /> :
                <ArrowUpRight className="w-2.5 h-2.5 text-white" />}
          </div>
        </div>

        {/* Middle: Activity Info */}
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-gray-900 font-rubik-bold text-sm md:text-base capitalize">
              {direction === 'in' ? 'Received' : 'Sent'} {tx.tokenSymbol || 'ETH'}
            </span>
            {isPending && (
              <span className="flex items-center gap-1 text-[10px] bg-yellow-50 text-yellow-600 px-1.5 py-0.5 rounded-full font-rubik-medium border border-yellow-100 animate-pulse">
                Pending
              </span>
            )}
            <span className="text-[10px] text-gray-400 font-rubik-medium uppercase tracking-wider bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
              {chainId}
            </span>
          </div>
          <div className="flex items-center text-xs text-gray-500 gap-1.5 font-rubik-normal truncate">
            <span className={tx.status === 'failed' ? 'text-red-500' : 'text-green-500 font-rubik-medium'}>
              {tx.status === 'success' ? 'Confirmed' : tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
            </span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <span>{formatTime(tx.timestamp)}</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <span className="text-gray-400">
              {direction === 'in' ? `From: ${truncateAddress(tx.from)}` : `To: ${truncateAddress(tx.to)}`}
            </span>
          </div>
        </div>

        {/* Right: Value */}
        <div className="text-right flex-shrink-0 ml-4">
          <div className={`font-rubik-bold text-sm md:text-base ${direction === 'in' ? 'text-green-600' : 'text-gray-900'
            }`}>
            {direction === 'in' ? '+' : '-'}{formatValue(tx.value, tx.tokenDecimals, tx.tokenSymbol)}
          </div>
          {tx.usdValue !== undefined && (
            <div className="text-[10px] md:text-xs text-gray-400 font-rubik-normal">
              ${tx.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>
    </a>
  );
};



const RecentTransactions = ({ showAll = false, transactions: propTransactions, hideHeader = false, selectedChainId }: RecentTransactionsProps) => {
  const { wallets } = useWalletV2();
  const { userId } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());

  // Create a set of all user wallet addresses for direction detection
  const userAddresses = useMemo(() => {
    if (!wallets) return new Set<string>();
    return new Set(wallets.map(w => w.address?.toLowerCase()).filter(Boolean));
  }, [wallets]);

  const fetchTransactions = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await walletApi.getTransactionsAny(userId, 100);
      setTransactions(data);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
      setError('Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!userId) return;

    // Initial fetch
    fetchTransactions();

    // Subscribe to SSE
    const unsubscribe = walletApi.subscribeToTransactions(userId, (newBatch) => {
      setTransactions((prev) => {
        // Merge and deduplicate by hash + chain
        const seen = new Set(prev.map(tx => `${tx.chain}:${tx.txHash}`));
        const filteredNew = newBatch.filter(tx => !seen.has(`${tx.chain}:${tx.txHash}`));

        if (filteredNew.length === 0) return prev;

        const merged = [...filteredNew, ...prev];
        // Sort by timestamp desc
        return merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
      setLastUpdated(Date.now());
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId, fetchTransactions]);

  // Use prop transactions if provided and we are strictly using props (legacy mode), 
  // BUT if selectedChainId is present, we prefer the fetched data for that chain.
  // Actually, the new logic above handles fetching if selectedChainId is set.
  // If propTransactions is passed AND selectedChainId is passed, maybe we should filter props? 
  // Let's rely on state 'transactions'.

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

  const groupedTransactions = useMemo(() => {
    if (!transactions || !Array.isArray(transactions)) return [];
    const list = showAll ? transactions : transactions.slice(0, 10);
    return groupTransactionsByDate(list);
  }, [transactions, showAll]);

  const renderContent = () => {
    if (error && transactions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <p className="text-red-500 font-rubik-medium mb-4">{error}</p>
          <button
            onClick={fetchTransactions}
            className="px-6 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors shadow-sm"
          >
            Retry Fetch
          </button>
        </div>
      );
    }

    if (loading && transactions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-4" />
          <p className="text-gray-600 font-rubik-medium">Fetching your activity...</p>
        </div>
      );
    }

    if (!transactions || transactions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-gray-50 rounded-full p-6 mb-4">
            <Repeat className="w-12 h-12 text-gray-300" />
          </div>
          <p className="text-gray-900 text-xl font-rubik-bold mb-2">
            No Transactions Yet
          </p>
          <p className="text-gray-500 max-w-xs mx-auto text-sm">
            Activity from all your connected networks will appear here once you start transacting.
          </p>
        </div>
      );
    }

    if (groupedTransactions.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-gray-500 font-rubik-normal text-lg">No grouped data found</p>
          <code className="mt-2 text-xs text-gray-400 bg-gray-50 p-2 rounded">Raw count: {transactions.length}</code>
        </div>
      );
    }

    return (
      <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl">
        {groupedTransactions.map(([date, txs]) => (
          <div key={date}>
            <div className="px-4 md:px-6 py-3 bg-gray-50 text-[11px] font-rubik-bold text-gray-500 uppercase tracking-widest sticky top-0 z-20 border-y border-gray-100">
              {date}
            </div>
            <div className="divide-y divide-gray-50">
              {txs.map((tx) => {
                const direction = userAddresses.has(tx.to?.toLowerCase() || '') ? 'in' : 'out';
                const isPending = tx.status === 'pending';
                return (
                  <TransactionItem
                    key={`${tx.chain}-${tx.txHash}-${tx.timestamp || Date.now()}`}
                    tx={tx}
                    direction={direction}
                    isPending={isPending}
                    getTransactionExplorerUrl={getTransactionExplorerUrl}
                    formatValue={formatValue}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (hideHeader) {
    return (
      <div className="w-full bg-white min-h-[400px]">
        {renderContent()}
      </div>
    );
  }

  return (
    <div className={`w-full bg-white rounded-3xl pt-4 pb-12 border border-gray-200 shadow-sm ${showAll
      ? "md:max-w-4xl md:rounded-3xl md:mx-auto min-h-[500px]"
      : "md:max-w-2xl md:mx-auto mt-4 overflow-y-auto max-h-[calc(100vh-450px)]"
      }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 px-4 md:px-6">
        <h2 className="text-gray-900 text-lg md:text-xl font-rubik-bold">
          {showAll ? "All Activity" : "Recent Activity"}
        </h2>
        <div className="flex items-center gap-4">
          {!showAll && (
            <Link href="/transactions" className="text-blue-500 text-sm font-rubik-medium hover:underline flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          )}
          <button
            onClick={fetchTransactions}
            disabled={loading}
            className="text-gray-400 hover:text-blue-500 transition-all bg-gray-50 p-2 rounded-xl border border-gray-100 hover:border-blue-100"
          >
            <Loader2 className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1">
        {renderContent()}
      </div>
    </div>
  );
};

export default RecentTransactions;
