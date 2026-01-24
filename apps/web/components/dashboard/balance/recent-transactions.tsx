"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, ArrowUpRight, ArrowDownLeft, ExternalLink, Clock } from "lucide-react";
import { walletApi, Transaction } from "@/lib/api";
import { useBrowserFingerprint } from "@/hooks/useBrowserFingerprint";

import { useWalletV2 } from "@/hooks/useWalletV2";

import { useAuth } from '@/hooks/useAuth';

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

// Explorer URLs are handled by getExplorerUrl function below
// Helper to truncate transaction hash
const truncateTxHash = (hash: string | null): string => {
  if (!hash) return "N/A";
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
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

const TransactionItem = ({
  tx,
  direction,
  isPending,
  getTransactionExplorerUrl,
  truncateAddress,
  truncateTxHash,
  formatValue,
  formatDate,
  CHAIN_NAMES
}: {
  tx: Transaction,
  direction: 'in' | 'out',
  isPending: boolean,
  getTransactionExplorerUrl: (tx: Transaction) => string,
  truncateAddress: (addr: string | null) => string,
  truncateTxHash: (hash: string | null) => string,
  formatValue: (val: string, dec?: number, sym?: string) => string,
  formatDate: (ts: number | null) => string,
  CHAIN_NAMES: Record<string, string>
}) => (
  <a
    key={`${tx.chain}-${tx.txHash}`}
    href={getTransactionExplorerUrl(tx)}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center p-3 md:p-4 rounded-2xl border border-gray-100 bg-white hover:border-gray-200 transition-all shadow-sm group"
  >
    <div className="flex items-center w-full overflow-hidden">
      {/* Direction Icon (Fixed Width) */}
      <div className={`flex-shrink-0 flex items-center justify-center rounded-full p-2 mr-3 sm:mr-4 ${direction === 'in' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
        {direction === 'in' ? (
          <ArrowDownLeft className="w-5 h-5 md:w-6 md:h-6" />
        ) : (
          <ArrowUpRight className="w-5 h-5 md:w-6 md:h-6" />
        )}
      </div>

      {/* Symbol/Direction Label (Fixed Width) */}
      <div className="flex-shrink-0 w-24 sm:w-28">
        <div className="text-sm md:text-base font-bold text-gray-900 font-rubik-medium truncate uppercase">
          {direction === 'in' ? 'Received' : 'Sent'}
        </div>
        <div className="text-[10px] text-gray-500 font-rubik-normal truncate">
          {direction === 'in' ? `From: ${truncateAddress(tx.from)}` : `To: ${truncateAddress(tx.to)}`}
        </div>
      </div>

      {/* Chain Tag & Time (Fixed Width) */}
      <div className="flex-shrink-0 w-20 sm:w-24 ml-auto px-2">
        <div className="text-[9px] md:text-[10px] text-blue-500 font-rubik-medium bg-blue-50 px-2 py-0.5 rounded-full leading-tight whitespace-nowrap inline-block text-center w-full">
          {CHAIN_NAMES[tx.chain] || tx.chain}
        </div>
        <div className="text-[10px] text-gray-400 font-rubik-normal mt-1 flex items-center justify-center gap-1">
          {isPending ? <Clock className="h-2 w-2" /> : null}
          {isPending ? 'Pending' : formatDate(tx.timestamp)}
        </div>
      </div>

      {/* Amount (Aligned Right) */}
      <div className="flex-shrink-0 ml-4 flex flex-col items-end min-w-[90px]">
        <div className={`text-base md:text-lg font-bold font-rubik-bold truncate ${direction === 'in' ? 'text-green-600' : 'text-gray-900'}`}>
          {direction === 'in' ? '+' : '-'}{formatValue(tx.value, 18, tx.tokenSymbol)}
        </div>
        <div className="text-[10px] text-gray-400 font-mono truncate">
          {truncateTxHash(tx.txHash)}
        </div>
      </div>
    </div>
  </a>
);



const RecentTransactions = ({ showAll = false, transactions: propTransactions, hideHeader = false, selectedChainId }: RecentTransactionsProps) => {
  const { wallets } = useWalletV2();
  const { userId } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create a set of all user wallet addresses for direction detection
  const userAddresses = useMemo(() => {
    return new Set(wallets.map(w => w.address.toLowerCase()));
  }, [wallets]);

  const fetchTransactions = useCallback(async () => {
    if (!userId) return;

    // Use prop transactions if provided and no chain filter
    if (propTransactions && !selectedChainId) {
      setTransactions(propTransactions);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Unified View: Always fetch transactions from all chains
      // Backend's getTransactionsAny aggregates from Zerion and other sources
      const fetchedTransactions = await walletApi.getTransactionsAny(userId, 50);

      // Sort by timestamp
      const sorted = fetchedTransactions.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        return timeB - timeA;
      });

      setTransactions(sorted);
    } catch (err) {
      console.error('Failed to load transactions:', err);
      setError('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [userId, propTransactions]); // Removed selectedChainId dependency from fetch logic


  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const refreshFn = fetchTransactions;

  // Use prop transactions if provided and we are strictly using props (legacy mode), 
  // BUT if selectedChainId is present, we prefer the fetched data for that chain.
  // Actually, the new logic above handles fetching if selectedChainId is set.
  // If propTransactions is passed AND selectedChainId is passed, maybe we should filter props? 
  // But the goal is to fetch fresh data.
  // Let's rely on state 'transactions'.

  const finalTransactions = transactions;
  const isRefreshing = loading;

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
        {error && finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-500 mb-4 font-rubik-normal">{error}</p>
            <button
              onClick={refreshFn}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : isRefreshing && finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
            <p className="text-gray-500 font-rubik-normal text-center">
              Searching for transactions...
            </p>
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
              const isPending = tx.status === 'pending';

              return (
                <TransactionItem
                  key={`${tx.chain}-${tx.txHash}`}
                  tx={tx}
                  direction={direction}
                  isPending={isPending}
                  getTransactionExplorerUrl={getTransactionExplorerUrl}
                  truncateAddress={truncateAddress}
                  truncateTxHash={truncateTxHash}
                  formatValue={formatValue}
                  formatDate={formatDate}
                  CHAIN_NAMES={CHAIN_NAMES}
                />
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
            onClick={refreshFn}
            disabled={loading}
            className="text-gray-500 text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
          </button>
        </div>
      </div>

      {/* Transactions List */}
      <div className="px-4 md:px-6">
        {error && finalTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-500 mb-4 font-rubik-normal">{error}</p>
            <button
              onClick={refreshFn}
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
              const isPending = tx.status === 'pending';

              return (
                <TransactionItem
                  key={`${tx.chain}-${tx.txHash}`}
                  tx={tx}
                  direction={direction}
                  isPending={isPending}
                  getTransactionExplorerUrl={getTransactionExplorerUrl}
                  truncateAddress={truncateAddress}
                  truncateTxHash={truncateTxHash}
                  formatValue={formatValue}
                  formatDate={formatDate}
                  CHAIN_NAMES={CHAIN_NAMES}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecentTransactions;
