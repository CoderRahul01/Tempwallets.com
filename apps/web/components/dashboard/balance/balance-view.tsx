'use client';

'use client';

import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import { Loader2, Zap, Info } from 'lucide-react';
import { walletApi, TokenBalance, ApiError } from '@/lib/api';
import { TokenBalanceItem } from './token-balance-item';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/ui/tooltip';
import { useAuth } from '@/hooks/useAuth';

export const CHAIN_NAMES: Record<string, string> = {
  // Zerion canonical chain ids
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  solana: 'Solana',
  avalanche: 'Avalanche',
  // Legacy/internal
  tron: 'Tron',
  bitcoin: 'Bitcoin',
  // Polkadot EVM Compatible chains
  moonbeamTestnet: 'Moonbeam Testnet',
  astarShibuya: 'Astar Shibuya',
  paseoPassetHub: 'Paseo PassetHub',
  // Substrate/Polkadot chains
  polkadot: 'Polkadot',
  hydrationSubstrate: 'Hydration',
  bifrostSubstrate: 'Bifrost',
  uniqueSubstrate: 'Unique',
  paseo: 'Paseo',
  paseoAssethub: 'Paseo AssetHub',
  // Testnets
  sepolia: 'Sepolia Testnet',
  // Gasless/Smart Account variants
  ethereumErc4337: 'Ethereum',
  baseErc4337: 'Base',
  arbitrumErc4337: 'Arbitrum',
  polygonErc4337: 'Polygon',
  avalancheErc4337: 'Avalanche',
  ethereumGasless: 'Ethereum',
  baseGasless: 'Base',
  arbitrumGasless: 'Arbitrum',
  polygonGasless: 'Polygon',
};

interface BalanceViewProps {
  selectedChainId: string;
}

/**
 * Container component that displays token balances
 * Fetches balances directly using walletApi to match send flow consistency
 */
export function BalanceView({ selectedChainId }: BalanceViewProps) {
  const { userId } = useAuth();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchBalances = async () => {
      // Trace consistent ID usage
      if (!userId || !selectedChainId) return;

      setLoading(true);
      setError(null);
      // Clear previous balances while loading new chain to avoid confusion
      setBalances([]);

      try {
        // Check if this is a Substrate chain
        const SUBSTRATE_CHAINS = ["polkadot", "hydrationSubstrate", "bifrostSubstrate", "uniqueSubstrate", "paseo", "paseoAssethub"];
        const isSubstrate = SUBSTRATE_CHAINS.includes(selectedChainId);

        // Check if this is an Aptos chain
        const APTOS_CHAINS = ["aptos", "aptosTestnet"];
        const isAptos = APTOS_CHAINS.includes(selectedChainId);

        let fetchedBalances: TokenBalance[] = [];

        if (isSubstrate) {
          // Load Substrate balances
          const substrateBalances = await walletApi.getSubstrateBalances(userId, false);
          const chainBalance = substrateBalances[selectedChainId];

          if (chainBalance && chainBalance.address) {
            fetchedBalances = [{
              address: null,
              symbol: chainBalance.token,
              balance: chainBalance.balance,
              decimals: chainBalance.decimals,
              chain: selectedChainId,
            }];
          }
        } else if (isAptos) {
          // Load Aptos balance
          const network = selectedChainId === "aptosTestnet" ? "testnet" : "mainnet";
          const balanceData = await walletApi.getAptosBalance(userId, network);

          // Convert to smallest units for consistency (assuming 8 decimals for APT)
          // Note: API might return human readable, need to check. 
          // Based on send-crypto-modal, it returns human readable and needs conversion
          fetchedBalances = [{
            address: null,
            symbol: "APT",
            balance: (parseFloat(balanceData.balance) * Math.pow(10, 8)).toString(),
            decimals: 8,
            chain: selectedChainId,
            // @ts-ignore - Adding extra prop for UI consistency if needed
            balanceHuman: balanceData.balance
          }];
        } else {
          // Fetch balances (RPC-based/Zerion, filtered by chain)
          // FORCE refreshing to ensure we get latest data and clear any stale "empty" cache
          fetchedBalances = await walletApi.getTokenBalances(userId, selectedChainId, true);
        }

        if (mounted) {
          setBalances(fetchedBalances);
        }
      } catch (err) {
        if (mounted) {
          console.error('[BalanceView] Failed to fetch balances:', err);
          setError('Failed to load balances');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchBalances();

    return () => {
      mounted = false;
    };
  }, [userId, selectedChainId]);

  const totalUsdForChain = useMemo(() => {
    // Assuming the API returns usdValue, sum it up
    // Note: TokenBalance interface in api.ts doesn't explicitly have usdValue but data often has it
    return balances.reduce((sum, b: any) => sum + (b.usdValue || 0), 0);
  }, [balances]);

  // Sort: native first, then by symbol
  const sortedBalances = useMemo(() => {
    return [...balances].sort((a, b) => {
      const isANative = !a.address;
      const isBNative = !b.address;
      if (isANative && !isBNative) return -1;
      if (!isANative && isBNative) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [balances]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
        <p className="text-gray-500 font-rubik-normal text-center">
          Searching for balances...
        </p>
      </div>
    );
  }

  // Show empty state
  if (balances.length === 0) {
    return (
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
          {error ? error : "No Balance Available"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Total Balance and Unified Balance Button */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm text-gray-500 font-rubik-normal uppercase tracking-wider">Total Balance</span>
          <span className="text-2xl md:text-3xl font-bold text-gray-900 font-rubik-bold">
            ${totalUsdForChain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                disabled
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg cursor-not-allowed opacity-60 border border-gray-200"
              >
                <Zap className="h-3.5 w-3.5" />
                Unified Balance
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">
                Add funds to your Lightning Network unified balance for gasless transfers. Coming soon!
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-2">
        <div className="space-y-2">
          {sortedBalances.map((balance, index) => {
            const isNative = !balance.address;
            const key = isNative
              ? `${selectedChainId}-native-${index}`
              : `${selectedChainId}-${balance.address}-${index}`;

            // Calculate human readable balance if not provided
            let balanceHuman = (balance as any).balanceHuman;
            if (!balanceHuman) {
              const num = parseFloat(balance.balance);
              if (!isNaN(num)) {
                balanceHuman = (num / Math.pow(10, balance.decimals)).toString();
              } else {
                balanceHuman = "0";
              }
            }

            return (
              <TokenBalanceItem
                key={key}
                chain={selectedChainId} // Use selectedChainId directly
                symbol={balance.symbol}
                balance={balance.balance}
                decimals={balance.decimals}
                balanceHuman={balanceHuman}
                isNative={isNative}
                usdValue={(balance as any).usdValue}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

