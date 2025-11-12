"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Loader2, ArrowUpRight, ArrowDownLeft, ExternalLink, Clock } from "lucide-react";
import { walletApi, Transaction, ApiError } from "@/lib/api";
import { useBrowserFingerprint } from "@/hooks/useBrowserFingerprint";

interface RecentTransactionsProps {
  showAll?: boolean;
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
};

const CHAIN_EXPLORER_URLS: Record<string, (txHash: string) => string> = {
  // Zerion canonical chain ids
  ethereum: (hash) => `https://etherscan.io/tx/${hash}`,
  base: (hash) => `https://basescan.org/tx/${hash}`,
  arbitrum: (hash) => `https://arbiscan.io/tx/${hash}`,
  polygon: (hash) => `https://polygonscan.com/tx/${hash}`,
  solana: (hash) => `https://solscan.io/tx/${hash}`,
  // Legacy/other
  tron: (hash) => `https://tronscan.org/#/transaction/${hash}`,
  bitcoin: (hash) => `https://blockstream.info/tx/${hash}`,
  ethereumErc4337: (hash) => `https://etherscan.io/tx/${hash}`,
  baseErc4337: (hash) => `https://basescan.org/tx/${hash}`,
  arbitrumErc4337: (hash) => `https://arbiscan.io/tx/${hash}`,
  polygonErc4337: (hash) => `https://polygonscan.com/tx/${hash}`,
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

const RecentTransactions = ({ showAll = false }: RecentTransactionsProps) => {
  const { fingerprint } = useBrowserFingerprint();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    if (!fingerprint) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch aggregated any-chain transactions in one call
      const allTransactions = await walletApi.getTransactionsAny(fingerprint, showAll ? 100 : 20);
      
      // Filter out transactions with invalid/missing data
      const validTransactions = allTransactions.filter(tx => 
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
      setTransactions(limited);
      
      // Cache transactions for instant loading on tab switch
      if (fingerprint) {
        setCachedTransactions(fingerprint, limited);
      }
    } catch (err) {
      const errorMessage = err instanceof ApiError 
        ? err.message 
        : "Failed to load transactions";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [fingerprint, showAll]);

  useEffect(() => {
    if (fingerprint) {
      // Try to load from cache first for instant display
      const cached = getCachedTransactions(fingerprint);
      if (cached && cached.length > 0) {
        setTransactions(cached);
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
  }, [fingerprint, loadTransactions]);

  const getExplorerUrl = (tx: Transaction): string => {
    const explorerFn = CHAIN_EXPLORER_URLS[tx.chain];
    return explorerFn ? explorerFn(tx.txHash) : "#";
  };

  const isOutgoing = (tx: Transaction, userAddress: string): boolean => {
    return tx.from.toLowerCase() === userAddress.toLowerCase();
  };

  return (
    <div className={`w-full bg-white rounded-t-3xl pt-4 pb-20 border-t border-gray-200 shadow-sm ${
      showAll
        ? "md:max-w-4xl md:rounded-3xl md:mx-auto"
        : "md:max-w-2xl md:mx-auto -mt-12 md:mt-4 overflow-y-auto max-h-[calc(100vh-350px)]"
    }`}>
      {/* Top Divider */}
      <div className="flex justify-center mb-2 px-4 md:px-6">
        <div className="w-10 h-1 bg-gray-200 rounded-full"></div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-4 md:px-6">
        <h2 className="text-gray-900 text-lg md:text-2xl">
          {showAll ? "All Transactions" : "Recent Transactions"}
        </h2>
        {!showAll && (
          <Link href="/transactions" className="text-gray-500 text-sm md:text-base hover:opacity-70 transition-opacity">
            See all
          </Link>
        )}
        <button
          onClick={loadTransactions}
          disabled={loading}
          className="text-gray-500 text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </button>
      </div>

      {/* Transactions List */}
      <div className="px-4 md:px-6">
        {loading && transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
            <p className="text-gray-500">Loading transactions...</p>
          </div>
        ) : error && transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-500 mb-4">{error}</p>
            <button
              onClick={loadTransactions}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 md:py-20">
            {/* Empty Mailbox GIF */}
            <div className="-mt-32">
              <img
                src="/empty-mailbox-illustration-with-spiderweb-and-flie-2025-10-20-04-28-09-utc.gif"
                alt="Empty mailbox illustration"
                className="w-80 h-80 md:w-90 md:h-90 object-contain mix-blend-multiply"
              />
            </div>
            <p className="text-gray-600 text-lg md:text-xl font-medium z-10 -mt-16">
              No transactions yet
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <a
                key={`${tx.chain}-${tx.txHash}`}
                href={getExplorerUrl(tx)}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-4 rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    {/* Transaction Icon */}
                    <div className={`p-2 rounded-full ${
                      tx.status === 'success' 
                        ? 'bg-green-100 text-green-600' 
                        : tx.status === 'failed'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-yellow-100 text-yellow-600'
                    }`}>
                      {tx.status === 'pending' ? (
                        <Clock className="h-5 w-5" />
                      ) : (
                        tx.from && tx.to ? (
                          <ArrowUpRight className="h-5 w-5" />
                        ) : (
                          <ArrowDownLeft className="h-5 w-5" />
                        )
                      )}
                    </div>

                    {/* Transaction Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900 truncate">
                          {CHAIN_NAMES[tx.chain] || tx.chain}
                        </p>
                        {tx.status === 'pending' && (
                          <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded">
                            Pending
                          </span>
                        )}
                        {tx.status === 'failed' && (
                          <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">
                            Failed
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        {tx.tokenSymbol 
                          ? formatValue(tx.value, 18, tx.tokenSymbol)
                          : formatValue(tx.value, 18)
                        }
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDate(tx.timestamp)}
                      </p>
                    </div>
                  </div>

                  {/* External Link Icon */}
                  <ExternalLink className="h-5 w-5 text-gray-400 flex-shrink-0 ml-2" />
                </div>

                {/* Transaction Hash (truncated) */}
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 font-mono">
                    {truncateAddress(tx.txHash)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentTransactions;
